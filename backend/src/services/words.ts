import { HttpError, languageDb, type DB } from '../db/connection.js';
import { refreshSentenceCounts, wordIdsOfSentences } from './ranking.js';
import { registerEnglishWords } from './english.js';
import { setWordExclusion } from './corpus.js';
import { invalidateGlossIndex } from './glossIndex.js';
import { parseEnglish } from './util.js';

export { parseEnglish };
import { dedupe } from '../../../shared/text.js';
import type { Paged, SentenceRow, WordLevels, WordRow } from '../../../shared/types.js';

export interface WordDbRow {
  id: number;
  word: string;
  display: string;
  rank: number | null;
  count: number;
  score: number;
  english: string | null;
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

export const WORD_COLUMNS = `id, word, display, rank, count, score, english, pronunciation, pos, definition_source,
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
  return {
    id: row.id,
    word: row.word,
    display: row.display,
    rank: row.rank,
    count: row.count,
    score: row.score,
    english: parseEnglish(row.english),
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
  return { rows: rows.map(toWordRow), total };
}

export function getWord(langId: string, id: number): WordRow {
  return toWordRow(getWordDb(languageDb(langId), id));
}

export interface DefinitionUpdate {
  id: number;
  english: string[];
  pronunciation?: string | null;
  pos?: string | null;
  source: string;
}

// Saves definitions fetched from a provider. Existing values are kept unless
// `overwrite` is set (manual edits are never lost by automation).
export function saveDefinitions(db: DB, updates: DefinitionUpdate[], overwrite: boolean): number {
  let saved = 0;
  const glosses: string[] = [];
  const statement = overwrite
    ? db.prepare(
        `UPDATE words SET english = ?, pronunciation = COALESCE(?, pronunciation), pos = COALESCE(?, pos), definition_source = ? WHERE id = ?`
      )
    : db.prepare(
        `UPDATE words SET english = COALESCE(english, ?), pronunciation = COALESCE(pronunciation, ?),
           pos = COALESCE(pos, ?), definition_source = COALESCE(definition_source, ?) WHERE id = ?`
      );
  db.transaction(() => {
    for (const update of updates) {
      const english = dedupe(update.english.map((gloss) => gloss.trim()).filter(Boolean)).slice(0, 8);
      if (english.length === 0 && !update.pronunciation) continue;
      statement.run(
        english.length ? JSON.stringify(english) : null,
        update.pronunciation?.trim() || null,
        update.pos?.trim() || null,
        update.source,
        update.id
      );
      glosses.push(...english);
      saved++;
    }
  })();
  registerEnglishWords(glosses);
  invalidateGlossIndex();
  return saved;
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
    db.prepare(`UPDATE words SET english = ?, definition_source = ? WHERE id = ?`).run(
      english.length ? JSON.stringify(english) : null,
      english.length ? 'manual' : null,
      id
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

export function listSentences(
  langId: string,
  query: { offset: number; limit: number; q: string; filter: string; wordId?: number }
): Paged<SentenceRow> {
  const db = languageDb(langId);
  const where: string[] = [];
  const params: unknown[] = [];
  if (query.filter === 'untranslated') where.push('english IS NULL');
  if (query.filter === 'translated') where.push('english IS NOT NULL');
  if (query.q.trim()) {
    where.push('(text LIKE ? OR english LIKE ?)');
    params.push(`%${query.q.trim()}%`, `%${query.q.trim()}%`);
  }
  if (query.wordId) {
    where.push('id IN (SELECT sentence_id FROM sentence_words WHERE word_id = ?)');
    params.push(query.wordId);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM sentences ${clause}`).get(...params) as { n: number }).n;
  const rows = db
    .prepare(
      `SELECT id, text, english, translation_source AS translationSource, source_id AS sourceId,
              word_count AS wordCount, max_rank AS maxRank
       FROM sentences ${clause} ORDER BY max_rank IS NULL, max_rank, word_count LIMIT ? OFFSET ?`
    )
    .all(...params, query.limit, query.offset) as SentenceRow[];
  return { rows, total };
}

export function saveSentenceTranslations(db: DB, translations: { id: number; english: string }[], source: string): number {
  const update = db.prepare(`UPDATE sentences SET english = ?, translation_source = ? WHERE id = ?`);
  let saved = 0;
  db.transaction(() => {
    for (const translation of translations) {
      const english = translation.english.replace(/\s+/g, ' ').trim();
      if (!english) continue;
      update.run(english, source, translation.id);
      saved++;
    }
  })();
  refreshSentenceCounts(db, wordIdsOfSentences(db, translations.map((t) => t.id)));
  return saved;
}

export function updateSentence(langId: string, id: number, patch: { english: string | null }): void {
  const db = languageDb(langId);
  db.prepare(`UPDATE sentences SET english = ?, translation_source = 'manual' WHERE id = ?`).run(
    patch.english?.trim() || null,
    id
  );
  refreshSentenceCounts(db, wordIdsOfSentences(db, [id]));
}

export function deleteSentence(langId: string, id: number): void {
  const db = languageDb(langId);
  const wordIds = wordIdsOfSentences(db, [id]);
  db.prepare(`DELETE FROM sentences WHERE id = ?`).run(id);
  refreshSentenceCounts(db, wordIds);
}
