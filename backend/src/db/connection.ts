import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { ENGLISH_DB_PATH, LANGUAGES_DIR, ensureDataDirs } from '../config.js';
import { migrateEnglishDb, migrateLanguageDb } from './schema.js';

export type DB = Database.Database;

const languageDbs = new Map<string, DB>();
let englishDb: DB | null = null;

const LANGUAGE_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

export function assertLanguageId(id: string): void {
  if (!LANGUAGE_ID.test(id)) throw new HttpError(400, `Invalid language id "${id}"`);
}

export function languageDbPath(id: string): string {
  assertLanguageId(id);
  return path.join(LANGUAGES_DIR, `${id}.sqlite`);
}

function configure(db: DB): void {
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');
}

export function languageExists(id: string): boolean {
  return fs.existsSync(languageDbPath(id));
}

export function listLanguageIds(): string[] {
  ensureDataDirs();
  return fs
    .readdirSync(LANGUAGES_DIR)
    .filter((file) => file.endsWith('.sqlite'))
    .map((file) => file.slice(0, -'.sqlite'.length))
    .filter((id) => LANGUAGE_ID.test(id))
    .sort();
}

// Opens (and creates when `create` is set) the database of one language.
export function languageDb(id: string, create = false): DB {
  const cached = languageDbs.get(id);
  if (cached) return cached;
  const file = languageDbPath(id);
  if (!create && !fs.existsSync(file)) throw new HttpError(404, `Unknown language "${id}"`);
  ensureDataDirs();
  const db = new Database(file);
  configure(db);
  migrateLanguageDb(db);
  languageDbs.set(id, db);
  return db;
}

export function closeLanguageDb(id: string): void {
  const db = languageDbs.get(id);
  if (db) {
    db.close();
    languageDbs.delete(id);
  }
}

export function englishDatabase(): DB {
  if (englishDb) return englishDb;
  ensureDataDirs();
  const db = new Database(ENGLISH_DB_PATH);
  configure(db);
  migrateEnglishDb(db);
  englishDb = db;
  return db;
}

export function closeEnglishDb(): void {
  if (englishDb) {
    englishDb.close();
    englishDb = null;
  }
}

export function closeAll(): void {
  for (const id of [...languageDbs.keys()]) closeLanguageDb(id);
  closeEnglishDb();
}

// Opens a standalone database file (used to validate uploads).
export function openFile(file: string, readonly = true): DB {
  return new Database(file, { readonly, fileMustExist: true });
}
