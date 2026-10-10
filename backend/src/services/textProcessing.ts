// Turns raw book text (plain text or HTML, e.g. from Project Gutenberg) into
// word counts and clean, learnable sentences for any language.

export interface Token {
  surface: string;
  word: string; // normalised (NFC, lower-cased) form used as the dictionary key
  capitalized: boolean;
  sentenceInitial: boolean;
  // Position in the text: surface = text.slice(start, end).
  start: number;
  end: number;
}

export interface ProcessedSentence {
  text: string;
  words: string[]; // normalised tokens in order
}

export interface ProcessedText {
  tokenCount: number;
  counts: Map<string, { count: number; mid: number; cap: number }>;
  sentences: ProcessedSentence[];
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  laquo: '«',
  raquo: '»',
  iexcl: '¡',
  iquest: '¿',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === '#') {
      const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[entity.toLowerCase()] ?? match;
  });
}

export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style|head|nav|footer)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|h[1-6]|li|blockquote|tr|section|article)>/gi, '\n\n')
      .replace(/<[^>]+>/g, ' ')
  );
}

export function looksLikeHtml(text: string, contentType = ''): boolean {
  return contentType.includes('html') || /^\s*(<!doctype html|<html)/i.test(text.slice(0, 500));
}

// Removes the Project Gutenberg header/licence and typographic noise.
export function cleanBookText(raw: string): string {
  let text = raw.replace(/\r\n?/g, '\n').replace(/﻿/g, '');
  const start = text.search(/\*{3}\s*START OF (THE|THIS) PROJECT GUTENBERG[^\n]*/i);
  if (start >= 0) text = text.slice(text.indexOf('\n', start) + 1);
  const end = text.search(/\*{3}\s*END OF (THE|THIS) PROJECT GUTENBERG/i);
  if (end >= 0) text = text.slice(0, end);
  const endAlt = text.search(/End of (the )?Project Gutenberg/i);
  if (endAlt >= 0) text = text.slice(0, endAlt);
  return text
    .replace(/_/g, '')
    .replace(/[ \t]*\[[^\]\n]{0,200}\]/g, '')
    .replace(/[ \t]+/g, ' ');
}

export function paragraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\s*\n\s*/g, ' ').replace(/\s+/g, ' ').trim())
    .filter((paragraph) => paragraph.length > 0);
}

export function normalizeWord(surface: string, locale: string): string | null {
  const word = surface
    .normalize('NFC')
    .toLocaleLowerCase(locale)
    .replace(/^['’\-]+|['’\-]+$/g, '');
  if (!word || word.length > 40) return null;
  if (/\p{Nd}/u.test(word)) return null;
  if (!/\p{L}/u.test(word)) return null;
  return word;
}

function isCapitalized(surface: string, locale: string): boolean {
  const first = Array.from(surface)[0] ?? '';
  return first !== first.toLocaleLowerCase(locale) && first === first.toLocaleUpperCase(locale);
}

export function tokenize(text: string, locale: string, wordSegmenter?: Intl.Segmenter): Token[] {
  const segmenter = wordSegmenter ?? new Intl.Segmenter(locale, { granularity: 'word' });
  const tokens: Token[] = [];
  for (const part of segmenter.segment(text)) {
    if (!part.isWordLike) continue;
    const word = normalizeWord(part.segment, locale);
    if (!word) continue;
    tokens.push({
      surface: part.segment,
      word,
      capitalized: isCapitalized(part.segment, locale),
      sentenceInitial: tokens.length === 0,
      start: part.index,
      end: part.index + part.segment.length,
    });
  }
  return tokens;
}

export interface SentenceRules {
  minWords: number;
  maxWords: number;
}

function acceptableSentence(text: string, tokens: Token[], rules: SentenceRules): boolean {
  if (tokens.length < rules.minWords || tokens.length > rules.maxWords) return false;
  if (text.length > 320) return false;
  if (/\p{Nd}/u.test(text)) return false;
  if (/gutenberg|https?:|www\./i.test(text)) return false;
  // Chapter headings and other all-caps lines.
  const letters = Array.from(text).filter((char) => /\p{L}/u.test(char));
  const upper = letters.filter((char) => char !== char.toLowerCase()).length;
  if (letters.length > 0 && upper / letters.length > 0.5) return false;
  return true;
}

// Trims dangling dialogue dashes / quotes and whitespace from a sentence.
export function tidySentence(text: string): string {
  let result = text.replace(/\s+/g, ' ').trim();
  result = result.replace(/^[—–\-]+\s*/, '').replace(/\s*[—–\-]+$/, '');
  // Drop unbalanced quotes left over from dialogue spanning several sentences.
  const occurrences = (char: string) => result.split(char).length - 1;
  if (occurrences('"') % 2 === 1) result = result.replace('"', '');
  for (const [open, close] of [['«', '»'], ['“', '”'], ['‘', '’']]) {
    const opens = occurrences(open);
    const closes = occurrences(close);
    if (opens > closes && result.startsWith(open)) result = result.slice(open.length);
    else if (closes > opens && result.endsWith(close)) result = result.slice(0, -close.length);
  }
  return result.trim();
}

export function processText(raw: string, locale: string, rules: SentenceRules): ProcessedText {
  const counts = new Map<string, { count: number; mid: number; cap: number }>();
  const sentences: ProcessedSentence[] = [];
  const seen = new Set<string>();
  const sentenceSegmenter = new Intl.Segmenter(locale, { granularity: 'sentence' });
  const wordSegmenter = new Intl.Segmenter(locale, { granularity: 'word' });
  let tokenCount = 0;

  for (const paragraph of paragraphs(raw)) {
    for (const part of sentenceSegmenter.segment(paragraph)) {
      const text = tidySentence(part.segment);
      if (!text) continue;
      const tokens = tokenize(text, locale, wordSegmenter);
      for (const token of tokens) {
        tokenCount++;
        let entry = counts.get(token.word);
        if (!entry) {
          entry = { count: 0, mid: 0, cap: 0 };
          counts.set(token.word, entry);
        }
        entry.count++;
        if (!token.sentenceInitial) {
          entry.mid++;
          if (token.capitalized) entry.cap++;
        }
      }
      if (acceptableSentence(text, tokens, rules) && !seen.has(text)) {
        seen.add(text);
        sentences.push({ text, words: tokens.map((token) => token.word) });
      }
    }
  }
  return { tokenCount, counts, sentences };
}

// Minimal CSV parser (RFC 4180 quotes) for word-list imports.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const delimiter = detectDelimiter(text);
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim()));
}

function detectDelimiter(text: string): string {
  const firstLine = text.slice(0, text.indexOf('\n') >= 0 ? text.indexOf('\n') : text.length);
  const candidates = [',', '\t', ';'];
  return candidates.sort((a, b) => firstLine.split(b).length - firstLine.split(a).length)[0];
}
