import fs from 'node:fs';
import path from 'node:path';

// Everything the app stores lives under one data directory:
//   languages/<id>.sqlite  one database per foreign language (words, sentences, progress, audio)
//   english.sqlite         shared across languages (English words, images + labels, English audio)
//   settings.json          service configuration and API keys (never exported)
export const DATA_DIR = path.resolve(process.env.LANG_DATA_DIR ?? path.join(process.cwd(), 'langData'));
export const LANGUAGES_DIR = path.join(DATA_DIR, 'languages');
export const ENGLISH_DB_PATH = path.join(DATA_DIR, 'english.sqlite');
export const SETTINGS_PATH = path.join(DATA_DIR, 'settings.json');
// Database of the previous version of the app, imported automatically once.
export const LEGACY_DB_PATH = path.join(DATA_DIR, 'app.db');

export const PORT = Number(process.env.LANG_PORT ?? 3000);
export const HOST = process.env.LANG_HOST ?? '127.0.0.1';

export function ensureDataDirs(): void {
  fs.mkdirSync(LANGUAGES_DIR, { recursive: true });
}
