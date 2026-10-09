// Language-agnostic text helpers shared by the backend (corpus processing,
// question building) and the frontend (forgiving answer evaluation).

const COMBINING_DIACRITICS = /[̀-ͯ]/g;
const PUNCTUATION = /[\p{P}\p{S}]+/gu;
const LEADING_FUNCTION_WORDS = /^(?:to|a|an|the)\s+/;

// Removes explanatory notes in parentheses or brackets ("(he/she) said",
// "el (m)", "（量词）"). They are shown to the learner but never spoken and
// never required when typing.
export function stripParentheticals(text: string): string {
  const stripped = text
    .replace(/\s*[(\[（【][^)\]）】]*[)\]）】]/g, ' ')
    .replace(/\s+([.,;:!?。，！？])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  return stripped || text.trim();
}

export function normalizeForCompare(text: string, locale?: string): string {
  return text
    .normalize('NFC')
    .toLocaleLowerCase(locale)
    .replace(PUNCTUATION, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Removes Latin-style combining accents only (é → e, ñ → n). Marks that are
// essential in other scripts (e.g. Devanagari vowel signs) are untouched.
export function stripDiacritics(text: string): string {
  return text.normalize('NFD').replace(COMBINING_DIACRITICS, '').normalize('NFC');
}

// Optimal string alignment distance (Levenshtein + adjacent transpositions).
export function editDistance(a: string, b: string): number {
  const s = Array.from(a);
  const t = Array.from(b);
  if (s.length === 0) return t.length;
  if (t.length === 0) return s.length;
  const rows = s.length + 1;
  const cols = t.length + 1;
  const d: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  for (let i = 0; i < rows; i++) d[i][0] = i;
  for (let j = 0; j < cols; j++) d[0][j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && s[i - 1] === t[j - 2] && s[i - 2] === t[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[s.length][t.length];
}

export function similarity(a: string, b: string): number {
  const length = Math.max(Array.from(a).length, Array.from(b).length);
  if (length === 0) return 1;
  return 1 - editDistance(a, b) / length;
}

// Number of typos tolerated for a word of the given length.
export function allowedTypos(length: number): number {
  if (length <= 3) return 0;
  if (length <= 7) return 1;
  return 2;
}

export function wordTokens(text: string, locale?: string): string[] {
  const Segmenter = (Intl as unknown as { Segmenter?: typeof Intl.Segmenter }).Segmenter;
  if (Segmenter) {
    const segmenter = new Segmenter(locale, { granularity: 'word' });
    const tokens: string[] = [];
    for (const part of segmenter.segment(text)) {
      if (part.isWordLike) tokens.push(part.segment);
    }
    return tokens;
  }
  return text.split(/[\s\p{P}]+/u).filter(Boolean);
}

export function normalizedTokens(text: string, locale?: string): string[] {
  return wordTokens(text, locale)
    .map((token) => normalizeForCompare(token, locale))
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// English glosses

// Splits "to say; to tell, said" into separate glosses. "/" is kept because it
// usually joins alternatives inside one gloss ("he/she said").
export function splitGlossList(text: string): string[] {
  const parts = text
    .split(/[;,|\n]/)
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  return dedupe(parts);
}

// Canonical key used to decide whether two glosses mean the same thing and to
// match image labels: "To Say (something)" → "say".
export function glossKey(text: string): string {
  const withoutParens = text.replace(/\([^)]*\)|\[[^\]]*\]/g, ' ');
  let key = normalizeForCompare(withoutParens, 'en');
  for (let i = 0; i < 2; i++) key = key.replace(LEADING_FUNCTION_WORDS, '');
  return key || normalizeForCompare(text, 'en');
}

// All the forms an English answer may reasonably take.
export function glossVariants(text: string): string[] {
  const lower = text.toLowerCase();
  const variants = new Set<string>();
  const candidates = [lower, stripParentheticals(lower), lower.replace(/[()[\]（）【】]/g, ' ')];
  for (const candidate of candidates) {
    const normalized = normalizeForCompare(candidate, 'en');
    if (!normalized) continue;
    variants.add(normalized);
    let stripped = normalized;
    for (let i = 0; i < 2; i++) {
      stripped = stripped.replace(LEADING_FUNCTION_WORDS, '');
      if (stripped) variants.add(stripped);
    }
    // "he/she said" → "he said", "she said"
    if (candidate.includes('/')) {
      const slashParts = candidate.split(/\s+/).map((w) => w.split('/'));
      if (slashParts.every((alternatives) => alternatives.length <= 3)) {
        for (const choice of [0, 1, 2]) {
          const phrase = slashParts.map((alternatives) => alternatives[Math.min(choice, alternatives.length - 1)]).join(' ');
          const normalizedPhrase = normalizeForCompare(phrase, 'en');
          if (normalizedPhrase) variants.add(normalizedPhrase);
        }
      }
    }
  }
  return [...variants];
}

export function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Forgiving answer matching

export type MatchQuality = 'exact' | 'accent' | 'typo';

export interface MatchOptions {
  locale?: string;
  side: 'foreign' | 'english';
  accentLenient: boolean;
  typoTolerance: boolean;
}

const QUALITY_RANK: Record<MatchQuality, number> = { exact: 3, accent: 2, typo: 1 };

function compareForms(input: string, expected: string, options: MatchOptions): MatchQuality | null {
  if (!input || !expected) return null;
  if (input === expected) return 'exact';
  const inputBare = stripDiacritics(input);
  const expectedBare = stripDiacritics(expected);
  if (options.accentLenient && inputBare === expectedBare) return 'accent';
  if (options.typoTolerance) {
    const a = options.accentLenient ? inputBare : input;
    const b = options.accentLenient ? expectedBare : expected;
    const budget = allowedTypos(Math.min(Array.from(a).length, Array.from(b).length));
    if (budget > 0 && editDistance(a, b) <= budget) return 'typo';
  }
  return null;
}

function forms(text: string, options: MatchOptions): string[] {
  if (options.side === 'english') return glossVariants(text);
  const variants = [text, stripParentheticals(text)].map((variant) => normalizeForCompare(variant, options.locale));
  return [...new Set(variants)].filter(Boolean);
}

// Finds the best accepted answer for a typed input.
export function bestMatch(
  input: string,
  accepted: string[],
  options: MatchOptions
): { index: number; quality: MatchQuality } | null {
  const inputForms = forms(input, options);
  let best: { index: number; quality: MatchQuality } | null = null;
  accepted.forEach((answer, index) => {
    for (const expected of forms(answer, options)) {
      for (const candidate of inputForms) {
        const quality = compareForms(candidate, expected, options);
        if (quality && (!best || QUALITY_RANK[quality] > QUALITY_RANK[best.quality])) {
          best = { index, quality };
        }
      }
    }
  });
  return best;
}

// ---------------------------------------------------------------------------
// Sentence alignment ("words closeness" metric)

export type TokenStatus = 'exact' | 'close' | 'wrong' | 'missing' | 'extra';

export interface AlignedToken {
  expected: string | null;
  actual: string | null;
  expectedIndex: number | null;
  status: TokenStatus;
  // How well a matched word matched (1 = exactly).
  weight?: number;
}

export interface Alignment {
  tokens: AlignedToken[];
  // F1-style score in [0, 1] combining precision and recall of matched words.
  score: number;
  // Status per expected token index.
  expectedStatus: TokenStatus[];
}

export interface AlignOptions {
  accentLenient: boolean;
  // Minimum character similarity for a "close" token match (typos, ASR noise).
  closeSimilarity: number;
}

function tokenWeight(expected: string, actual: string, options: AlignOptions): number {
  if (expected === actual) return 1;
  const e = stripDiacritics(expected);
  const a = stripDiacritics(actual);
  if (options.accentLenient && e === a) return 0.95;
  const sim = similarity(options.accentLenient ? e : expected, options.accentLenient ? a : actual);
  if (sim >= options.closeSimilarity && Math.min(e.length, a.length) >= 3) return 0.8;
  return 0;
}

export function alignTokens(expected: string[], actual: string[], options: AlignOptions): Alignment {
  const n = expected.length;
  const m = actual.length;
  const score: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  const weights: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const w = tokenWeight(expected[i - 1], actual[j - 1], options);
      weights[i][j] = w;
      score[i][j] = Math.max(score[i - 1][j], score[i][j - 1], w > 0 ? score[i - 1][j - 1] + w : -1);
    }
  }
  // Backtrack the matched pairs.
  const pairs: Array<[number, number]> = [];
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    const w = weights[i][j];
    if (w > 0 && Math.abs(score[i][j] - (score[i - 1][j - 1] + w)) < 1e-9) {
      pairs.push([i - 1, j - 1]);
      i--;
      j--;
    } else if (score[i - 1][j] >= score[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }
  pairs.reverse();

  const tokens: AlignedToken[] = [];
  const expectedStatus: TokenStatus[] = new Array(n).fill('missing');
  let total = 0;
  let ei = 0;
  let ai = 0;
  const flushGap = (eEnd: number, aEnd: number) => {
    // Pair unmatched tokens inside a gap as substitutions, rest are missing/extra.
    while (ei < eEnd && ai < aEnd) {
      tokens.push({ expected: expected[ei], actual: actual[ai], expectedIndex: ei, status: 'wrong' });
      expectedStatus[ei] = 'wrong';
      ei++;
      ai++;
    }
    while (ei < eEnd) {
      tokens.push({ expected: expected[ei], actual: null, expectedIndex: ei, status: 'missing' });
      expectedStatus[ei] = 'missing';
      ei++;
    }
    while (ai < aEnd) {
      tokens.push({ expected: null, actual: actual[ai], expectedIndex: null, status: 'extra' });
      ai++;
    }
  };
  for (const [pe, pa] of pairs) {
    flushGap(pe, pa);
    const w = weights[pe + 1][pa + 1];
    const status: TokenStatus = w === 1 ? 'exact' : 'close';
    tokens.push({ expected: expected[pe], actual: actual[pa], expectedIndex: pe, status, weight: w });
    expectedStatus[pe] = status;
    total += w;
    ei = pe + 1;
    ai = pa + 1;
  }
  flushGap(n, m);
  const denominator = n + m;
  return { tokens, expectedStatus, score: denominator === 0 ? 1 : (2 * total) / denominator };
}

// Best character-level similarity between any recognised alternative and any
// accepted answer, used for spoken single words.
export function spokenWordSimilarity(alternatives: string[], accepted: string[], locale?: string): number {
  let best = 0;
  for (const heard of alternatives) {
    const heardTokens = normalizedTokens(heard, locale);
    for (const answer of accepted.map(stripParentheticals)) {
      const expected = stripDiacritics(normalizeForCompare(answer, locale));
      const candidates = [heardTokens.join(' '), ...heardTokens];
      for (const candidate of candidates) {
        best = Math.max(best, similarity(stripDiacritics(candidate), expected));
      }
    }
  }
  return best;
}
