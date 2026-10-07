import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, LEGACY_DB_PATH } from '../config.js';
import { englishDatabase, languageDb, languageExists, openFile, type DB } from '../db/connection.js';
import { createLanguage } from './languages.js';
import { importWordList } from './corpus.js';
import { addImage } from './english.js';
import { findCatalogLanguage, slugify } from '../../../shared/languages.js';
import { MAX_LEVEL } from '../../../shared/scoring.js';

// Imports the database of the previous version of the app (langData/app.db:
// words_list + image_data tables) into the new per-language databases.

const MARKER = path.join(DATA_DIR, '.legacy-imported');

function tableColumns(db: DB, table: string): Set<string> {
  return new Set((db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name));
}

export function legacyAvailable(): boolean {
  if (!fs.existsSync(LEGACY_DB_PATH)) return false;
  try {
    const db = openFile(LEGACY_DB_PATH);
    try {
      return tableColumns(db, 'words_list').size > 0;
    } finally {
      db.close();
    }
  } catch {
    return false;
  }
}

export function legacyAlreadyImported(): boolean {
  return fs.existsSync(MARKER);
}

function sniffImageMime(data: Buffer): string {
  if (data[0] === 0xff && data[1] === 0xd8) return 'image/jpeg';
  if (data.subarray(0, 4).toString('hex') === '89504e47') return 'image/png';
  if (data.subarray(0, 3).toString() === 'GIF') return 'image/gif';
  if (data.subarray(0, 4).toString() === 'RIFF' && data.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  if (data.subarray(0, 2).toString() === 'BM') return 'image/bmp';
  return 'image/jpeg';
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

interface LegacyRow {
  language: string;
  frequency_rank: number;
  english_value: string;
  foreign_value: string;
  recognition_level: number | null;
  recall_level: number | null;
  recite_level: number | null;
  translate_level: number | null;
  image_id?: number | null;
  english_speech_male?: Buffer | null;
  english_speech_female?: Buffer | null;
  foreign_speech_male?: Buffer | null;
  foreign_speech_female?: Buffer | null;
}

export async function importLegacy(): Promise<string> {
  const legacy = openFile(LEGACY_DB_PATH);
  const lines: string[] = [];
  try {
    const columns = tableColumns(legacy, 'words_list');
    const hasSpeech = columns.has('foreign_speech_male');
    const languages = (legacy.prepare(`SELECT DISTINCT language FROM words_list`).all() as { language: string }[]).map(
      (row) => row.language
    );
    const imageWords = new Map<number, Set<string>>();

    for (const name of languages) {
      const catalog = findCatalogLanguage(name);
      const id = slugify(catalog?.name ?? name);
      const rows = legacy
        .prepare(`SELECT * FROM words_list WHERE language = ? ORDER BY frequency_rank`)
        .all(name) as LegacyRow[];
      for (const row of rows) {
        if (columns.has('image_id') && row.image_id) {
          const set = imageWords.get(row.image_id) ?? new Set<string>();
          set.add(row.english_value);
          imageWords.set(row.image_id, set);
        }
      }
      if (languageExists(id)) {
        lines.push(`${name}: skipped, a language "${id}" already exists`);
        continue;
      }
      createLanguage({ name: catalog?.name ?? name.charAt(0).toUpperCase() + name.slice(1), code: catalog?.code ?? name.slice(0, 2) });
      const csv = ['word,english,rank', ...rows.map((r) => [r.foreign_value, r.english_value, String(r.frequency_rank)].map(csvCell).join(','))].join('\n');
      const summary = await importWordList(id, { title: 'Word list from the previous version', csv });
      const db = languageDb(id);
      const now = Date.now();
      db.transaction(() => {
        const setLevels = db.prepare(
          `UPDATE words SET
             recognition_level = MAX(recognition_level, ?), recall_level = MAX(recall_level, ?),
             recite_level = MAX(recite_level, ?), translate_level = MAX(translate_level, ?),
             first_seen_at = CASE WHEN ? > 0 THEN COALESCE(first_seen_at, ?) ELSE first_seen_at END
           WHERE word = ?`
        );
        const addAudio = db.prepare(
          `INSERT OR IGNORE INTO audio (text, voice, mime, data, created_at) VALUES (?, ?, 'audio/mpeg', ?, ?)`
        );
        const addEnglishAudio = englishDatabase().prepare(
          `INSERT OR IGNORE INTO audio (text, voice, mime, data, created_at) VALUES (?, ?, 'audio/mpeg', ?, ?)`
        );
        for (const row of rows) {
          const word = row.foreign_value.normalize('NFC').toLowerCase().trim();
          const levels = [
            Math.min(row.recognition_level ?? 0, MAX_LEVEL.recognition),
            Math.min(row.recall_level ?? 0, MAX_LEVEL.recall),
            Math.min(row.recite_level ?? 0, MAX_LEVEL.recite),
            Math.min(row.translate_level ?? 0, MAX_LEVEL.translate),
          ];
          setLevels.run(...levels, Math.max(...levels), now, word);
          if (hasSpeech) {
            if (row.foreign_speech_male) addAudio.run(row.foreign_value, 'legacy-male', row.foreign_speech_male, now);
            if (row.foreign_speech_female) addAudio.run(row.foreign_value, 'legacy-female', row.foreign_speech_female, now);
            if (row.english_speech_male) addEnglishAudio.run(row.english_value, 'legacy-male', row.english_speech_male, now);
            if (row.english_speech_female) addEnglishAudio.run(row.english_value, 'legacy-female', row.english_speech_female, now);
          }
        }
      })();
      lines.push(`${name}: ${summary.uniqueWords} words imported`);
    }

    const hasImages = tableColumns(legacy, 'image_data').size > 0;
    if (hasImages) {
      let images = 0;
      for (const row of legacy.prepare(`SELECT id, image_description, data FROM image_data`).all() as {
        id: number;
        image_description: string;
        data: Buffer;
      }[]) {
        const labels = new Set([row.image_description, ...(imageWords.get(row.id) ?? [])]);
        const added = addImage({
          data: row.data,
          mime: sniffImageMime(row.data),
          labels: [...labels].filter(Boolean),
          status: 'labeled',
          source: 'legacy',
        });
        if (added) images++;
      }
      lines.push(`${images} images imported`);
    }
  } finally {
    legacy.close();
  }
  fs.writeFileSync(MARKER, new Date().toISOString());
  return lines.join('\n') || 'Nothing to import';
}
