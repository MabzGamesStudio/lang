import type { DB } from '../db/connection.js';
import { parseEnglish } from './util.js';
import { MANUAL, idList, preferenceJson, rankSql } from './sourced.js';
import type { SourcedValue } from '../../../shared/types.js';

// The English meanings of a word, each with where it came from: "wiktionary",
// "llm:…", "word list: …" or "manual" (typed by the learner). They are stored
// in word_meanings; words.english / english_sources / definition_source hold
// the meanings in the order they are used (see sourced.ts), so questions and
// listings read them without a join.

export interface SourcedGloss {
  text: string;
  source: string;
}

// Meanings kept on the word itself (questions accept all of them).
const MAX_USED = 12;

const ORDER = `m.pinned DESC, ${rankSql('m.source')}, m.position, m.id`;

// The meanings stored on a word row, with their sources.
export function sourcedGlosses(english: string | null, sources: string | null, fallback: string | null): SourcedGloss[] {
  const texts = parseEnglish(english);
  let list: unknown = null;
  try {
    list = sources ? JSON.parse(sources) : null;
  } catch {
    list = null;
  }
  return texts.map((text, index) => ({
    text,
    source: Array.isArray(list) && typeof list[index] === 'string' ? (list[index] as string) : (fallback ?? 'unknown'),
  }));
}

// Brings the meanings kept on the words up to date (all words when no ids are given).
export function syncMeanings(db: DB, wordIds?: number[]): void {
  const prefs = preferenceJson(db, 'meanings');
  const used = `SELECT m.english, m.source FROM word_meanings m WHERE m.word_id = words.id ORDER BY ${ORDER} LIMIT ${MAX_USED}`;
  db.prepare(
    `UPDATE words SET
       english = (SELECT NULLIF(json_group_array(english), '[]') FROM (${used})),
       english_sources = (SELECT NULLIF(json_group_array(source), '[]') FROM (${used})),
       definition_source = (SELECT source FROM (${used}) LIMIT 1)
     ${wordIds ? 'WHERE id IN (SELECT value FROM json_each(?))' : ''}`
  ).run(prefs, prefs, prefs, ...(wordIds ? [idList(wordIds)] : []));
}

interface MeaningRow {
  id: number;
  text: string;
  source: string;
  pinned: number;
  createdAt: number;
}

export function meaningsOf(db: DB, wordId: number): SourcedValue[] {
  return (
    db
      .prepare(`SELECT m.id, m.english AS text, m.source, m.pinned, m.created_at AS createdAt FROM word_meanings m WHERE m.word_id = ? ORDER BY ${ORDER}`)
      .all(wordId, preferenceJson(db, 'meanings')) as MeaningRow[]
  ).map((row) => ({ ...row, pinned: row.pinned === 1 }));
}

export function readGlosses(db: DB, wordId: number): SourcedGloss[] {
  return meaningsOf(db, wordId).map(({ text, source }) => ({ text, source }));
}

function clean(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

// Adds meanings from one source to many words (the same meaning is never
// added twice). With `replace`, a word that gets new meanings loses the ones
// added automatically before (typed and pinned meanings stay).
export function addMeanings(db: DB, items: { id: number; english: string[] }[], source: string, options: { replace?: boolean } = {}): number {
  const insert = db.prepare(
    `INSERT OR IGNORE INTO word_meanings (word_id, english, source, position, created_at)
     VALUES (?, ?, ?, COALESCE((SELECT MAX(position) + 1 FROM word_meanings WHERE word_id = ?), 0), ?)`
  );
  const removeAutomatic = db.prepare(`DELETE FROM word_meanings WHERE word_id = ? AND source != '${MANUAL}' AND pinned = 0`);
  const touched: number[] = [];
  let added = 0;
  const now = Date.now();
  db.transaction(() => {
    for (const item of items) {
      const texts = [...new Set(item.english.map(clean).filter(Boolean))];
      if (texts.length === 0) continue;
      if (options.replace) removeAutomatic.run(item.id);
      for (const text of texts) added += insert.run(item.id, text, source, item.id, now).changes;
      touched.push(item.id);
    }
    if (touched.length) syncMeanings(db, touched);
  })();
  return added;
}

export function addGlosses(db: DB, wordId: number, texts: string[], source: string): void {
  addMeanings(db, [{ id: wordId, english: texts }], source);
}

// The meanings of a word as edited in a list: meanings that stay keep their
// source; new ones were typed by you. The list order is kept.
export function setMeanings(db: DB, wordId: number, texts: string[]): void {
  const wanted = [...new Map(texts.map(clean).filter(Boolean).map((text) => [text.toLowerCase(), text])).values()];
  const current = meaningsOf(db, wordId);
  const now = Date.now();
  db.transaction(() => {
    for (const meaning of current) {
      if (!wanted.some((text) => text.toLowerCase() === meaning.text.toLowerCase())) db.prepare(`DELETE FROM word_meanings WHERE id = ?`).run(meaning.id);
    }
    wanted.forEach((text, position) => {
      const existing = current.find((meaning) => meaning.text.toLowerCase() === text.toLowerCase());
      if (existing) db.prepare(`UPDATE word_meanings SET position = ?, english = ? WHERE id = ?`).run(position, text, existing.id);
      else db.prepare(`INSERT INTO word_meanings (word_id, english, source, position, created_at) VALUES (?, ?, '${MANUAL}', ?, ?)`).run(wordId, text, position, now);
    });
    syncMeanings(db, [wordId]);
  })();
}

// A meaning typed by you; editing a meaning makes it yours.
export function addManualMeaning(db: DB, wordId: number, text: string): void {
  addMeanings(db, [{ id: wordId, english: [text] }], MANUAL);
}

export function editMeaning(db: DB, wordId: number, meaningId: number, text: string): void {
  const value = clean(text);
  if (!value) return deleteMeaning(db, wordId, meaningId);
  db.transaction(() => {
    db.prepare(`UPDATE OR REPLACE word_meanings SET english = ?, source = '${MANUAL}' WHERE id = ? AND word_id = ?`).run(value, meaningId, wordId);
    syncMeanings(db, [wordId]);
  })();
}

export function deleteMeaning(db: DB, wordId: number, meaningId: number): void {
  db.transaction(() => {
    db.prepare(`DELETE FROM word_meanings WHERE id = ? AND word_id = ?`).run(meaningId, wordId);
    syncMeanings(db, [wordId]);
  })();
}

// The meaning shown first for this word, whatever the preferred sources.
export function pinMeaning(db: DB, wordId: number, meaningId: number, pinned: boolean): void {
  db.transaction(() => {
    db.prepare(`UPDATE word_meanings SET pinned = 0 WHERE word_id = ?`).run(wordId);
    if (pinned) db.prepare(`UPDATE word_meanings SET pinned = 1 WHERE id = ? AND word_id = ?`).run(meaningId, wordId);
    syncMeanings(db, [wordId]);
  })();
}
