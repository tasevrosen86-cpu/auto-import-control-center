// Loads the internal Cars Catalog into `master_catalog`.
//
// The catalogue used to live only as a JSON file imported by the bundle, so
// every visitor downloaded all 4674 rows and a hidden menu entry was the only
// thing keeping it from a company. It now lives in a table that carries a policy
// restricting it to the system administrator, and this script is how the file
// gets there.
//
// The file is read from disk and is not imported by application code, so it does
// not end up in the bundle. Run it once, after the migrations:
//
//   VITE_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/load_master_catalog.ts
//
// Passing a path as the first argument overrides the default location.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const DEFAULT_FILE = 'data/master_catalog_v40.json';
const BATCH_SIZE = 500;

interface CatalogRecord {
  permanent_id: number;
  stable_key?: string;
  make?: string;
  model?: string;
  model_year?: number;
  fuel?: string;
  priority?: number;
  status?: string;
  company_status?: string;
  our_price_eur?: number | null;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Липсва ${name}.`);
  return value;
}

async function main() {
  const file = resolve(process.argv[2] || DEFAULT_FILE);
  const supabaseUrl = required('VITE_SUPABASE_URL');
  const serviceKey = required('SUPABASE_SERVICE_ROLE_KEY');

  const parsed = JSON.parse(readFileSync(file, 'utf8')) as { catalog: CatalogRecord[] };
  const records = parsed.catalog || [];
  if (!records.length) throw new Error(`Файлът ${file} не съдържа записи.`);

  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  const rows = records
    .filter((record) => Number.isInteger(record.permanent_id))
    .map((record) => ({
      permanent_id: record.permanent_id,
      stable_key: record.stable_key ?? null,
      make: record.make ?? null,
      model: record.model ?? null,
      model_year: record.model_year ?? null,
      fuel: record.fuel ?? null,
      priority: record.priority ?? null,
      status: record.status ?? null,
      company_status: record.company_status ?? null,
      our_price_eur: record.our_price_eur ?? null,
      source_version: 'v40',
      // The whole original record is kept, so nothing the catalogue carried is
      // lost by being flattened into columns.
      payload: record as unknown as Record<string, unknown>,
      updated_at: new Date().toISOString(),
    }));

  let written = 0;
  for (let index = 0; index < rows.length; index += BATCH_SIZE) {
    const batch = rows.slice(index, index + BATCH_SIZE);
    const { error } = await supabase.from('master_catalog').upsert(batch, { onConflict: 'permanent_id' });
    if (error) throw new Error(`Партида ${index / BATCH_SIZE + 1}: ${error.message}`);
    written += batch.length;
    console.log(`Записани ${written}/${rows.length}`);
  }

  console.log(`Готово: ${written} записа в master_catalog.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
