import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import JSZip from 'jszip';
import {
  HttpError,
  assertLanguageId,
  closeEnglishDb,
  closeLanguageDb,
  englishDatabase,
  languageDb,
  languageDbPath,
  openFile,
} from '../db/connection.js';
import { ENGLISH_SCHEMA_VERSION, LANGUAGE_SCHEMA_VERSION, readMeta, writeMeta } from '../db/schema.js';
import { DATA_DIR, ENGLISH_DB_PATH, LANGUAGES_DIR, ensureDataDirs } from '../config.js';
import { getLanguageConfig, languageSummary } from './languages.js';
import { invalidateImageIndex } from './english.js';
import { invalidateGlossIndex } from './glossIndex.js';
import type { LanguageSummary } from '../../../shared/types.js';

// Backups are zip files holding a manifest and the SQLite database itself, so
// a restore brings back everything: words, sentences, progress and audio.

interface Manifest {
  format: 'lang-backup';
  type: 'language' | 'english';
  id?: string;
  name?: string;
  schemaVersion: number;
  exportedAt: string;
}

const LANGUAGE_FILE = 'language.sqlite';
const ENGLISH_FILE = 'english.sqlite';

function stamp(): string {
  return new Date().toISOString().slice(0, 10);
}

async function zipDatabase(manifest: Manifest, fileName: string, bytes: Buffer): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('manifest.json', JSON.stringify(manifest, null, 2));
  zip.file(fileName, bytes);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}

async function readBackup(buffer: Buffer, type: Manifest['type']): Promise<{ manifest: Manifest; bytes: Buffer }> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    throw new HttpError(400, 'This file is not a zip archive');
  }
  const manifestFile = zip.file('manifest.json');
  if (!manifestFile) throw new HttpError(400, 'This zip is not a backup made by this app (manifest.json is missing)');
  const manifest = JSON.parse(await manifestFile.async('string')) as Manifest;
  if (manifest.format !== 'lang-backup') throw new HttpError(400, 'Unrecognised backup format');
  if (manifest.type !== type) {
    throw new HttpError(
      400,
      manifest.type === 'english'
        ? 'This is an English & images backup. Upload it under "English words & images" instead.'
        : 'This is a language backup. Upload it under "Language data" instead.'
    );
  }
  const dbFile = zip.file(type === 'language' ? LANGUAGE_FILE : ENGLISH_FILE);
  if (!dbFile) throw new HttpError(400, 'The backup does not contain a database');
  return { manifest, bytes: await dbFile.async('nodebuffer') };
}

// Writes the database to a temporary file and checks it before it replaces
// the live database.
function stageDatabase(bytes: Buffer, directory: string, kind: 'language' | 'english'): string {
  ensureDataDirs();
  const temp = path.join(directory, `.import-${randomUUID()}.tmp`);
  fs.writeFileSync(temp, bytes);
  try {
    const db = openFile(temp, false);
    try {
      const actualKind = readMeta(db, 'kind');
      if (actualKind !== kind) throw new HttpError(400, `The backup database is not a ${kind} database`);
      if (kind === 'language' && !readMeta(db, 'config')) throw new HttpError(400, 'The language backup has no configuration');
      const version = Number(readMeta(db, 'schema_version') ?? 0);
      if (version > (kind === 'language' ? LANGUAGE_SCHEMA_VERSION : ENGLISH_SCHEMA_VERSION)) {
        throw new HttpError(400, 'The backup was made by a newer version of the app. Update the app to import it.');
      }
      const check = db.pragma('integrity_check', { simple: true });
      if (check !== 'ok') throw new HttpError(400, `The backup database is damaged (${String(check)})`);
    } finally {
      db.close();
    }
  } catch (error) {
    fs.rmSync(temp, { force: true });
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, `The backup database could not be opened: ${(error as Error).message}`);
  }
  return temp;
}

function replaceFile(temp: string, target: string): void {
  for (const suffix of ['', '-wal', '-shm', '-journal']) fs.rmSync(target + suffix, { force: true });
  fs.renameSync(temp, target);
}

export async function exportLanguage(langId: string): Promise<{ fileName: string; data: Buffer }> {
  const db = languageDb(langId);
  const config = getLanguageConfig(db);
  const manifest: Manifest = {
    format: 'lang-backup',
    type: 'language',
    id: config.id,
    name: config.name,
    schemaVersion: Number(readMeta(db, 'schema_version')),
    exportedAt: new Date().toISOString(),
  };
  const data = await zipDatabase(manifest, LANGUAGE_FILE, db.serialize());
  return { fileName: `lang-${config.id}-${stamp()}.zip`, data };
}

export async function importLanguage(buffer: Buffer): Promise<LanguageSummary> {
  const { manifest, bytes } = await readBackup(buffer, 'language');
  const id = manifest.id ?? '';
  assertLanguageId(id);
  const temp = stageDatabase(bytes, LANGUAGES_DIR, 'language');
  closeLanguageDb(id);
  replaceFile(temp, languageDbPath(id));
  const db = languageDb(id);
  const config = getLanguageConfig(db);
  if (config.id !== id) writeMeta(db, 'config', JSON.stringify({ ...config, id }));
  invalidateGlossIndex();
  return languageSummary(id);
}

export async function exportEnglish(): Promise<{ fileName: string; data: Buffer }> {
  const db = englishDatabase();
  const manifest: Manifest = {
    format: 'lang-backup',
    type: 'english',
    schemaVersion: Number(readMeta(db, 'schema_version')),
    exportedAt: new Date().toISOString(),
  };
  const data = await zipDatabase(manifest, ENGLISH_FILE, db.serialize());
  return { fileName: `lang-english-images-${stamp()}.zip`, data };
}

export async function importEnglish(buffer: Buffer): Promise<void> {
  const { bytes } = await readBackup(buffer, 'english');
  const temp = stageDatabase(bytes, DATA_DIR, 'english');
  closeEnglishDb();
  replaceFile(temp, ENGLISH_DB_PATH);
  englishDatabase();
  invalidateImageIndex();
}
