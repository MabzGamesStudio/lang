import { HttpError, englishDatabase, languageDb, listLanguageIds, type DB } from '../db/connection.js';
import { fetchBytes, fetchJson } from './http.js';
import { startJob, type JobContext } from './jobs.js';
import { getSettings } from './settings.js';
import { getLanguageConfig } from './languages.js';
import { decodeEntities } from './textProcessing.js';
import { parseEnglish, pickRandom, shuffle } from './util.js';
import { getAudio, speakInLocale, ttsGenerates } from '../providers/speech.js';
import { PHASES, type Phase } from '../../../shared/games.js';
import { BATCH_SIZE, nextLevel, requiredLevels } from '../../../shared/scoring.js';
import {
  EXAMPLE_LOCALES,
  IPA_BY_SYMBOL,
  IPA_SOUNDS,
  LANGUAGE_NAMES,
  LEARNING_ORDER,
  isEnglishExample,
  isEnglishSound,
  soundSimilarity,
  type IpaExample,
  type IpaSound,
} from '../../../shared/ipa/inventory.js';
import { blankSound, firstTranscription, looksLikeIpa, looseIpa, normalizeIpa, replaceSound, soundsIn, tidyIpa } from '../../../shared/ipa/text.js';
import {
  IPA_GAMES_BY_ID,
  type IpaAudioRef,
  type IpaGameDef,
  type IpaNextRequest,
  type IpaNextResponse,
  type IpaOption,
  type IpaQuestion,
  type IpaRecording,
  type IpaResult,
  type IpaSummary,
  type IpaWord,
} from '../../../shared/ipa/games.js';
import type { JobInfo, TtsProvider, WordLevels } from '../../../shared/types.js';

// The pronunciation mode. Recordings of the sounds on their own (the
// recordings of Wikipedia's IPA charts) and of the example words come from
// Wikimedia Commons, with their licence and author; example words missing
// there are spoken by the voice service, or by the device. Progress is kept
// per sound in the shared English database.

const SOUND_LANG = 'ipa';

// ---------------------------------------------------------------------------
// Stored recordings

interface RecordingRow {
  id: number;
  lang: string;
  text: string;
  source: string;
  license: string | null;
  author: string | null;
  url: string | null;
  created_at: number;
}

const itemKey = (lang: string, text: string) => `${lang}\u0000${text}`;

// Every stored recording (without the audio), Commons files first.
function recordingIndex(db: DB): Map<string, IpaRecording[]> {
  const rows = db
    .prepare(`SELECT id, lang, text, source, license, author, url, created_at FROM ipa_audio ORDER BY source NOT LIKE 'commons:%', created_at, id`)
    .all() as RecordingRow[];
  const index = new Map<string, IpaRecording[]>();
  for (const row of rows) {
    const key = itemKey(row.lang, row.text);
    const list = index.get(key) ?? [];
    list.push({ id: row.id, source: row.source, license: row.license, author: row.author, url: row.url, createdAt: row.created_at });
    index.set(key, list);
  }
  return index;
}

interface AudioFile {
  data: Buffer;
  mime: string;
  source: string;
  license?: string | null;
  author?: string | null;
  url?: string | null;
}

function storeRecording(db: DB, lang: string, text: string, file: AudioFile): IpaRecording {
  const now = Date.now();
  db.prepare(
    `INSERT OR REPLACE INTO ipa_audio (lang, text, source, mime, data, license, author, url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(lang, text, file.source, file.mime, file.data, file.license ?? null, file.author ?? null, file.url ?? null, now);
  const row = db.prepare(`SELECT id FROM ipa_audio WHERE lang = ? AND text = ? AND source = ?`).get(lang, text, file.source) as { id: number };
  return { id: row.id, source: file.source, license: file.license ?? null, author: file.author ?? null, url: file.url ?? null, createdAt: now };
}

export function ipaRecordingFile(id: number): { data: Buffer; mime: string } | null {
  return (englishDatabase().prepare(`SELECT mime, data FROM ipa_audio WHERE id = ?`).get(id) as { data: Buffer; mime: string } | undefined) ?? null;
}

export function deleteIpaRecording(id: number): boolean {
  return englishDatabase().prepare(`DELETE FROM ipa_audio WHERE id = ?`).run(id).changes > 0;
}

// Example words, each once (the same word can be an example of several sounds).
function uniqueExamples(): IpaExample[] {
  const seen = new Set<string>();
  const result: IpaExample[] = [];
  for (const sound of IPA_SOUNDS) {
    for (const example of sound.examples) {
      const key = itemKey(example.lang, example.word);
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(example);
    }
  }
  return result;
}

const EXAMPLE_KEYS = new Set(uniqueExamples().map((example) => itemKey(example.lang, example.word)));

function assertExample(lang: string, text: string): void {
  if (!EXAMPLE_KEYS.has(itemKey(lang, text))) throw new HttpError(404, `"${text}" is not an example word of the pronunciation mode`);
}

const failedVoices = new Set<string>();

// Audio of a sound or a word. Sounds and example words: a Commons recording
// when there is one, else one made by a voice service; example words without
// any are spoken by the voice service now (and kept). Words of your languages
// use their own recordings. null: let the device speak (or nothing, for sounds).
export async function ipaAudio(ref: Pick<IpaAudioRef, 'kind' | 'lang' | 'text'>): Promise<{ data: Buffer; mime: string } | null> {
  if (ref.kind === 'word') {
    languageDb(ref.lang);
    return getAudio(ref.lang, ref.text, true);
  }
  const db = englishDatabase();
  const lang = ref.kind === 'sound' ? SOUND_LANG : ref.lang;
  const stored = db
    .prepare(`SELECT mime, data FROM ipa_audio WHERE lang = ? AND text = ? ORDER BY source NOT LIKE 'commons:%', RANDOM() LIMIT 1`)
    .get(lang, ref.text) as { mime: string; data: Buffer } | undefined;
  if (stored) return stored;
  if (ref.kind === 'sound') return null;
  assertExample(lang, ref.text);
  const locale = EXAMPLE_LOCALES[lang];
  const key = itemKey(lang, ref.text);
  if (!locale || !ttsGenerates() || failedVoices.has(key)) return null;
  try {
    const spoken = await speakInLocale(ref.text, locale);
    if (!spoken) return null;
    storeRecording(db, lang, ref.text, { data: spoken.data, mime: spoken.mime, source: spoken.voice });
    return spoken;
  } catch (error) {
    // Not retried on every question; the device speaks instead.
    failedVoices.add(key);
    console.warn(`No voice for "${ref.text}" (${locale}):`, (error as Error).message);
    return null;
  }
}

// Adds a recording of an example word made by a voice service.
export async function addIpaRecording(lang: string, text: string, provider?: TtsProvider): Promise<IpaRecording> {
  assertExample(lang, text);
  const locale = EXAMPLE_LOCALES[lang];
  if (!locale) throw new HttpError(400, `No voice locale for ${lang}`);
  const spoken = await speakInLocale(text, locale, provider);
  if (!spoken) throw new HttpError(400, 'Voices on this device are not stored: choose a voice service.');
  failedVoices.delete(itemKey(lang, text));
  return storeRecording(englishDatabase(), lang, text, { data: spoken.data, mime: spoken.mime, source: spoken.voice });
}

// ---------------------------------------------------------------------------
// Wikimedia Commons

export function commonsApi(): string {
  return process.env.LANG_COMMONS_API || 'https://commons.wikimedia.org/w/api.php';
}

const MAX_FILE_BYTES = 8 * 1024 * 1024;

interface CommonsPage {
  title: string;
  missing?: boolean;
  index?: number;
  imageinfo?: {
    url?: string;
    descriptionurl?: string;
    mime?: string;
    size?: number;
    extmetadata?: Record<string, { value?: unknown } | undefined>;
  }[];
}

export interface CommonsFile {
  // File name without "File:".
  title: string;
  url: string;
  // Description page (licence, author, history).
  page: string;
  mime: string;
  license: string | null;
  author: string | null;
}

function plainText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = decodeEntities(value.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
  return text ? text.slice(0, 200) : null;
}

function commonsFile(page: CommonsPage): CommonsFile | null {
  const info = page.imageinfo?.[0];
  if (page.missing || !info?.url) return null;
  const mime = info.mime ?? '';
  if (!mime.startsWith('audio/') && mime !== 'application/ogg') return null;
  if ((info.size ?? 0) > MAX_FILE_BYTES) return null;
  const meta = info.extmetadata ?? {};
  return {
    title: page.title.replace(/^File:/, ''),
    url: info.url,
    page: info.descriptionurl ?? `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, '_'))}`,
    mime: mime === 'application/ogg' ? 'audio/ogg' : mime,
    license: plainText(meta.LicenseShortName?.value),
    author: plainText(meta.Artist?.value) ?? plainText(meta.Credit?.value),
  };
}

async function commonsQuery(params: Record<string, string>): Promise<CommonsPage[]> {
  const search = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    prop: 'imageinfo',
    iiprop: 'url|mime|size|extmetadata',
    iiextmetadatafilter: 'LicenseShortName|Artist|Credit',
    ...params,
  });
  const data = await fetchJson<{ query?: { pages?: CommonsPage[] } }>(`${commonsApi()}?${search}`, { timeoutMs: 30_000 });
  return data.query?.pages ?? [];
}

// MediaWiki titles: spaces for underscores, first letter in upper case.
function fileTitle(name: string): string {
  const clean = name.replace(/_/g, ' ').trim();
  return `File:${clean.charAt(0).toUpperCase()}${clean.slice(1)}`;
}

// The first of these files (names without "File:") that exists on Commons.
export async function findCommonsFile(names: string[]): Promise<CommonsFile | null> {
  const titles = [...new Set(names.map(fileTitle))].slice(0, 50);
  if (titles.length === 0) return null;
  const pages = await commonsQuery({ titles: titles.join('|') });
  const byTitle = new Map(pages.map((page) => [page.title, page]));
  for (const title of titles) {
    const page = byTitle.get(title);
    const file = page ? commonsFile(page) : null;
    if (file) return file;
  }
  return null;
}

// Audio files found by a search, best match first.
export async function searchCommonsFiles(query: string, limit = 20): Promise<CommonsFile[]> {
  const pages = await commonsQuery({ generator: 'search', gsrsearch: query, gsrnamespace: '6', gsrlimit: String(limit) });
  return pages
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map(commonsFile)
    .filter((file): file is CommonsFile => file !== null);
}

// The recording of a sound on its own: the file of Wikipedia's IPA charts, or
// a file named after the sound.
async function findSoundFile(sound: IpaSound): Promise<CommonsFile | null> {
  if (!sound.file) return null;
  const exact = await findCommonsFile([sound.file]);
  if (exact) return exact;
  const name = sound.name.replace(/\(.*?\)/g, ' ').replace(/\s+/g, ' ').trim();
  const words = name.toLowerCase().split(/[\s-]+/).filter(Boolean);
  const found = await searchCommonsFiles(`intitle:"${name}" filetype:audio`);
  return found.find((file) => words.every((word) => file.title.toLowerCase().replace(/[-_]/g, ' ').includes(word))) ?? null;
}

// Lingua Libre names files "LL-Q150 (fra)-Speaker-word.wav": ISO 639-3 codes.
const LINGUA_LIBRE: Record<string, string> = {
  fr: 'fra',
  de: 'deu',
  es: 'spa',
  it: 'ita',
  pt: 'por',
  ru: 'rus',
  pl: 'pol',
  tr: 'tur',
  nb: 'nob',
  sv: 'swe',
  zh: 'cmn',
  ja: 'jpn',
  hi: 'hin',
  ar: 'ara',
  cy: 'cym',
  hu: 'hun',
  nl: 'nld',
  el: 'ell',
};

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Wiktionary's names for recordings of a word: "En-us-thin.ogg", "De-ich.ogg".
// English examples only take recordings of the accent of their transcription.
function exampleFileNames(example: IpaExample): string[] {
  const forms = [...new Set([example.word, example.word.toLowerCase()])];
  const base = example.lang.split('-')[0];
  const prefixes =
    example.lang === 'en' ? ['En-us-'] : example.lang === 'en-GB' ? ['En-uk-', 'En-gb-'] : [`${base.charAt(0).toUpperCase()}${base.slice(1)}-`];
  return prefixes.flatMap((prefix) => forms.flatMap((form) => ['ogg', 'oga', 'wav', 'mp3'].map((extension) => `${prefix}${form}.${extension}`)));
}

// Other recordings of a (non-English) word: Lingua Libre, or Wiktionary names
// with a region ("Fr-Paris--tu.ogg" is not taken: only "Fr-tu.ogg", "Fr-fr-tu.ogg").
async function searchExampleFile(example: IpaExample): Promise<CommonsFile | null> {
  if (isEnglishExample(example)) return null;
  const base = example.lang.split('-')[0];
  const iso = LINGUA_LIBRE[base];
  const word = escapeRegExp(example.word);
  const prefix = `${base.charAt(0).toUpperCase()}${base.slice(1)}`;
  const searches: [string, RegExp][] = [[`intitle:"${example.word}" intitle:${prefix} filetype:audio`, new RegExp(`^${prefix}-(?:[a-z]{2}-)?${word}\\d?\\.\\w+$`, 'iu')]];
  if (iso) searches.unshift([`intitle:"${example.word}" intitle:${iso} filetype:audio`, new RegExp(`^LL-Q\\d+ \\(${iso}\\)-.+-${word}\\.\\w+$`, 'iu')]);
  for (const [query, pattern] of searches) {
    const match = (await searchCommonsFiles(query, 30)).find((file) => pattern.test(file.title.normalize('NFC')));
    if (match) return match;
  }
  return null;
}

async function saveCommonsFile(db: DB, lang: string, text: string, file: CommonsFile): Promise<void> {
  const { data, contentType } = await fetchBytes(file.url, { timeoutMs: 60_000 });
  if (data.length === 0 || data.length > MAX_FILE_BYTES) throw new Error(`Unexpected size for ${file.title}`);
  storeRecording(db, lang, text, {
    data,
    mime: file.mime || contentType,
    source: `commons:${file.title}`,
    license: file.license,
    author: file.author,
    url: file.page,
  });
}

export function startIpaDownload(): JobInfo {
  return startJob(null, 'ipa-download', 'Downloading pronunciation recordings', (ctx) => downloadIpaRecordings(ctx));
}

// Downloads what is missing: the recording of each sound and of each example
// word. Words not on Commons are spoken by the voice service when one is set up.
export async function downloadIpaRecordings(ctx: JobContext): Promise<string> {
  const db = englishDatabase();
  const index = recordingIndex(db);
  const fromCommons = (lang: string, text: string) => (index.get(itemKey(lang, text)) ?? []).some((recording) => recording.source.startsWith('commons:'));
  const stored = (lang: string, text: string) => (index.get(itemKey(lang, text)) ?? []).length > 0;
  const sounds = IPA_SOUNDS.filter((sound) => sound.file && !fromCommons(SOUND_LANG, sound.symbol));
  const examples = uniqueExamples().filter((example) => !stored(example.lang, example.word));
  const total = sounds.length + examples.length;
  const speaks = ttsGenerates();
  let done = 0;
  let found = 0;
  let spoken = 0;
  const missingSounds: string[] = [];
  const missingWords: string[] = [];
  // Three network failures in a row: Commons is out of reach, stop asking it.
  let failures = 0;
  let unreachable: string | null = null;
  const ask = async <T>(lookup: () => Promise<T>): Promise<T | null> => {
    if (unreachable) return null;
    try {
      const result = await lookup();
      failures = 0;
      return result;
    } catch (error) {
      if (++failures >= 3) unreachable = (error as Error).message;
      return null;
    }
  };

  for (const sound of sounds) {
    ctx.checkCancelled();
    ctx.progress(done, total, `Sound ${sound.symbol} (${sound.name})…`);
    const file = await ask(() => findSoundFile(sound));
    const saved = file ? await ask(() => saveCommonsFile(db, SOUND_LANG, sound.symbol, file).then(() => true)) : null;
    if (saved) found++;
    else missingSounds.push(sound.symbol);
    done++;
  }
  for (const example of examples) {
    ctx.checkCancelled();
    ctx.progress(done, total, `Example “${example.word}”…`);
    const file = await ask(async () => (await findCommonsFile(exampleFileNames(example))) ?? (await searchExampleFile(example)));
    const saved = file ? await ask(() => saveCommonsFile(db, example.lang, example.word, file).then(() => true)) : null;
    if (saved) found++;
    else if (speaks && EXAMPLE_LOCALES[example.lang]) {
      try {
        const audio = await speakInLocale(example.word, EXAMPLE_LOCALES[example.lang]);
        if (audio) {
          storeRecording(db, example.lang, example.word, { data: audio.data, mime: audio.mime, source: audio.voice });
          spoken++;
        }
      } catch {
        missingWords.push(example.word);
      }
    } else missingWords.push(example.word);
    done++;
  }
  ctx.progress(total, total);
  if (unreachable && found === 0 && spoken === 0 && total > 0) {
    throw new Error(`Wikimedia Commons could not be reached (${unreachable}).`);
  }
  const parts = [
    total === 0 ? 'Every recording is already downloaded.' : `${found} recording${found === 1 ? '' : 's'} from Wikimedia Commons.`,
  ];
  if (spoken) parts.push(`${spoken} example word${spoken === 1 ? '' : 's'} spoken by your voice service.`);
  if (unreachable) parts.push(`Wikimedia Commons stopped answering (${unreachable}).`);
  const list = (all: string[]) => {
    const items = [...new Set(all)];
    return `${items.slice(0, 12).join(', ')}${items.length > 12 ? ` and ${items.length - 12} more` : ''}`;
  };
  if (missingSounds.length) parts.push(`No recording found of the sound${missingSounds.length === 1 ? '' : 's'} ${list(missingSounds)}.`);
  if (missingWords.length) {
    parts.push(`No recording found of ${list(missingWords)}${speaks ? '' : ' (this device says those words)'}.`);
  }
  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// Words to practise: the example words, or the words of one of your languages
// with an IPA pronunciation.

interface PoolWord extends IpaWord {
  sounds: string[];
  // Example words: the sound they illustrate in the inventory.
  exampleOf: string[];
}

function exampleAudio(example: IpaExample): IpaAudioRef {
  return { kind: 'example', text: example.word, lang: example.lang, locale: EXAMPLE_LOCALES[example.lang] ?? example.lang };
}

const EXAMPLE_POOL: PoolWord[] = (() => {
  const byKey = new Map<string, PoolWord>();
  for (const sound of IPA_SOUNDS) {
    for (const example of sound.examples) {
      const key = itemKey(example.lang, example.word);
      const existing = byKey.get(key);
      if (existing) {
        existing.exampleOf.push(sound.symbol);
        continue;
      }
      byKey.set(key, {
        word: example.word,
        ipa: example.ipa,
        lang: example.lang,
        langName: LANGUAGE_NAMES[example.lang] ?? example.lang,
        ...(example.gloss ? { gloss: example.gloss } : {}),
        audio: exampleAudio(example),
        sounds: soundsIn(example.ipa),
        exampleOf: [sound.symbol],
      });
    }
  }
  return [...byKey.values()];
})();

// Chinese, Japanese and Korean words have pinyin, kana or romanization.
const NOT_IPA = new Set(['zh', 'ja', 'ko']);
const languagePools = new Map<string, { signature: string; words: PoolWord[] }>();

function languagePool(langId: string): PoolWord[] {
  const db = languageDb(langId);
  const config = getLanguageConfig(db);
  if (NOT_IPA.has(config.code.toLowerCase().split('-')[0])) return [];
  const { signature } = db
    .prepare(
      `SELECT COUNT(*) || ':' || COALESCE(MAX(id), 0) || ':' || COALESCE(SUM(LENGTH(pronunciation)), 0) || ':' || COALESCE(SUM(active), 0) AS signature
       FROM words WHERE pronunciation IS NOT NULL`
    )
    .get() as { signature: string };
  const cached = languagePools.get(langId);
  if (cached?.signature === signature) return cached.words;
  const rows = db
    .prepare(
      `SELECT display, pronunciation, english FROM words
       WHERE pronunciation IS NOT NULL AND pronunciation != '' AND active = 1
       ORDER BY rank IS NULL, rank, count DESC LIMIT 5000`
    )
    .all() as { display: string; pronunciation: string; english: string | null }[];
  const locale = config.locale || config.code;
  const words: PoolWord[] = [];
  for (const row of rows) {
    const ipa = tidyIpa(firstTranscription(row.pronunciation));
    if (!looksLikeIpa(ipa)) continue;
    const gloss = parseEnglish(row.english).slice(0, 2).join(', ');
    words.push({
      word: row.display,
      ipa,
      lang: langId,
      langName: config.name,
      ...(gloss ? { gloss } : {}),
      audio: { kind: 'word', text: row.display, lang: langId, locale },
      sounds: soundsIn(ipa),
      exampleOf: [],
    });
  }
  languagePools.set(langId, { signature, words });
  return words;
}

// ---------------------------------------------------------------------------
// Progress

type SoundProgress = WordLevels & { correct: number; wrong: number };

function progressOf(db: DB): Map<string, SoundProgress> {
  const rows = db
    .prepare(
      `SELECT symbol, recognition_level AS recognition, recall_level AS recall, recite_level AS recite,
              translate_level AS translate, correct, wrong FROM ipa_progress`
    )
    .all() as (SoundProgress & { symbol: string })[];
  return new Map(rows.map(({ symbol, ...progress }) => [symbol, progress]));
}

const NO_PROGRESS: SoundProgress = { recognition: 0, recall: 0, recite: 0, translate: 0, correct: 0, wrong: 0 };

function levelsOnly(progress: SoundProgress): WordLevels {
  return { recognition: progress.recognition, recall: progress.recall, recite: progress.recite, translate: progress.translate };
}

export function applyIpaResults(results: IpaResult[]): Record<string, WordLevels> {
  const db = englishDatabase();
  const required = requiredLevels(getSettings().learning);
  const now = Date.now();
  const touched = new Set<string>();
  db.transaction(() => {
    const create = db.prepare(`INSERT OR IGNORE INTO ipa_progress (symbol) VALUES (?)`);
    for (const result of results) {
      if (!IPA_BY_SYMBOL[result.symbol] || !PHASES.includes(result.phase)) continue;
      const phase: Phase = result.phase;
      create.run(result.symbol);
      const { level } = db.prepare(`SELECT ${phase}_level AS level FROM ipa_progress WHERE symbol = ?`).get(result.symbol) as { level: number };
      db.prepare(`UPDATE ipa_progress SET ${phase}_level = ?, correct = correct + ?, wrong = wrong + ?, last_seen_at = ? WHERE symbol = ?`).run(
        nextLevel(phase, level, result.correct, required[phase]),
        result.correct ? 1 : 0,
        result.correct ? 0 : 1,
        now,
        result.symbol
      );
      touched.add(result.symbol);
    }
  })();
  const progress = progressOf(db);
  return Object.fromEntries([...touched].map((symbol) => [symbol, levelsOnly(progress.get(symbol) ?? NO_PROGRESS)]));
}

export function resetIpaProgress(): void {
  englishDatabase().prepare(`DELETE FROM ipa_progress`).run();
}

// ---------------------------------------------------------------------------
// Overview

export function ipaSummary(): IpaSummary {
  const db = englishDatabase();
  const recordings = recordingIndex(db);
  const progress = progressOf(db);
  const recordingsOf = (lang: string, text: string) => recordings.get(itemKey(lang, text)) ?? [];
  const languages: IpaSummary['languages'] = [];
  for (const id of listLanguageIds()) {
    try {
      const words = languagePool(id).length;
      if (words > 0) languages.push({ id, name: getLanguageConfig(languageDb(id)).name, words });
    } catch {
      // A language that cannot be opened is left out.
    }
  }
  const examples = uniqueExamples();
  return {
    sounds: IPA_SOUNDS.map((sound) => {
      const own = progress.get(sound.symbol) ?? NO_PROGRESS;
      return {
        symbol: sound.symbol,
        name: sound.name,
        kind: sound.kind,
        english: isEnglishSound(sound),
        file: sound.file ?? null,
        recordings: recordingsOf(SOUND_LANG, sound.symbol),
        examples: sound.examples.map((example) => ({
          ...example,
          langName: LANGUAGE_NAMES[example.lang] ?? example.lang,
          recordings: recordingsOf(example.lang, example.word),
        })),
        levels: levelsOnly(own),
        correct: own.correct,
        wrong: own.wrong,
      };
    }),
    required: requiredLevels(getSettings().learning),
    languages: languages.sort((a, b) => a.name.localeCompare(b.name)),
    download: {
      sounds: IPA_SOUNDS.filter((sound) => recordingsOf(SOUND_LANG, sound.symbol).some((r) => r.source.startsWith('commons:'))).length,
      soundFiles: IPA_SOUNDS.filter((sound) => sound.file).length,
      words: examples.filter((example) => recordingsOf(example.lang, example.word).length > 0).length,
      wordTotal: examples.length,
    },
  };
}

// ---------------------------------------------------------------------------
// Questions

function soundAudio(symbol: string): IpaAudioRef {
  return { kind: 'sound', text: symbol, lang: SOUND_LANG, locale: '' };
}

function soundInfo(sound: IpaSound): IpaQuestion['sound'] {
  return { symbol: sound.symbol, name: sound.name, kind: sound.kind };
}

// The sound to practise: one of the first sounds (in learning order) not
// mastered yet in this phase; now and then one already mastered.
function pickTarget(candidates: Set<string>, progress: Map<string, SoundProgress>, phase: Phase, required: number, recent: string[]): string | null {
  const ordered = LEARNING_ORDER.filter((symbol) => candidates.has(symbol));
  if (ordered.length === 0) return null;
  const level = (symbol: string) => progress.get(symbol)?.[phase] ?? 0;
  const learning = ordered.filter((symbol) => level(symbol) < required).slice(0, BATCH_SIZE);
  const mastered = ordered.filter((symbol) => level(symbol) >= required);
  const pool = learning.length > 0 && (mastered.length === 0 || Math.random() >= 0.2) ? learning : mastered.length > 0 ? mastered : ordered;
  const fresh = pool.filter((symbol) => !recent.slice(0, Math.min(3, pool.length - 1)).includes(symbol));
  return pickRandom(fresh.length ? fresh : pool) ?? null;
}

// Sounds most like the target (same kind, most features in common), at random among the closest.
function similarSounds(target: IpaSound, among: IpaSound[], count: number): IpaSound[] {
  const others = shuffle(among.filter((sound) => sound.symbol !== target.symbol));
  const ranked = others
    .map((sound) => ({ sound, score: soundSimilarity(target, sound) }))
    .sort((a, b) => b.score - a.score)
    .map(({ sound }) => sound);
  return shuffle(ranked.slice(0, Math.max(count * 2, 6))).slice(0, count);
}

function choiceCount(): number {
  return Math.max(2, Math.min(6, getSettings().learning.choiceCount || 4));
}

function questionKey(gameId: string, symbol: string): string {
  return `${gameId}:${symbol}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
}

function publicWord(word: PoolWord): IpaWord {
  return {
    word: word.word,
    ipa: word.ipa,
    lang: word.lang,
    langName: word.langName,
    ...(word.gloss ? { gloss: word.gloss } : {}),
    audio: word.audio,
  };
}

// A word for a sound: one it is an example of, or any word containing it
// (frequent words first for your languages).
function wordFor(symbol: string, pool: PoolWord[], examplesFirst: boolean): PoolWord | null {
  const containing = pool.filter((word) => word.sounds.includes(symbol));
  if (containing.length === 0) return null;
  const preferred = examplesFirst ? containing.filter((word) => word.exampleOf.includes(symbol)) : containing.slice(0, 40);
  return pickRandom(preferred.length && Math.random() < 0.75 ? preferred : containing) ?? null;
}

// Latin letters (with accents) can be typed on any keyboard.
const LATIN_WORD = /^[\p{Script=Latin}\s'’-]+$/u;

const NO_SOUND_RECORDINGS =
  'The recordings of the sounds are not downloaded yet. Download them on the Pronunciation page (from Wikimedia Commons, needs internet), or play a game with words.';

export function nextIpaQuestion(request: IpaNextRequest): IpaNextResponse {
  const game: IpaGameDef | undefined = IPA_GAMES_BY_ID[request.gameId];
  if (!game) throw new HttpError(400, 'Unknown pronunciation game');
  const db = englishDatabase();
  const progress = progressOf(db);
  const required = requiredLevels(getSettings().learning)[game.phase];
  const recent = Array.isArray(request.recent) ? request.recent.filter((symbol) => typeof symbol === 'string') : [];
  const inSet = IPA_SOUNDS.filter((sound) => request.sounds !== 'english' || isEnglishSound(sound));
  const count = choiceCount();
  const met = (symbol: string) => (progress.get(symbol)?.[game.phase] ?? 0) > 0;

  // Games on sounds alone need their recordings.
  if (game.unit === 'sound' && game.id !== 'examplesToSymbolTyped') {
    const recorded = new Set(
      (db.prepare(`SELECT DISTINCT text FROM ipa_audio WHERE lang = ?`).all(SOUND_LANG) as { text: string }[]).map((row) => row.text)
    );
    const playable = inSet.filter((sound) => recorded.has(sound.symbol));
    const symbol = pickTarget(new Set(playable.map((sound) => sound.symbol)), progress, game.phase, required, recent);
    if (!symbol) return { question: null, notice: NO_SOUND_RECORDINGS };
    const sound = IPA_BY_SYMBOL[symbol];
    const base = { key: questionKey(game.id, symbol), gameId: game.id, phase: game.phase, symbol, sound: soundInfo(sound), answer: symbol, scored: [symbol] };
    if (game.id === 'soundToSymbol' || game.id === 'symbolToSound') {
      const distractors = similarSounds(sound, game.id === 'symbolToSound' ? playable : inSet, count - 1);
      const options: IpaOption[] = shuffle([sound, ...distractors]).map((option) => ({
        text: option.symbol,
        correct: option.symbol === symbol,
        symbol: option.symbol,
        scored: option.symbol !== symbol && met(option.symbol),
        ...(game.id === 'symbolToSound' ? { audio: soundAudio(option.symbol) } : {}),
      }));
      return { question: { ...base, ...(game.id === 'soundToSymbol' ? { audio: soundAudio(symbol) } : {}), options }, notice: null };
    }
    return { question: { ...base, audio: soundAudio(symbol) }, notice: null };
  }

  // Games with words.
  const examples = request.words === 'examples' || !request.words;
  let pool = examples ? EXAMPLE_POOL : languagePool(request.words);
  if (examples && request.sounds === 'english') pool = pool.filter((word) => word.lang === 'en' || word.lang === 'en-GB');
  if (game.id === 'ipaToWordTyped' && examples) pool = pool.filter((word) => LATIN_WORD.test(word.word));
  if (pool.length === 0) {
    return {
      question: null,
      notice: examples
        ? 'No example words for these sounds.'
        : 'This language has no words with an IPA pronunciation yet: fetch definitions (Configuration → Words) to get them.',
    };
  }
  const present = new Set(pool.flatMap((word) => word.sounds));
  const symbol = pickTarget(new Set(inSet.filter((sound) => present.has(sound.symbol)).map((sound) => sound.symbol)), progress, game.phase, required, recent);
  if (!symbol) return { question: null, notice: 'None of these words contains the chosen sounds.' };
  const sound = IPA_BY_SYMBOL[symbol];
  const word = wordFor(symbol, pool, examples)!;
  const base = { key: questionKey(game.id, symbol), gameId: game.id, phase: game.phase, symbol, sound: soundInfo(sound) };

  if (game.id === 'examplesToSymbolTyped') {
    const words = shuffle(pool.filter((candidate) => candidate.sounds.includes(symbol)))
      .sort((a, b) => Number(b.exampleOf.includes(symbol)) - Number(a.exampleOf.includes(symbol)))
      .slice(0, 3);
    return {
      question: { ...base, examples: words.map((candidate) => ({ ...publicWord(candidate), blanked: blankSound(candidate.ipa, symbol) })), answer: symbol, scored: [symbol] },
      notice: null,
    };
  }

  if (game.id === 'wordAudioToIpa') {
    // Transcriptions of the word with the sound swapped for a similar one.
    // Variants that count as the same transcription (ʌ / ə, r / ɹ…) are left out.
    const options: IpaOption[] = [{ text: word.ipa, correct: true, symbol }];
    const seen = new Set([looseIpa(word.ipa)]);
    for (const other of similarSounds(sound, inSet, 8)) {
      if (options.length >= count) break;
      const variant = replaceSound(word.ipa, symbol, other.symbol);
      if (seen.has(looseIpa(variant))) continue;
      seen.add(looseIpa(variant));
      options.push({ text: variant, correct: false, symbol: other.symbol, scored: met(other.symbol) });
    }
    return { question: { ...base, word: publicWord(word), audio: word.audio, options: shuffle(options), answer: word.ipa, scored: [symbol] }, notice: null };
  }

  if (game.id === 'ipaToWordAudio') {
    // Recordings of words of the same language with similar sounds.
    const sameLanguage = pool.filter((candidate) => candidate.lang === word.lang && candidate.word !== word.word);
    const options: IpaOption[] = [{ text: word.word, correct: true, symbol, audio: word.audio, word: publicWord(word) }];
    const used = new Set([word.word]);
    for (const other of similarSounds(sound, inSet, 8)) {
      if (options.length >= count) break;
      const candidate = pickRandom(sameLanguage.filter((w) => !used.has(w.word) && w.sounds.includes(other.symbol) && !w.sounds.includes(symbol)));
      if (!candidate) continue;
      used.add(candidate.word);
      options.push({ text: candidate.word, correct: false, symbol: other.symbol, scored: met(other.symbol), audio: candidate.audio, word: publicWord(candidate) });
    }
    for (const candidate of shuffle(sameLanguage)) {
      if (options.length >= count) break;
      if (used.has(candidate.word) || normalizeIpa(candidate.ipa) === normalizeIpa(word.ipa)) continue;
      used.add(candidate.word);
      options.push({ text: candidate.word, correct: false, audio: candidate.audio, word: publicWord(candidate) });
    }
    if (options.length < 2) return { question: null, notice: `Not enough ${word.langName} words to choose from.` };
    return { question: { ...base, word: publicWord(word), options: shuffle(options), answer: word.word, scored: [symbol] }, notice: null };
  }

  // Typed answers: the transcription (every sound met before counts) or the word.
  const scored = game.response === 'ipaTyped' ? [symbol, ...word.sounds.filter((other) => other !== symbol && met(other))] : [symbol];
  return {
    question: {
      ...base,
      word: publicWord(word),
      // Heard: words to transcribe, and transcriptions to learn by heart.
      ...(game.prompt === 'wordAudio' || game.memorize ? { audio: word.audio } : {}),
      answer: game.response === 'wordTyped' ? word.word : word.ipa,
      scored,
    },
    notice: null,
  };
}
