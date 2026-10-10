import { IPA_SOUNDS } from './inventory.js';

// Comparing IPA transcriptions. Differences that are not mistakes are
// ignored: slashes and brackets, stress and syllable marks, tie bars, spaces,
// "g" for "ɡ" and ":" for "ː".

export function normalizeIpa(text: string): string {
  return text
    .normalize('NFC')
    .replace(/[/[\]\s.ˈˌ'"‿͜͡]/g, '')
    .replace(/g/g, 'ɡ')
    .replace(/:/g, 'ː');
}

// Looser still: vowel length, ʌ / ə, r-coloured vowels written with ɹ, dark l.
export function looseIpa(text: string): string {
  return normalizeIpa(text)
    .replace(/[ːˑ]/g, '')
    .replace(/ɚ/g, 'əɹ')
    .replace(/ɝ/g, 'ɜɹ')
    .replace(/ʌ/g, 'ə')
    .replace(/ɫ/g, 'l')
    .replace(/r/g, 'ɹ');
}

// Diacritics and modifier letters (ʰ ʲ ʷ ː ̃ ̩ …) belong to the sound before them.
const MODIFIER = /[̀-ͯʰ-˿ᴬ-ᵪᶛ-ᶿ⁰-₟]/u;
const SYMBOLS = IPA_SOUNDS.map((sound) => sound.symbol).sort((a, b) => b.length - a.length);

// "ˈtʃɝtʃ" → ["tʃ", "ɝ", "tʃ"]; "ʃøːn" → ["ʃ", "øː", "n"].
export function segmentIpa(text: string): string[] {
  const clean = normalizeIpa(text);
  const segments: string[] = [];
  let i = 0;
  while (i < clean.length) {
    const char = String.fromCodePoint(clean.codePointAt(i)!);
    if (MODIFIER.test(char) && segments.length) {
      segments[segments.length - 1] += char;
      i += char.length;
      continue;
    }
    const symbol = SYMBOLS.find((candidate) => clean.startsWith(candidate, i));
    const segment = symbol ?? char;
    segments.push(segment);
    i += segment.length;
  }
  return segments;
}

// The sound of a segment without its diacritics ("øː" → "ø").
export function baseSound(segment: string): string {
  return Array.from(segment)
    .filter((char) => !MODIFIER.test(char))
    .join('');
}

export type SegmentStatus = 'exact' | 'close' | 'missing';

export interface IpaComparison {
  correct: boolean;
  exact: boolean;
  score: number;
  // One entry per sound of the expected transcription.
  segments: { segment: string; status: SegmentStatus }[];
  extra: string[];
}

// Compares a typed transcription with the expected one, sound by sound
// (longest common subsequence of the sounds).
export function compareIpa(expected: string, typed: string): IpaComparison {
  const a = segmentIpa(expected);
  const b = segmentIpa(typed);
  const baseA = a.map(baseSound);
  const baseB = b.map(baseSound);
  const table = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i][j] = baseA[i] === baseB[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const segments: IpaComparison['segments'] = a.map((segment) => ({ segment, status: 'missing' as SegmentStatus }));
  const used = new Array<boolean>(b.length).fill(false);
  for (let i = 0, j = 0; i < a.length && j < b.length; ) {
    if (baseA[i] === baseB[j]) {
      segments[i].status = a[i] === b[j] ? 'exact' : 'close';
      used[j] = true;
      i++;
      j++;
    } else if (table[i + 1][j] >= table[i][j + 1]) i++;
    else j++;
  }
  const matched = table[0][0];
  const score = a.length + b.length === 0 ? 1 : (2 * matched) / (a.length + b.length);
  const exact = normalizeIpa(expected) === normalizeIpa(typed);
  return {
    correct: exact || looseIpa(expected) === looseIpa(typed),
    exact,
    score,
    segments,
    extra: b.filter((_, index) => !used[index]),
  };
}

// The sounds of the inventory a transcription contains (each once).
export function soundsIn(text: string): string[] {
  const known = new Set(SYMBOLS);
  return [...new Set(segmentIpa(text).map(baseSound).filter((sound) => known.has(sound)))];
}

// A transcription split into sounds and everything else (stress marks,
// syllable dots, spaces), keeping the text as written.
function ipaTokens(text: string): { text: string; sound: boolean }[] {
  const source = text.normalize('NFC');
  const tokens: { text: string; sound: boolean }[] = [];
  let i = 0;
  while (i < source.length) {
    const char = String.fromCodePoint(source.codePointAt(i)!);
    const last = tokens[tokens.length - 1];
    if (MODIFIER.test(char) && last?.sound) {
      last.text += char;
      i += char.length;
      continue;
    }
    const symbol = SYMBOLS.find((candidate) => source.startsWith(candidate, i));
    const piece = symbol ?? char;
    tokens.push({ text: piece, sound: !/[/[\]\s.ˈˌ'"‿͜͡]/u.test(piece) });
    i += piece.length;
  }
  return tokens;
}

// Replaces every occurrence of a sound in a transcription (its diacritics
// stay): replaceSound("ˈθɪŋk", "θ", "ð") → "ˈðɪŋk".
export function replaceSound(text: string, symbol: string, replacement: string): string {
  return ipaTokens(text)
    .map((token) => (token.sound && baseSound(token.text) === symbol ? replacement + token.text.slice(symbol.length) : token.text))
    .join('');
}

// The transcription with a sound left out: blankSound("θɪn", "θ") → "_ɪn".
export function blankSound(text: string, symbol: string, blank = '_'): string {
  return replaceSound(text, symbol, blank);
}

// Cleans a pronunciation from a dictionary: the first transcription, without
// slashes or brackets ("/ˈpe.ro/, /ˈpero/" → "ˈpe.ro").
export function firstTranscription(text: string): string {
  return text
    .split(/[,;~]|\bor\b/)[0]
    .replace(/[/[\]]/g, '')
    .trim();
}

// Does a pronunciation look like IPA (not pinyin, kana or a respelling)?
export function looksLikeIpa(text: string): boolean {
  const clean = normalizeIpa(text);
  if (!clean || /[A-Z0-9]/.test(clean) || /[぀-ヿ一-鿿가-힯]/u.test(clean)) return false;
  // Tone-marked vowels are pinyin ("xué").
  if (/[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/.test(clean)) return false;
  return segmentIpa(clean).some((segment) => SYMBOLS.includes(baseSound(segment)));
}

// A transcription as shown: IPA ɡ for g, ː for a colon, no slashes or brackets.
export function tidyIpa(text: string): string {
  return text.normalize('NFC').replace(/[/[\]]/g, '').replace(/g/g, 'ɡ').replace(/:/g, 'ː').trim();
}
