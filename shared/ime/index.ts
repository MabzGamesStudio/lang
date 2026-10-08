import type { InputMethod } from '../types.js';
import { phoneticScheme } from './transliterate.js';
import { katakanaToHiragana } from './kana.js';

export type ResolvedInputMethod = Exclude<InputMethod, 'auto'>;

export const INPUT_METHOD_LABELS: Record<InputMethod, string> = {
  auto: 'Automatic',
  system: 'System keyboard only',
  letters: 'Letter buttons on screen',
  phonetic: 'Phonetic (type Latin letters, get the script)',
  pinyin: 'Pinyin (Chinese)',
  japanese: 'Romaji → kana / kanji (Japanese)',
  hangul: 'Korean 2-set keyboard',
};

// "auto" picks the best method for the language.
export function resolveInputMethod(method: InputMethod, code: string): ResolvedInputMethod {
  const base = code.toLowerCase().split('-')[0];
  if (method === 'phonetic' && !phoneticScheme(base)) return 'letters';
  if (method !== 'auto') return method;
  if (base === 'zh') return 'pinyin';
  if (base === 'ja') return 'japanese';
  if (base === 'ko') return 'hangul';
  if (phoneticScheme(base)) return 'phonetic';
  return 'letters';
}

// Methods that turn several keystrokes into text in another script.
export function isComposingMethod(method: ResolvedInputMethod): boolean {
  return method === 'phonetic' || method === 'pinyin' || method === 'japanese' || method === 'hangul';
}

// ---------------------------------------------------------------------------
// Candidate search for the pinyin / kana input methods

export interface PreparedEntry {
  text: string;
  full: string; // "xuesheng" (pinyin) or "がくせい" (kana)
  initials: string; // "xs" for pinyin, empty otherwise
  rank: number;
}

export function prepareEntries(entries: [string, string, number][], method: 'pinyin' | 'japanese'): PreparedEntry[] {
  return entries.map(([text, key, rank]) => {
    if (method === 'pinyin') {
      const syllables = key.toLowerCase().split("'").filter(Boolean);
      return { text, full: syllables.join(''), initials: syllables.map((s) => s[0]).join(''), rank };
    }
    return { text, full: katakanaToHiragana(key).replace(/\s+/g, ''), initials: '', rank };
  });
}

// Words matching what was typed: exact matches first, then completions, then
// (for pinyin) initials such as "xs" for 学生; most frequent first.
export function searchCandidates(entries: PreparedEntry[], typed: string, limit = 60): string[] {
  const query = typed.toLowerCase().replace(/ü/g, 'v').replace(/'/g, '');
  if (!query) return [];
  const scored: { text: string; score: number; rank: number }[] = [];
  for (const entry of entries) {
    let score = -1;
    if (entry.full === query) score = 0;
    else if (entry.full.startsWith(query)) score = 1;
    else if (query.length >= 2 && entry.initials === query) score = 2;
    else if (query.length >= 2 && entry.initials.length > query.length && entry.initials.startsWith(query)) score = 3;
    if (score >= 0) scored.push({ text: entry.text, score, rank: entry.rank });
  }
  scored.sort((a, b) => a.score - b.score || a.rank - b.rank || a.text.length - b.text.length);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const candidate of scored) {
    if (seen.has(candidate.text)) continue;
    seen.add(candidate.text);
    result.push(candidate.text);
    if (result.length >= limit) break;
  }
  return result;
}

export function pinyinConsumes(key: string): boolean {
  return /^[a-zA-Z']$/.test(key);
}
