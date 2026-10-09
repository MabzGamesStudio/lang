import type Database from 'better-sqlite3';

export const LANGUAGE_SCHEMA_VERSION = 2;
export const ENGLISH_SCHEMA_VERSION = 1;

const LANGUAGE_SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sources (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT,
  token_count INTEGER NOT NULL DEFAULT 0,
  sentence_count INTEGER NOT NULL DEFAULT 0,
  word_count INTEGER NOT NULL DEFAULT 0,
  weight REAL NOT NULL DEFAULT 1,
  added_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS words (
  id INTEGER PRIMARY KEY,
  word TEXT NOT NULL UNIQUE,
  display TEXT NOT NULL,
  has_case INTEGER NOT NULL DEFAULT 0,
  count INTEGER NOT NULL DEFAULT 0,
  mid_count INTEGER NOT NULL DEFAULT 0,
  cap_count INTEGER NOT NULL DEFAULT 0,
  score REAL NOT NULL DEFAULT 0,
  rank INTEGER,
  proper_noun INTEGER NOT NULL DEFAULT 0,
  user_excluded INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  english TEXT,
  pronunciation TEXT,
  pos TEXT,
  definition_source TEXT,
  sentence_count INTEGER NOT NULL DEFAULT 0,
  translated_sentence_count INTEGER NOT NULL DEFAULT 0,
  recognition_level INTEGER NOT NULL DEFAULT 0,
  recall_level INTEGER NOT NULL DEFAULT 0,
  recite_level INTEGER NOT NULL DEFAULT 0,
  translate_level INTEGER NOT NULL DEFAULT 0,
  recognition_correct INTEGER NOT NULL DEFAULT 0,
  recognition_wrong INTEGER NOT NULL DEFAULT 0,
  recall_correct INTEGER NOT NULL DEFAULT 0,
  recall_wrong INTEGER NOT NULL DEFAULT 0,
  recite_correct INTEGER NOT NULL DEFAULT 0,
  recite_wrong INTEGER NOT NULL DEFAULT 0,
  translate_correct INTEGER NOT NULL DEFAULT 0,
  translate_wrong INTEGER NOT NULL DEFAULT 0,
  first_seen_at INTEGER,
  last_seen_at INTEGER,
  srs_stage INTEGER NOT NULL DEFAULT 0,
  learned_at INTEGER,
  next_review_at INTEGER,
  review_started_at INTEGER,
  review_errors INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS words_rank ON words(rank);
CREATE INDEX IF NOT EXISTS words_review ON words(next_review_at) WHERE srs_stage > 0;

CREATE TABLE IF NOT EXISTS word_sources (
  word_id INTEGER NOT NULL REFERENCES words(id) ON DELETE CASCADE,
  source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  count INTEGER NOT NULL,
  mid_count INTEGER NOT NULL DEFAULT 0,
  cap_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (word_id, source_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS word_sources_source ON word_sources(source_id);

CREATE TABLE IF NOT EXISTS sentences (
  id INTEGER PRIMARY KEY,
  text TEXT NOT NULL UNIQUE,
  english TEXT,
  translation_source TEXT,
  source_id INTEGER REFERENCES sources(id) ON DELETE CASCADE,
  word_count INTEGER NOT NULL,
  max_rank INTEGER,
  last_used_at INTEGER,
  excluded_reason TEXT,
  excluded_at INTEGER
);
CREATE INDEX IF NOT EXISTS sentences_max_rank ON sentences(max_rank);
CREATE INDEX IF NOT EXISTS sentences_excluded ON sentences(excluded_reason) WHERE excluded_reason IS NOT NULL;
CREATE INDEX IF NOT EXISTS sentences_source ON sentences(source_id);

CREATE TABLE IF NOT EXISTS sentence_words (
  sentence_id INTEGER NOT NULL REFERENCES sentences(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  word_id INTEGER NOT NULL REFERENCES words(id) ON DELETE CASCADE,
  PRIMARY KEY (sentence_id, position)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS sentence_words_word ON sentence_words(word_id, sentence_id);

CREATE TABLE IF NOT EXISTS audio (
  id INTEGER PRIMARY KEY,
  text TEXT NOT NULL,
  voice TEXT NOT NULL,
  mime TEXT NOT NULL,
  data BLOB NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (text, voice)
);

CREATE TABLE IF NOT EXISTS activity (
  day TEXT PRIMARY KEY,
  correct INTEGER NOT NULL DEFAULT 0,
  wrong INTEGER NOT NULL DEFAULT 0
);
`;

const ENGLISH_SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS english_words (
  id INTEGER PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  display TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS images (
  id INTEGER PRIMARY KEY,
  mime TEXT NOT NULL,
  data BLOB NOT NULL,
  status TEXT NOT NULL DEFAULT 'labeled',
  source TEXT,
  source_url TEXT,
  license TEXT,
  attribution TEXT,
  query TEXT,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS images_source_url ON images(source_url) WHERE source_url IS NOT NULL;

CREATE TABLE IF NOT EXISTS image_labels (
  image_id INTEGER NOT NULL REFERENCES images(id) ON DELETE CASCADE,
  english_word_id INTEGER NOT NULL REFERENCES english_words(id) ON DELETE CASCADE,
  PRIMARY KEY (image_id, english_word_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS image_labels_word ON image_labels(english_word_id);

CREATE TABLE IF NOT EXISTS audio (
  id INTEGER PRIMARY KEY,
  text TEXT NOT NULL,
  voice TEXT NOT NULL,
  mime TEXT NOT NULL,
  data BLOB NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (text, voice)
);
`;

function schemaVersion(db: Database.Database): number {
  const hasMeta = db
    .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'meta'`)
    .get();
  if (!hasMeta) return 0;
  const row = db.prepare(`SELECT value FROM meta WHERE key = 'schema_version'`).get() as
    | { value: string }
    | undefined;
  return row ? Number(row.value) : 0;
}

// Changes to tables of existing databases, by the schema version they lead to.
// New databases get the columns from the CREATE TABLE statements directly.
// 2: sentences.excluded_reason ('translation', 'nonsense', 'audio' or 'other')
//    takes a sentence out of the questions; excluded_at says when.
const LANGUAGE_UPGRADES: Record<number, string> = {
  2: `ALTER TABLE sentences ADD COLUMN excluded_reason TEXT;
      ALTER TABLE sentences ADD COLUMN excluded_at INTEGER;`,
};

function migrate(db: Database.Database, schema: string, kind: string, version: number, upgrades: Record<number, string> = {}): void {
  const current = schemaVersion(db);
  if (current > version) {
    throw new Error(`This ${kind} database was created by a newer version of the app (schema ${current}).`);
  }
  db.transaction(() => {
    if (current > 0) {
      for (let step = current + 1; step <= version; step++) if (upgrades[step]) db.exec(upgrades[step]);
    }
    db.exec(schema);
    db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', ?)`).run(String(version));
    db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES ('kind', ?)`).run(kind);
  })();
}

export function migrateLanguageDb(db: Database.Database): void {
  migrate(db, LANGUAGE_SCHEMA, 'language', LANGUAGE_SCHEMA_VERSION, LANGUAGE_UPGRADES);
}

export function migrateEnglishDb(db: Database.Database): void {
  migrate(db, ENGLISH_SCHEMA, 'english', ENGLISH_SCHEMA_VERSION);
}

export function readMeta(db: Database.Database, key: string): string | null {
  const row = db.prepare(`SELECT value FROM meta WHERE key = ?`).get(key) as { value: string } | undefined;
  return row ? row.value : null;
}

export function writeMeta(db: Database.Database, key: string, value: string): void {
  db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)`).run(key, value);
}
