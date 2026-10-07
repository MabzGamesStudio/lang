import { HttpError, languageDb } from '../db/connection.js';
import { getLanguageConfig } from '../services/languages.js';
import { getSettings } from '../services/settings.js';
import { fetchJson } from '../services/http.js';
import { saveDefinitions, type DefinitionUpdate } from '../services/words.js';
import { decodeEntities } from '../services/textProcessing.js';
import { yieldToEventLoop, type JobContext } from '../services/jobs.js';
import { chat, extractItems, llmAvailable, llmLabel } from './llm.js';
import { splitGlossList } from '../../../shared/text.js';
import type { LanguageConfig } from '../../../shared/types.js';

interface WordToDefine {
  id: number;
  word: string;
}

interface Definition {
  english: string[];
  pronunciation: string | null;
  pos: string | null;
}

export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

// ---------------------------------------------------------------------------
// LLM (Google Colab open-source model, OpenAI-compatible API or Anthropic)

interface LlmDefinition {
  word?: string;
  english?: unknown;
  pos?: unknown;
  ipa?: unknown;
}

async function defineWithLlm(words: WordToDefine[], config: LanguageConfig): Promise<Map<number, Definition>> {
  const list = words.map((w) => w.word);
  const reply = await chat(
    [
      {
        role: 'system',
        content: `You are an expert ${config.name}-English lexicographer writing flashcards for learners.`,
      },
      {
        role: 'user',
        content: `For each ${config.name} word below (taken from a frequency list of real texts, so it may be an inflected form), give:
- "english": 1-4 short English translations, most common meaning first. Translate the form itself (a past tense verb → "said", a plural noun → plural). Use "to ..." only for infinitives.
- "pos": part of speech (noun, verb, adjective, adverb, pronoun, preposition, conjunction, determiner, interjection, numeral or other)
- "ipa": pronunciation in IPA, without slashes
Return only JSON: {"items":[{"word":"...","english":["..."],"pos":"...","ipa":"..."}]} with exactly one item per word, in the same order.
Words: ${JSON.stringify(list)}`,
      },
    ],
    { temperature: 0.1 }
  );
  const items = extractItems<LlmDefinition>(reply);
  const byWord = new Map<string, LlmDefinition>();
  for (const item of items) {
    if (typeof item.word === 'string') byWord.set(item.word.normalize('NFC').toLocaleLowerCase(config.locale), item);
  }
  const result = new Map<number, Definition>();
  words.forEach((word, index) => {
    const item = byWord.get(word.word) ?? (items.length === words.length ? items[index] : undefined);
    if (!item) return;
    const english = Array.isArray(item.english)
      ? item.english.map(String)
      : typeof item.english === 'string'
        ? splitGlossList(item.english)
        : [];
    const ipa = typeof item.ipa === 'string' ? item.ipa.replace(/^[/[]|[/\]]$/g, '').trim() : '';
    result.set(word.id, {
      english: english.map((gloss) => gloss.trim()).filter(Boolean),
      pronunciation: ipa || null,
      pos: typeof item.pos === 'string' ? item.pos.toLowerCase() : null,
    });
  });
  return result;
}

// ---------------------------------------------------------------------------
// Wiktionary (free, no key)

interface WiktionaryEntry {
  partOfSpeech: string;
  language: string;
  definitions: { definition: string }[];
}

function stripHtml(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
}

const FORM_OF = /\b(inflection|form|plural|singular|participle|feminine|masculine|conjugation|person|tense|imperative|gerund|diminutive|augmentative|apocopic|contraction|superlative|comparative|preterite|indicative|subjunctive)\b[^.]*\bof\b/i;

function shortGloss(text: string): string {
  return text
    .replace(/^(\([^)]*\)\s*)+/, '')
    .split(/;|:/)[0]
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
}

async function wiktionaryEntries(word: string, config: LanguageConfig): Promise<WiktionaryEntry[]> {
  try {
    const data = await fetchJson<Record<string, WiktionaryEntry[]>>(
      `https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(word)}?redirect=true`,
      { timeoutMs: 20_000 }
    );
    return (
      data[config.code] ??
      Object.values(data).find((entries) => entries[0]?.language?.toLowerCase() === config.name.toLowerCase()) ??
      []
    );
  } catch (error) {
    if (/^404/.test((error as Error).message)) return [];
    throw error;
  }
}

async function wiktionaryPronunciation(word: string, config: LanguageConfig): Promise<string | null> {
  try {
    const params = new URLSearchParams({
      action: 'parse',
      page: word,
      prop: 'text',
      format: 'json',
      formatversion: '2',
      redirects: '1',
    });
    const data = await fetchJson<{ parse?: { text?: string } }>(`https://en.wiktionary.org/w/api.php?${params}`, {
      timeoutMs: 20_000,
    });
    const html = data.parse?.text ?? '';
    const heading = html.search(new RegExp(`<h2[^>]*id="${config.name.replace(/[^A-Za-z_]/g, '_')}"`, 'i'));
    if (heading < 0) return null;
    const nextHeading = html.indexOf('<h2', heading + 4);
    const section = html.slice(heading, nextHeading > 0 ? nextHeading : undefined);
    const ipa = /<span[^>]*class="[^"]*\bIPA\b[^"]*"[^>]*>([^<]+)<\/span>/.exec(section);
    return ipa ? decodeEntities(ipa[1]).replace(/^[/[]|[/\]]$/g, '').trim() : null;
  } catch {
    return null;
  }
}

async function defineWithWiktionary(word: string, config: LanguageConfig, depth = 0): Promise<Definition | null> {
  const entries = await wiktionaryEntries(word, config);
  if (entries.length === 0) return null;
  const glosses: string[] = [];
  for (const entry of entries.slice(0, 3)) {
    for (const definition of entry.definitions.slice(0, 3)) {
      const text = stripHtml(definition.definition);
      if (!text) continue;
      const lemma = /title="([^"]+)"/.exec(definition.definition)?.[1];
      if (FORM_OF.test(text) && lemma && depth === 0 && lemma !== word) {
        const lemmaDefinition = await defineWithWiktionary(lemma, config, depth + 1);
        if (lemmaDefinition) glosses.push(...lemmaDefinition.english.slice(0, 2));
        continue;
      }
      const gloss = shortGloss(text);
      if (gloss) glosses.push(gloss);
    }
  }
  if (glosses.length === 0) return null;
  return {
    english: [...new Set(glosses)].slice(0, 4),
    pronunciation: depth === 0 ? await wiktionaryPronunciation(word, config) : null,
    pos: entries[0].partOfSpeech?.toLowerCase() ?? null,
  };
}

// ---------------------------------------------------------------------------

export async function fetchDefinitions(
  langId: string,
  options: { limit?: number; wordIds?: number[]; overwrite?: boolean },
  ctx?: JobContext
): Promise<string> {
  const db = languageDb(langId);
  const config = getLanguageConfig(db);
  const settings = getSettings();
  const provider = settings.definitions.provider;
  if (provider === 'llm' && !llmAvailable(settings)) {
    throw new HttpError(400, 'Definitions are set to use an LLM, but no LLM is configured in Configuration → Services.');
  }
  const words = options.wordIds
    ? (db
        .prepare(
          `SELECT id, word FROM words WHERE id IN (SELECT value FROM json_each(?)) ${options.overwrite ? '' : 'AND english IS NULL'} ORDER BY rank`
        )
        .all(JSON.stringify(options.wordIds)) as WordToDefine[])
    : (db
        .prepare(
          `SELECT id, word FROM words WHERE active = 1 AND rank IS NOT NULL ${options.overwrite ? '' : 'AND english IS NULL'} ORDER BY rank LIMIT ?`
        )
        .all(options.limit ?? 100) as WordToDefine[]);
  if (words.length === 0) return 'All selected words already have definitions';

  let saved = 0;
  const failures: string[] = [];
  if (provider === 'llm') {
    const batchSize = Math.max(5, settings.definitions.batchSize);
    for (let start = 0; start < words.length; start += batchSize) {
      ctx?.checkCancelled();
      ctx?.progress(start, words.length, `Asking the LLM for definitions (${start}/${words.length})…`);
      const batch = words.slice(start, start + batchSize);
      try {
        const definitions = await defineWithLlm(batch, config);
        const updates: DefinitionUpdate[] = [...definitions.entries()].map(([id, definition]) => ({
          id,
          ...definition,
          source: llmLabel(settings),
        }));
        saved += saveDefinitions(db, updates, Boolean(options.overwrite));
      } catch (error) {
        failures.push((error as Error).message);
        if (failures.length >= 3 && saved === 0) throw new Error(`Definitions failed: ${failures[0]}`);
      }
    }
  } else {
    let done = 0;
    for (let start = 0; start < words.length; start += 20) {
      ctx?.checkCancelled();
      const batch = words.slice(start, start + 20);
      const definitions = await mapLimit(batch, 4, async (word) => {
        try {
          return await defineWithWiktionary(word.word, config);
        } catch (error) {
          failures.push(`${word.word}: ${(error as Error).message}`);
          return null;
        } finally {
          done++;
          ctx?.progress(done, words.length, `Looking up words on Wiktionary (${done}/${words.length})…`);
        }
      });
      const updates: DefinitionUpdate[] = [];
      batch.forEach((word, index) => {
        const definition = definitions[index];
        if (definition) updates.push({ id: word.id, ...definition, source: 'wiktionary' });
      });
      saved += saveDefinitions(db, updates, Boolean(options.overwrite));
      if (failures.length >= 5 && saved === 0) throw new Error(`Wiktionary lookups failed: ${failures[0]}`);
      await yieldToEventLoop();
    }
  }
  ctx?.progress(words.length, words.length);
  const missing = words.length - saved;
  return `Defined ${saved} of ${words.length} words${missing ? ` (${missing} not found${failures.length ? `; ${failures[0]}` : ''})` : ''}`;
}
