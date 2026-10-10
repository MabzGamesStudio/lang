import { HttpError, englishDatabase, languageDb, type DB } from '../db/connection.js';
import { refreshSentenceCounts, wordIdsOfSentences } from './ranking.js';
import { registerEnglishWords } from './english.js';
import { setWordExclusion } from './corpus.js';
import { invalidateGlossIndex } from './glossIndex.js';
import { fillChinesePinyin, isChinese } from './chinese.js';
import { getLanguageConfig } from './languages.js';
import { parseEnglish } from './util.js';
import { readGlosses, sourcedGlosses, storeGlosses } from './glosses.js';
import { addSentenceTranslations, setSentenceTranslations, splitTranslations, translationsOf } from './sentenceTranslations.js';

export { parseEnglish };
import { dedupe, stripParentheticals } from '../../../shared/text.js';
import type { Paged, Recording, SentenceExclusion, SentenceRow, WordLevels, WordRow } from '../../../shared/types.js';

export interface WordDbRow {
  id: number;
  word: string;
  display: string;
  rank: number | null;
  count: number;
  score: number;
  english: string | null;
  english_sources: string | null;
  pronunciation: string | null;
  pos: string | null;
  definition_source: string | null;
  active: number;
  proper_noun: number;
  user_excluded: number | null;
  sentence_count: number;
  translated_sentence_count: number;
  recognition_level: number;
  recall_level: number;
  recite_level: number;
  translate_level: number;
  srs_stage: number;
  next_review_at: number | null;
  review_started_at: number | null;
  review_errors: number;
  last_seen_at: number | null;
}

export const WORD_COLUMNS = `id, word, display, rank, count, score, english, english_sources, pronunciation, pos, definition_source,
  active, proper_noun, user_excluded, sentence_count, translated_sentence_count,
  recognition_level, recall_level, recite_level, translate_level,
  srs_stage, next_review_at, review_started_at, review_errors, last_seen_at`;

export function levelsOf(row: WordDbRow): WordLevels {
  return {
    recognition: row.recognition_level,
    recall: row.recall_level,
    recite: row.recite_level,
    translate: row.translate_level,
  };
}

export function toWordRow(row: WordDbRow): WordRow {
  const glosses = sourcedGlosses(row.english, row.english_sources, row.definition_source);
  return {
    id: row.id,
    word: row.word,
    display: row.display,
    rank: row.rank,
    count: row.count,
    score: row.score,
    english: glosses.map((gloss) => gloss.text),
    englishSources: glosses.map((gloss) => gloss.source),
    pronunciation: row.pronunciation,
    pos: row.pos,
    definitionSource: row.definition_source,
    active: row.active === 1,
    properNoun: row.proper_noun === 1,
    userExcluded: row.user_excluded === null ? null : row.user_excluded === 1,
    sentenceCount: row.sentence_count,
    translatedSentenceCount: row.translated_sentence_count,
    levels: levelsOf(row),
    srsStage: row.srs_stage,
    nextReviewAt: row.next_review_at,
    reviewing: row.review_started_at !== null,
    lastSeenAt: row.last_seen_at,
  };
}

export function getWordDb(db: DB, id: number): WordDbRow {
  const row = db.prepare(`SELECT ${WORD_COLUMNS} FROM words WHERE id = ?`).get(id) as WordDbRow | undefined;
  if (!row) throw new HttpError(404, 'Word not found');
  return row;
}

export interface WordQuery {
  offset: number;
  limit: number;
  q: string;
  filter: string;
  sort: string;
}

export function listWords(langId: string, query: WordQuery): Paged<WordRow> {
  const db = languageDb(langId);
  const where: string[] = [];
  const params: unknown[] = [];
  switch (query.filter) {
    case 'active':
      where.push('active = 1');
      break;
    case 'excluded':
      where.push('active = 0');
      break;
    case 'undefined':
      where.push('active = 1 AND english IS NULL');
      break;
    case 'learned':
      where.push('srs_stage > 0');
      break;
    case 'due':
      where.push('srs_stage > 0 AND (next_review_at <= ? OR review_started_at IS NOT NULL)');
      params.push(Date.now());
      break;
    case 'studying':
      where.push('first_seen_at IS NOT NULL AND srs_stage = 0');
      break;
  }
  if (query.q.trim()) {
    where.push('(word LIKE ? OR english LIKE ?)');
    params.push(`${query.q.trim().toLowerCase()}%`, `%${query.q.trim()}%`);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const order =
    query.sort === 'alpha'
      ? 'word'
      : query.sort === 'count'
        ? 'count DESC'
        : query.sort === 'recent'
          ? 'last_seen_at DESC NULLS LAST'
          : 'rank IS NULL, rank, score DESC';
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM words ${clause}`).get(...params) as { n: number }).n;
  const rows = db
    .prepare(`SELECT ${WORD_COLUMNS} FROM words ${clause} ORDER BY ${order} LIMIT ? OFFSET ?`)
    .all(...params, query.limit, query.offset) as WordDbRow[];
  return { rows: rows.map((row) => withDetails(db, toWordRow(row))), total };
}

// Where a word was found (books, word lists) and its stored recordings.
function withDetails(db: DB, word: WordRow): WordRow {
  const origins = db
    .prepare(
      `SELECT s.title, ws.count FROM word_sources ws JOIN sources s ON s.id = ws.source_id
       WHERE ws.word_id = ? ORDER BY ws.count DESC LIMIT 5`
    )
    .all(word.id) as { title: string; count: number }[];
  return { ...word, origins, audio: recordingsOf(db, word.display) };
}

export function getWord(langId: string, id: number): WordRow {
  const db = languageDb(langId);
  return withDetails(db, toWordRow(getWordDb(db, id)));
}

export interface DefinitionUpdate {
  id: number;
  english: string[];
  pronunciation?: string | null;
  pos?: string | null;
  source: string;
}

// Saves definitions fetched from a provider. New meanings are added to the
// ones a word already has, each with its source. With `overwrite`, meanings
// found by automation before are replaced (typed ones are never lost), and so
// are the pronunciation and part of speech.
export function saveDefinitions(db: DB, updates: DefinitionUpdate[], overwrite: boolean): number {
  let saved = 0;
  const glosses: string[] = [];
  const other = overwrite
    ? db.prepare(`UPDATE words SET pronunciation = COALESCE(?, pronunciation), pos = COALESCE(?, pos) WHERE id = ?`)
    : db.prepare(`UPDATE words SET pronunciation = COALESCE(pronunciation, ?), pos = COALESCE(pos, ?) WHERE id = ?`);
  db.transaction(() => {
    for (const update of updates) {
      const english = dedupe(update.english.map((gloss) => gloss.trim()).filter(Boolean)).slice(0, 8);
      if (english.length === 0 && !update.pronunciation) continue;
      if (english.length) {
        const current = readGlosses(db, update.id);
        const incoming = english.map((text) => ({ text, source: update.source }));
        storeGlosses(
          db,
          update.id,
          overwrite ? [...current.filter((gloss) => gloss.source === 'manual'), ...incoming] : [...current, ...incoming]
        );
      }
      other.run(update.pronunciation?.trim() || null, update.pos?.trim() || null, update.id);
      glosses.push(...english);
      saved++;
    }
  })();
  registerEnglishWords(glosses);
  invalidateGlossIndex();
  // Chinese pronunciations are always shown in pinyin.
  if (isChinese(getLanguageConfig(db))) fillChinesePinyin(db, updates.map((update) => update.id));
  return saved;
}

export function undefinedWordCount(db: DB): number {
  return (
    db.prepare(`SELECT COUNT(*) AS n FROM words WHERE active = 1 AND rank IS NOT NULL AND english IS NULL`).get() as { n: number }
  ).n;
}

// Words the autopilot works on next: the most frequent words that have no
// definition yet. Once every word is defined, the most frequent words that
// still lack translated example sentences.
export function nextWordsToPrepare(db: DB, limit: number): { wordIds: number[]; needDefinitions: boolean } {
  const needDefinitions = undefinedWordCount(db) > 0;
  const condition = needDefinitions ? 'english IS NULL' : 'translated_sentence_count < 2';
  const rows = db
    .prepare(`SELECT id FROM words WHERE active = 1 AND rank IS NOT NULL AND ${condition} ORDER BY rank LIMIT ?`)
    .all(limit) as { id: number }[];
  return { wordIds: rows.map((row) => row.id), needDefinitions };
}

export function updateWord(
  langId: string,
  id: number,
  patch: { english?: string[]; pronunciation?: string | null; pos?: string | null; excluded?: boolean | null }
): WordRow {
  const db = languageDb(langId);
  getWordDb(db, id);
  if (patch.english !== undefined) {
    const english = dedupe(patch.english.map((gloss) => gloss.trim()).filter(Boolean));
    // Meanings that stay keep their source; new ones were typed by the learner.
    const current = readGlosses(db, id);
    storeGlosses(
      db,
      id,
      english.map((text) => ({ text, source: current.find((gloss) => gloss.text === text)?.source ?? 'manual' }))
    );
    registerEnglishWords(english);
    invalidateGlossIndex();
  }
  if (patch.pronunciation !== undefined) {
    db.prepare(`UPDATE words SET pronunciation = ? WHERE id = ?`).run(patch.pronunciation?.trim() || null, id);
  }
  if (patch.pos !== undefined) {
    db.prepare(`UPDATE words SET pos = ? WHERE id = ?`).run(patch.pos?.trim() || null, id);
  }
  if (patch.excluded !== undefined) setWordExclusion(db, id, patch.excluded);
  return getWord(langId, id);
}

export function resetWordProgress(langId: string, id: number): WordRow {
  const db = languageDb(langId);
  db.prepare(
    `UPDATE words SET recognition_level = 0, recall_level = 0, recite_level = 0, translate_level = 0,
       srs_stage = 0, learned_at = NULL, next_review_at = NULL, review_started_at = NULL, review_errors = 0
     WHERE id = ?`
  ).run(id);
  return getWord(langId, id);
}

// ---------------------------------------------------------------------------
// Sentences

export const SENTENCE_EXCLUSIONS: SentenceExclusion[] = ['translation', 'nonsense', 'audio', 'other'];

// Audio is stored under the text that is spoken (notes in parentheses removed).
export function audioText(text: string): string {
  return stripParentheticals(text).slice(0, 500);
}

// The stored recordings of a text (several voices are possible), newest first.
export function recordingsOf(db: DB, text: string): Recording[] {
  return db
    .prepare(`SELECT id, voice, created_at AS createdAt FROM audio WHERE text = ? ORDER BY created_at DESC`)
    .all(audioText(text)) as Recording[];
}

export function listSentences(
  langId: string,
  query: { offset: number; limit: number; q: string; filter: string; wordId?: number }
): Paged<SentenceRow> {
  const db = languageDb(langId);
  const where: string[] = [];
  const params: unknown[] = [];
  if (query.filter === 'untranslated') where.push('s.english IS NULL AND s.excluded_reason IS NULL');
  if (query.filter === 'translated') where.push('s.english IS NOT NULL AND s.excluded_reason IS NULL');
  if (query.filter === 'excluded') where.push('s.excluded_reason IS NOT NULL');
  if ((SENTENCE_EXCLUSIONS as string[]).includes(query.filter)) {
    where.push('s.excluded_reason = ?');
    params.push(query.filter);
  }
  if (query.q.trim()) {
    where.push('(s.text LIKE ? OR s.id IN (SELECT sentence_id FROM sentence_translations WHERE english LIKE ?))');
    params.push(`%${query.q.trim()}%`, `%${query.q.trim()}%`);
  }
  if (query.wordId) {
    where.push('s.id IN (SELECT sentence_id FROM sentence_words WHERE word_id = ?)');
    params.push(query.wordId);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM sentences s ${clause}`).get(...params) as { n: number }).n;
  const order = query.filter === 'excluded' ? 's.excluded_at DESC' : 's.max_rank IS NULL, s.max_rank, s.word_count';
  const rows = db
    .prepare(
      `SELECT s.id, s.text, s.english, s.translation_source AS translationSource, s.source_id AS sourceId, src.title AS sourceTitle,
              s.word_count AS wordCount, s.max_rank AS maxRank, s.excluded_reason AS excludedReason, s.excluded_at AS excludedAt
       FROM sentences s LEFT JOIN sources src ON src.id = s.source_id
       ${clause} ORDER BY ${order} LIMIT ? OFFSET ?`
    )
    .all(...params, query.limit, query.offset) as Omit<SentenceRow, 'translations' | 'audio' | 'englishAudio'>[];
  const english = englishDatabase();
  const translations = translationsOf(
    db,
    rows.map((row) => row.id)
  );
  return {
    rows: rows.map((row) => ({
      ...row,
      translations: translations.get(row.id) ?? [],
      audio: recordingsOf(db, row.text),
      englishAudio: row.english ? recordingsOf(english, row.english) : [],
    })),
    total,
  };
}

// Takes a sentence out of the questions (with the reason), or puts it back.
export function setSentenceExclusion(langId: string, id: number, reason: SentenceExclusion | null): void {
  const db = languageDb(langId);
  const result = db
    .prepare(`UPDATE sentences SET excluded_reason = ?, excluded_at = ? WHERE id = ?`)
    .run(reason, reason ? Date.now() : null, id);
  if (!result.changes) throw new HttpError(404, 'Sentence not found');
  refreshSentenceCounts(db, wordIdsOfSentences(db, [id]));
}

// Adds translations from a service or an import (see sentenceTranslations.ts).
export function saveSentenceTranslations(db: DB, translations: { id: number; english: string }[], source: string): number {
  return addSentenceTranslations(db, translations, source);
}

// Translations edited by hand: several separated by semicolons.
export function updateSentence(langId: string, id: number, patch: { english: string | null }): void {
  const db = languageDb(langId);
  if (!db.prepare(`SELECT 1 FROM sentences WHERE id = ?`).get(id)) throw new HttpError(404, 'Sentence not found');
  setSentenceTranslations(db, id, splitTranslations(patch.english ?? ''));
}

export function deleteSentence(langId: string, id: number): void {
  const db = languageDb(langId);
  const wordIds = wordIdsOfSentences(db, [id]);
  db.prepare(`DELETE FROM sentences WHERE id = ?`).run(id);
  refreshSentenceCounts(db, wordIds);
}
