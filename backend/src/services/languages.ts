import fs from 'node:fs';
import {
  HttpError,
  closeLanguageDb,
  languageDb,
  languageDbPath,
  languageExists,
  listLanguageIds,
  type DB,
} from '../db/connection.js';
import { readMeta, writeMeta } from '../db/schema.js';
import { findCatalogLanguage, slugify } from '../../../shared/languages.js';
import type { InputMethod, LanguageConfig, LanguageSummary } from '../../../shared/types.js';

const INPUT_METHODS: InputMethod[] = ['auto', 'system', 'letters', 'phonetic', 'pinyin', 'japanese', 'hangul'];
// Scripts with thousands of characters are typed with an input method instead of buttons.
const LOGOGRAPHIC = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

export function defaultLanguageConfig(input: Partial<LanguageConfig> & { name: string }): LanguageConfig {
  const catalog = findCatalogLanguage(input.code || input.name);
  const name = input.name.trim() || catalog?.name || 'Language';
  const id = input.id || slugify(name) || slugify(input.code ?? '') || 'language';
  return {
    id,
    name,
    code: (input.code || catalog?.code || '').trim().toLowerCase(),
    locale: (input.locale || catalog?.locale || input.code || '').trim(),
    rtl: input.rtl ?? catalog?.rtl ?? false,
    detectProperNouns: input.detectProperNouns ?? !catalog?.capitalizedNouns,
    inputMethod: INPUT_METHODS.includes(input.inputMethod as InputMethod) ? (input.inputMethod as InputMethod) : 'auto',
    sourceWeighting: input.sourceWeighting === 'size' ? 'size' : 'equal',
    extraCharacters: input.extraCharacters ?? [],
    minSentenceWords: input.minSentenceWords ?? 3,
    maxSentenceWords: input.maxSentenceWords ?? 20,
    ttsVoice: input.ttsVoice ?? '',
    createdAt: input.createdAt ?? Date.now(),
  };
}

export function getLanguageConfig(db: DB): LanguageConfig {
  const raw = readMeta(db, 'config');
  if (!raw) throw new HttpError(500, 'Language database has no configuration');
  const parsed = JSON.parse(raw) as LanguageConfig;
  return defaultLanguageConfig(parsed);
}

export function configFor(id: string): LanguageConfig {
  return getLanguageConfig(languageDb(id));
}

function saveConfig(db: DB, config: LanguageConfig): void {
  writeMeta(db, 'config', JSON.stringify(config));
}

// Letters shown as one-click buttons while typing answers, most frequent
// first: the accented / special letters of Latin-script languages, or the
// whole alphabet of other scripts (Cyrillic, Greek, Arabic, Hebrew, Thai...).
export function autoCharacters(db: DB): string[] {
  const rows = db
    .prepare(`SELECT word, count FROM words WHERE active = 1 AND rank IS NOT NULL ORDER BY rank LIMIT 5000`)
    .all() as { word: string; count: number }[];
  const counts = new Map<string, number>();
  let ascii = 0;
  let other = 0;
  for (const { word, count } of rows) {
    for (const char of word) {
      if (!/[\p{L}\p{M}]/u.test(char)) continue;
      if (/[a-z]/.test(char)) {
        ascii += count;
      } else {
        other += count;
        counts.set(char, (counts.get(char) ?? 0) + count);
      }
    }
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([char]) => char);
  if (other <= ascii) return ranked.slice(0, 10);
  if (ranked.some((char) => LOGOGRAPHIC.test(char))) return [];
  return ranked.slice(0, 80);
}

export function languageSummary(id: string): LanguageSummary {
  const db = languageDb(id);
  const config = getLanguageConfig(db);
  const now = Date.now();
  const stats = db
    .prepare(
      `SELECT
         COUNT(*) FILTER (WHERE active = 1) AS wordCount,
         COUNT(*) FILTER (WHERE active = 1 AND english IS NOT NULL) AS definedWordCount,
         COUNT(*) FILTER (WHERE active = 1 AND srs_stage > 0) AS learnedCount,
         COUNT(*) FILTER (WHERE active = 1 AND srs_stage > 0 AND (next_review_at <= ? OR review_started_at IS NOT NULL)) AS dueCount
       FROM words`
    )
    .get(now) as { wordCount: number; definedWordCount: number; learnedCount: number; dueCount: number };
  const sentences = db
    .prepare(
      `SELECT COUNT(*) FILTER (WHERE excluded_reason IS NULL) AS sentenceCount,
              COUNT(english) FILTER (WHERE excluded_reason IS NULL) AS translatedSentenceCount,
              COUNT(*) FILTER (WHERE excluded_reason IS NOT NULL) AS excludedSentenceCount
       FROM sentences`
    )
    .get() as { sentenceCount: number; translatedSentenceCount: number; excludedSentenceCount: number };
  const sources = db.prepare(`SELECT COUNT(*) AS n FROM sources`).get() as { n: number };
  return {
    ...config,
    ...stats,
    ...sentences,
    sourceCount: sources.n,
    autoCharacters: autoCharacters(db),
  };
}

export function listLanguages(): LanguageSummary[] {
  const result: LanguageSummary[] = [];
  for (const id of listLanguageIds()) {
    try {
      result.push(languageSummary(id));
    } catch (error) {
      console.error(`Could not open language "${id}":`, (error as Error).message);
    }
  }
  return result.sort((a, b) => a.name.localeCompare(b.name));
}

export function createLanguage(input: Partial<LanguageConfig> & { name: string }): LanguageSummary {
  if (!input.name?.trim()) throw new HttpError(400, 'A language name is required');
  const config = defaultLanguageConfig(input);
  if (!config.code) throw new HttpError(400, 'An ISO 639-1 language code (e.g. "es") is required');
  if (languageExists(config.id)) throw new HttpError(409, `Language "${config.id}" already exists`);
  const db = languageDb(config.id, true);
  saveConfig(db, config);
  return languageSummary(config.id);
}

export function updateLanguage(id: string, patch: Partial<LanguageConfig>): LanguageSummary {
  const db = languageDb(id);
  const current = getLanguageConfig(db);
  const next: LanguageConfig = {
    ...current,
    ...Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)),
    id: current.id,
    createdAt: current.createdAt,
  };
  next.inputMethod = INPUT_METHODS.includes(next.inputMethod) ? next.inputMethod : 'auto';
  next.sourceWeighting = next.sourceWeighting === 'size' ? 'size' : 'equal';
  next.minSentenceWords = Math.max(1, Math.min(50, Math.round(next.minSentenceWords)));
  next.maxSentenceWords = Math.max(next.minSentenceWords, Math.min(80, Math.round(next.maxSentenceWords)));
  saveConfig(db, next);
  return languageSummary(id);
}

export function deleteLanguage(id: string): void {
  const file = languageDbPath(id);
  closeLanguageDb(id);
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    fs.rmSync(file + suffix, { force: true });
  }
}
