import { languageDb } from '../db/connection.js';
import { glossKey } from '../../../shared/text.js';
import { parseEnglish } from './util.js';

// English gloss key → foreign words having that meaning. Used to accept
// synonyms ("that" → que / eso / ese) and every word an image stands for.

export interface GlossEntry {
  id: number;
  display: string;
  rank: number | null;
  active: boolean;
}

const indexes = new Map<string, Map<string, GlossEntry[]>>();

export function invalidateGlossIndex(): void {
  indexes.clear();
}

export function glossIndex(langId: string): Map<string, GlossEntry[]> {
  const cached = indexes.get(langId);
  if (cached) return cached;
  const rows = languageDb(langId)
    .prepare(`SELECT id, display, rank, active, english FROM words WHERE english IS NOT NULL`)
    .all() as { id: number; display: string; rank: number | null; active: number; english: string }[];
  const index = new Map<string, GlossEntry[]>();
  for (const row of rows) {
    const entry = { id: row.id, display: row.display, rank: row.rank, active: row.active === 1 };
    for (const key of new Set(parseEnglish(row.english).map(glossKey))) {
      if (!key) continue;
      const list = index.get(key) ?? [];
      list.push(entry);
      index.set(key, list);
    }
  }
  indexes.set(langId, index);
  return index;
}

export function wordsWithGlosses(langId: string, keys: Iterable<string>): GlossEntry[] {
  const index = glossIndex(langId);
  const result = new Map<number, GlossEntry>();
  for (const key of keys) {
    for (const entry of index.get(key) ?? []) result.set(entry.id, entry);
  }
  return [...result.values()];
}
