import type { DB } from '../db/connection.js';
import { invalidateGlossIndex } from './glossIndex.js';
import { fillChinesePinyin, isChinese } from './chinese.js';
import type { LanguageConfig } from '../../../shared/types.js';

// Frequency score, in occurrences per million words:
// - 'equal' (default): sum over sources of (per-million frequency × weight), so
//   every source counts the same regardless of its length and a curated word
//   list can be mixed with books;
// - 'size': all sources are pooled, so longer texts count more (× weight).
function recomputeTotals(db: DB, config: LanguageConfig): void {
  db.exec(`UPDATE words SET count = 0, mid_count = 0, cap_count = 0, score = 0`);
  const pooled = config.sourceWeighting === 'size';
  const totalTokens = pooled
    ? (db.prepare(`SELECT MAX(COALESCE(SUM(token_count * weight), 0), 1) AS n FROM sources`).get() as { n: number }).n
    : 1;
  const score = pooled
    ? `SUM(ws.count * s.weight) * 1000000.0 / ${Number(totalTokens)}`
    : `SUM(ws.count * 1000000.0 / MAX(s.token_count, 1) * s.weight)`;
  db.exec(`
    UPDATE words SET count = t.count, mid_count = t.mid, cap_count = t.cap, score = t.score
    FROM (
      SELECT ws.word_id,
             SUM(ws.count) AS count,
             SUM(ws.mid_count) AS mid,
             SUM(ws.cap_count) AS cap,
             ${score} AS score
      FROM word_sources ws JOIN sources s ON s.id = ws.source_id
      GROUP BY ws.word_id
    ) AS t
    WHERE t.word_id = words.id
  `);
}

// Words written with a capital letter in the middle of sentences almost every
// time are names (Sancho, Madrid...). They are excluded from learning unless
// the user includes them manually.
function recomputeProperNouns(db: DB, config: LanguageConfig): void {
  db.prepare(
    `UPDATE words SET proper_noun = CASE
       WHEN ? = 1 AND has_case = 1 AND mid_count >= 3 AND cap_count >= 0.9 * mid_count THEN 1
       ELSE 0 END`
  ).run(config.detectProperNouns ? 1 : 0);
}

function capitalize(word: string, locale: string): string {
  const [first, ...rest] = Array.from(word);
  return (first ?? '').toLocaleUpperCase(locale) + rest.join('');
}

// Display form: words that are mostly capitalised mid-sentence (German nouns)
// are shown capitalised.
function recomputeDisplay(db: DB, config: LanguageConfig): void {
  const rows = db
    .prepare(`SELECT id, word, display, has_case, mid_count, cap_count FROM words`)
    .all() as { id: number; word: string; display: string; has_case: number; mid_count: number; cap_count: number }[];
  const update = db.prepare(`UPDATE words SET display = ? WHERE id = ?`);
  for (const row of rows) {
    const display =
      row.has_case && row.mid_count > 0 && row.cap_count * 2 > row.mid_count ? capitalize(row.word, config.locale) : row.word;
    if (display !== row.display) update.run(display, row.id);
  }
}

export function recomputeRanks(db: DB): void {
  invalidateGlossIndex();
  db.exec(`
    UPDATE words SET active = CASE WHEN user_excluded IS NOT NULL THEN 1 - user_excluded ELSE 1 - proper_noun END;
    UPDATE words SET rank = NULL WHERE rank IS NOT NULL;
    UPDATE words SET rank = r.rn
    FROM (SELECT id, ROW_NUMBER() OVER (ORDER BY score DESC, count DESC, id ASC) AS rn FROM words WHERE active = 1) AS r
    WHERE r.id = words.id;
    UPDATE sentences SET max_rank = (
      SELECT MAX(w.rank) FROM sentence_words sw JOIN words w ON w.id = sw.word_id
      WHERE sw.sentence_id = sentences.id AND w.active = 1
    );
  `);
}

// How many (translated) sentences contain each word. Recite and translate
// minigames are only offered for words that have sentences. Sentences taken
// out of the questions do not count.
export function refreshSentenceCounts(db: DB, wordIds?: number[]): void {
  const sql = `
    UPDATE words SET
      sentence_count = (
        SELECT COUNT(DISTINCT sw.sentence_id) FROM sentence_words sw JOIN sentences s ON s.id = sw.sentence_id
        WHERE sw.word_id = words.id AND s.excluded_reason IS NULL
      ),
      translated_sentence_count = (
        SELECT COUNT(DISTINCT sw.sentence_id) FROM sentence_words sw JOIN sentences s ON s.id = sw.sentence_id
        WHERE sw.word_id = words.id AND s.english IS NOT NULL AND s.excluded_reason IS NULL
      )`;
  if (wordIds) {
    if (wordIds.length === 0) return;
    db.prepare(`${sql} WHERE id IN (SELECT value FROM json_each(?))`).run(JSON.stringify(wordIds));
  } else {
    db.exec(sql);
  }
}

export function wordIdsOfSentences(db: DB, sentenceIds: number[]): number[] {
  if (sentenceIds.length === 0) return [];
  const rows = db
    .prepare(`SELECT DISTINCT word_id FROM sentence_words WHERE sentence_id IN (SELECT value FROM json_each(?))`)
    .all(JSON.stringify(sentenceIds)) as { word_id: number }[];
  return rows.map((row) => row.word_id);
}

export function recomputeAll(db: DB, config: LanguageConfig): void {
  db.transaction(() => {
    recomputeTotals(db, config);
    recomputeProperNouns(db, config);
    recomputeDisplay(db, config);
    recomputeRanks(db);
    refreshSentenceCounts(db);
    if (isChinese(config)) fillChinesePinyin(db);
  })();
}
