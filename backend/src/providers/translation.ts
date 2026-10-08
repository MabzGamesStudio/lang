import { HttpError, languageDb, type DB } from '../db/connection.js';
import { getLanguageConfig } from '../services/languages.js';
import { getSettings } from '../services/settings.js';
import { postJson } from '../services/http.js';
import { saveSentenceTranslations } from '../services/words.js';
import { recomputeRanks, refreshSentenceCounts, wordIdsOfSentences } from '../services/ranking.js';
import { wordIdFor } from '../services/corpus.js';
import { tokenize, tidySentence } from '../services/textProcessing.js';
import type { JobContext } from '../services/jobs.js';
import { chat, extractItems, llmAvailable, llmLabel } from './llm.js';
import type { LanguageConfig } from '../../../shared/types.js';

interface SentenceToTranslate {
  id: number;
  text: string;
}

// Untranslated sentences in the order they will be needed: for each word,
// the easiest sentences (lowest "hardest word" rank) first.
export function sentencesNeedingTranslation(
  db: DB,
  options: { limit?: number; wordIds?: number[]; perWord?: number }
): SentenceToTranslate[] {
  if (options.wordIds) {
    const perWord = options.perWord ?? 4;
    const statement = db.prepare(
      `SELECT s.id, s.text FROM sentences s
       WHERE s.english IS NULL AND s.id IN (SELECT sentence_id FROM sentence_words WHERE word_id = ?)
       ORDER BY s.max_rank IS NULL, s.max_rank, s.word_count LIMIT ?`
    );
    const translatedCount = db.prepare(
      `SELECT COUNT(DISTINCT sw.sentence_id) AS n FROM sentence_words sw JOIN sentences s ON s.id = sw.sentence_id
       WHERE sw.word_id = ? AND s.english IS NOT NULL`
    );
    const chosen = new Map<number, SentenceToTranslate>();
    for (const wordId of options.wordIds) {
      const have = (translatedCount.get(wordId) as { n: number }).n;
      if (have >= perWord) continue;
      for (const row of statement.all(wordId, perWord - have) as SentenceToTranslate[]) chosen.set(row.id, row);
    }
    return [...chosen.values()];
  }
  return db
    .prepare(
      `SELECT id, text FROM sentences WHERE english IS NULL AND max_rank IS NOT NULL
       ORDER BY max_rank, word_count LIMIT ?`
    )
    .all(options.limit ?? 100) as SentenceToTranslate[];
}

async function translateWithLlm(sentences: SentenceToTranslate[], config: LanguageConfig): Promise<Map<number, string>> {
  const items = sentences.map((sentence, index) => ({ id: index + 1, text: sentence.text }));
  const reply = await chat(
    [
      { role: 'system', content: `You are a professional ${config.name}-to-English translator.` },
      {
        role: 'user',
        content: `Translate each ${config.name} sentence into natural, faithful English. Keep the meaning and tone, do not add explanations.
Return only JSON: {"items":[{"id":1,"english":"..."}]} with one item per sentence.
${JSON.stringify(items)}`,
      },
    ],
    { temperature: 0.1 }
  );
  const result = new Map<number, string>();
  for (const item of extractItems<{ id?: unknown; english?: unknown }>(reply)) {
    const index = Number(item.id) - 1;
    if (sentences[index] && typeof item.english === 'string') result.set(sentences[index].id, item.english);
  }
  return result;
}

async function translateWithApi(texts: string[], config: LanguageConfig): Promise<string[]> {
  const settings = getSettings();
  const { provider } = settings.translation;
  if (provider === 'deepl') {
    const key = settings.translation.deepl.apiKey;
    if (!key) throw new HttpError(400, 'Add a DeepL API key in Configuration → Services.');
    const host = key.endsWith(':fx') ? 'https://api-free.deepl.com' : 'https://api.deepl.com';
    const data = await postJson<{ translations: { text: string }[] }>(
      `${host}/v2/translate`,
      { text: texts, source_lang: config.code.toUpperCase(), target_lang: 'EN-US' },
      { Authorization: `DeepL-Auth-Key ${key}` }
    );
    return data.translations.map((t) => t.text);
  }
  if (provider === 'google') {
    const key = settings.translation.google.apiKey;
    if (!key) throw new HttpError(400, 'Add a Google Cloud Translation API key in Configuration → Services.');
    const data = await postJson<{ data: { translations: { translatedText: string }[] } }>(
      `https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(key)}`,
      { q: texts, source: config.code, target: 'en', format: 'text' }
    );
    return data.data.translations.map((t) => t.translatedText);
  }
  if (provider === 'libretranslate') {
    const { url, apiKey } = settings.translation.libretranslate;
    const data = await postJson<{ translatedText: string | string[] }>(`${url.replace(/\/+$/, '')}/translate`, {
      q: texts,
      source: config.code,
      target: 'en',
      format: 'text',
      ...(apiKey ? { api_key: apiKey } : {}),
    });
    return Array.isArray(data.translatedText) ? data.translatedText : [data.translatedText];
  }
  throw new HttpError(400, `Unknown translation provider "${provider}"`);
}

export async function translateBatch(sentences: SentenceToTranslate[], config: LanguageConfig): Promise<Map<number, string>> {
  const settings = getSettings();
  if (settings.translation.provider === 'llm') return translateWithLlm(sentences, config);
  const translated = await translateWithApi(
    sentences.map((s) => s.text),
    config
  );
  return new Map(sentences.map((sentence, index) => [sentence.id, translated[index] ?? '']));
}

export function translationLabel(): string {
  const settings = getSettings();
  return settings.translation.provider === 'llm' ? llmLabel(settings) : settings.translation.provider;
}

export function translationAvailable(): boolean {
  const settings = getSettings();
  switch (settings.translation.provider) {
    case 'llm':
      return llmAvailable(settings);
    case 'deepl':
      return Boolean(settings.translation.deepl.apiKey);
    case 'google':
      return Boolean(settings.translation.google.apiKey);
    case 'libretranslate':
      return Boolean(settings.translation.libretranslate.url);
  }
}

export async function translateSentences(
  langId: string,
  options: { limit?: number; wordIds?: number[]; perWord?: number },
  ctx?: JobContext
): Promise<string> {
  const db = languageDb(langId);
  const config = getLanguageConfig(db);
  const settings = getSettings();
  if (!translationAvailable()) {
    throw new HttpError(400, 'Sentence translation is not configured. Set it up in Configuration → Services.');
  }
  const sentences = sentencesNeedingTranslation(db, options);
  if (sentences.length === 0) return 'No sentences need translating';
  const batchSize = Math.max(1, settings.translation.provider === 'llm' ? settings.translation.batchSize : 40);
  const label = translationLabel();
  let saved = 0;
  const failures: string[] = [];
  for (let start = 0; start < sentences.length; start += batchSize) {
    ctx?.checkCancelled();
    ctx?.progress(start, sentences.length, `Translating sentences (${start}/${sentences.length})…`);
    const batch = sentences.slice(start, start + batchSize);
    try {
      const translations = await translateBatch(batch, config);
      saved += saveSentenceTranslations(
        db,
        [...translations.entries()].map(([id, english]) => ({ id, english })),
        label
      );
    } catch (error) {
      failures.push((error as Error).message);
      if (failures.length >= 3 && saved === 0) throw new Error(`Translation failed: ${failures[0]}`);
    }
  }
  ctx?.progress(sentences.length, sentences.length);
  return `Translated ${saved} of ${sentences.length} sentences${failures.length ? ` (${failures.length} batches failed: ${failures[0]})` : ''}`;
}

// ---------------------------------------------------------------------------
// LLM sentence generation for words that have too few example sentences.

function generatedSourceId(db: DB): number {
  const existing = db.prepare(`SELECT id FROM sources WHERE kind = 'generated'`).get() as { id: number } | undefined;
  if (existing) return existing.id;
  return Number(
    db
      .prepare(
        `INSERT INTO sources (kind, title, url, token_count, sentence_count, word_count, weight, added_at)
         VALUES ('generated', 'LLM-generated sentences', NULL, 0, 0, 0, 0, ?)`
      )
      .run(Date.now()).lastInsertRowid
  );
}

export async function generateSentences(
  langId: string,
  options: { limit?: number; wordIds?: number[]; minSentences?: number },
  ctx?: JobContext
): Promise<string> {
  const db = languageDb(langId);
  const config = getLanguageConfig(db);
  const settings = getSettings();
  if (!llmAvailable(settings)) throw new HttpError(400, 'Sentence generation needs an LLM (Configuration → Services).');
  const minSentences = options.minSentences ?? 3;
  const targets = (
    options.wordIds
      ? db
          .prepare(
            `SELECT id, word, english, rank FROM words WHERE id IN (SELECT value FROM json_each(?)) AND translated_sentence_count < ? ORDER BY rank`
          )
          .all(JSON.stringify(options.wordIds), minSentences)
      : db
          .prepare(
            `SELECT id, word, english, rank FROM words
             WHERE active = 1 AND rank IS NOT NULL AND english IS NOT NULL AND translated_sentence_count < ?
             ORDER BY rank LIMIT ?`
          )
          .all(minSentences, options.limit ?? 50)
  ) as { id: number; word: string; english: string | null; rank: number }[];
  if (targets.length === 0) return 'Every selected word already has enough sentences';

  const sourceId = generatedSourceId(db);
  const wordSegmenter = new Intl.Segmenter(config.locale, { granularity: 'word' });
  let added = 0;
  const failures: string[] = [];
  for (let start = 0; start < targets.length; start += 10) {
    ctx?.checkCancelled();
    ctx?.progress(start, targets.length, `Generating example sentences (${start}/${targets.length})…`);
    const batch = targets.slice(start, start + 10);
    const maxRank = Math.max(...batch.map((t) => t.rank)) + 60;
    const vocabulary = (
      db.prepare(`SELECT word FROM words WHERE active = 1 AND rank <= ? ORDER BY rank LIMIT 400`).all(maxRank) as {
        word: string;
      }[]
    ).map((row) => row.word);
    try {
      const reply = await chat(
        [
          { role: 'system', content: `You write simple, natural ${config.name} example sentences for language learners.` },
          {
            role: 'user',
            content: `For each target word write 2 different short ${config.name} sentences (4 to 10 words) that use the target word exactly as written.
Use only very common words, preferably from this vocabulary: ${vocabulary.join(', ')}
Also give a faithful English translation of each sentence.
Return only JSON: {"items":[{"word":"...","text":"...","english":"..."}]}
Target words: ${JSON.stringify(batch.map((t) => t.word))}`,
          },
        ],
        { temperature: 0.7 }
      );
      const items = extractItems<{ word?: unknown; text?: unknown; english?: unknown }>(reply);
      const sentenceIds: number[] = [];
      db.transaction(() => {
        const insertSentence = db.prepare(
          `INSERT OR IGNORE INTO sentences (text, english, translation_source, source_id, word_count) VALUES (?, ?, ?, ?, ?)`
        );
        const insertWord = db.prepare(`INSERT INTO sentence_words (sentence_id, position, word_id) VALUES (?, ?, ?)`);
        for (const item of items) {
          if (typeof item.text !== 'string' || typeof item.english !== 'string') continue;
          const text = tidySentence(item.text);
          const tokens = tokenize(text, config.locale, wordSegmenter);
          const target = batch.find((t) => tokens.some((token) => token.word === t.word));
          if (!target || tokens.length < 2 || tokens.length > config.maxSentenceWords) continue;
          const result = insertSentence.run(text, item.english.trim(), llmLabel(settings), sourceId, tokens.length);
          if (!result.changes) continue;
          const sentenceId = Number(result.lastInsertRowid);
          tokens.forEach((token, position) => insertWord.run(sentenceId, position, wordIdFor(db, token.word, config.locale)));
          sentenceIds.push(sentenceId);
          added++;
        }
        db.prepare(`UPDATE sources SET sentence_count = (SELECT COUNT(*) FROM sentences WHERE source_id = ?) WHERE id = ?`).run(
          sourceId,
          sourceId
        );
      })();
      recomputeRanks(db);
      refreshSentenceCounts(db, wordIdsOfSentences(db, sentenceIds));
    } catch (error) {
      failures.push((error as Error).message);
      if (failures.length >= 3 && added === 0) throw new Error(`Sentence generation failed: ${failures[0]}`);
    }
  }
  ctx?.progress(targets.length, targets.length);
  return `Generated ${added} sentences for ${targets.length} words${failures.length ? ` (${failures.length} batches failed)` : ''}`;
}
