// Korean with the standard 2-set (dubeolsik) keyboard layout: keys give
// jamo, which are composed into syllable blocks as you type
// ("dkssudgktpdy" → 안녕하세요). Shift gives the tense consonants (ㄲ ㄸ ㅃ ㅆ ㅉ).

const KEYS: Record<string, string> = {
  q: 'ㅂ', w: 'ㅈ', e: 'ㄷ', r: 'ㄱ', t: 'ㅅ', y: 'ㅛ', u: 'ㅕ', i: 'ㅑ', o: 'ㅐ', p: 'ㅔ',
  a: 'ㅁ', s: 'ㄴ', d: 'ㅇ', f: 'ㄹ', g: 'ㅎ', h: 'ㅗ', j: 'ㅓ', k: 'ㅏ', l: 'ㅣ',
  z: 'ㅋ', x: 'ㅌ', c: 'ㅊ', v: 'ㅍ', b: 'ㅠ', n: 'ㅜ', m: 'ㅡ',
  Q: 'ㅃ', W: 'ㅉ', E: 'ㄸ', R: 'ㄲ', T: 'ㅆ', O: 'ㅒ', P: 'ㅖ',
};

const INITIALS = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
const MEDIALS = 'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ';
const FINALS = ['', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ', 'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];

const VOWEL_PAIRS: Record<string, string> = {
  'ㅗㅏ': 'ㅘ', 'ㅗㅐ': 'ㅙ', 'ㅗㅣ': 'ㅚ', 'ㅜㅓ': 'ㅝ', 'ㅜㅔ': 'ㅞ', 'ㅜㅣ': 'ㅟ', 'ㅡㅣ': 'ㅢ',
};
const FINAL_PAIRS: Record<string, string> = {
  'ㄱㅅ': 'ㄳ', 'ㄴㅈ': 'ㄵ', 'ㄴㅎ': 'ㄶ', 'ㄹㄱ': 'ㄺ', 'ㄹㅁ': 'ㄻ', 'ㄹㅂ': 'ㄼ', 'ㄹㅅ': 'ㄽ',
  'ㄹㅌ': 'ㄾ', 'ㄹㅍ': 'ㄿ', 'ㄹㅎ': 'ㅀ', 'ㅂㅅ': 'ㅄ',
};
const FINAL_SPLIT: Record<string, [string, string]> = Object.fromEntries(
  Object.entries(FINAL_PAIRS).map(([pair, combined]) => [combined, [pair[0], pair[1]]])
);

function isVowel(jamo: string): boolean {
  return MEDIALS.includes(jamo);
}

function syllable(initial: string, medial: string, final: string): string {
  return String.fromCharCode(
    0xac00 + (INITIALS.indexOf(initial) * 21 + MEDIALS.indexOf(medial)) * 28 + FINALS.indexOf(final)
  );
}

export function keysToJamo(keys: string): string[] {
  const jamo: string[] = [];
  for (const key of keys) {
    const mapped = KEYS[key] ?? KEYS[key.toLowerCase()];
    if (mapped) jamo.push(mapped);
  }
  return jamo;
}

// Composes a sequence of jamo into syllable blocks.
export function composeHangul(jamo: string[]): string {
  let out = '';
  let initial = '';
  let medial = '';
  let final = '';
  const flush = () => {
    if (initial && medial) out += syllable(initial, medial, final);
    else out += initial + medial + final;
    initial = '';
    medial = '';
    final = '';
  };
  for (const j of jamo) {
    if (isVowel(j)) {
      if (initial && !medial) {
        medial = j;
      } else if (medial && !final) {
        const combined = VOWEL_PAIRS[medial + j];
        if (combined && initial) medial = combined;
        else {
          flush();
          medial = j;
        }
      } else if (final) {
        // The final consonant moves to the next syllable (각 + ㅏ → 가가).
        const split = FINAL_SPLIT[final];
        const moving = split ? split[1] : final;
        final = split ? split[0] : '';
        flush();
        initial = moving;
        medial = j;
      } else {
        flush();
        medial = j;
      }
    } else if (!initial && !medial) {
      initial = j;
    } else if (initial && !medial) {
      flush();
      initial = j;
    } else if (!initial && medial) {
      flush();
      initial = j;
    } else if (!final) {
      if (FINALS.includes(j)) final = j;
      else {
        flush();
        initial = j;
      }
    } else {
      const combined = FINAL_PAIRS[final + j];
      if (combined) final = combined;
      else {
        flush();
        initial = j;
      }
    }
  }
  flush();
  return out;
}

export function hangulFromKeys(keys: string): string {
  return composeHangul(keysToJamo(keys));
}

export function hangulConsumes(key: string): boolean {
  return key in KEYS || key.toLowerCase() in KEYS;
}

export const HANGUL_LAYOUT = KEYS;
