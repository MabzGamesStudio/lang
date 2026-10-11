import type { DB } from '../db/connection.js';
import { MANUAL, idList, preferenceJson, rankSql } from './sourced.js';
import type { SourcedValue } from '../../../shared/types.js';

// The pronunciations of a word (IPA, or pinyin / kana / romanization for
// Chinese, Japanese and Korean), each with where it came from: "wiktionary",
// "llm:…", "word list: …", "pinyin" (made offline) or "manual". The one used
// (see sourced.ts) is kept in words.pronunciation.

const ORDER = `p.pinned DESC, ${rankSql('p.source')}, p.position, p.id`;

// Stored without slashes or brackets.
export function cleanPronunciation(text: string): string {
  return text
    .replace(/^\s*[/[]+|[/\]]+\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function syncPronunciations(db: DB, wordIds?: number[]): void {
  db.prepare(
    `UPDATE words SET pronunciation = (SELECT p.pronunciation FROM word_pronunciations p WHERE p.word_id = words.id ORDER BY ${ORDER} LIMIT 1)
     ${wordIds ? 'WHERE id IN (SELECT value FROM json_each(?))' : ''}`
  ).run(preferenceJson(db, 'pronunciations'), ...(wordIds ? [idList(wordIds)] : []));
}

interface PronunciationRow {
  id: number;
  wordId: number;
  text: string;
  source: string;
  pinned: number;
  createdAt: number;
}

// Every pronunciation of these words, in the order they are used.
export function pronunciationsOfWords(db: DB, wordIds: number[]): Map<number, SourcedValue[]> {
  const result = new Map<number, SourcedValue[]>();
  if (wordIds.length === 0) return result;
  const rows = db
    .prepare(
      `SELECT p.id, p.word_id AS wordId, p.pronunciation AS text, p.source, p.pinned, p.created_at AS createdAt
       FROM word_pronunciations p WHERE p.word_id IN (SELECT value FROM json_each(?)) ORDER BY p.word_id, ${ORDER}`
    )
    .all(idList(wordIds), preferenceJson(db, 'pronunciations')) as PronunciationRow[];
  for (const { wordId, ...row } of rows) {
    const list = result.get(wordId) ?? [];
    list.push({ ...row, pinned: row.pinned === 1 });
    result.set(wordId, list);
  }
  return result;
}

export function pronunciationsOf(db: DB, wordId: number): SourcedValue[] {
  return pronunciationsOfWords(db, [wordId]).get(wordId) ?? [];
}

// Adds pronunciations from one source. With `replace`, a word that gets a new
// one loses those added automatically before (typed and pinned ones stay).
// `accept` filters the values (Chinese keeps pinyin only).
export function addPronunciations(
  db: DB,
  items: { id: number; pronunciation?: string | null }[],
  source: string,
  options: { replace?: boolean; accept?: (value: string) => boolean } = {}
): number {
  const insert = db.prepare(
    `INSERT OR IGNORE INTO word_pronunciations (word_id, pronunciation, source, position, created_at)
     VALUES (?, ?, ?, COALESCE((SELECT MAX(position) + 1 FROM word_pronunciations WHERE word_id = ?), 0), ?)`
  );
  const removeAutomatic = db.prepare(`DELETE FROM word_pronunciations WHERE word_id = ? AND source != '${MANUAL}' AND pinned = 0`);
  const touched: number[] = [];
  let added = 0;
  const now = Date.now();
  db.transaction(() => {
    for (const item of items) {
      const value = cleanPronunciation(item.pronunciation ?? '');
      if (!value || (options.accept && !options.accept(value))) continue;
      if (options.replace) removeAutomatic.run(item.id);
      added += insert.run(item.id, value, source, item.id, now).changes;
      touched.push(item.id);
    }
    if (touched.length) syncPronunciations(db, touched);
  })();
  return added;
}

// The pronunciation typed in a word's editor: yours, and used from now on.
export function setMainPronunciation(db: DB, wordId: number, text: string | null): void {
  const value = cleanPronunciation(text ?? '');
  db.transaction(() => {
    if (!value) {
      db.prepare(`DELETE FROM word_pronunciations WHERE word_id = ? AND source = '${MANUAL}'`).run(wordId);
      db.prepare(`UPDATE word_pronunciations SET pinned = 0 WHERE word_id = ?`).run(wordId);
    } else {
      db.prepare(`UPDATE word_pronunciations SET pinned = 0 WHERE word_id = ?`).run(wordId);
      db.prepare(
        `INSERT INTO word_pronunciations (word_id, pronunciation, source, position, pinned, created_at) VALUES (?, ?, '${MANUAL}', 0, 1, ?)
         ON CONFLICT(word_id, pronunciation) DO UPDATE SET pinned = 1`
      ).run(wordId, value, Date.now());
    }
    syncPronunciations(db, [wordId]);
  })();
}

export function addManualPronunciation(db: DB, wordId: number, text: string): void {
  addPronunciations(db, [{ id: wordId, pronunciation: text }], MANUAL);
}

// Editing a pronunciation makes it yours.
export function editPronunciation(db: DB, wordId: number, id: number, text: string): void {
  const value = cleanPronunciation(text);
  if (!value) return deletePronunciation(db, wordId, id);
  db.transaction(() => {
    db.prepare(`UPDATE OR REPLACE word_pronunciations SET pronunciation = ?, source = '${MANUAL}' WHERE id = ? AND word_id = ?`).run(value, id, wordId);
    syncPronunciations(db, [wordId]);
  })();
}

export function deletePronunciation(db: DB, wordId: number, id: number): void {
  db.transaction(() => {
    db.prepare(`DELETE FROM word_pronunciations WHERE id = ? AND word_id = ?`).run(id, wordId);
    syncPronunciations(db, [wordId]);
  })();
}

export function pinPronunciation(db: DB, wordId: number, id: number, pinned: boolean): void {
  db.transaction(() => {
    db.prepare(`UPDATE word_pronunciations SET pinned = 0 WHERE word_id = ?`).run(wordId);
    if (pinned) db.prepare(`UPDATE word_pronunciations SET pinned = 1 WHERE id = ? AND word_id = ?`).run(id, wordId);
    syncPronunciations(db, [wordId]);
  })();
}
