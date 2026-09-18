import { MOBILE_BG_FIELD_MAP } from '@/lib/mobile_bg_field_map';
import type { MobileBgDraftField } from '@/types';

// A draft is stored as scattered field rows keyed by field_key. The working
// sheet shows them in the order of the field map, which is the order Mobile.bg
// asks for them, so the broker reads down the page the same way they type.
export type SheetRow = {
  key: string;
  label: string;
  value: string;
  required: boolean;
  section: string;
  // True only when a person has to decide the value. The map already marks
  // condition, price and the final description this way.
  human: boolean;
};

const SECTION_ORDER = ['basic', 'price', 'description', 'extras', 'publishing', 'source_control', 'images'];

export function buildSheet(fields: MobileBgDraftField[]): SheetRow[] {
  const byKey = new Map(fields.map(field => [field.field_key, field]));

  return MOBILE_BG_FIELD_MAP
    // Images are uploaded as files, not typed, so they are not text rows.
    .filter(def => def.field_type !== 'image')
    .map(def => ({
      key: def.key,
      label: def.mobile_bg_label,
      value: String(byKey.get(def.key)?.value ?? '').trim(),
      required: def.required,
      section: def.section,
      human: def.needs_human_confirmation || !def.agent_can_fill,
    }))
    .sort((a, b) => SECTION_ORDER.indexOf(a.section) - SECTION_ORDER.indexOf(b.section));
}

export function sheetSections(rows: SheetRow[]): string[] {
  return [...new Set(rows.map(row => row.section))];
}

// What the person still has to fill in before this can be copied across. Kept
// separate from the copy text so the screen can warn without a second query.
export function missingInSheet(rows: SheetRow[]): SheetRow[] {
  return rows.filter(row => row.required && !row.value);
}

// Plain text, in the order the form is filled in. It is what the clipboard
// gets, because the clipboard is the only channel that carries information
// from our page to another page without the site refusing it.
export function sheetAsText(rows: SheetRow[], title: string): string {
  const lines: string[] = [title, ''];
  let section = '';
  for (const row of rows) {
    if (row.section !== section) {
      section = row.section;
      lines.push('', sectionNameBg(section), '');
    }
    const mark = row.required && !row.value ? '  ← липсва' : '';
    lines.push(`${row.label}: ${row.value || '—'}${mark}`);
  }
  return lines.join('\n').trim();
}

export function sheetAsPairs(rows: SheetRow[]): Array<{ label: string; value: string }> {
  return rows.filter(row => row.value).map(row => ({ label: row.label, value: row.value }));
}

function sectionNameBg(section: string): string {
  const names: Record<string, string> = {
    basic: 'Основни данни',
    price: 'Цена',
    description: 'Описание',
    extras: 'Екстри',
    publishing: 'Публикуване',
    source_control: 'Източник',
  };
  return names[section] || section;
}