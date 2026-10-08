// Phonetic typing: Latin keystrokes are turned into another script as you
// type ("privet" → "привет"). Longest match wins, so "sh" gives ш while "s"
// alone gives с. Type "|" between letters to keep them apart ("s|h" → сх).

export interface PhoneticScheme {
  id: string;
  name: string;
  rules: [string, string][];
  // Optional clean-up of the converted text (e.g. Greek final sigma).
  post?: (text: string) => string;
  // Converter that cannot be expressed as simple rules (Devanagari).
  convert?: (raw: string) => string;
}

const SEPARATOR = '|';

const RUSSIAN: [string, string][] = [
  ['a', 'а'], ['b', 'б'], ['v', 'в'], ['g', 'г'], ['d', 'д'], ['e', 'е'], ['yo', 'ё'], ['jo', 'ё'],
  ['zh', 'ж'], ['z', 'з'], ['i', 'и'], ['j', 'й'], ['k', 'к'], ['l', 'л'], ['m', 'м'], ['n', 'н'],
  ['o', 'о'], ['p', 'п'], ['r', 'р'], ['s', 'с'], ['t', 'т'], ['u', 'у'], ['f', 'ф'], ['h', 'х'],
  ['x', 'х'], ['c', 'ц'], ['ch', 'ч'], ['sh', 'ш'], ['shch', 'щ'], ['shh', 'щ'], ['sch', 'щ'], ['w', 'щ'],
  ['#', 'ъ'], ["''", 'ъ'], ['y', 'ы'], ["'", 'ь'], ['je', 'э'], ["e'", 'э'], ['yu', 'ю'], ['ju', 'ю'],
  ['ya', 'я'], ['ja', 'я'], ['q', 'я'],
];

const UKRAINIAN: [string, string][] = [
  ['a', 'а'], ['b', 'б'], ['v', 'в'], ['h', 'г'], ['g', 'ґ'], ['d', 'д'], ['e', 'е'], ['ye', 'є'],
  ['je', 'є'], ['zh', 'ж'], ['z', 'з'], ['y', 'и'], ['i', 'і'], ['yi', 'ї'], ['ji', 'ї'], ['j', 'й'],
  ['k', 'к'], ['l', 'л'], ['m', 'м'], ['n', 'н'], ['o', 'о'], ['p', 'п'], ['r', 'р'], ['s', 'с'],
  ['t', 'т'], ['u', 'у'], ['f', 'ф'], ['kh', 'х'], ['x', 'х'], ['c', 'ц'], ['ch', 'ч'], ['sh', 'ш'],
  ['shch', 'щ'], ['w', 'щ'], ["'", 'ь'], ["''", 'ʼ'], ['yu', 'ю'], ['ju', 'ю'], ['ya', 'я'],
  ['ja', 'я'], ['q', 'я'],
];

const BULGARIAN: [string, string][] = [
  ['a', 'а'], ['b', 'б'], ['v', 'в'], ['g', 'г'], ['d', 'д'], ['e', 'е'], ['zh', 'ж'], ['z', 'з'],
  ['i', 'и'], ['j', 'й'], ['k', 'к'], ['l', 'л'], ['m', 'м'], ['n', 'н'], ['o', 'о'], ['p', 'п'],
  ['r', 'р'], ['s', 'с'], ['t', 'т'], ['u', 'у'], ['f', 'ф'], ['h', 'х'], ['x', 'х'], ['c', 'ц'],
  ['ch', 'ч'], ['sh', 'ш'], ['sht', 'щ'], ['w', 'щ'], ['y', 'ъ'], ["'", 'ь'], ['yu', 'ю'],
  ['ju', 'ю'], ['ya', 'я'], ['ja', 'я'], ['q', 'я'],
];

// Serbian: the Latin alphabet maps one-to-one onto Cyrillic.
const SERBIAN: [string, string][] = [
  ['a', 'а'], ['b', 'б'], ['v', 'в'], ['g', 'г'], ['d', 'д'], ['đ', 'ђ'], ['dj', 'ђ'], ['e', 'е'],
  ['ž', 'ж'], ['zh', 'ж'], ['z', 'з'], ['i', 'и'], ['j', 'ј'], ['k', 'к'], ['l', 'л'], ['lj', 'љ'],
  ['m', 'м'], ['n', 'н'], ['nj', 'њ'], ['o', 'о'], ['p', 'п'], ['r', 'р'], ['s', 'с'], ['t', 'т'],
  ['ć', 'ћ'], ["c'", 'ћ'], ['u', 'у'], ['f', 'ф'], ['h', 'х'], ['c', 'ц'], ['č', 'ч'], ['ch', 'ч'],
  ['dž', 'џ'], ['dzh', 'џ'], ['š', 'ш'], ['sh', 'ш'],
];

const MACEDONIAN: [string, string][] = [
  ['a', 'а'], ['b', 'б'], ['v', 'в'], ['g', 'г'], ['d', 'д'], ['gj', 'ѓ'], ["g'", 'ѓ'], ['e', 'е'],
  ['zh', 'ж'], ['ž', 'ж'], ['z', 'з'], ['dz', 'ѕ'], ['i', 'и'], ['j', 'ј'], ['k', 'к'], ['l', 'л'],
  ['lj', 'љ'], ['m', 'м'], ['n', 'н'], ['nj', 'њ'], ['o', 'о'], ['p', 'п'], ['r', 'р'], ['s', 'с'],
  ['t', 'т'], ['kj', 'ќ'], ["k'", 'ќ'], ['u', 'у'], ['f', 'ф'], ['h', 'х'], ['c', 'ц'], ['ch', 'ч'],
  ['č', 'ч'], ['dzh', 'џ'], ['dž', 'џ'], ['sh', 'ш'], ['š', 'ш'],
];

const GREEK: [string, string][] = [
  ['a', 'α'], ['b', 'β'], ['v', 'β'], ['g', 'γ'], ['d', 'δ'], ['e', 'ε'], ['z', 'ζ'], ['h', 'η'],
  ['th', 'θ'], ['i', 'ι'], ['k', 'κ'], ['l', 'λ'], ['m', 'μ'], ['n', 'ν'], ['x', 'ξ'], ['ks', 'ξ'],
  ['o', 'ο'], ['p', 'π'], ['r', 'ρ'], ['s', 'σ'], ['t', 'τ'], ['y', 'υ'], ['u', 'υ'], ['f', 'φ'],
  ['ch', 'χ'], ['ps', 'ψ'], ['w', 'ω'],
  // Accents: vowel + ' (tonos), vowel + : (dialytika)
  ["a'", 'ά'], ["e'", 'έ'], ["h'", 'ή'], ["i'", 'ί'], ["o'", 'ό'], ["y'", 'ύ'], ["u'", 'ύ'], ["w'", 'ώ'],
  ['i:', 'ϊ'], ['y:', 'ϋ'], ['u:', 'ϋ'],
];

function greekFinalSigma(text: string): string {
  return text.replace(/σ(?=$|[^\p{L}])/gu, 'ς');
}

// ---------------------------------------------------------------------------
// Devanagari (Hindi, Marathi, Nepali): consonants carry an inherent "a";
// a following vowel becomes a vowel sign, a following consonant joins with a
// virama ("namaste" → नमस्ते, "hindii" → हिन्दी).

const DEVA_CONSONANTS: [string, string][] = [
  ['k', 'क'], ['kh', 'ख'], ['g', 'ग'], ['gh', 'घ'], ['~N', 'ङ'], ['ch', 'च'], ['chh', 'छ'], ['Ch', 'छ'],
  ['j', 'ज'], ['jh', 'झ'], ['~n', 'ञ'], ['T', 'ट'], ['Th', 'ठ'], ['D', 'ड'], ['Dh', 'ढ'], ['N', 'ण'],
  ['t', 'त'], ['th', 'थ'], ['d', 'द'], ['dh', 'ध'], ['n', 'न'], ['p', 'प'], ['ph', 'फ'], ['f', 'फ़'],
  ['b', 'ब'], ['bh', 'भ'], ['m', 'म'], ['y', 'य'], ['r', 'र'], ['l', 'ल'], ['v', 'व'], ['w', 'व'],
  ['sh', 'श'], ['Sh', 'ष'], ['s', 'स'], ['h', 'ह'], ['z', 'ज़'], ['q', 'क़'], ['x', 'क्ष'], ['GY', 'ज्ञ'],
  ['R', 'ड़'], ['Rh', 'ढ़'],
];
// [keys, independent vowel, vowel sign]
const DEVA_VOWELS: [string, string, string][] = [
  ['a', 'अ', ''], ['aa', 'आ', 'ा'], ['A', 'आ', 'ा'], ['i', 'इ', 'ि'], ['ii', 'ई', 'ी'], ['I', 'ई', 'ी'],
  ['ee', 'ई', 'ी'], ['u', 'उ', 'ु'], ['uu', 'ऊ', 'ू'], ['U', 'ऊ', 'ू'], ['oo', 'ऊ', 'ू'], ['RRi', 'ऋ', 'ृ'],
  ['R^i', 'ऋ', 'ृ'], ['e', 'ए', 'े'], ['ai', 'ऐ', 'ै'], ['o', 'ओ', 'ो'], ['au', 'औ', 'ौ'],
];
const DEVA_MARKS: [string, string][] = [['M', 'ं'], ['.n', 'ं'], ['H', 'ः'], ['.N', 'ँ'], ['|', '।']];

const devaTokens = new Map<string, { kind: 'c' | 'v' | 'm'; value: string; sign?: string }>();
for (const [key, value] of DEVA_CONSONANTS) devaTokens.set(key, { kind: 'c', value });
for (const [key, value, sign] of DEVA_VOWELS) devaTokens.set(key, { kind: 'v', value, sign });
for (const [key, value] of DEVA_MARKS) devaTokens.set(key, { kind: 'm', value });
const devaMax = Math.max(...[...devaTokens.keys()].map((key) => key.length));

export function toDevanagari(raw: string): string {
  let out = '';
  let afterConsonant = false;
  let i = 0;
  while (i < raw.length) {
    let token: { kind: 'c' | 'v' | 'm'; value: string; sign?: string } | undefined;
    let length = 0;
    for (let len = Math.min(devaMax, raw.length - i); len >= 1; len--) {
      token = devaTokens.get(raw.slice(i, i + len));
      if (token) {
        length = len;
        break;
      }
    }
    if (!token) {
      out += raw[i];
      afterConsonant = false;
      i++;
      continue;
    }
    if (token.kind === 'c') {
      if (afterConsonant) out += '्';
      out += token.value;
      afterConsonant = true;
    } else if (token.kind === 'v') {
      out += afterConsonant ? token.sign : token.value;
      afterConsonant = false;
    } else {
      out += token.value;
      afterConsonant = false;
    }
    i += length;
  }
  return out;
}

// ---------------------------------------------------------------------------

const DEVA_RULES: [string, string][] = [
  ...DEVA_CONSONANTS,
  ...DEVA_VOWELS.map(([key, value]) => [key, value] as [string, string]),
  ...DEVA_MARKS,
];

export const PHONETIC_SCHEMES: Record<string, PhoneticScheme> = {
  ru: { id: 'ru', name: 'Russian', rules: RUSSIAN },
  be: { id: 'be', name: 'Russian-style', rules: RUSSIAN },
  uk: { id: 'uk', name: 'Ukrainian', rules: UKRAINIAN },
  bg: { id: 'bg', name: 'Bulgarian', rules: BULGARIAN },
  sr: { id: 'sr', name: 'Serbian', rules: SERBIAN },
  mk: { id: 'mk', name: 'Macedonian', rules: MACEDONIAN },
  el: { id: 'el', name: 'Greek', rules: GREEK, post: greekFinalSigma },
  hi: { id: 'hi', name: 'Devanagari', rules: DEVA_RULES, convert: toDevanagari },
  mr: { id: 'mr', name: 'Devanagari', rules: DEVA_RULES, convert: toDevanagari },
  ne: { id: 'ne', name: 'Devanagari', rules: DEVA_RULES, convert: toDevanagari },
};

export function phoneticScheme(code: string): PhoneticScheme | null {
  return PHONETIC_SCHEMES[code.toLowerCase().split('-')[0]] ?? null;
}

const compiled = new Map<string, { map: Map<string, string>; maxLength: number }>();

function compile(scheme: PhoneticScheme) {
  let entry = compiled.get(scheme.id);
  if (!entry) {
    const map = new Map(scheme.rules.map(([latin, output]) => [latin.toLowerCase(), output]));
    entry = { map, maxLength: Math.max(1, ...scheme.rules.map(([latin]) => latin.length)) };
    compiled.set(scheme.id, entry);
  }
  return entry;
}

// Keys the scheme consumes while composing (everything else ends the run).
export function phoneticConsumes(scheme: PhoneticScheme, key: string): boolean {
  if (key === SEPARATOR) return true;
  if (scheme.convert) return /^[A-Za-z.~^|]$/.test(key);
  if (/^[a-zA-Z]$/.test(key)) return true;
  const lower = key.toLowerCase();
  return scheme.rules.some(([latin]) => latin.includes(lower));
}

export function transliterate(raw: string, scheme: PhoneticScheme): string {
  if (scheme.convert) return scheme.convert(raw);
  const { map, maxLength } = compile(scheme);
  const lower = raw.toLowerCase();
  let out = '';
  let i = 0;
  while (i < raw.length) {
    if (raw[i] === SEPARATOR) {
      i++;
      continue;
    }
    let matched = false;
    for (let len = Math.min(maxLength, raw.length - i); len >= 1; len--) {
      const output = map.get(lower.slice(i, i + len));
      if (output === undefined) continue;
      const upper = raw[i] !== lower[i];
      out += upper ? output.charAt(0).toLocaleUpperCase() + output.slice(1) : output;
      i += len;
      matched = true;
      break;
    }
    if (!matched) {
      out += raw[i];
      i++;
    }
  }
  return scheme.post ? scheme.post(out) : out;
}

// Rows for the on-screen help table.
export function phoneticHelp(scheme: PhoneticScheme): [string, string][] {
  const seen = new Set<string>();
  const rows: [string, string][] = [];
  for (const [latin, output] of scheme.rules) {
    const key = `${latin}→${output}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push([latin, output]);
  }
  return rows;
}
