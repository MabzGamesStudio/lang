import { randomUUID } from 'node:crypto';
import { HttpError, englishDatabase, languageDb, type DB } from '../db/connection.js';
import { getLanguageConfig } from '../services/languages.js';
import { getSettings } from '../services/settings.js';
import { httpFetch, postForBytes, postJson } from '../services/http.js';
import { audioText, parseEnglish } from '../services/words.js';
import { refreshSentenceCounts, wordIdsOfSentences } from '../services/ranking.js';
import type { JobContext } from '../services/jobs.js';
import { colabBaseUrl } from './llm.js';
import { stripParentheticals } from '../../../shared/text.js';
import type { AppSettings, Recording, TtsProvider } from '../../../shared/types.js';

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

// Stored with the audio: which service and voice made it ("colab:es-ES-ElviraNeural").
function voiceKey(settings: AppSettings, target: VoiceTarget): string {
  switch (settings.tts.provider) {
    case 'openai':
      return `openai:${settings.tts.openai.model}:${target.voice || settings.tts.openai.voice}`;
    case 'google':
      return `google:${target.locale}:${target.voice}`;
    case 'colab':
      return `colab:${target.voice || target.locale}`;
    case 'azure':
      return `azure:${target.voice || target.locale}`;
    case 'elevenlabs':
      return `elevenlabs:${settings.tts.elevenlabs.model}:${target.voice || settings.tts.elevenlabs.voice}`;
    default:
      return 'browser';
  }
}

interface Synthesized {
  data: Buffer;
  mime: string;
  // The voice key when the service reports which voice it really used.
  key?: string;
}

function escapeXml(text: string): string {
  return text.replace(/[<>&'"]/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[char]!);
}

// Azure Speech: a region ("westeurope") or a full endpoint URL.
function azureHost(region: string): string {
  const value = region.trim() || 'westeurope';
  return /^https?:\/\//.test(value) ? value.replace(/\/+$/, '') : `https://${value}.tts.speech.microsoft.com`;
}

const azureVoiceLists = new Map<string, Promise<{ ShortName: string; Locale: string }[]>>();

// The first Azure voice for a locale (or for its language), when none is set.
async function azureDefaultVoice(host: string, apiKey: string, locale: string): Promise<string> {
  let voices = azureVoiceLists.get(host);
  if (!voices) {
    voices = httpFetch(`${host}/cognitiveservices/voices/list`, { headers: { 'Ocp-Apim-Subscription-Key': apiKey } }).then(async (response) => {
      if (!response.ok) throw new Error(`Azure Speech voices: ${response.status} ${(await response.text()).slice(0, 200)}`);
      return (await response.json()) as { ShortName: string; Locale: string }[];
    });
    azureVoiceLists.set(host, voices);
    voices.catch(() => azureVoiceLists.delete(host));
  }
  const list = await voices;
  const wanted = locale.toLowerCase();
  const language = wanted.split('-')[0];
  const voice =
    list.find((v) => v.Locale.toLowerCase() === wanted) ?? list.find((v) => v.Locale.toLowerCase().split('-')[0] === language);
  if (!voice) throw new HttpError(400, `Azure Speech has no voice for ${locale}`);
  return voice.ShortName;
}

async function synthesize(text: string, target: VoiceTarget, settings: AppSettings): Promise<Synthesized> {
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
      // The notebook reports the engine (edge-tts, kokoro, chatterbox) and voice it used.
      const engine = result.headers.get('x-tts-engine');
      const voice = result.headers.get('x-tts-voice') || target.voice || target.locale;
      return {
        data: result.data,
        mime: result.contentType.startsWith('audio/') ? result.contentType : 'audio/mpeg',
        key: `colab:${engine && engine !== 'edge-tts' ? `${engine}:` : ''}${voice}`,
      };
    }
    case 'azure': {
      const { apiKey, region } = settings.tts.azure;
      if (!apiKey) throw new HttpError(400, 'Add an Azure Speech key in Configuration → Services.');
      const host = azureHost(region);
      const voice = target.voice || (await azureDefaultVoice(host, apiKey, target.locale));
      const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${escapeXml(target.locale)}"><voice name="${escapeXml(voice)}">${escapeXml(text)}</voice></speak>`;
      const response = await httpFetch(`${host}/cognitiveservices/v1`, {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': apiKey,
          'Content-Type': 'application/ssml+xml',
          'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
        },
        body: ssml,
        timeoutMs: 60_000,
      });
      if (!response.ok) throw new Error(`Azure Speech: ${response.status} ${(await response.text()).slice(0, 200)}`);
      return { data: Buffer.from(await response.arrayBuffer()), mime: 'audio/mpeg', key: `azure:${voice}` };
    }
    case 'elevenlabs': {
      const { apiKey, model, voice, baseUrl } = settings.tts.elevenlabs;
      if (!apiKey) throw new HttpError(400, 'Add an ElevenLabs API key in Configuration → Services.');
      const voiceId = target.voice || voice;
      // Newer models can be told the language (short words are otherwise easily read as English).
      const languageCode = /v2_5|v3/.test(model) ? { language_code: target.locale.split('-')[0].toLowerCase() } : {};
      const result = await postForBytes(
        `${(baseUrl || 'https://api.elevenlabs.io').replace(/\/+$/, '')}/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`,
        { text, model_id: model, ...languageCode },
        { 'xi-api-key': apiKey, Accept: 'audio/mpeg' }
      );
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
  // Notes in parentheses are never spoken.
  const clean = stripParentheticals(text).slice(0, 500);
  if (!clean) return null;
  // Any stored recording: with several voices, a different one each time.
  const cached = voice.db.prepare(`SELECT mime, data FROM audio WHERE text = ? ORDER BY RANDOM() LIMIT 1`).get(clean) as
    | { mime: string; data: Buffer }
    | undefined;
  if (cached) return cached;
  if (!generate || !ttsGenerates(settings)) return null;
  const audio = await synthesize(clean, voice, settings);
  voice.db
    .prepare(`INSERT OR REPLACE INTO audio (text, voice, mime, data, created_at) VALUES (?, ?, ?, ?, ?)`)
    .run(clean, audio.key ?? key, audio.mime, audio.data, Date.now());
  return { data: audio.data, mime: audio.mime };
}

// ---------------------------------------------------------------------------
// Recordings of one text: several voices can be kept, each with its source.

function recordingsDb(target: string): DB {
  return target === 'english' ? englishDatabase() : languageDb(target);
}

export function recordingFile(target: string, id: number): { data: Buffer; mime: string } | null {
  return (recordingsDb(target).prepare(`SELECT mime, data FROM audio WHERE id = ?`).get(id) as { data: Buffer; mime: string } | undefined) ?? null;
}

export function deleteRecording(target: string, id: number): boolean {
  return recordingsDb(target).prepare(`DELETE FROM audio WHERE id = ?`).run(id).changes > 0;
}

// Adds a recording made by the configured voice service, or another one (a
// recording by the same voice is replaced).
export async function addRecording(target: string, text: string, options: { provider?: TtsProvider; voice?: string }): Promise<Recording> {
  const settings = getSettings();
  const provider = options.provider ?? settings.tts.provider;
  if (provider === 'browser') throw new HttpError(400, 'Voices on this device are not stored: choose a voice service.');
  const effective: AppSettings = { ...settings, tts: { ...settings.tts, provider } };
  const base = voiceTarget(target, effective);
  const voice = options.voice?.trim() ? { ...base, voice: options.voice.trim() } : provider !== settings.tts.provider ? { ...base, voice: '' } : base;
  const clean = audioText(text);
  if (!clean) throw new HttpError(400, 'Nothing to record');
  const audio = await synthesize(clean, voice, effective);
  const key = audio.key ?? voiceKey(effective, voice);
  const now = Date.now();
  voice.db.prepare(`INSERT OR REPLACE INTO audio (text, voice, mime, data, created_at) VALUES (?, ?, ?, ?, ?)`).run(clean, key, audio.mime, audio.data, now);
  const row = voice.db.prepare(`SELECT id FROM audio WHERE text = ? AND voice = ?`).get(clean, key) as { id: number };
  return { id: row.id, voice: key, createdAt: now };
}

// Speaks a text in any locale with the configured voice service (or another
// one): example words of the pronunciation mode. null when voices are only
// on the device.
export async function speakInLocale(
  text: string,
  locale: string,
  provider?: TtsProvider
): Promise<{ data: Buffer; mime: string; voice: string } | null> {
  const settings = getSettings();
  const chosen = provider ?? settings.tts.provider;
  if (chosen === 'browser') return null;
  const effective: AppSettings = { ...settings, tts: { ...settings.tts, provider: chosen } };
  const ownEnglishVoice = locale.toLowerCase() === 'en-us' && chosen === settings.tts.provider;
  const target: VoiceTarget = { db: englishDatabase(), locale, voice: ownEnglishVoice ? settings.tts.englishVoice : '' };
  const audio = await synthesize(text, target, effective);
  return { data: audio.data, mime: audio.mime, voice: audio.key ?? voiceKey(effective, target) };
}

// Replaces every stored recording of a text with a new one. The old audio is
// only removed once the new one exists.
async function replaceAudio(target: string, text: string, settings: AppSettings, voiceOverride?: string): Promise<void> {
  const base = voiceTarget(target, settings);
  const voice = voiceOverride === undefined ? base : { ...base, voice: voiceOverride };
  const clean = audioText(text);
  if (!clean) return;
  const audio = await synthesize(clean, voice, settings);
  voice.db.transaction(() => {
    voice.db.prepare(`DELETE FROM audio WHERE text = ?`).run(clean);
    voice.db
      .prepare(`INSERT INTO audio (text, voice, mime, data, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run(clean, audio.key ?? voiceKey(settings, voice), audio.mime, audio.data, Date.now());
  })();
}

// Regenerates the audio of sentences reported as having bad audio (or of the
// given sentences), with the configured voice service or another one. A
// separate job from generating audio that does not exist yet. Fixed
// sentences go back into the questions.
export async function regenerateSentenceAudio(
  langId: string,
  options: { ids?: number[]; provider?: TtsProvider; voice?: string },
  ctx?: JobContext
): Promise<string> {
  const settings = getSettings();
  const provider = options.provider ?? settings.tts.provider;
  if (provider === 'browser') {
    throw new HttpError(
      400,
      'Voices on this device are not stored, so there is nothing to regenerate. Choose a voice service (Configuration → Services), or another device voice for the language (Configuration → Language) and put the sentences back.'
    );
  }
  const switched = provider !== settings.tts.provider;
  const effective: AppSettings = { ...settings, tts: { ...settings.tts, provider } };
  // Voice names belong to one service: another service uses its default voice.
  const voice = options.voice?.trim() || (switched ? '' : undefined);
  const db = languageDb(langId);
  const english = englishDatabase();
  const rows = (
    options.ids?.length
      ? db.prepare(`SELECT id, text, english FROM sentences WHERE id IN (SELECT value FROM json_each(?))`).all(JSON.stringify(options.ids))
      : db
          .prepare(`SELECT id, text, english FROM sentences WHERE excluded_reason = 'audio' ORDER BY max_rank IS NULL, max_rank`)
          .all()
  ) as { id: number; text: string; english: string | null }[];
  if (rows.length === 0) return 'No sentences are marked as having bad audio';
  let fixed = 0;
  const failures: string[] = [];
  for (const [index, row] of rows.entries()) {
    ctx?.checkCancelled();
    ctx?.progress(index, rows.length, `Regenerating audio (${index}/${rows.length})…`);
    try {
      await replaceAudio(langId, row.text, effective, voice);
      // The English recording is redone too when there is one.
      if (row.english && hasAudio(english, row.english)) await replaceAudio('english', row.english, effective, switched ? '' : undefined);
      db.prepare(`UPDATE sentences SET excluded_reason = NULL, excluded_at = NULL WHERE id = ? AND excluded_reason = 'audio'`).run(row.id);
      fixed++;
    } catch (error) {
      failures.push((error as Error).message);
      if (fixed === 0 && failures.length >= 3) throw new Error(`Audio generation failed: ${failures[0]}`);
    }
  }
  ctx?.progress(rows.length, rows.length);
  refreshSentenceCounts(db, wordIdsOfSentences(db, rows.map((row) => row.id)));
  return `Regenerated the audio of ${fixed} sentence${fixed === 1 ? '' : 's'}${failures.length ? ` (${failures.length} failed: ${failures[0]})` : ''}`;
}

function hasAudio(db: DB, text: string): boolean {
  return Boolean(db.prepare(`SELECT 1 FROM audio WHERE text = ? LIMIT 1`).get(audioText(text)));
}

// Pre-generates audio for the most frequent words (foreign + English) and the
// easiest sentences so practice works offline and without delays.
export async function pregenerateAudio(
  langId: string,
  options: { words: number; sentences: number; wordIds?: number[] },
  ctx: JobContext
): Promise<string> {
  const settings = getSettings();
  if (!ttsGenerates(settings)) {
    throw new HttpError(400, 'Audio is played by the browser (on device). Choose an API or Colab voice to pre-generate audio.');
  }
  const db = languageDb(langId);
  const english = englishDatabase();
  const ids = options.wordIds ? JSON.stringify(options.wordIds) : null;
  const words = (
    ids
      ? db.prepare(`SELECT display, english FROM words WHERE id IN (SELECT value FROM json_each(?)) ORDER BY rank`).all(ids)
      : db.prepare(`SELECT display, english FROM words WHERE active = 1 AND rank IS NOT NULL ORDER BY rank LIMIT ?`).all(options.words)
  ) as { display: string; english: string | null }[];
  const sentences = (
    ids
      ? db
          .prepare(
            `SELECT text, english FROM sentences
             WHERE english IS NOT NULL AND excluded_reason IS NULL
               AND id IN (SELECT sentence_id FROM sentence_words WHERE word_id IN (SELECT value FROM json_each(?)))
             ORDER BY max_rank, word_count LIMIT ?`
          )
          .all(ids, options.sentences)
      : db
          .prepare(
            `SELECT text, english FROM sentences WHERE max_rank IS NOT NULL AND excluded_reason IS NULL ORDER BY max_rank, word_count LIMIT ?`
          )
          .all(options.sentences)
  ) as { text: string; english: string | null }[];
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
