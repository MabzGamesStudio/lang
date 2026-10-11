import type { DB } from '../db/connection.js';
import { refreshSentenceCounts, wordIdsOfSentences } from './ranking.js';
import { MANUAL, idList, preferenceJson, rankSql } from './sourced.js';
import type { SentenceTranslation } from '../../../shared/types.js';

// A sentence can have several English translations, each with its source
// (a service, an import or "manual"). The first one in the order of use (a
// pinned one, then the preferred sources, then the order they were added) is
// the main one: it is kept in sentences.english / translation_source and shown
// in questions; answers are checked against all of them.

const ORDER = `t.pinned DESC, ${rankSql('t.source')}, t.position, t.id`;

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

interface TranslationRow {
  id: number;
  sentenceId: number;
  english: string;
  source: string;
  pinned: number;
  createdAt: number;
}

export function translationsOf(db: DB, sentenceIds: number[]): Map<number, SentenceTranslation[]> {
  const result = new Map<number, SentenceTranslation[]>();
  if (sentenceIds.length === 0) return result;
  const rows = db
    .prepare(
      `SELECT t.id, t.sentence_id AS sentenceId, t.english, t.source, t.pinned, t.created_at AS createdAt FROM sentence_translations t
       WHERE t.sentence_id IN (SELECT value FROM json_each(?)) ORDER BY t.sentence_id, ${ORDER}`
    )
    .all(idList(sentenceIds), preferenceJson(db, 'translations')) as TranslationRow[];
  for (const { sentenceId, ...translation } of rows) {
    const list = result.get(sentenceId) ?? [];
    list.push({ ...translation, pinned: translation.pinned === 1 });
    result.set(sentenceId, list);
  }
  return result;
}

// Keeps sentences.english / translation_source equal to the main translation
// (every sentence when no ids are given, e.g. after the preferences changed).
export function syncMainTranslations(db: DB, sentenceIds?: number[]): void {
  const prefs = preferenceJson(db, 'translations');
  const main = `SELECT t.english, t.source FROM sentence_translations t WHERE t.sentence_id = sentences.id ORDER BY ${ORDER} LIMIT 1`;
  db.prepare(
    `UPDATE sentences SET
       english = (SELECT english FROM (${main})),
       translation_source = (SELECT source FROM (${main}))
     ${sentenceIds ? 'WHERE id IN (SELECT value FROM json_each(?))' : ''}`
  ).run(prefs, prefs, ...(sentenceIds ? [idList(sentenceIds)] : []));
}

// Adds translations from one source; the same text is never added twice.
// `main` puts the new translation before the others of the same source rank;
// `replace` removes the translations a sentence got automatically before
// (typed and pinned ones stay).
export function addSentenceTranslations(
  db: DB,
  items: { id: number; english: string }[],
  source: string,
  options: { main?: boolean; replace?: boolean } = {}
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
  const removeAutomatic = db.prepare(`DELETE FROM sentence_translations WHERE sentence_id = ? AND source != '${MANUAL}' AND pinned = 0 AND english != ?`);
  const touched: number[] = [];
  const now = Date.now();
  db.transaction(() => {
    for (const item of items) {
      const english = cleanTranslation(item.english);
      if (!english) continue;
      if (options.replace) removeAutomatic.run(item.id, english);
      const result = insert.run(item.id, english, source, item.id, now);
      if (!result.changes && options.main) promote.run(item.id, item.id, english);
      touched.push(item.id);
    }
    syncMainTranslations(db, touched);
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
      `INSERT INTO sentence_translations (sentence_id, english, source, position, created_at) VALUES (?, ?, '${MANUAL}', ?, ?)`
    );
    wanted.forEach((english, position) => {
      const existing = current.find((translation) => translation.english === english);
      if (existing) move.run(position, existing.id);
      else insert.run(sentenceId, english, position, now);
    });
    syncMainTranslations(db, [sentenceId]);
  })();
  refreshSentenceCounts(db, wordIdsOfSentences(db, [sentenceId]));
}

export function removeSentenceTranslation(db: DB, sentenceId: number, english: string): void {
  db.transaction(() => {
    db.prepare(`DELETE FROM sentence_translations WHERE sentence_id = ? AND english = ?`).run(sentenceId, english);
    syncMainTranslations(db, [sentenceId]);
  })();
  refreshSentenceCounts(db, wordIdsOfSentences(db, [sentenceId]));
}

// One translation: typed, edited (it becomes yours), deleted or pinned as the main one.
export function addManualTranslation(db: DB, sentenceId: number, text: string): void {
  addSentenceTranslations(db, [{ id: sentenceId, english: text }], MANUAL);
}

export function editTranslation(db: DB, sentenceId: number, id: number, text: string): void {
  const english = cleanTranslation(text);
  if (!english) return deleteTranslation(db, sentenceId, id);
  db.transaction(() => {
    db.prepare(`UPDATE OR REPLACE sentence_translations SET english = ?, source = '${MANUAL}' WHERE id = ? AND sentence_id = ?`).run(english, id, sentenceId);
    syncMainTranslations(db, [sentenceId]);
  })();
}

export function deleteTranslation(db: DB, sentenceId: number, id: number): void {
  db.transaction(() => {
    db.prepare(`DELETE FROM sentence_translations WHERE id = ? AND sentence_id = ?`).run(id, sentenceId);
    syncMainTranslations(db, [sentenceId]);
  })();
  refreshSentenceCounts(db, wordIdsOfSentences(db, [sentenceId]));
}

export function pinTranslation(db: DB, sentenceId: number, id: number, pinned: boolean): void {
  db.transaction(() => {
    db.prepare(`UPDATE sentence_translations SET pinned = 0 WHERE sentence_id = ?`).run(sentenceId);
    if (pinned) db.prepare(`UPDATE sentence_translations SET pinned = 1 WHERE id = ? AND sentence_id = ?`).run(id, sentenceId);
    syncMainTranslations(db, [sentenceId]);
  })();
}
