import { englishDatabase, HttpError } from '../db/connection.js';
import { glossKey } from '../../../shared/text.js';
import type { ImageRow, Paged } from '../../../shared/types.js';

// The English side is shared by every language: English words, labelled
// images (an image can stand for several English words) and English audio.

export function registerEnglishWords(glosses: string[]): void {
  const db = englishDatabase();
  const insert = db.prepare(`INSERT OR IGNORE INTO english_words (key, display, created_at) VALUES (?, ?, ?)`);
  const now = Date.now();
  db.transaction(() => {
    for (const gloss of glosses) {
      const key = glossKey(gloss);
      if (key && key.length <= 60) insert.run(key, gloss.trim().slice(0, 80), now);
    }
  })();
}

function englishWordId(label: string): number | null {
  const db = englishDatabase();
  const key = glossKey(label);
  if (!key) return null;
  db.prepare(`INSERT OR IGNORE INTO english_words (key, display, created_at) VALUES (?, ?, ?)`).run(
    key,
    label.trim().slice(0, 80),
    Date.now()
  );
  const row = db.prepare(`SELECT id FROM english_words WHERE key = ?`).get(key) as { id: number };
  return row.id;
}

export function searchEnglishWords(query: string, limit = 20): string[] {
  const db = englishDatabase();
  const key = glossKey(query);
  const rows = db
    .prepare(`SELECT display FROM english_words WHERE key LIKE ? ORDER BY length(key), key LIMIT ?`)
    .all(`${key}%`, limit) as { display: string }[];
  return rows.map((row) => row.display);
}

export function englishWordCount(): number {
  return (englishDatabase().prepare(`SELECT COUNT(*) AS n FROM english_words`).get() as { n: number }).n;
}

// ---------------------------------------------------------------------------
// Image index: label key → labelled image ids. Rebuilt lazily after edits.

let imageIndex: Map<string, number[]> | null = null;
let imageLabelsById: Map<number, string[]> | null = null;

function buildImageIndex(): void {
  const rows = englishDatabase()
    .prepare(
      `SELECT il.image_id AS imageId, ew.key AS key, ew.display AS display
       FROM image_labels il
       JOIN english_words ew ON ew.id = il.english_word_id
       JOIN images i ON i.id = il.image_id
       WHERE i.status = 'labeled'`
    )
    .all() as { imageId: number; key: string; display: string }[];
  imageIndex = new Map();
  imageLabelsById = new Map();
  for (const row of rows) {
    const ids = imageIndex.get(row.key) ?? [];
    ids.push(row.imageId);
    imageIndex.set(row.key, ids);
    const labels = imageLabelsById.get(row.imageId) ?? [];
    labels.push(row.display);
    imageLabelsById.set(row.imageId, labels);
  }
}

export function invalidateImageIndex(): void {
  imageIndex = null;
  imageLabelsById = null;
}

export function imagesForGlosses(glosses: string[]): number[] {
  if (!imageIndex) buildImageIndex();
  const ids = new Set<number>();
  for (const gloss of glosses) {
    for (const id of imageIndex!.get(glossKey(gloss)) ?? []) ids.add(id);
  }
  return [...ids];
}

export function imageLabels(imageId: number): string[] {
  if (!imageLabelsById) buildImageIndex();
  return imageLabelsById!.get(imageId) ?? [];
}

// ---------------------------------------------------------------------------
// Image CRUD

interface ImageDbRow {
  id: number;
  status: 'labeled' | 'pending';
  source: string | null;
  source_url: string | null;
  license: string | null;
  attribution: string | null;
  created_at: number;
  labels: string | null;
}

function toImageRow(row: ImageDbRow): ImageRow {
  return {
    id: row.id,
    status: row.status,
    source: row.source,
    sourceUrl: row.source_url,
    license: row.license,
    attribution: row.attribution,
    createdAt: row.created_at,
    labels: row.labels ? (JSON.parse(row.labels) as string[]) : [],
  };
}

const IMAGE_SELECT = `
  SELECT i.id, i.status, i.source, i.source_url, i.license, i.attribution, i.created_at,
    (SELECT json_group_array(ew.display) FROM image_labels il JOIN english_words ew ON ew.id = il.english_word_id
     WHERE il.image_id = i.id) AS labels
  FROM images i`;

export function listImages(status: string, query: string, offset: number, limit: number): Paged<ImageRow> {
  const db = englishDatabase();
  const where: string[] = [];
  const params: unknown[] = [];
  if (status === 'labeled' || status === 'pending') {
    where.push('i.status = ?');
    params.push(status);
  }
  if (query.trim()) {
    where.push(
      `EXISTS (SELECT 1 FROM image_labels il JOIN english_words ew ON ew.id = il.english_word_id WHERE il.image_id = i.id AND ew.key LIKE ?)`
    );
    params.push(`${glossKey(query)}%`);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM images i ${clause}`).get(...params) as { n: number }).n;
  const rows = db
    .prepare(`${IMAGE_SELECT} ${clause} ORDER BY i.status = 'pending' DESC, i.id DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as ImageDbRow[];
  return { rows: rows.map(toImageRow), total };
}

export function getImage(id: number): ImageRow {
  const row = englishDatabase().prepare(`${IMAGE_SELECT} WHERE i.id = ?`).get(id) as ImageDbRow | undefined;
  if (!row) throw new HttpError(404, 'Image not found');
  return toImageRow(row);
}

export function imageFile(id: number): { mime: string; data: Buffer } {
  const row = englishDatabase().prepare(`SELECT mime, data FROM images WHERE id = ?`).get(id) as
    | { mime: string; data: Buffer }
    | undefined;
  if (!row) throw new HttpError(404, 'Image not found');
  return row;
}

export function setImageLabels(id: number, labels: string[]): void {
  const db = englishDatabase();
  db.transaction(() => {
    db.prepare(`DELETE FROM image_labels WHERE image_id = ?`).run(id);
    const insert = db.prepare(`INSERT OR IGNORE INTO image_labels (image_id, english_word_id) VALUES (?, ?)`);
    for (const label of labels) {
      const wordId = englishWordId(label);
      if (wordId) insert.run(id, wordId);
    }
  })();
  invalidateImageIndex();
}

export function updateImage(id: number, update: { labels?: string[]; status?: 'labeled' | 'pending' }): ImageRow {
  getImage(id);
  if (update.labels) setImageLabels(id, update.labels.map((label) => label.trim()).filter(Boolean));
  if (update.status) {
    englishDatabase().prepare(`UPDATE images SET status = ? WHERE id = ?`).run(update.status, id);
    invalidateImageIndex();
  }
  return getImage(id);
}

export function addImage(input: {
  data: Buffer;
  mime: string;
  labels: string[];
  status: 'labeled' | 'pending';
  source?: string;
  sourceUrl?: string;
  license?: string;
  attribution?: string;
  query?: string;
}): number | null {
  if (!input.mime.startsWith('image/')) throw new HttpError(400, 'Only image files can be added');
  const db = englishDatabase();
  const result = db
    .prepare(
      `INSERT OR IGNORE INTO images (mime, data, status, source, source_url, license, attribution, query, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.mime,
      input.data,
      input.status,
      input.source ?? 'upload',
      input.sourceUrl ?? null,
      input.license ?? null,
      input.attribution ?? null,
      input.query ?? null,
      Date.now()
    );
  if (!result.changes) return null;
  const id = Number(result.lastInsertRowid);
  setImageLabels(id, input.labels);
  return id;
}

export function deleteImage(id: number): void {
  englishDatabase().prepare(`DELETE FROM images WHERE id = ?`).run(id);
  invalidateImageIndex();
}

export function imageStats(): { labeled: number; pending: number } {
  return englishDatabase()
    .prepare(
      `SELECT COUNT(*) FILTER (WHERE status = 'labeled') AS labeled, COUNT(*) FILTER (WHERE status = 'pending') AS pending FROM images`
    )
    .get() as { labeled: number; pending: number };
}

// "dog,puppy_2.jpg" → ["dog", "puppy"]
export function labelsFromFilename(name: string): string[] {
  const base = name.replace(/\.[a-z0-9]+$/i, '');
  return base
    .split(/[,;+]/)
    .map((part) => part.replace(/[_-]?\d+$/, '').replace(/[_-]+/g, ' ').trim())
    .filter(Boolean);
}
