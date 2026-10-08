import { englishDatabase, languageDb } from '../db/connection.js';
import { fetchBytes, fetchJson } from '../services/http.js';
import { addImage, imagesForGlosses } from '../services/english.js';
import { parseEnglish } from '../services/words.js';
import type { JobContext } from '../services/jobs.js';
import { glossKey } from '../../../shared/text.js';

interface OpenverseImage {
  id: string;
  title: string | null;
  url: string;
  thumbnail: string | null;
  license: string;
  license_version: string | null;
  creator: string | null;
  foreign_landing_url: string | null;
}

// Parts of speech that can be pictured. Words without a known part of speech
// are tried too; function words rarely get good results and can be rejected
// in the labelling queue.
const PICTURABLE = /noun|verb|adjective|adverb|numeral|interjection/i;
const NOT_PICTURABLE = /pronoun|preposition|conjunction|determiner|article|particle|contraction/i;

export async function searchOpenverse(query: string, count: number): Promise<OpenverseImage[]> {
  const params = new URLSearchParams({ q: query, page_size: String(Math.max(count, 5)), mature: 'false' });
  const data = await fetchJson<{ results: OpenverseImage[] }>(`https://api.openverse.org/v1/images/?${params}`, {
    timeoutMs: 30_000,
  });
  return data.results.slice(0, count);
}

// Finds candidate pictures (openly licensed, from Openverse) for the most
// frequent words that have none yet. They land in the labelling queue where
// the user confirms or edits the English labels.
export async function suggestImages(langId: string, options: { words: number; perWord: number }, ctx: JobContext): Promise<string> {
  const db = languageDb(langId);
  const rows = db
    .prepare(
      `SELECT word, english, pos FROM words WHERE active = 1 AND rank IS NOT NULL AND english IS NOT NULL ORDER BY rank LIMIT ?`
    )
    .all(options.words * 4) as { word: string; english: string; pos: string | null }[];
  const pendingQueries = new Set(
    (englishDatabase().prepare(`SELECT DISTINCT query FROM images WHERE query IS NOT NULL`).all() as { query: string }[]).map(
      (row) => row.query
    )
  );
  const targets: string[] = [];
  for (const row of rows) {
    if (targets.length >= options.words) break;
    if (row.pos && (NOT_PICTURABLE.test(row.pos) || !PICTURABLE.test(row.pos))) continue;
    const glosses = parseEnglish(row.english);
    if (glosses.length === 0 || imagesForGlosses(glosses).length > 0) continue;
    const query = glossKey(glosses[0]);
    if (!query || query.split(' ').length > 3 || pendingQueries.has(query) || targets.includes(query)) continue;
    targets.push(query);
  }
  if (targets.length === 0) return 'Every frequent picturable word already has images or suggestions';
  let added = 0;
  const failures: string[] = [];
  for (let i = 0; i < targets.length; i++) {
    ctx.checkCancelled();
    ctx.progress(i, targets.length, `Searching pictures for "${targets[i]}"…`);
    try {
      const results = await searchOpenverse(targets[i], options.perWord);
      for (const result of results) {
        const source = result.thumbnail ?? result.url;
        try {
          const file = await fetchBytes(source, { timeoutMs: 30_000 });
          if (!file.contentType.startsWith('image/')) continue;
          const license = `${result.license.toUpperCase()}${result.license_version ? ` ${result.license_version}` : ''}`;
          const id = addImage({
            data: file.data,
            mime: file.contentType.split(';')[0],
            labels: [targets[i]],
            status: 'pending',
            source: 'openverse',
            sourceUrl: result.foreign_landing_url ?? result.url,
            license,
            attribution: [result.title, result.creator].filter(Boolean).join(' — ') || undefined,
            query: targets[i],
          });
          if (id) added++;
        } catch (error) {
          failures.push((error as Error).message);
        }
      }
    } catch (error) {
      failures.push((error as Error).message);
      if (failures.length >= 3 && added === 0) throw new Error(`Image search failed: ${failures[0]}`);
    }
  }
  ctx.progress(targets.length, targets.length);
  return `Added ${added} pictures to the labelling queue for ${targets.length} words`;
}
