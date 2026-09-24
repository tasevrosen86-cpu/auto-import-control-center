// Guards the publisher's queries against schema drift.
//
// A draft fetch that asked for `price_eur` — a column that lives on
// `publication_drafts`, not on `mobile_bg_drafts` — failed with a Postgres
// schema error, and the caller reported it as "Черновата не е намерена." Three
// publishing runs were lost to a column name that no compiler checks, because
// the table is reached through a string.
//
// This test reads the migrations as the schema of record and every `select`,
// `insert` and `update` column in the worker against it. It needs no database:
// the migrations are the source of truth the deployed tables were built from.

import { strict as assert } from 'node:assert';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');
const migrationsDir = join(repoRoot, 'supabase', 'migrations');
// Every file whose table access goes through a string. The publisher was the
// first to break; these edge functions read and write the same mobile_bg_* and
// publication_* tables, and one of them was already asking mobile_bg_drafts for
// owner_id, price_eur and currency — columns of publication_drafts.
const sourceFiles = [
  join(here, '..', 'src', 'index.ts'),
  join(here, '..', '..', '..', 'supabase', 'functions', 'queue-publication-url', 'index.ts'),
  join(here, '..', '..', '..', 'supabase', 'functions', 'ingest-source-listing', 'index.ts'),
  join(here, '..', '..', '..', 'supabase', 'functions', 'ingest-publication-listing', 'index.ts'),
];

// Splits a SQL body on commas that are not inside parentheses or quotes, so a
// table definition is read as one item per column even when several columns
// share a line (`a text, b text,` is three tokens, not one).
function splitTopLevel(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let buffer = '';
  for (const char of body) {
    if (quote) {
      buffer += char;
      if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      buffer += char;
      continue;
    }
    if (char === '(') depth += 1;
    else if (char === ')') depth = Math.max(0, depth - 1);
    if (char === ',' && depth === 0) {
      parts.push(buffer);
      buffer = '';
    } else {
      buffer += char;
    }
  }
  parts.push(buffer);
  return parts;
}

// Column names declared by one `CREATE TABLE` body. Each item is either a column
// (`name type ...`) or a table-level constraint (`primary key (...)`,
// `constraint x ...`), which has no type after the keyword.
function columnsFromBody(body: string): string[] {
  const columns: string[] = [];
  for (const part of splitTopLevel(body)) {
    const match = part.match(/^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s+([\s\S]*)$/);
    if (!match) continue;
    const [, name, rest] = match;
    if (/^(primary|unique|foreign|check|constraint|exclude)$/i.test(name)) continue;
    if (!/^[a-zA-Z]/.test(rest.trim())) continue;
    columns.push(name);
  }
  return columns;
}

// ---------------------------------------------------------------- schema

type Schema = Map<string, Set<string>>;

async function readSchema(): Promise<Schema> {
  const schema: Schema = new Map();
  const files = (await readdir(migrationsDir)).filter(name => name.endsWith('.sql')).sort();

  for (const file of files) {
    const sql = await readFile(join(migrationsDir, file), 'utf8');

    // CREATE TABLE [IF NOT EXISTS] name ( ... );
    const createRe = /CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+([a-zA-Z0-9_.]+)\s*\(([\s\S]*?)\n\)\s*;/gi;
    for (const match of sql.matchAll(createRe)) {
      const table = match[1].split('.').pop() as string;
      const columns = schema.get(table) || new Set<string>();
      for (const name of columnsFromBody(match[2])) columns.add(name);
      schema.set(table, columns);
    }

    // ALTER TABLE name ADD COLUMN [IF NOT EXISTS] col ..., and RENAME COLUMN.
    const alterRe = /ALTER\s+TABLE\s+([a-zA-Z0-9_.]+)([\s\S]*?);/gi;
    for (const match of sql.matchAll(alterRe)) {
      const table = match[1].split('.').pop() as string;
      const columns = schema.get(table) || new Set<string>();
      for (const add of match[2].matchAll(/ADD\s+COLUMN(?:\s+IF\s+NOT\s+EXISTS)?\s+([a-zA-Z_][a-zA-Z0-9_]*)/gi)) {
        columns.add(add[1]);
      }
      for (const rename of match[2].matchAll(/RENAME\s+COLUMN\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+TO\s+([a-zA-Z_][a-zA-Z0-9_]*)/gi)) {
        columns.delete(rename[1]);
        columns.add(rename[2]);
      }
      schema.set(table, columns);
    }
  }
  return schema;
}

// Keys of an object literal that sit at brace depth zero. `details: { a: 1 }`
// contributes `details` and nothing from inside.
function topLevelKeys(body: string): string[] {
  const keys: string[] = [];
  let depth = 0;
  for (const token of body.matchAll(/([{}])|(?:^|[\s,])([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g)) {
    if (token[1] === '{') {
      depth += 1;
      continue;
    }
    if (token[1] === '}') {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth === 0 && token[2]) keys.push(token[2]);
  }
  return keys;
}

// ---------------------------------------------------------------- queries

type Query = { table: string; columns: string[]; kind: string };

// Walks a `.from('table')...` chain and collects the column names it names.
// Object literals are read for their keys; `select`/`order` strings are split on
// commas. `select('*')` is skipped, and so is any string that carries a PostgREST
// modifier such as `count` or an embedded resource.
function queriesIn(source: string): Query[] {
  const found: Query[] = [];
  const fromRe = /\.from\(\s*'([^']+)'\s*\)/g;

  for (const match of source.matchAll(fromRe)) {
    const table = match[1];
    const tail = source.slice(match.index, match.index + 1400);
    // Stop at the end of *this* chain: the next `.from(`, or a blank line. Without
    // the `.from(` stop the slice would run into the following query and bill its
    // columns to this table.
    const nextFrom = tail.slice(1).search(/\.from\(/);
    const nextBlank = tail.search(/\n\s*\n/);
    const candidates = [nextFrom === -1 ? Infinity : nextFrom + 1, nextBlank === -1 ? Infinity : nextBlank];
    const end = Math.min(...candidates);
    const chain = Number.isFinite(end) ? tail.slice(0, end) : tail;

    for (const sel of chain.matchAll(/\.select\(\s*'([^']*)'/g)) {
      const spec = sel[1].trim();
      if (!spec || spec === '*') continue;
      found.push({
        table,
        kind: 'select',
        columns: spec.split(',').map(part => part.trim()).filter(Boolean),
      });
    }

    // `.insert({ a: 1, b: 2 })` and `.update({ a: 1 })`. Only the first object
    // literal after the call is read, which is the row being written. Keys nested
    // inside a value — `details: { error: ... }` — are not columns, so only keys
    // at brace depth zero are taken.
    for (const write of chain.matchAll(/\.(insert|update)\(\s*\{([\s\S]*?)\}\s*\)/g)) {
      const keys = topLevelKeys(write[2]);
      if (keys.length > 0) found.push({ table, kind: write[1], columns: keys });
    }
  }
  return found;
}

const schema = await readSchema();
assert.ok(schema.has('mobile_bg_drafts'), 'миграциите трябва да дефинират mobile_bg_drafts');

let failures = 0;
const checks: Query[] = [];
for (const file of sourceFiles) {
  checks.push(...queriesIn(await readFile(file, 'utf8')));
}
assert.ok(checks.length > 0, 'трябва да са намерени заявки за проверка');

for (const query of checks) {
  const columns = schema.get(query.table);
  if (!columns) {
    failures += 1;
    console.error(`  ✖ ${query.kind} върху непозната таблица: ${query.table}`);
    continue;
  }
  for (const raw of query.columns) {
    // `col`, `*`, or a PostgREST hint. Only a bare identifier is a column.
    const name = raw.match(/^([a-zA-Z_][a-zA-Z0-9_]*)$/)?.[1];
    if (!name) continue;
    if (!columns.has(name)) {
      failures += 1;
      console.error(`  ✖ ${query.table}.${name} не съществува (${query.kind})`);
    }
  }
}

// The regression itself: the column that caused the outage must not come back.
const draftSelects = checks.filter(q => q.table === 'mobile_bg_drafts' && q.kind === 'select');
for (const query of draftSelects) {
  assert.ok(
    !query.columns.includes('price_eur'),
    'mobile_bg_drafts няма price_eur; цената е source_price_eur',
  );
}

if (failures > 0) {
  console.error(`\n${failures} несъществуващи колони в заявките.`);
  process.exitCode = 1;
} else {
  console.log(`Проверени ${checks.length} заявки срещу ${schema.size} таблици. Всички колони съществуват.`);
}
