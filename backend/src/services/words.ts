import { HttpError, englishDatabase, languageDb, type DB } from '../db/connection.js';
import { refreshSentenceCounts, wordIdsOfSentences } from './ranking.js';
import { registerEnglishWords } from './english.js';
import { setWordExclusion } from './corpus.js';
import { invalidateGlossIndex } from './glossIndex.js';
import { fillChinesePinyin, isChinese, isPinyin } from './chinese.js';
import { getLanguageConfig } from './languages.js';
import { parseEnglish } from './util.js';
import { addManualMeaning, addMeanings, deleteMeaning, editMeaning, meaningsOf, pinMeaning, setMeanings, sourcedGlosses } from './glosses.js';
import {
  addManualPronunciation,
  addPronunciations,
  deletePronunciation,
  editPronunciation,
  pinPronunciation,
  pronunciationsOf,
  pronunciationsOfWords,
  setMainPronunciation,
} from './pronunciations.js';
import {
  addManualTranslation,
  addSentenceTranslations,
  deleteTranslation,
  editTranslation,
  pinTranslation,
  setSentenceTranslations,
  splitTranslations,
  translationsOf,
} from './sentenceTranslations.js';
import { idList, preferenceJson, rankSql } from './sourced.js';

export { parseEnglish };
import { dedupe, stripParentheticals } from '../../../shared/text.js';
import type { Paged, Recording, SentenceExclusion, SentenceRow, ValueChange, WordDetails, WordLevels, WordRow } from '../../../shared/types.js';

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
  const pronunciations = pronunciationsOfWords(
    db,
    rows.map((row) => row.id)
  );
  return { rows: rows.map((row) => withDetails(db, toWordRow(row), pronunciations.get(row.id) ?? [])), total };
}

// Where a word was found (books, word lists), its pronunciations and its stored recordings.
function withDetails(db: DB, word: WordRow, pronunciations = pronunciationsOf(db, word.id)): WordRow {
  const origins = db
    .prepare(
      `SELECT s.title, ws.count FROM word_sources ws JOIN sources s ON s.id = ws.source_id
       WHERE ws.word_id = ? ORDER BY ws.count DESC LIMIT 5`
    )
    .all(word.id) as { title: string; count: number }[];
  return { ...word, origins, pronunciations, audio: recordingsOf(db, word.display, preferenceJson(db, 'audio')) };
}

export function getWord(langId: string, id: number): WordRow {
  const db = languageDb(langId);
  return withDetails(db, toWordRow(getWordDb(db, id)));
}

// Everything about a word, each part with where it came from.
export function wordDetails(langId: string, id: number): WordDetails {
  const db = languageDb(langId);
  const word = getWord(langId, id);
  return {
    word,
    meanings: meaningsOf(db, id),
    pronunciations: word.pronunciations ?? [],
    origins: db
      .prepare(
        `SELECT s.id, s.title, s.kind, ws.count FROM word_sources ws JOIN sources s ON s.id = ws.source_id
         WHERE ws.word_id = ? ORDER BY ws.count DESC`
      )
      .all(id) as WordDetails['origins'],
    audio: word.audio ?? [],
  };
}

export interface DefinitionUpdate {
  id: number;
  english: string[];
  pronunciation?: string | null;
  pos?: string | null;
  source: string;
}

// Saves definitions fetched from a provider: meanings and pronunciation are
// added to the ones a word already has, each with its source. With
// `replace`, the meanings and pronunciations found by automation before are
// replaced (typed and pinned ones are never lost), and so is the part of speech.
export function saveDefinitions(db: DB, updates: DefinitionUpdate[], replace: boolean): number {
  let saved = 0;
  const glosses: string[] = [];
  const pos = replace
    ? db.prepare(`UPDATE words SET pos = COALESCE(?, pos) WHERE id = ?`)
    : db.prepare(`UPDATE words SET pos = COALESCE(pos, ?) WHERE id = ?`);
  const chinese = isChinese(getLanguageConfig(db));
  const bySource = new Map<string, DefinitionUpdate[]>();
  for (const update of updates) bySource.set(update.source, [...(bySource.get(update.source) ?? []), update]);
  db.transaction(() => {
    for (const [source, group] of bySource) {
      const meanings = group.map((update) => ({ id: update.id, english: dedupe(update.english.map((gloss) => gloss.trim()).filter(Boolean)).slice(0, 8) }));
      addMeanings(db, meanings, source, { replace });
      // Chinese pronunciations are pinyin.
      addPronunciations(db, group, source, { replace, ...(chinese ? { accept: isPinyin } : {}) });
      for (const update of group) {
        const english = meanings.find((meaning) => meaning.id === update.id)?.english ?? [];
        if (english.length === 0 && !update.pronunciation) continue;
        pos.run(update.pos?.trim() || null, update.id);
        glosses.push(...english);
        saved++;
      }
    }
  })();
  registerEnglishWords(glosses);
  invalidateGlossIndex();
  if (chinese) fillChinesePinyin(db, updates.map((update) => update.id));
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
    setMeanings(db, id, english);
    registerEnglishWords(english);
    invalidateGlossIndex();
  }
  if (patch.pronunciation !== undefined) setMainPronunciation(db, id, patch.pronunciation);
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

// The stored recordings of a text (several voices are possible): a pinned one
// first, then the preferred voices (`preferred`: JSON list), then the newest.
export function recordingsOf(db: DB, text: string, preferred = '[]'): Recording[] {
  return (
    db
      .prepare(
        `SELECT id, voice, created_at AS createdAt, pinned FROM audio WHERE text = ?
         ORDER BY pinned DESC, ${rankSql('voice')}, created_at DESC`
      )
      .all(audioText(text), preferred) as (Omit<Recording, 'pinned'> & { pinned: number })[]
  ).map((row) => ({ ...row, pinned: row.pinned === 1 }));
}

export function listSentences(
  langId: string,
  query: { offset: number; limit: number; q: string; filter: string; wordId?: number; sourceId?: number; sentenceId?: number }
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
  if (query.sourceId) {
    where.push('s.id IN (SELECT sentence_id FROM sentence_sources WHERE source_id = ?)');
    params.push(query.sourceId);
  }
  if (query.sentenceId) {
    where.push('s.id = ?');
    params.push(query.sentenceId);
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
    .all(...params, query.limit, query.offset) as Omit<SentenceRow, 'translations' | 'audio' | 'englishAudio' | 'origins'>[];
  const english = englishDatabase();
  const ids = rows.map((row) => row.id);
  const translations = translationsOf(db, ids);
  const origins = sentenceOrigins(db, ids);
  const voices = preferenceJson(db, 'audio');
  return {
    rows: rows.map((row) => ({
      ...row,
      origins: origins.get(row.id) ?? [],
      translations: translations.get(row.id) ?? [],
      audio: recordingsOf(db, row.text, voices),
      englishAudio: row.english ? recordingsOf(english, row.english) : [],
    })),
    total,
  };
}

// Every text each sentence was found in, the first one first.
export function sentenceOrigins(db: DB, sentenceIds: number[]): Map<number, SentenceRow['origins']> {
  const result = new Map<number, SentenceRow['origins']>();
  if (sentenceIds.length === 0) return result;
  const rows = db
    .prepare(
      `SELECT ss.sentence_id AS sentenceId, src.id, src.title, src.kind FROM sentence_sources ss
       JOIN sources src ON src.id = ss.source_id JOIN sentences s ON s.id = ss.sentence_id
       WHERE ss.sentence_id IN (SELECT value FROM json_each(?))
       ORDER BY ss.sentence_id, src.id != s.source_id, src.added_at`
    )
    .all(idList(sentenceIds)) as ({ sentenceId: number } & SentenceRow['origins'][number])[];
  for (const { sentenceId, ...origin } of rows) {
    const list = result.get(sentenceId) ?? [];
    list.push(origin);
    result.set(sentenceId, list);
  }
  return result;
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
export function saveSentenceTranslations(
  db: DB,
  translations: { id: number; english: string }[],
  source: string,
  options: { replace?: boolean } = {}
): number {
  return addSentenceTranslations(db, translations, source, options);
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

// ---------------------------------------------------------------------------
// One value at a time (Configuration → Words and Sentences). Each change
// returns the word or sentence as it is now.

export function changeMeaning(langId: string, wordId: number, change: ValueChange): WordDetails {
  const db = languageDb(langId);
  getWordDb(db, wordId);
  if ('add' in change) addManualMeaning(db, wordId, change.add);
  else if ('edit' in change) editMeaning(db, wordId, change.edit, change.text);
  else if ('remove' in change) deleteMeaning(db, wordId, change.remove);
  else pinMeaning(db, wordId, change.pin, change.pinned);
  if ('add' in change || 'edit' in change) registerEnglishWords(['add' in change ? change.add : change.text]);
  invalidateGlossIndex();
  return wordDetails(langId, wordId);
}

export function changePronunciation(langId: string, wordId: number, change: ValueChange): WordDetails {
  const db = languageDb(langId);
  getWordDb(db, wordId);
  if ('add' in change) addManualPronunciation(db, wordId, change.add);
  else if ('edit' in change) editPronunciation(db, wordId, change.edit, change.text);
  else if ('remove' in change) deletePronunciation(db, wordId, change.remove);
  else pinPronunciation(db, wordId, change.pin, change.pinned);
  return wordDetails(langId, wordId);
}

export function getSentence(langId: string, id: number): SentenceRow {
  const db = languageDb(langId);
  const row = db.prepare(`SELECT id FROM sentences WHERE id = ?`).get(id);
  if (!row) throw new HttpError(404, 'Sentence not found');
  return listSentences(langId, { offset: 0, limit: 1, q: '', filter: 'all', sentenceId: id }).rows[0];
}

export function changeTranslation(langId: string, sentenceId: number, change: ValueChange): SentenceRow {
  const db = languageDb(langId);
  if (!db.prepare(`SELECT 1 FROM sentences WHERE id = ?`).get(sentenceId)) throw new HttpError(404, 'Sentence not found');
  if ('add' in change) addManualTranslation(db, sentenceId, change.add);
  else if ('edit' in change) editTranslation(db, sentenceId, change.edit, change.text);
  else if ('remove' in change) deleteTranslation(db, sentenceId, change.remove);
  else pinTranslation(db, sentenceId, change.pin, change.pinned);
  return getSentence(langId, sentenceId);
}
