import type { DB } from '../db/connection.js';
import { parseEnglish } from './util.js';

// The English meanings of a word, each with where it came from: "wiktionary",
// "llm:…", "word list: …" or "manual" (typed by the learner). Stored as two
// parallel JSON arrays: words.english and words.english_sources.

export interface SourcedGloss {
  text: string;
  source: string;
}

const MAX_GLOSSES = 12;

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

export function readGlosses(db: DB, wordId: number): SourcedGloss[] {
  const row = db.prepare(`SELECT english, english_sources, definition_source FROM words WHERE id = ?`).get(wordId) as
    | { english: string | null; english_sources: string | null; definition_source: string | null }
    | undefined;
  return row ? sourcedGlosses(row.english, row.english_sources, row.definition_source) : [];
}

// Saves the meanings of a word (the same meaning only once, first one wins).
export function storeGlosses(db: DB, wordId: number, glosses: SourcedGloss[]): SourcedGloss[] {
  const seen = new Set<string>();
  const kept: SourcedGloss[] = [];
  for (const gloss of glosses) {
    const text = gloss.text.replace(/\s+/g, ' ').trim();
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    kept.push({ text, source: gloss.source });
    if (kept.length >= MAX_GLOSSES) break;
  }
  db.prepare(`UPDATE words SET english = ?, english_sources = ?, definition_source = ? WHERE id = ?`).run(
    kept.length ? JSON.stringify(kept.map((gloss) => gloss.text)) : null,
    kept.length ? JSON.stringify(kept.map((gloss) => gloss.source)) : null,
    kept[0]?.source ?? null,
    wordId
  );
  return kept;
}

// Adds meanings from one source after the ones a word already has.
export function addGlosses(db: DB, wordId: number, texts: string[], source: string): SourcedGloss[] {
  return storeGlosses(db, wordId, [...readGlosses(db, wordId), ...texts.map((text) => ({ text, source }))]);
}
