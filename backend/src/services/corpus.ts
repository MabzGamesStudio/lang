import { HttpError, languageDb, type DB } from '../db/connection.js';
import { getLanguageConfig } from './languages.js';
import { cleanBookText, normalizeWord, parseCsv, processText } from './textProcessing.js';
import { recomputeAll, recomputeRanks } from './ranking.js';
import { addGlosses } from './glosses.js';
import { downloadBook, searchGutenberg } from './gutenberg.js';
import { registerEnglishWords } from './english.js';
import { yieldToEventLoop, type JobContext } from './jobs.js';
import { splitGlossList, dedupe } from '../../../shared/text.js';
import type { SourceRow } from '../../../shared/types.js';

export interface ImportSummary {
  sourceId: number;
  title: string;
  tokens: number;
  uniqueWords: number;
  sentencesAdded: number;
}

function hasCase(word: string, locale: string): number {
  return word.toLocaleUpperCase(locale) !== word ? 1 : 0;
}

export function wordIdFor(db: DB, word: string, locale: string): number {
  db.prepare(`INSERT INTO words (word, display, has_case) VALUES (?, ?, ?) ON CONFLICT(word) DO NOTHING`).run(
    word,
    word,
    hasCase(word, locale)
  );
  return (db.prepare(`SELECT id FROM words WHERE word = ?`).get(word) as { id: number }).id;
}

// Adds a text (a book, an article, pasted text) as a source: word counts go
// into the frequency database and clean sentences into the sentence database.
export async function importText(
  langId: string,
  input: { kind: SourceRow['kind']; title: string; url?: string | null; text: string },
  ctx?: JobContext
): Promise<ImportSummary> {
  const db = languageDb(langId);
  const config = getLanguageConfig(db);
  ctx?.message(`Splitting "${input.title}" into words and sentences…`);
  await yieldToEventLoop();
  const processed = processText(cleanBookText(input.text), config.locale, {
    minWords: config.minSentenceWords,
    maxWords: config.maxSentenceWords,
  });
  if (processed.tokenCount === 0) throw new HttpError(400, 'No words were found in this text');
  ctx?.checkCancelled();
  ctx?.message(`Saving ${processed.counts.size} words and ${processed.sentences.length} sentences…`);
  await yieldToEventLoop();

  let sourceId = 0;
  let sentencesAdded = 0;
  db.transaction(() => {
    sourceId = Number(
      db
        .prepare(
          `INSERT INTO sources (kind, title, url, token_count, sentence_count, word_count, weight, added_at)
           VALUES (?, ?, ?, ?, 0, ?, 1, ?)`
        )
        .run(input.kind, input.title, input.url ?? null, processed.tokenCount, processed.counts.size, Date.now())
        .lastInsertRowid
    );
    const ids = new Map<string, number>();
    const insertCount = db.prepare(
      `INSERT INTO word_sources (word_id, source_id, count, mid_count, cap_count) VALUES (?, ?, ?, ?, ?)`
    );
    for (const [word, counts] of processed.counts) {
      const id = wordIdFor(db, word, config.locale);
      ids.set(word, id);
      insertCount.run(id, sourceId, counts.count, counts.mid, counts.cap);
    }
    const insertSentence = db.prepare(`INSERT OR IGNORE INTO sentences (text, source_id, word_count) VALUES (?, ?, ?)`);
    const insertSentenceWord = db.prepare(`INSERT INTO sentence_words (sentence_id, position, word_id) VALUES (?, ?, ?)`);
    for (const sentence of processed.sentences) {
      const result = insertSentence.run(sentence.text, sourceId, sentence.words.length);
      if (!result.changes) continue;
      const sentenceId = Number(result.lastInsertRowid);
      sentence.words.forEach((word, position) => insertSentenceWord.run(sentenceId, position, ids.get(word)!));
      sentencesAdded++;
    }
    db.prepare(`UPDATE sources SET sentence_count = ? WHERE id = ?`).run(sentencesAdded, sourceId);
  })();

  ctx?.message('Re-ranking words by frequency…');
  await yieldToEventLoop();
  recomputeAll(db, config);
  return {
    sourceId,
    title: input.title,
    tokens: processed.tokenCount,
    uniqueWords: processed.counts.size,
    sentencesAdded,
  };
}

export async function importUrl(langId: string, url: string, title: string | undefined, ctx?: JobContext): Promise<ImportSummary> {
  const db = languageDb(langId);
  ctx?.message(`Downloading ${url}…`);
  const book = await downloadBook(url);
  const existing = db.prepare(`SELECT id FROM sources WHERE url = ?`).get(book.url);
  if (existing) throw new HttpError(409, `This book was already added (${book.url})`);
  return importText(langId, { kind: 'book', title: title?.trim() || book.title, url: book.url, text: book.text }, ctx);
}

export function importedUrls(langId: string): Set<string> {
  const rows = languageDb(langId).prepare(`SELECT url FROM sources WHERE url IS NOT NULL`).all() as { url: string }[];
  return new Set(rows.map((row) => row.url));
}

// One click: import the most popular public-domain books of the language.
export async function importTopGutenbergBooks(langId: string, count: number, ctx: JobContext): Promise<string> {
  const config = getLanguageConfig(languageDb(langId));
  ctx.message(`Searching Project Gutenberg for ${config.name} books…`);
  const queue: { title: string; url: string }[] = [];
  for (let page = 1; queue.length < count && page <= 5; page++) {
    const { books, hasMore } = await searchGutenberg(config.code, '', page, importedUrls(langId));
    for (const book of books) {
      if (!book.imported && book.textUrl && queue.length < count) queue.push({ title: book.title, url: book.textUrl });
    }
    if (!hasMore) break;
  }
  if (queue.length === 0) return `No new ${config.name} books found on Project Gutenberg`;
  const lines: string[] = [];
  for (let i = 0; i < queue.length; i++) {
    ctx.checkCancelled();
    ctx.progress(i, queue.length, `Importing "${queue[i].title}" (${i + 1}/${queue.length})…`);
    try {
      const summary = await importUrl(langId, queue[i].url, queue[i].title, ctx);
      lines.push(`${summary.title}: ${summary.uniqueWords} words, ${summary.sentencesAdded} sentences`);
    } catch (error) {
      lines.push(`${queue[i].title}: failed (${(error as Error).message})`);
    }
    ctx.progress(i + 1, queue.length);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Word lists (CSV): word, english, count/rank, pronunciation, part of speech

const NO_SPACE_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;

const COLUMN_ALIASES: Record<string, string[]> = {
  word: ['word', 'foreign', 'foreign_value', 'term', 'lemma', 'token'],
  english: ['english', 'english_value', 'translation', 'meaning', 'definition', 'gloss'],
  count: ['count', 'frequency', 'freq', 'occurrences'],
  rank: ['rank', 'position'],
  pronunciation: ['pronunciation', 'ipa', 'phonetic'],
  pos: ['pos', 'part of speech', 'part_of_speech', 'type'],
};

export async function importWordList(
  langId: string,
  input: { title: string; csv: string },
  ctx?: JobContext
): Promise<ImportSummary> {
  const db = languageDb(langId);
  const config = getLanguageConfig(db);
  const rows = parseCsv(input.csv);
  if (rows.length === 0) throw new HttpError(400, 'The word list is empty');

  const header = rows[0].map((cell) => cell.trim().toLowerCase());
  const columns: Record<string, number> = {};
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    const index = header.findIndex((cell) => aliases.includes(cell));
    if (index >= 0) columns[field] = index;
  }
  const hasHeader = columns.word !== undefined;
  if (!hasHeader) {
    columns.word = 0;
    if (rows[0].length > 1) columns.english = 1;
  }
  const dataRows = hasHeader ? rows.slice(1) : rows;
  const segmenter = new Intl.Segmenter(config.locale, { granularity: 'word' });

  interface Entry {
    word: string;
    english: string[];
    count: number | null;
    rank: number;
    pronunciation: string | null;
    pos: string | null;
  }
  const entries = new Map<string, Entry>();
  dataRows.forEach((row, index) => {
    const raw = (row[columns.word] ?? '').trim();
    const parts = [...segmenter.segment(raw)].filter((part) => part.isWordLike);
    let surface: string | null = parts.length === 1 ? parts[0].segment : null;
    // Scripts written without spaces: a list entry like 一模一样 is one word
    // even if the segmenter would split it.
    if (parts.length > 1 && !/\s/.test(raw) && NO_SPACE_SCRIPT.test(raw)) surface = parts.map((part) => part.segment).join('');
    if (!surface) return;
    const word = normalizeWord(surface, config.locale);
    if (!word) return;
    const english = columns.english !== undefined ? splitGlossList(row[columns.english] ?? '') : [];
    const countValue = columns.count !== undefined ? Number(row[columns.count]) : NaN;
    const rankValue = columns.rank !== undefined ? Number(row[columns.rank]) : NaN;
    const existing = entries.get(word);
    if (existing) {
      existing.english = dedupe([...existing.english, ...english]);
      if (Number.isFinite(countValue)) existing.count = (existing.count ?? 0) + countValue;
      return;
    }
    entries.set(word, {
      word,
      english,
      count: Number.isFinite(countValue) && countValue > 0 ? countValue : null,
      rank: Number.isFinite(rankValue) && rankValue > 0 ? rankValue : index + 1,
      pronunciation: columns.pronunciation !== undefined ? row[columns.pronunciation]?.trim() || null : null,
      pos: columns.pos !== undefined ? row[columns.pos]?.trim() || null : null,
    });
  });
  if (entries.size === 0) throw new HttpError(400, 'No usable words were found in the word list');

  // Lists without counts get Zipf-law estimates from their order.
  const values = [...entries.values()];
  const realCounts = values.every((entry) => entry.count !== null);
  for (const entry of values) {
    if (!realCounts) entry.count = Math.max(1, Math.round(100_000 / entry.rank));
  }
  const tokenCount = values.reduce((sum, entry) => sum + (entry.count ?? 0), 0);
  ctx?.message(`Saving ${values.length} words…`);
  await yieldToEventLoop();

  let sourceId = 0;
  const glosses: string[] = [];
  db.transaction(() => {
    sourceId = Number(
      db
        .prepare(
          `INSERT INTO sources (kind, title, url, token_count, sentence_count, word_count, weight, added_at)
           VALUES ('wordlist', ?, NULL, ?, 0, ?, 1, ?)`
        )
        .run(input.title, tokenCount, values.length, Date.now()).lastInsertRowid
    );
    const insertCount = db.prepare(`INSERT INTO word_sources (word_id, source_id, count) VALUES (?, ?, ?)`);
    const definitionSource = `word list: ${input.title}`;
    const setPronunciation = db.prepare(`UPDATE words SET pronunciation = ? WHERE id = ? AND pronunciation IS NULL`);
    const setPos = db.prepare(`UPDATE words SET pos = ? WHERE id = ? AND pos IS NULL`);
    for (const entry of values) {
      const id = wordIdFor(db, entry.word, config.locale);
      insertCount.run(id, sourceId, Math.round(entry.count ?? 1));
      if (entry.english.length) {
        // Added to any meanings the word already has, with the list as source.
        addGlosses(db, id, entry.english, definitionSource);
        glosses.push(...entry.english);
      }
      if (entry.pronunciation) setPronunciation.run(entry.pronunciation, id);
      if (entry.pos) setPos.run(entry.pos, id);
    }
  })();
  registerEnglishWords(glosses);
  recomputeAll(db, config);
  return { sourceId, title: input.title, tokens: tokenCount, uniqueWords: values.length, sentencesAdded: 0 };
}

// ---------------------------------------------------------------------------
// Source management

export function listSources(langId: string): SourceRow[] {
  const rows = languageDb(langId)
    .prepare(
      `SELECT id, kind, title, url, token_count AS tokenCount, sentence_count AS sentenceCount,
              word_count AS wordCount, weight, added_at AS addedAt
       FROM sources ORDER BY added_at`
    )
    .all() as SourceRow[];
  return rows;
}

export function updateSource(langId: string, sourceId: number, update: { title?: string; weight?: number }): void {
  const db = languageDb(langId);
  if (update.title !== undefined) db.prepare(`UPDATE sources SET title = ? WHERE id = ?`).run(update.title, sourceId);
  if (update.weight !== undefined) {
    const weight = Math.max(0, Math.min(100, Number(update.weight) || 0));
    db.prepare(`UPDATE sources SET weight = ? WHERE id = ?`).run(weight, sourceId);
    recomputeAll(db, getLanguageConfig(db));
  }
}

export function deleteSource(langId: string, sourceId: number): void {
  const db = languageDb(langId);
  db.transaction(() => {
    db.prepare(`DELETE FROM sources WHERE id = ?`).run(sourceId);
    // Forget words that no longer appear anywhere and were never studied or edited.
    db.exec(`
      DELETE FROM words
      WHERE id NOT IN (SELECT word_id FROM word_sources)
        AND id NOT IN (SELECT word_id FROM sentence_words)
        AND first_seen_at IS NULL AND english IS NULL AND user_excluded IS NULL
    `);
  })();
  recomputeAll(db, getLanguageConfig(db));
}

// Re-applies proper noun detection, ranking and sentence statistics, e.g.
// after the language configuration changed.
export function rebuildStatistics(langId: string): void {
  const db = languageDb(langId);
  recomputeAll(db, getLanguageConfig(db));
}

export function setWordExclusion(db: DB, wordId: number, excluded: boolean | null): void {
  db.prepare(`UPDATE words SET user_excluded = ? WHERE id = ?`).run(excluded === null ? null : excluded ? 1 : 0, wordId);
  recomputeRanks(db);
}
