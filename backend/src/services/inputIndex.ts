import { languageDb } from '../db/connection.js';
import { getLanguageConfig } from './languages.js';
import { pinyinKey, pinyinReadings } from './chinese.js';
import { resolveInputMethod } from '../../../shared/ime/index.js';
import { isKana, katakanaToHiragana } from '../../../shared/ime/kana.js';
import type { InputIndex } from '../../../shared/types.js';

// Dictionary for the pinyin and Japanese input methods, built from the
// language's own vocabulary (so every word that can be asked can be typed).

const HAN = /\p{Script=Han}/u;
const cache = new Map<string, { signature: string; index: InputIndex }>();

export function inputIndex(langId: string): InputIndex {
  const db = languageDb(langId);
  const config = getLanguageConfig(db);
  const method = resolveInputMethod(config.inputMethod, config.code);
  if (method !== 'pinyin' && method !== 'japanese') return { method: null, entries: [] };
  const signature = `${method}:${
    (
      db
        .prepare(
          `SELECT COUNT(*) || ':' || COALESCE(MAX(id), 0) || ':' || COALESCE(SUM(LENGTH(pronunciation)), 0) || ':' || COALESCE(SUM(rank), 0) AS s FROM words`
        )
        .get() as { s: string }
    ).s
  }`;
  const cached = cache.get(langId);
  if (cached && cached.signature === signature) return cached.index;

  const rows = db
    .prepare(`SELECT display, rank, pronunciation FROM words ORDER BY rank IS NULL, rank, count DESC`)
    .all() as { display: string; rank: number | null; pronunciation: string | null }[];
  const entries: [string, string, number][] = [];
  if (method === 'pinyin') {
    // Single characters are typeable too, ranked by their most frequent word.
    const characters = new Map<string, number>();
    rows.forEach((row, index) => {
      if (!HAN.test(row.display)) return;
      const rank = row.rank ?? 1_000_000 + index;
      const key = pinyinKey(row.display);
      if (key) entries.push([row.display, key, rank]);
      for (const char of row.display) {
        if (HAN.test(char) && !characters.has(char)) characters.set(char, rank + 0.5);
      }
    });
    for (const [char, rank] of characters) {
      for (const reading of pinyinReadings(char)) entries.push([char, reading, rank]);
    }
  } else {
    rows.forEach((row, index) => {
      const reading = row.pronunciation && isKana(row.pronunciation) ? row.pronunciation : isKana(row.display) ? row.display : null;
      if (reading) entries.push([row.display, katakanaToHiragana(reading).replace(/\s+/g, ''), row.rank ?? 1_000_000 + index]);
    });
  }
  const index: InputIndex = { method, entries };
  cache.set(langId, { signature, index });
  return index;
}
