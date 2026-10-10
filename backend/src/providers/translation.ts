import { HttpError, languageDb, type DB } from '../db/connection.js';
import { getLanguageConfig } from '../services/languages.js';
import { getSettings } from '../services/settings.js';
import { postJson } from '../services/http.js';
import { saveSentenceTranslations } from '../services/words.js';
import { addSentenceTranslations, cleanTranslation, removeSentenceTranslation } from '../services/sentenceTranslations.js';
import { recomputeRanks, refreshSentenceCounts, wordIdsOfSentences } from '../services/ranking.js';
import { wordIdFor } from '../services/corpus.js';
import { tokenize, tidySentence } from '../services/textProcessing.js';
import type { JobContext } from '../services/jobs.js';
import { chat, extractItems, llmAvailable, llmLabel } from './llm.js';
import type { LanguageConfig, TranslationProvider } from '../../../shared/types.js';

interface SentenceToTranslate {
  id: number;
  text: string;
}

// Untranslated sentences in the order they will be needed. For the words of a
// batch, sentences are picked at random (a variety of texts), preferring ones
// whose rarest word is not far beyond the word itself.
export function sentencesNeedingTranslation(
  db: DB,
  options: { limit?: number; wordIds?: number[]; perWord?: number }
): SentenceToTranslate[] {
  if (options.wordIds) {
    const perWord = options.perWord ?? 4;
    const statement = db.prepare(
      `SELECT s.id, s.text FROM sentences s
       WHERE s.english IS NULL AND (s.excluded_reason IS NULL OR s.excluded_reason = 'audio')
         AND s.id IN (SELECT sentence_id FROM sentence_words WHERE word_id = ?)
       ORDER BY s.max_rank IS NULL, s.max_rank > COALESCE((SELECT rank FROM words WHERE id = ?), 0) + 500, RANDOM() LIMIT ?`
    );
    const translatedCount = db.prepare(
      `SELECT COUNT(DISTINCT sw.sentence_id) AS n FROM sentence_words sw JOIN sentences s ON s.id = sw.sentence_id
       WHERE sw.word_id = ? AND s.english IS NOT NULL AND (s.excluded_reason IS NULL OR s.excluded_reason = 'audio')`
    );
    const chosen = new Map<number, SentenceToTranslate>();
    for (const wordId of options.wordIds) {
      const have = (translatedCount.get(wordId) as { n: number }).n;
      if (have >= perWord) continue;
      for (const row of statement.all(wordId, wordId, perWord - have) as SentenceToTranslate[]) chosen.set(row.id, row);
    }
    return [...chosen.values()];
  }
  return db
    .prepare(
      `SELECT id, text FROM sentences WHERE english IS NULL AND (excluded_reason IS NULL OR excluded_reason = 'audio')
         AND max_rank IS NOT NULL
       ORDER BY max_rank, word_count LIMIT ?`
    )
    .all(options.limit ?? 100) as SentenceToTranslate[];
}

// `reported`: translations a learner marked as wrong, to be replaced.
async function translateWithLlm(
  sentences: SentenceToTranslate[],
  config: LanguageConfig,
  reported?: Map<number, string>
): Promise<Map<number, string>> {
  const items = sentences.map((sentence, index) => ({
    id: index + 1,
    text: sentence.text,
    ...(reported?.get(sentence.id) ? { reported: reported.get(sentence.id) } : {}),
  }));
  const instructions = reported
    ? `A learner reported the English translations given as "reported" as wrong. Translate each ${config.name} sentence again into natural, faithful English. Keep the meaning and tone, do not add explanations, and do not repeat a reported translation unless it is really correct.`
    : `Translate each ${config.name} sentence into natural, faithful English. Keep the meaning and tone, do not add explanations.`;
  const reply = await chat(
    [
      { role: 'system', content: `You are a professional ${config.name}-to-English translator.` },
      {
        role: 'user',
        content: `${instructions}
Return only JSON: {"items":[{"id":1,"english":"..."}]} with one item per sentence.
${JSON.stringify(items)}`,
      },
    ],
    { temperature: reported ? 0.3 : 0.1 }
  );
  const result = new Map<number, string>();
  for (const item of extractItems<{ id?: unknown; english?: unknown }>(reply)) {
    const index = Number(item.id) - 1;
    if (sentences[index] && typeof item.english === 'string') result.set(sentences[index].id, item.english);
  }
  return result;
}

async function translateWithApi(texts: string[], config: LanguageConfig, provider: TranslationProvider): Promise<string[]> {
  const settings = getSettings();
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

export async function translateBatch(
  sentences: SentenceToTranslate[],
  config: LanguageConfig,
  provider: TranslationProvider = getSettings().translation.provider,
  reported?: Map<number, string>
): Promise<Map<number, string>> {
  if (provider === 'llm') return translateWithLlm(sentences, config, reported);
  const translated = await translateWithApi(
    sentences.map((s) => s.text),
    config,
    provider
  );
  return new Map(sentences.map((sentence, index) => [sentence.id, translated[index] ?? '']));
}

export function translationLabel(provider: TranslationProvider = getSettings().translation.provider): string {
  return provider === 'llm' ? llmLabel(getSettings()) : provider;
}

export function translationAvailable(provider: TranslationProvider = getSettings().translation.provider): boolean {
  const settings = getSettings();
  switch (provider) {
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
// Fixing translations a learner reported as wrong: a separate job from
// translating new sentences. The old translation is replaced; a sentence whose
// new translation comes back the same stays out of the questions.

function sameTranslation(a: string, b: string): boolean {
  const norm = (text: string) => text.toLowerCase().replace(/[.!?¡¿"“”'’]/g, '').replace(/\s+/g, ' ').trim();
  return norm(a) === norm(b);
}

export async function retranslateSentences(
  langId: string,
  options: { ids?: number[]; provider?: TranslationProvider },
  ctx?: JobContext
): Promise<string> {
  const db = languageDb(langId);
  const config = getLanguageConfig(db);
  const settings = getSettings();
  const provider = options.provider ?? settings.translation.provider;
  if (!translationAvailable(provider)) {
    throw new HttpError(400, `${provider === 'llm' ? 'The language model' : provider} is not set up for translations (Configuration → Services).`);
  }
  const rows = (
    options.ids?.length
      ? db
          .prepare(`SELECT id, text, english, excluded_reason AS reason FROM sentences WHERE id IN (SELECT value FROM json_each(?))`)
          .all(JSON.stringify(options.ids))
      : db
          .prepare(
            `SELECT id, text, english, excluded_reason AS reason FROM sentences WHERE excluded_reason = 'translation' ORDER BY max_rank IS NULL, max_rank`
          )
          .all()
  ) as { id: number; text: string; english: string | null; reason: string | null }[];
  if (rows.length === 0) return 'No sentences are marked as badly translated';
  const batchSize = Math.max(1, provider === 'llm' ? settings.translation.batchSize : 40);
  const label = translationLabel(provider);
  const restore = db.prepare(`UPDATE sentences SET excluded_reason = NULL, excluded_at = NULL WHERE id = ? AND excluded_reason = 'translation'`);
  let fixed = 0;
  let unchanged = 0;
  const failures: string[] = [];
  for (let start = 0; start < rows.length; start += batchSize) {
    ctx?.checkCancelled();
    ctx?.progress(start, rows.length, `Translating again (${start}/${rows.length})…`);
    const batch = rows.slice(start, start + batchSize);
    try {
      const reported = new Map(batch.filter((row) => row.english).map((row) => [row.id, row.english!]));
      const translations = await translateBatch(batch, config, provider, reported.size ? reported : undefined);
      for (const row of batch) {
        const english = cleanTranslation(translations.get(row.id) ?? '');
        if (!english) continue;
        if (row.english && sameTranslation(english, row.english)) {
          unchanged++;
          continue;
        }
        if (row.reason === 'translation') {
          // The reported translation goes; the new one becomes the main one.
          if (row.english) removeSentenceTranslation(db, row.id, row.english);
          addSentenceTranslations(db, [{ id: row.id, english }], label, { main: true });
          restore.run(row.id);
        } else {
          // Not reported: the new translation is added as another one.
          addSentenceTranslations(db, [{ id: row.id, english }], label);
        }
        fixed++;
      }
    } catch (error) {
      failures.push((error as Error).message);
      if (fixed === 0 && failures.length >= 3) throw new Error(`Translation failed: ${failures[0]}`);
    }
  }
  ctx?.progress(rows.length, rows.length);
  refreshSentenceCounts(db, wordIdsOfSentences(db, rows.map((row) => row.id)));
  const parts = [`Translated ${fixed} sentence${fixed === 1 ? '' : 's'} again`];
  if (unchanged) parts.push(`${unchanged} came back the same and stay excluded: edit them by hand or try another service`);
  if (failures.length) parts.push(`${failures.length} batches failed: ${failures[0]}`);
  return parts.join('; ');
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
      const translations: { id: number; english: string }[] = [];
      db.transaction(() => {
        const insertSentence = db.prepare(`INSERT OR IGNORE INTO sentences (text, source_id, word_count) VALUES (?, ?, ?)`);
        const insertWord = db.prepare(`INSERT INTO sentence_words (sentence_id, position, word_id) VALUES (?, ?, ?)`);
        for (const item of items) {
          if (typeof item.text !== 'string' || typeof item.english !== 'string') continue;
          const text = tidySentence(item.text);
          const tokens = tokenize(text, config.locale, wordSegmenter);
          const target = batch.find((t) => tokens.some((token) => token.word === t.word));
          if (!target || tokens.length < 2 || tokens.length > config.maxSentenceWords) continue;
          const result = insertSentence.run(text, sourceId, tokens.length);
          if (!result.changes) continue;
          const sentenceId = Number(result.lastInsertRowid);
          translations.push({ id: sentenceId, english: item.english });
          tokens.forEach((token, position) => insertWord.run(sentenceId, position, wordIdFor(db, token.word, config.locale)));
          sentenceIds.push(sentenceId);
          added++;
        }
        db.prepare(`UPDATE sources SET sentence_count = (SELECT COUNT(*) FROM sentences WHERE source_id = ?) WHERE id = ?`).run(
          sourceId,
          sourceId
        );
      })();
      addSentenceTranslations(db, translations, llmLabel(settings));
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
