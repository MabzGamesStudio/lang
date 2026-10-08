// Romaji → hiragana for the Japanese input method ("nihongo" → にほんご).
// Kanji come from the vocabulary: words whose reading starts with the typed
// kana are offered as candidates.

const TABLE: Record<string, string> = {
  a: 'あ', i: 'い', u: 'う', e: 'え', o: 'お',
  ka: 'か', ki: 'き', ku: 'く', ke: 'け', ko: 'こ',
  sa: 'さ', si: 'し', shi: 'し', su: 'す', se: 'せ', so: 'そ',
  ta: 'た', ti: 'ち', chi: 'ち', tu: 'つ', tsu: 'つ', te: 'て', to: 'と',
  na: 'な', ni: 'に', nu: 'ぬ', ne: 'ね', no: 'の',
  ha: 'は', hi: 'ひ', hu: 'ふ', fu: 'ふ', he: 'へ', ho: 'ほ',
  ma: 'ま', mi: 'み', mu: 'む', me: 'め', mo: 'も',
  ya: 'や', yu: 'ゆ', yo: 'よ',
  ra: 'ら', ri: 'り', ru: 'る', re: 'れ', ro: 'ろ',
  wa: 'わ', wi: 'うぃ', we: 'うぇ', wo: 'を',
  ga: 'が', gi: 'ぎ', gu: 'ぐ', ge: 'げ', go: 'ご',
  za: 'ざ', zi: 'じ', ji: 'じ', zu: 'ず', ze: 'ぜ', zo: 'ぞ',
  da: 'だ', di: 'ぢ', du: 'づ', de: 'で', do: 'ど',
  ba: 'ば', bi: 'び', bu: 'ぶ', be: 'べ', bo: 'ぼ',
  pa: 'ぱ', pi: 'ぴ', pu: 'ぷ', pe: 'ぺ', po: 'ぽ',
  va: 'ゔぁ', vi: 'ゔぃ', vu: 'ゔ', ve: 'ゔぇ', vo: 'ゔぉ',
  fa: 'ふぁ', fi: 'ふぃ', fe: 'ふぇ', fo: 'ふぉ', fyu: 'ふゅ',
  je: 'じぇ', she: 'しぇ', che: 'ちぇ', thi: 'てぃ', dhi: 'でぃ', tsa: 'つぁ',
  xa: 'ぁ', xi: 'ぃ', xu: 'ぅ', xe: 'ぇ', xo: 'ぉ', la: 'ぁ', li: 'ぃ', lu: 'ぅ', le: 'ぇ', lo: 'ぉ',
  xya: 'ゃ', xyu: 'ゅ', xyo: 'ょ', lya: 'ゃ', lyu: 'ゅ', lyo: 'ょ',
  xtu: 'っ', xtsu: 'っ', ltu: 'っ', ltsu: 'っ', xwa: 'ゎ', lwa: 'ゎ',
  '-': 'ー',
};

// Contracted sounds: kya きゃ, sha しゃ, cho ちょ, ju じゅ...
const YOUON: Record<string, string> = {
  ky: 'き', sy: 'し', ty: 'ち', cy: 'ち', ny: 'に', hy: 'ひ', my: 'み', ry: 'り',
  gy: 'ぎ', zy: 'じ', jy: 'じ', dy: 'ぢ', by: 'び', py: 'ぴ',
};
const SMALL: Record<string, string> = { a: 'ゃ', u: 'ゅ', o: 'ょ' };
for (const [prefix, kana] of Object.entries(YOUON)) {
  for (const [vowel, small] of Object.entries(SMALL)) TABLE[prefix + vowel] = kana + small;
}
for (const [prefix, kana] of Object.entries({ sh: 'し', ch: 'ち', j: 'じ' })) {
  for (const [vowel, small] of Object.entries(SMALL)) TABLE[prefix + vowel] = kana + small;
}

const MAX_KEY = Math.max(...Object.keys(TABLE).map((key) => key.length));
const VOWEL_OR_Y = /[aiueoy]/;

// Converts typed romaji. Unfinished syllables stay in Latin letters; with
// `final` a trailing "n" becomes ん.
export function romajiToHiragana(raw: string, final = false): string {
  const text = raw.toLowerCase();
  let out = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];
    if (c === 'n') {
      if (next === 'n') {
        // "konnichiha": ん + に; "nn" before a consonant or at the end: ん.
        const after = text[i + 2];
        out += 'ん';
        i += after && VOWEL_OR_Y.test(after) ? 1 : 2;
        continue;
      }
      if (next === "'") {
        out += 'ん';
        i += 2;
        continue;
      }
      if (next !== undefined && !VOWEL_OR_Y.test(next)) {
        out += 'ん';
        i += 1;
        continue;
      }
    }
    // Doubled consonant → small っ ("kitte" → きって, "matcha" → まっちゃ).
    if (next === c && /[bcdfghjkmpqrstvwxz]/.test(c)) {
      out += 'っ';
      i += 1;
      continue;
    }
    if (c === 't' && text.startsWith('ch', i + 1)) {
      out += 'っ';
      i += 1;
      continue;
    }
    let matched = false;
    for (let len = Math.min(MAX_KEY, text.length - i); len >= 1; len--) {
      const kana = TABLE[text.slice(i, i + len)];
      if (kana === undefined) continue;
      out += kana;
      i += len;
      matched = true;
      break;
    }
    if (matched) continue;
    out += c === 'n' && final && i === text.length - 1 ? 'ん' : c;
    i++;
  }
  return out;
}

export function hiraganaToKatakana(text: string): string {
  return text.replace(/[ぁ-ゖ]/g, (char) => String.fromCharCode(char.charCodeAt(0) + 0x60));
}

export function katakanaToHiragana(text: string): string {
  return text.replace(/[ァ-ヶ]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0x60));
}

export function isKana(text: string): boolean {
  return /^[\p{Script=Hiragana}\p{Script=Katakana}ー・\s]+$/u.test(text);
}

// Keys the Japanese input method consumes while composing.
export function kanaConsumes(key: string): boolean {
  return /^[a-zA-Z'-]$/.test(key);
}
