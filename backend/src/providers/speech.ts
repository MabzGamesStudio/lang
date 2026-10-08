import { randomUUID } from 'node:crypto';
import { HttpError, englishDatabase, languageDb, type DB } from '../db/connection.js';
import { getLanguageConfig } from '../services/languages.js';
import { getSettings } from '../services/settings.js';
import { httpFetch, postForBytes, postJson } from '../services/http.js';
import { parseEnglish } from '../services/words.js';
import type { JobContext } from '../services/jobs.js';
import { colabBaseUrl } from './llm.js';
import type { AppSettings } from '../../../shared/types.js';

// ---------------------------------------------------------------------------
// Text to speech. Generated audio is cached in the database (foreign audio in
// the language database, English audio in the shared English database), so
// each word or sentence is synthesised only once.

interface VoiceTarget {
  db: DB;
  locale: string;
  voice: string;
}

function voiceTarget(target: string, settings: AppSettings): VoiceTarget {
  if (target === 'english') {
    return { db: englishDatabase(), locale: 'en-US', voice: settings.tts.englishVoice };
  }
  const db = languageDb(target);
  const config = getLanguageConfig(db);
  return { db, locale: config.locale || config.code, voice: config.ttsVoice };
}

export function ttsGenerates(settings = getSettings()): boolean {
  return settings.tts.provider !== 'browser';
}

function voiceKey(settings: AppSettings, target: VoiceTarget): string {
  switch (settings.tts.provider) {
    case 'openai':
      return `openai:${settings.tts.openai.model}:${target.voice || settings.tts.openai.voice}`;
    case 'google':
      return `google:${target.locale}:${target.voice}`;
    case 'colab':
      return `colab:${target.voice || target.locale}`;
    default:
      return 'browser';
  }
}

async function synthesize(text: string, target: VoiceTarget, settings: AppSettings): Promise<{ data: Buffer; mime: string }> {
  switch (settings.tts.provider) {
    case 'openai': {
      const { baseUrl, apiKey, model, voice } = settings.tts.openai;
      const headers: Record<string, string> = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
      const result = await postForBytes(
        `${baseUrl.replace(/\/+$/, '')}/audio/speech`,
        { model, voice: target.voice || voice, input: text, response_format: 'mp3' },
        headers
      );
      return { data: result.data, mime: 'audio/mpeg' };
    }
    case 'colab': {
      const result = await postForBytes(`${colabBaseUrl(settings)}/audio/speech`, {
        model: 'edge-tts',
        voice: target.voice,
        language: target.locale,
        input: text,
        response_format: 'mp3',
      });
      return { data: result.data, mime: 'audio/mpeg' };
    }
    case 'google': {
      const key = settings.tts.google.apiKey;
      if (!key) throw new HttpError(400, 'Add a Google Cloud Text-to-Speech API key in Configuration → Services.');
      const response = await postJson<{ audioContent: string }>(
        `https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(key)}`,
        {
          input: { text },
          voice: { languageCode: target.locale, ...(target.voice ? { name: target.voice } : {}) },
          audioConfig: { audioEncoding: 'MP3', speakingRate: settings.tts.rate || 1 },
        }
      );
      return { data: Buffer.from(response.audioContent, 'base64'), mime: 'audio/mpeg' };
    }
    default:
      throw new HttpError(400, 'Text to speech runs in the browser');
  }
}

// Returns cached audio, generating it with the configured provider when
// `generate` is set. null means "use the browser's speech synthesis".
export async function getAudio(target: string, text: string, generate: boolean): Promise<{ data: Buffer; mime: string } | null> {
  const settings = getSettings();
  const voice = voiceTarget(target, settings);
  const key = voiceKey(settings, voice);
  const clean = text.trim().slice(0, 500);
  if (!clean) return null;
  const cached = voice.db
    .prepare(`SELECT mime, data FROM audio WHERE text = ? ORDER BY voice = ? DESC, RANDOM() LIMIT 1`)
    .get(clean, key) as { mime: string; data: Buffer } | undefined;
  if (cached) return cached;
  if (!generate || !ttsGenerates(settings)) return null;
  const audio = await synthesize(clean, voice, settings);
  voice.db
    .prepare(`INSERT OR REPLACE INTO audio (text, voice, mime, data, created_at) VALUES (?, ?, ?, ?, ?)`)
    .run(clean, key, audio.mime, audio.data, Date.now());
  return audio;
}

function hasAudio(db: DB, text: string): boolean {
  return Boolean(db.prepare(`SELECT 1 FROM audio WHERE text = ? LIMIT 1`).get(text.trim()));
}

// Pre-generates audio for the most frequent words (foreign + English) and the
// easiest sentences so practice works offline and without delays.
export async function pregenerateAudio(
  langId: string,
  options: { words: number; sentences: number },
  ctx: JobContext
): Promise<string> {
  const settings = getSettings();
  if (!ttsGenerates(settings)) {
    throw new HttpError(400, 'Audio is played by the browser (on device). Choose an API or Colab voice to pre-generate audio.');
  }
  const db = languageDb(langId);
  const english = englishDatabase();
  const words = db
    .prepare(`SELECT display, english FROM words WHERE active = 1 AND rank IS NOT NULL ORDER BY rank LIMIT ?`)
    .all(options.words) as { display: string; english: string | null }[];
  const sentences = db
    .prepare(`SELECT text, english FROM sentences WHERE max_rank IS NOT NULL ORDER BY max_rank, word_count LIMIT ?`)
    .all(options.sentences) as { text: string; english: string | null }[];
  const tasks: { target: string; text: string }[] = [];
  for (const word of words) {
    if (!hasAudio(db, word.display)) tasks.push({ target: langId, text: word.display });
    const gloss = parseEnglish(word.english)[0];
    if (gloss && !hasAudio(english, gloss)) tasks.push({ target: 'english', text: gloss });
  }
  for (const sentence of sentences) {
    if (!hasAudio(db, sentence.text)) tasks.push({ target: langId, text: sentence.text });
    if (sentence.english && !hasAudio(english, sentence.english)) tasks.push({ target: 'english', text: sentence.english });
  }
  if (tasks.length === 0) return 'All audio is already generated';
  let done = 0;
  const failures: string[] = [];
  for (const task of tasks) {
    ctx.checkCancelled();
    ctx.progress(done, tasks.length, `Generating audio (${done}/${tasks.length})…`);
    try {
      await getAudio(task.target, task.text, true);
    } catch (error) {
      failures.push((error as Error).message);
      if (failures.length >= 5 && failures.length === done + 1) throw new Error(`Audio generation failed: ${failures[0]}`);
    }
    done++;
  }
  ctx.progress(done, tasks.length);
  return `Generated ${done - failures.length} audio clips${failures.length ? ` (${failures.length} failed: ${failures[0]})` : ''}`;
}

// ---------------------------------------------------------------------------
// Speech to text (Whisper-compatible /audio/transcriptions endpoint).

function multipart(fields: Record<string, string>, file: { name: string; mime: string; data: Buffer }) {
  const boundary = `----lang${randomUUID().replace(/-/g, '')}`;
  const parts: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  }
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.mime}\r\n\r\n`
    ),
    file.data,
    Buffer.from(`\r\n--${boundary}--\r\n`)
  );
  return { body: new Uint8Array(Buffer.concat(parts)), contentType: `multipart/form-data; boundary=${boundary}` };
}

export async function transcribe(audio: Buffer, mime: string, target: string): Promise<string> {
  const settings = getSettings();
  const language = target === 'english' ? 'en' : getLanguageConfig(languageDb(target)).code;
  let base: string;
  let model: string;
  const headers: Record<string, string> = {};
  if (settings.stt.provider === 'colab') {
    base = colabBaseUrl(settings);
    model = 'whisper';
  } else if (settings.stt.provider === 'openai') {
    base = settings.stt.openai.baseUrl.replace(/\/+$/, '');
    model = settings.stt.openai.model;
    if (settings.stt.openai.apiKey) headers.Authorization = `Bearer ${settings.stt.openai.apiKey}`;
  } else {
    throw new HttpError(400, 'Speech recognition runs in the browser');
  }
  const extension = mime.includes('ogg') ? 'ogg' : mime.includes('mp4') ? 'mp4' : mime.includes('wav') ? 'wav' : 'webm';
  const form = multipart(
    { model, language, response_format: 'json' },
    { name: `speech.${extension}`, mime: mime || 'audio/webm', data: audio }
  );
  const response = await httpFetch(`${base}/audio/transcriptions`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': form.contentType },
    body: form.body,
    timeoutMs: 60_000,
  });
  if (!response.ok) throw new Error(`Transcription failed: ${response.status} ${(await response.text()).slice(0, 200)}`);
  const data = (await response.json()) as { text?: string };
  return (data.text ?? '').trim();
}
