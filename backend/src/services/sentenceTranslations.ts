import type { DB } from '../db/connection.js';
import { refreshSentenceCounts, wordIdsOfSentences } from './ranking.js';

// A sentence can have several English translations, each with its source
// (a service, an import or "manual"). The first one is the main translation:
// it is kept in sentences.english / translation_source and shown in questions;
// answers are checked against all of them.

export interface StoredTranslation {
  id: number;
  english: string;
  source: string;
}

// Semicolons separate translations, so a translation never contains one.
export function cleanTranslation(text: string): string {
  return text.replace(/;/g, ',').replace(/\s+/g, ' ').trim();
}

export function splitTranslations(text: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const part of text.split(';')) {
    const english = cleanTranslation(part);
    if (!english || seen.has(english)) continue;
    seen.add(english);
    result.push(english);
  }
  return result;
}

export function translationsOf(db: DB, sentenceIds: number[]): Map<number, StoredTranslation[]> {
  const result = new Map<number, StoredTranslation[]>();
  if (sentenceIds.length === 0) return result;
  const rows = db
    .prepare(
      `SELECT id, sentence_id AS sentenceId, english, source FROM sentence_translations
       WHERE sentence_id IN (SELECT value FROM json_each(?)) ORDER BY position, id`
    )
    .all(JSON.stringify(sentenceIds)) as (StoredTranslation & { sentenceId: number })[];
  for (const { sentenceId, ...translation } of rows) {
    const list = result.get(sentenceId) ?? [];
    list.push(translation);
    result.set(sentenceId, list);
  }
  return result;
}

// Keeps sentences.english / translation_source equal to the main translation.
function syncMain(db: DB, sentenceIds: number[]): void {
  if (sentenceIds.length === 0) return;
  db.prepare(
    `UPDATE sentences SET
       english = (SELECT english FROM sentence_translations t WHERE t.sentence_id = sentences.id ORDER BY position, id LIMIT 1),
       translation_source = (SELECT source FROM sentence_translations t WHERE t.sentence_id = sentences.id ORDER BY position, id LIMIT 1)
     WHERE id IN (SELECT value FROM json_each(?))`
  ).run(JSON.stringify(sentenceIds));
}

// Adds translations from one source. A sentence's first translation becomes
// its main one (or this one, with `main`); the same text is never added twice.
export function addSentenceTranslations(
  db: DB,
  items: { id: number; english: string }[],
  source: string,
  options: { main?: boolean } = {}
): number {
  const position = options.main
    ? `COALESCE((SELECT MIN(position) - 1 FROM sentence_translations WHERE sentence_id = ?), 0)`
    : `COALESCE((SELECT MAX(position) + 1 FROM sentence_translations WHERE sentence_id = ?), 0)`;
  const insert = db.prepare(
    `INSERT OR IGNORE INTO sentence_translations (sentence_id, english, source, position, created_at) VALUES (?, ?, ?, ${position}, ?)`
  );
  const promote = db.prepare(
    `UPDATE sentence_translations SET position = (SELECT MIN(position) - 1 FROM sentence_translations WHERE sentence_id = ?)
     WHERE sentence_id = ? AND english = ?`
  );
  const touched: number[] = [];
  const now = Date.now();
  db.transaction(() => {
    for (const item of items) {
      const english = cleanTranslation(item.english);
      if (!english) continue;
      const result = insert.run(item.id, english, source, item.id, now);
      if (!result.changes && options.main) promote.run(item.id, item.id, english);
      touched.push(item.id);
    }
    syncMain(db, touched);
  })();
  refreshSentenceCounts(db, wordIdsOfSentences(db, touched));
  return touched.length;
}

// Replaces the translations of a sentence with an edited list. Translations
// that stay keep their source; new ones are "manual".
export function setSentenceTranslations(db: DB, sentenceId: number, texts: string[]): void {
  const wanted = splitTranslations(texts.join(';'));
  const current = translationsOf(db, [sentenceId]).get(sentenceId) ?? [];
  const now = Date.now();
  db.transaction(() => {
    db.prepare(`DELETE FROM sentence_translations WHERE sentence_id = ? AND english NOT IN (SELECT value FROM json_each(?))`).run(
      sentenceId,
      JSON.stringify(wanted)
    );
    const move = db.prepare(`UPDATE sentence_translations SET position = ? WHERE id = ?`);
    const insert = db.prepare(
      `INSERT INTO sentence_translations (sentence_id, english, source, position, created_at) VALUES (?, ?, 'manual', ?, ?)`
    );
    wanted.forEach((english, position) => {
      const existing = current.find((translation) => translation.english === english);
      if (existing) move.run(position, existing.id);
      else insert.run(sentenceId, english, position, now);
    });
    syncMain(db, [sentenceId]);
  })();
  refreshSentenceCounts(db, wordIdsOfSentences(db, [sentenceId]));
}

export function removeSentenceTranslation(db: DB, sentenceId: number, english: string): void {
  db.transaction(() => {
    db.prepare(`DELETE FROM sentence_translations WHERE sentence_id = ? AND english = ?`).run(sentenceId, english);
    syncMain(db, [sentenceId]);
  })();
  refreshSentenceCounts(db, wordIdsOfSentences(db, [sentenceId]));
}
