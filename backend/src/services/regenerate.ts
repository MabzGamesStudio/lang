import { HttpError, languageDb, type DB } from '../db/connection.js';
import { cleanPreferences, getLanguageConfig, languageSummary, updateLanguage } from './languages.js';
import { syncMeanings } from './glosses.js';
import { syncPronunciations } from './pronunciations.js';
import { syncMainTranslations } from './sentenceTranslations.js';
import { invalidateGlossIndex } from './glossIndex.js';
import { audioText } from './words.js';
import type { LanguageSummary, RegeneratePolicy, SourceInventory, SourcePreferences } from '../../../shared/types.js';

// Which sources are preferred, which sources each kind of data comes from,
// and which words or sentences a generation job works on.

export const ONLY_MISSING: RegeneratePolicy = { mode: 'missing', keep: [], replace: false };
// Every word or sentence asked for (e.g. "get the meanings of this word again").
export const ALWAYS: RegeneratePolicy = { mode: 'unless', keep: [], replace: false };

export function cleanPolicy(input: unknown, fallback: RegeneratePolicy = ONLY_MISSING): RegeneratePolicy {
  if (!input || typeof input !== 'object') return fallback;
  const value = input as Partial<RegeneratePolicy>;
  return {
    mode: value.mode === 'unless' ? 'unless' : 'missing',
    keep: Array.isArray(value.keep) ? [...new Set(value.keep.filter((item): item is string => typeof item === 'string'))] : [],
    replace: value.replace === true,
  };
}

// SQL condition (and its parameters) for the rows of `table` (words or
// sentences, aliased by the caller as the table name) that need new values.
function needsCondition(kind: 'meanings' | 'pronunciations' | 'translations', policy: RegeneratePolicy): { sql: string; params: unknown[] } {
  const store =
    kind === 'meanings'
      ? { missing: 'words.english IS NULL', table: 'word_meanings', key: 'word_id', owner: 'words.id' }
      : kind === 'pronunciations'
        ? { missing: 'words.pronunciation IS NULL', table: 'word_pronunciations', key: 'word_id', owner: 'words.id' }
        : { missing: 'sentences.english IS NULL', table: 'sentence_translations', key: 'sentence_id', owner: 'sentences.id' };
  if (policy.mode === 'missing') return { sql: store.missing, params: [] };
  return {
    sql: `NOT EXISTS (SELECT 1 FROM ${store.table} v WHERE v.${store.key} = ${store.owner} AND v.source IN (SELECT value FROM json_each(?)))`,
    params: [JSON.stringify(policy.keep)],
  };
}

export function wordsNeeding(kind: 'meanings' | 'pronunciations', policy: RegeneratePolicy) {
  return needsCondition(kind, policy);
}

export function sentencesNeeding(policy: RegeneratePolicy) {
  return needsCondition('translations', policy);
}

// Does a text need a new recording?
export function audioNeeded(db: DB, text: string, policy: RegeneratePolicy): boolean {
  const clean = audioText(text);
  if (policy.mode === 'missing') return !db.prepare(`SELECT 1 FROM audio WHERE text = ? LIMIT 1`).get(clean);
  return !db.prepare(`SELECT 1 FROM audio WHERE text = ? AND voice IN (SELECT value FROM json_each(?)) LIMIT 1`).get(clean, JSON.stringify(policy.keep));
}

// Words to learn and sentences in use are the ones generation jobs work on.
const ACTIVE_WORDS = 'words.active = 1 AND words.rank IS NOT NULL';
const SENTENCES_IN_USE = "(sentences.excluded_reason IS NULL OR sentences.excluded_reason = 'audio') AND sentences.max_rank IS NOT NULL";

// How many words or sentences a job with this policy would work on.
export function countNeeding(langId: string, kind: 'meanings' | 'pronunciations' | 'translations' | 'audio', policy: RegeneratePolicy): number {
  const db = languageDb(langId);
  if (kind === 'meanings' || kind === 'pronunciations') {
    const condition = needsCondition(kind, policy);
    return (db.prepare(`SELECT COUNT(*) AS n FROM words WHERE ${ACTIVE_WORDS} AND ${condition.sql}`).get(...condition.params) as { n: number }).n;
  }
  if (kind === 'translations') {
    const condition = needsCondition(kind, policy);
    return (db.prepare(`SELECT COUNT(*) AS n FROM sentences WHERE ${SENTENCES_IN_USE} AND ${condition.sql}`).get(...condition.params) as { n: number }).n;
  }
  const recorded =
    policy.mode === 'missing'
      ? `EXISTS (SELECT 1 FROM audio a WHERE a.text = TEXT)`
      : `EXISTS (SELECT 1 FROM audio a WHERE a.text = TEXT AND a.voice IN (SELECT value FROM json_each(?)))`;
  const params = policy.mode === 'missing' ? [] : [JSON.stringify(policy.keep)];
  const words = db.prepare(`SELECT COUNT(*) AS n FROM words WHERE ${ACTIVE_WORDS} AND NOT ${recorded.replace('TEXT', 'words.display')}`).get(...params) as { n: number };
  // Sentences reported for their audio are redone by their own job (Configuration → Sentences).
  const sentences = db
    .prepare(
      `SELECT COUNT(*) AS n FROM sentences WHERE ${SENTENCES_IN_USE} AND sentences.excluded_reason IS NULL AND NOT ${recorded.replace('TEXT', 'sentences.text')}`
    )
    .get(...params) as { n: number };
  return words.n + sentences.n;
}

export { ACTIVE_WORDS, SENTENCES_IN_USE };

// Which sources each kind of data comes from, and how much.
export function sourceInventory(langId: string): SourceInventory {
  const db = languageDb(langId);
  const counts = (sql: string) => db.prepare(sql).all() as { source: string; count: number }[];
  return {
    meanings: counts(`SELECT source, COUNT(*) AS count FROM word_meanings GROUP BY source ORDER BY count DESC`),
    pronunciations: counts(`SELECT source, COUNT(*) AS count FROM word_pronunciations GROUP BY source ORDER BY count DESC`),
    translations: counts(`SELECT source, COUNT(*) AS count FROM sentence_translations GROUP BY source ORDER BY count DESC`),
    audio: counts(`SELECT voice AS source, COUNT(*) AS count FROM audio GROUP BY voice ORDER BY count DESC`),
    sentences: db
      .prepare(
        `SELECT s.id, s.title, s.kind, COUNT(ss.sentence_id) AS count FROM sources s JOIN sentence_sources ss ON ss.source_id = s.id
         GROUP BY s.id ORDER BY s.added_at`
      )
      .all() as SourceInventory['sentences'],
  };
}

// Saves the preferred sources; the values used (main meaning, pronunciation
// and translation of every word and sentence) follow the new order at once.
export function saveSourcePreferences(langId: string, input: Partial<SourcePreferences>): LanguageSummary {
  const db = languageDb(langId);
  const current = getLanguageConfig(db).sourcePreferences;
  const next = cleanPreferences({ ...current, ...input });
  for (const id of next.sentences) {
    if (!db.prepare(`SELECT 1 FROM sources WHERE id = ?`).get(id)) throw new HttpError(400, `Unknown source ${id}`);
  }
  updateLanguage(langId, { sourcePreferences: next });
  db.transaction(() => {
    syncMeanings(db);
    syncPronunciations(db);
    syncMainTranslations(db);
  })();
  invalidateGlossIndex();
  return languageSummary(langId);
}
