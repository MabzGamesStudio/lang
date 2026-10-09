import express, { type Request, type Response, type Router } from 'express';
import { HttpError, languageDb } from '../db/connection.js';
import { maskedSettings, saveSettings, getSettings } from '../services/settings.js';
import {
  createLanguage,
  deleteLanguage,
  getLanguageConfig,
  languageSummary,
  listLanguages,
  updateLanguage,
} from '../services/languages.js';
import {
  deleteSource,
  importText,
  importTopGutenbergBooks,
  importUrl,
  importWordList,
  importedUrls,
  listSources,
  rebuildStatistics,
  updateSource,
} from '../services/corpus.js';
import { searchGutenberg } from '../services/gutenberg.js';
import {
  deleteSentence,
  getWord,
  nextWordsToPrepare,
  undefinedWordCount,
  listSentences,
  listWords,
  SENTENCE_EXCLUSIONS,
  setSentenceExclusion,
  resetWordProgress,
  saveDefinitions,
  saveSentenceTranslations,
  updateSentence,
  updateWord,
} from '../services/words.js';
import { cancelJob, isJobRunning, listJobs, startJob } from '../services/jobs.js';
import {
  addImage,
  deleteImage,
  englishWordCount,
  imageFile,
  imageStats,
  labelsFromFilename,
  listImages,
  searchEnglishWords,
  updateImage,
} from '../services/english.js';
import {
  applyResults,
  currentBlockWordIds,
  freePlayNext,
  progressSummary,
  resetProgress,
  sessionNext,
  undoResults,
  type NextRequest,
} from '../services/progress.js';
import { exportEnglish, exportLanguage, importEnglish, importLanguage } from '../services/backup.js';
import { inputIndex } from '../services/inputIndex.js';
import { listHubBackups, restoreFromHub, uploadToHub } from '../services/huggingface.js';
import { importLegacy, legacyAlreadyImported, legacyAvailable } from '../services/legacy.js';
import { fetchDefinitions } from '../providers/definitions.js';
import {
  generateSentences,
  retranslateSentences,
  sentencesNeedingTranslation,
  translateBatch,
  translateSentences,
  translationAvailable,
} from '../providers/translation.js';
import { getAudio, pregenerateAudio, regenerateSentenceAudio, transcribe, ttsGenerates } from '../providers/speech.js';
import { suggestImages } from '../providers/images.js';
import { chat, judgeTranslation, llmAvailable } from '../providers/llm.js';
import { PHASES, isGameId, type GameId } from '../../../shared/games.js';
import type { SentenceExclusion, TranslationProvider, TtsProvider, WordResult } from '../../../shared/types.js';

const TRANSLATION_PROVIDERS: TranslationProvider[] = ['llm', 'deepl', 'google', 'libretranslate'];
const TTS_PROVIDERS: TtsProvider[] = ['colab', 'openai', 'google', 'azure', 'elevenlabs'];

function intParam(value: unknown, fallback: number, min = 0, max = 1_000_000): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function lang(req: Request): string {
  const id = String(req.params.lang);
  languageDb(id);
  return id;
}

function sendFile(res: Response, fileName: string, data: Buffer): void {
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.send(data);
}

function definitionsAvailable(): boolean {
  const settings = getSettings();
  return settings.definitions.provider === 'wiktionary' || llmAvailable(settings);
}

// Remembers which blocks were already prepared in the background.
const preparedBlocks = new Set<string>();
// Last failed automatic definition lookup per language (to avoid retrying on every question).
const definitionFailures = new Map<string, number>();

// Background preparation of the block being learnt: definitions, sentence
// translations, extra example sentences and audio, so practice never waits.
function prepareBlockInBackground(langId: string, force = false): void {
  const wordIds = currentBlockWordIds(langId);
  if (wordIds.length === 0) return;
  const key = `${langId}:${wordIds[0]}:${wordIds.length}`;
  if ((!force && preparedBlocks.has(key)) || isJobRunning(langId, 'prepare')) return;
  preparedBlocks.add(key);
  startJob(langId, 'prepare', 'Preparing the current block', async (ctx) => {
    const summary: string[] = [];
    if (definitionsAvailable()) {
      ctx.progress(0, 4, 'Fetching definitions…');
      summary.push(await fetchDefinitions(langId, { wordIds }, ctx));
    }
    if (translationAvailable()) {
      ctx.progress(1, 4, 'Translating sentences…');
      summary.push(await translateSentences(langId, { wordIds, perWord: 4 }, ctx));
    }
    if (llmAvailable()) {
      ctx.progress(2, 4, 'Generating extra example sentences…');
      summary.push(await generateSentences(langId, { wordIds, minSentences: 2 }, ctx));
    }
    if (ttsGenerates()) {
      ctx.progress(3, 4, 'Generating audio…');
      const db = languageDb(langId);
      const texts = db
        .prepare(`SELECT display FROM words WHERE id IN (SELECT value FROM json_each(?))`)
        .all(JSON.stringify(wordIds)) as { display: string }[];
      for (const { display } of texts) {
        ctx.checkCancelled();
        await getAudio(langId, display, true).catch(() => null);
      }
      summary.push(`Audio ready for ${texts.length} words`);
    }
    ctx.progress(4, 4);
    return summary.join('\n') || 'Nothing to prepare (no services configured)';
  });
}

export function apiRouter(): Router {
  const api = express.Router();
  api.use(express.json({ limit: '100mb' }));

  // -------------------------------------------------------------------------
  // Settings and services

  api.get('/settings', (_req, res) => {
    res.json(maskedSettings());
  });

  api.put('/settings', (req, res) => {
    saveSettings(req.body);
    res.json(maskedSettings());
  });

  api.post('/services/test', async (req, res) => {
    const service = str(req.body?.service);
    const langId = str(req.body?.lang);
    if (service === 'llm') {
      const reply = await chat([{ role: 'user', content: 'Reply with the single word: ready' }]);
      res.json({ ok: true, message: `LLM replied: ${reply.trim().slice(0, 80)}` });
    } else if (service === 'tts') {
      const audio = await getAudio(langId || 'english', langId ? 'hola' : 'hello', true);
      res.json({ ok: true, message: audio ? `Generated ${audio.data.length} bytes of audio` : 'Audio plays in the browser' });
    } else if (service === 'translation') {
      if (!langId) throw new HttpError(400, 'Select a language first');
      const config = getLanguageConfig(languageDb(langId));
      const sample = languageDb(langId).prepare(`SELECT id, text FROM sentences ORDER BY max_rank LIMIT 1`).get() as
        | { id: number; text: string }
        | undefined;
      const result = await translateBatch([sample ?? { id: 0, text: config.name }], config);
      res.json({ ok: true, message: `Translated: ${[...result.values()][0] ?? '(empty)'}` });
    } else {
      throw new HttpError(400, 'Unknown service');
    }
  });

  api.get('/jobs', (req, res) => {
    res.json(listJobs(str(req.query.lang) || undefined));
  });

  api.post('/jobs/:id/cancel', (req, res) => {
    res.json({ cancelled: cancelJob(String(req.params.id)) });
  });

  // -------------------------------------------------------------------------
  // Languages

  api.get('/languages', (_req, res) => {
    res.json(listLanguages());
  });

  api.post('/languages', (req, res) => {
    res.status(201).json(createLanguage(req.body ?? {}));
  });

  api.get('/languages/:lang', (req, res) => {
    res.json(languageSummary(lang(req)));
  });

  api.put('/languages/:lang', (req, res) => {
    const id = lang(req);
    const before = getLanguageConfig(languageDb(id));
    const summary = updateLanguage(id, req.body ?? {});
    if (before.detectProperNouns !== summary.detectProperNouns || before.sourceWeighting !== summary.sourceWeighting) {
      rebuildStatistics(id);
    }
    res.json(languageSummary(id));
  });

  api.delete('/languages/:lang', (req, res) => {
    deleteLanguage(lang(req));
    res.json({ ok: true });
  });

  // -------------------------------------------------------------------------
  // Sources (books, texts, word lists)

  api.get('/languages/:lang/sources', (req, res) => {
    res.json(listSources(lang(req)));
  });

  api.post('/languages/:lang/sources/url', (req, res) => {
    const id = lang(req);
    const url = str(req.body?.url).trim();
    if (!/^https?:\/\//i.test(url)) throw new HttpError(400, 'Enter a full http(s) URL');
    res.json(
      startJob(id, `import:${url}`, `Importing ${url}`, async (ctx) => {
        const summary = await importUrl(id, url, str(req.body?.title), ctx);
        return `${summary.title}: ${summary.uniqueWords} words, ${summary.sentencesAdded} new sentences`;
      })
    );
  });

  api.post('/languages/:lang/sources/text', (req, res) => {
    const id = lang(req);
    const text = str(req.body?.text);
    const title = str(req.body?.title).trim() || 'Pasted text';
    if (!text.trim()) throw new HttpError(400, 'The text is empty');
    res.json(
      startJob(id, `text:${title}:${Date.now()}`, `Importing "${title}"`, async (ctx) => {
        const summary = await importText(id, { kind: 'text', title, text }, ctx);
        return `${summary.title}: ${summary.uniqueWords} words, ${summary.sentencesAdded} new sentences`;
      })
    );
  });

  api.post('/languages/:lang/sources/wordlist', (req, res) => {
    const id = lang(req);
    const csv = str(req.body?.csv);
    const title = str(req.body?.title).trim() || 'Word list';
    res.json(
      startJob(id, `wordlist:${title}:${Date.now()}`, `Importing word list "${title}"`, async (ctx) => {
        const summary = await importWordList(id, { title, csv }, ctx);
        return `${summary.title}: ${summary.uniqueWords} words`;
      })
    );
  });

  api.post('/languages/:lang/sources/gutenberg', (req, res) => {
    const id = lang(req);
    const count = intParam(req.body?.count, 3, 1, 20);
    res.json(
      startJob(id, 'gutenberg', `Importing ${count} popular public-domain books`, (ctx) => importTopGutenbergBooks(id, count, ctx))
    );
  });

  api.get('/languages/:lang/gutenberg', async (req, res) => {
    const id = lang(req);
    const config = getLanguageConfig(languageDb(id));
    res.json(await searchGutenberg(config.code, str(req.query.q), intParam(req.query.page, 1, 1, 100), importedUrls(id)));
  });

  api.put('/languages/:lang/sources/:source', (req, res) => {
    updateSource(lang(req), intParam(req.params.source, 0), {
      title: typeof req.body?.title === 'string' ? req.body.title : undefined,
      weight: req.body?.weight !== undefined ? Number(req.body.weight) : undefined,
    });
    res.json(listSources(lang(req)));
  });

  api.delete('/languages/:lang/sources/:source', (req, res) => {
    deleteSource(lang(req), intParam(req.params.source, 0));
    res.json(listSources(lang(req)));
  });

  api.get('/languages/:lang/input-index', (req, res) => {
    res.json(inputIndex(lang(req)));
  });

  api.post('/languages/:lang/rebuild', (req, res) => {
    rebuildStatistics(lang(req));
    res.json(languageSummary(lang(req)));
  });

  // -------------------------------------------------------------------------
  // Words and sentences

  api.get('/languages/:lang/words', (req, res) => {
    res.json(
      listWords(lang(req), {
        offset: intParam(req.query.offset, 0),
        limit: intParam(req.query.limit, 50, 1, 500),
        q: str(req.query.q),
        filter: str(req.query.filter),
        sort: str(req.query.sort),
      })
    );
  });

  api.get('/languages/:lang/words/:word', (req, res) => {
    res.json(getWord(lang(req), intParam(req.params.word, 0)));
  });

  api.put('/languages/:lang/words/:word', (req, res) => {
    const body = req.body ?? {};
    res.json(
      updateWord(lang(req), intParam(req.params.word, 0), {
        english: Array.isArray(body.english) ? body.english.map(String) : undefined,
        pronunciation: body.pronunciation !== undefined ? (body.pronunciation === null ? null : String(body.pronunciation)) : undefined,
        pos: body.pos !== undefined ? (body.pos === null ? null : String(body.pos)) : undefined,
        excluded: body.excluded !== undefined ? (body.excluded === null ? null : Boolean(body.excluded)) : undefined,
      })
    );
  });

  api.post('/languages/:lang/words/:word/reset', (req, res) => {
    res.json(resetWordProgress(lang(req), intParam(req.params.word, 0)));
  });

  api.get('/languages/:lang/sentences', (req, res) => {
    res.json(
      listSentences(lang(req), {
        offset: intParam(req.query.offset, 0),
        limit: intParam(req.query.limit, 50, 1, 500),
        q: str(req.query.q),
        filter: str(req.query.filter),
        wordId: req.query.word ? intParam(req.query.word, 0) : undefined,
      })
    );
  });

  api.put('/languages/:lang/sentences/:sentence', (req, res) => {
    updateSentence(lang(req), intParam(req.params.sentence, 0), {
      english: req.body?.english === null ? null : str(req.body?.english),
    });
    res.json({ ok: true });
  });

  api.delete('/languages/:lang/sentences/:sentence', (req, res) => {
    deleteSentence(lang(req), intParam(req.params.sentence, 0));
    res.json({ ok: true });
  });

  // Takes a sentence out of the questions with a reason. When the question was
  // already answered, its results are taken back as well (undoId).
  api.post('/languages/:lang/sentences/:sentence/exclude', (req, res) => {
    const id = lang(req);
    const reason = str(req.body?.reason) as SentenceExclusion;
    if (!SENTENCE_EXCLUSIONS.includes(reason)) throw new HttpError(400, 'Unknown reason');
    setSentenceExclusion(id, intParam(req.params.sentence, 0), reason);
    const undoId = str(req.body?.undoId);
    res.json({ ok: true, undone: undoId ? undoResults(id, undoId) : false });
  });

  api.post('/languages/:lang/sentences/:sentence/restore', (req, res) => {
    setSentenceExclusion(lang(req), intParam(req.params.sentence, 0), null);
    res.json({ ok: true });
  });

  // Fixing reported sentences: separate jobs from translating new sentences or
  // generating missing audio.
  const sentenceIds = (value: unknown): number[] | undefined =>
    Array.isArray(value) ? value.filter((v): v is number => Number.isInteger(v)).slice(0, 5000) : undefined;

  api.post('/languages/:lang/sentences/retranslate', (req, res) => {
    const id = lang(req);
    const ids = sentenceIds(req.body?.ids);
    const provider = str(req.body?.provider) as TranslationProvider;
    const chosen = TRANSLATION_PROVIDERS.includes(provider) ? provider : undefined;
    const title = ids?.length === 1 ? 'Translating a sentence again' : 'Translating reported sentences again';
    res.json(startJob(id, 'fix-translations', title, (ctx) => retranslateSentences(id, { ids, provider: chosen }, ctx)));
  });

  api.post('/languages/:lang/sentences/regenerate-audio', (req, res) => {
    const id = lang(req);
    const ids = sentenceIds(req.body?.ids);
    const provider = str(req.body?.provider) as TtsProvider;
    const chosen = TTS_PROVIDERS.includes(provider) ? provider : undefined;
    const title = ids?.length === 1 ? 'Regenerating the audio of a sentence' : 'Regenerating the audio of reported sentences';
    res.json(
      startJob(id, 'fix-audio', title, (ctx) =>
        regenerateSentenceAudio(id, { ids, provider: chosen, voice: str(req.body?.voice) || undefined }, ctx)
      )
    );
  });

  // -------------------------------------------------------------------------
  // Automation jobs

  api.post('/languages/:lang/definitions', (req, res) => {
    const id = lang(req);
    const limit = intParam(req.body?.limit, 200, 1, 50_000);
    const overwrite = Boolean(req.body?.overwrite);
    res.json(startJob(id, 'definitions', `Fetching definitions for ${limit} words`, (ctx) => fetchDefinitions(id, { limit, overwrite }, ctx)));
  });

  api.post('/languages/:lang/translations', (req, res) => {
    const id = lang(req);
    const limit = intParam(req.body?.limit, 200, 1, 100_000);
    res.json(startJob(id, 'translations', `Translating ${limit} sentences`, (ctx) => translateSentences(id, { limit }, ctx)));
  });

  api.post('/languages/:lang/generate-sentences', (req, res) => {
    const id = lang(req);
    const limit = intParam(req.body?.limit, 50, 1, 5_000);
    res.json(
      startJob(id, 'generate', `Generating sentences for ${limit} words`, (ctx) =>
        generateSentences(id, { limit, minSentences: intParam(req.body?.minSentences, 3, 1, 20) }, ctx)
      )
    );
  });

  api.post('/languages/:lang/audio', (req, res) => {
    const id = lang(req);
    const words = intParam(req.body?.words, 200, 0, 50_000);
    const sentences = intParam(req.body?.sentences, 100, 0, 50_000);
    res.json(startJob(id, 'audio', `Generating audio`, (ctx) => pregenerateAudio(id, { words, sentences }, ctx)));
  });

  api.post('/languages/:lang/images/suggest', (req, res) => {
    const id = lang(req);
    const words = intParam(req.body?.words, 30, 1, 1_000);
    const perWord = intParam(req.body?.perWord, 3, 1, 10);
    res.json(startJob(null, 'images', `Finding pictures for ${words} words`, (ctx) => suggestImages(id, { words, perWord }, ctx)));
  });

  api.post('/languages/:lang/prepare', (req, res) => {
    const id = lang(req);
    prepareBlockInBackground(id, true);
    res.json(listJobs(id).find((job) => job.type === 'prepare') ?? null);
  });

  // One click: definitions + translations + example sentences + audio for the
  // next N most frequent words that have no definition yet.
  api.post('/languages/:lang/autopilot', (req, res) => {
    const id = lang(req);
    const words = intParam(req.body?.words, 500, 7, 50_000);
    res.json(
      startJob(id, 'autopilot', `Preparing the next ${words} words without a definition`, async (ctx) => {
        const db = languageDb(id);
        const { wordIds, needDefinitions } = nextWordsToPrepare(db, words);
        if (wordIds.length === 0) return 'Every word already has a definition and translated sentences';
        const summary: string[] = [];
        if (!needDefinitions) summary.push('Every word already has a definition; preparing sentences for the next words instead');
        if (needDefinitions && definitionsAvailable()) summary.push(await fetchDefinitions(id, { wordIds }, ctx));
        if (translationAvailable()) summary.push(await translateSentences(id, { wordIds, perWord: 4 }, ctx));
        if (llmAvailable()) summary.push(await generateSentences(id, { wordIds, minSentences: 2 }, ctx));
        if (ttsGenerates()) {
          summary.push(await pregenerateAudio(id, { words, sentences: Math.min(words * 2, 1000), wordIds }, ctx));
        }
        if (summary.length === 0) return 'No services are configured yet (Configuration → Services)';
        summary.push(`${undefinedWordCount(db).toLocaleString()} words still have no definition`);
        return summary.join('\n');
      })
    );
  });

  // Offline Google Colab workflow: download a job file, run it in the
  // notebook, upload the results.
  api.get('/languages/:lang/colab-job', (req, res) => {
    const id = lang(req);
    const db = languageDb(id);
    const config = getLanguageConfig(db);
    const type = str(req.query.type) === 'definitions' ? 'definitions' : 'translations';
    const limit = intParam(req.query.limit, 500, 1, 100_000);
    const items =
      type === 'definitions'
        ? (db
            .prepare(`SELECT id, word AS text FROM words WHERE active = 1 AND english IS NULL ORDER BY rank LIMIT ?`)
            .all(limit) as { id: number; text: string }[])
        : sentencesNeedingTranslation(db, { limit });
    const job = { format: 'lang-colab-job', type, language: config.name, code: config.code, langId: id, items };
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="lang-${id}-${type}-job.json"`);
    res.send(JSON.stringify(job, null, 1));
  });

  api.post('/languages/:lang/colab-results', (req, res) => {
    const id = lang(req);
    const db = languageDb(id);
    const body = req.body ?? {};
    if (body.format !== 'lang-colab-results' || !Array.isArray(body.items)) {
      throw new HttpError(400, 'This is not a results file produced by the Colab notebook');
    }
    const source = `llm:colab:${str(body.model) || 'notebook'}`;
    let saved = 0;
    if (body.type === 'definitions') {
      saved = saveDefinitions(
        db,
        body.items
          .filter((item: { id?: unknown }) => Number.isInteger(item.id))
          .map((item: { id: number; english?: unknown; pos?: unknown } & Record<string, unknown>) => ({
            id: item.id,
            english: Array.isArray(item.english) ? item.english.map(String) : typeof item.english === 'string' ? [item.english] : [],
            pronunciation:
              [item.pronunciation, item.pinyin, item.reading, item.romanization, item.ipa].find(
                (value): value is string => typeof value === 'string' && value.trim() !== ''
              ) ?? null,
            pos: typeof item.pos === 'string' ? item.pos : null,
            source,
          })),
        false
      );
    } else {
      saved = saveSentenceTranslations(
        db,
        body.items
          .filter((item: { id?: unknown; english?: unknown }) => Number.isInteger(item.id) && typeof item.english === 'string')
          .map((item: { id: number; english: string }) => ({ id: item.id, english: item.english })),
        source
      );
    }
    res.json({ saved });
  });

  // -------------------------------------------------------------------------
  // Learning

  api.post('/languages/:lang/session/next', async (req, res) => {
    const id = lang(req);
    const body = req.body ?? {};
    const request: NextRequest = {
      mode: body.mode === 'review' ? 'review' : 'learn',
      recent: Array.isArray(body.recent) ? body.recent.map(Number).filter(Number.isFinite).slice(0, 10) : [],
      lastGameId: isGameId(body.lastGameId) ? body.lastGameId : null,
    };
    let next = sessionNext(id, request);
    const settings = getSettings();
    if (request.mode === 'learn' && settings.learning.autoPrepare) {
      // Words without translations block the batch: fetch them right away.
      const notice = next.notice;
      const lastFailure = definitionFailures.get(id) ?? 0;
      // Words without translations are skipped; only when nothing else is left
      // to practise, try to fetch their translations right away.
      if (
        !next.question &&
        notice?.kind === 'missingDefinitions' &&
        notice.words?.length &&
        definitionsAvailable() &&
        Date.now() - lastFailure > 10 * 60 * 1000
      ) {
        try {
          await fetchDefinitions(id, { wordIds: notice.words.map((w) => w.id) });
          next = sessionNext(id, request);
          if (!next.question && next.notice?.kind === 'missingDefinitions') definitionFailures.set(id, Date.now());
        } catch (error) {
          definitionFailures.set(id, Date.now());
          next.notice = { ...notice, message: `${notice.message} Automatic lookup failed: ${(error as Error).message}` };
        }
      }
      if (next.state.block) prepareBlockInBackground(id);
    }
    res.json(next);
  });

  api.post('/languages/:lang/play/next', (req, res) => {
    const body = req.body ?? {};
    if (!isGameId(body.gameId)) throw new HttpError(400, 'Unknown minigame');
    res.json(
      freePlayNext(lang(req), {
        gameId: body.gameId as GameId,
        batch: intParam(body.batch, 1, 1),
        cumulative: Boolean(body.cumulative),
        recent: Array.isArray(body.recent) ? body.recent.map(Number).filter(Number.isFinite).slice(0, 10) : [],
      })
    );
  });

  api.post('/languages/:lang/results', (req, res) => {
    const results: WordResult[] = (Array.isArray(req.body?.results) ? req.body.results : [])
      .filter(
        (r: Partial<WordResult>) => Number.isInteger(r.wordId) && PHASES.includes(r.phase as WordResult['phase']) && typeof r.correct === 'boolean'
      )
      .slice(0, 200);
    res.json(applyResults(lang(req), results));
  });

  api.post('/languages/:lang/judge', async (req, res) => {
    const id = lang(req);
    const config = getLanguageConfig(languageDb(id));
    if (!llmAvailable()) throw new HttpError(400, 'No LLM configured');
    res.json(
      await judgeTranslation({
        languageName: config.name,
        direction: req.body?.direction === 'toForeign' ? 'toForeign' : 'toEnglish',
        source: str(req.body?.source),
        reference: str(req.body?.reference),
        answer: str(req.body?.answer),
      })
    );
  });

  api.get('/languages/:lang/progress', (req, res) => {
    res.json(progressSummary(lang(req)));
  });

  api.post('/languages/:lang/progress/reset', (req, res) => {
    resetProgress(lang(req));
    res.json({ ok: true });
  });

  // -------------------------------------------------------------------------
  // Audio

  api.get('/audio', async (req, res) => {
    const target = str(req.query.lang) || 'english';
    if (target !== 'english') languageDb(target);
    const audio = await getAudio(target, str(req.query.text), req.query.generate !== '0');
    if (!audio) {
      res.status(204).end();
      return;
    }
    res.setHeader('Content-Type', audio.mime);
    // Revalidated every time (an unchanged recording is a 304): regenerated audio is heard at once.
    res.setHeader('Cache-Control', 'private, no-cache');
    res.send(audio.data);
  });

  api.post('/stt', express.raw({ type: () => true, limit: '25mb' }), async (req, res) => {
    const target = str(req.query.lang) || 'english';
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) throw new HttpError(400, 'No audio received');
    const text = await transcribe(req.body, str(req.headers['content-type']), target);
    res.json({ text });
  });

  // -------------------------------------------------------------------------
  // English words and images (shared by all languages)

  api.get('/english/words', (req, res) => {
    res.json(searchEnglishWords(str(req.query.q), intParam(req.query.limit, 20, 1, 100)));
  });

  api.get('/english/stats', (_req, res) => {
    res.json({ ...imageStats(), englishWords: englishWordCount() });
  });

  api.get('/english/images', (req, res) => {
    res.json(
      listImages(str(req.query.status), str(req.query.q), intParam(req.query.offset, 0), intParam(req.query.limit, 40, 1, 200))
    );
  });

  api.get('/english/images/:id/file', (req, res) => {
    const file = imageFile(intParam(req.params.id, 0));
    res.setHeader('Content-Type', file.mime);
    res.setHeader('Cache-Control', 'private, max-age=604800');
    res.send(file.data);
  });

  api.post('/english/images', express.raw({ type: 'image/*', limit: '30mb' }), (req, res) => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) throw new HttpError(400, 'No image received');
    const explicit = str(req.query.labels)
      .split(',')
      .map((label) => label.trim())
      .filter(Boolean);
    const labels = explicit.length ? explicit : labelsFromFilename(str(req.query.name));
    const id = addImage({
      data: req.body,
      mime: str(req.headers['content-type']).split(';')[0],
      labels,
      status: labels.length && req.query.review !== '1' ? 'labeled' : 'pending',
      source: 'upload',
    });
    res.status(201).json({ id });
  });

  api.put('/english/images/:id', (req, res) => {
    const labels = Array.isArray(req.body?.labels) ? req.body.labels.map(String) : undefined;
    const status = req.body?.status === 'pending' || req.body?.status === 'labeled' ? req.body.status : undefined;
    res.json(updateImage(intParam(req.params.id, 0), { labels, status }));
  });

  api.delete('/english/images/:id', (req, res) => {
    deleteImage(intParam(req.params.id, 0));
    res.json({ ok: true });
  });

  // -------------------------------------------------------------------------
  // Backups

  api.get('/languages/:lang/export', async (req, res) => {
    const { fileName, data } = await exportLanguage(lang(req));
    sendFile(res, fileName, data);
  });

  api.post('/import/language', express.raw({ type: () => true, limit: '4gb' }), async (req, res) => {
    if (!Buffer.isBuffer(req.body)) throw new HttpError(400, 'No file received');
    res.json(await importLanguage(req.body));
  });

  api.get('/english/export', async (_req, res) => {
    const { fileName, data } = await exportEnglish();
    sendFile(res, fileName, data);
  });

  api.post('/import/english', express.raw({ type: () => true, limit: '4gb' }), async (req, res) => {
    if (!Buffer.isBuffer(req.body)) throw new HttpError(400, 'No file received');
    await importEnglish(req.body);
    res.json({ ok: true });
  });

  // Hugging Face Hub backups
  api.post('/huggingface/upload', (req, res) => {
    const kind = req.body?.kind === 'english' ? 'english' : 'language';
    if (kind === 'english') {
      res.json(startJob(null, 'hf-upload:english', 'Uploading English & images to Hugging Face', (ctx) => uploadToHub({ kind: 'english' }, ctx)));
      return;
    }
    const id = String(req.body?.lang ?? '');
    const { name } = getLanguageConfig(languageDb(id));
    res.json(startJob(id, `hf-upload:${id}`, `Uploading ${name} to Hugging Face`, (ctx) => uploadToHub({ kind: 'language', langId: id }, ctx)));
  });

  api.get('/huggingface/backups', async (_req, res) => {
    res.json(await listHubBackups());
  });

  api.post('/huggingface/restore', (req, res) => {
    const path = str(req.body?.path);
    res.json(startJob(null, `hf-restore:${path}`, `Restoring ${path} from Hugging Face`, (ctx) => restoreFromHub(path, ctx)));
  });

  api.get('/legacy', (_req, res) => {
    res.json({ available: legacyAvailable(), imported: legacyAlreadyImported() });
  });

  api.post('/legacy/import', async (_req, res) => {
    if (!legacyAvailable()) throw new HttpError(404, 'No database from the previous version (langData/app.db) was found');
    res.json({ message: await importLegacy() });
  });

  return api;
}
