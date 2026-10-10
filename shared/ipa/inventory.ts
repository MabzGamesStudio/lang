// The sounds of the pronunciation mode: IPA symbols with the Wikimedia Commons
// recording of each sound on its own (the recordings of Wikipedia's IPA
// charts) and example words — English (General American, or British where
// noted) when English has the sound, otherwise common words of other languages.

export type SoundKind = 'consonant' | 'vowel';

export interface IpaExample {
  word: string;
  ipa: string; // broad transcription, without slashes
  lang: string; // BCP 47: en, en-GB, fr, de, es…
  gloss?: string; // meaning of a non-English word
}

export interface IpaSound {
  symbol: string;
  name: string;
  kind: SoundKind;
  // Commons file of the sound on its own (without "File:"); none for sounds
  // only heard in words (r-coloured vowels, the flap…) when no recording exists.
  file?: string;
  examples: IpaExample[];
}

const en = (word: string, ipa: string): IpaExample => ({ word, ipa, lang: 'en' });
const gb = (word: string, ipa: string): IpaExample => ({ word, ipa, lang: 'en-GB' });
const x = (lang: string, word: string, ipa: string, gloss: string): IpaExample => ({ word, ipa, lang, gloss });

export const IPA_SOUNDS: IpaSound[] = [
  // Vowels, front to back, close to open.
  { symbol: 'i', name: 'close front unrounded vowel', kind: 'vowel', file: 'Close front unrounded vowel.ogg', examples: [en('see', 'si'), en('meet', 'mit'), en('happy', 'ˈhæpi')] },
  { symbol: 'y', name: 'close front rounded vowel', kind: 'vowel', file: 'Close front rounded vowel.ogg', examples: [x('fr', 'tu', 'ty', 'you'), x('de', 'über', 'ˈyːbɐ', 'over')] },
  { symbol: 'ɨ', name: 'close central unrounded vowel', kind: 'vowel', file: 'Close central unrounded vowel.ogg', examples: [x('ru', 'ты', 'tɨ', 'you'), x('pl', 'my', 'mɨ', 'we')] },
  { symbol: 'ʉ', name: 'close central rounded vowel', kind: 'vowel', file: 'Close central rounded vowel.ogg', examples: [x('nb', 'hus', 'hʉːs', 'house'), x('sv', 'hus', 'hʉːs', 'house')] },
  { symbol: 'ɯ', name: 'close back unrounded vowel', kind: 'vowel', file: 'Close back unrounded vowel.ogg', examples: [x('tr', 'kız', 'kɯz', 'girl'), x('tr', 'ılık', 'ɯˈlɯk', 'lukewarm')] },
  { symbol: 'u', name: 'close back rounded vowel', kind: 'vowel', file: 'Close back rounded vowel.ogg', examples: [en('food', 'fud'), en('blue', 'blu'), en('too', 'tu')] },
  { symbol: 'ɪ', name: 'near-close near-front unrounded vowel', kind: 'vowel', file: 'Near-close near-front unrounded vowel.ogg', examples: [en('sit', 'sɪt'), en('ship', 'ʃɪp'), en('busy', 'ˈbɪzi')] },
  { symbol: 'ʊ', name: 'near-close near-back rounded vowel', kind: 'vowel', file: 'Near-close near-back rounded vowel.ogg', examples: [en('book', 'bʊk'), en('put', 'pʊt'), en('good', 'ɡʊd')] },
  { symbol: 'e', name: 'close-mid front unrounded vowel', kind: 'vowel', file: 'Close-mid front unrounded vowel.ogg', examples: [x('es', 'mesa', 'ˈmesa', 'table'), x('fr', 'été', 'ete', 'summer'), en('day', 'deɪ')] },
  { symbol: 'ø', name: 'close-mid front rounded vowel', kind: 'vowel', file: 'Close-mid front rounded vowel.ogg', examples: [x('fr', 'peu', 'pø', 'little'), x('de', 'schön', 'ʃøːn', 'beautiful')] },
  { symbol: 'ɤ', name: 'close-mid back unrounded vowel', kind: 'vowel', file: 'Close-mid back unrounded vowel.ogg', examples: [x('zh', '哥', 'kɤ', 'older brother'), x('zh', '饿', 'ɤ', 'hungry')] },
  { symbol: 'o', name: 'close-mid back rounded vowel', kind: 'vowel', file: 'Close-mid back rounded vowel.ogg', examples: [x('es', 'como', 'ˈkomo', 'like'), x('fr', 'beau', 'bo', 'beautiful'), en('go', 'ɡoʊ')] },
  { symbol: 'ə', name: 'mid central vowel (schwa)', kind: 'vowel', file: 'Mid-central vowel.ogg', examples: [en('about', 'əˈbaʊt'), en('sofa', 'ˈsoʊfə'), en('banana', 'bəˈnænə')] },
  { symbol: 'ɚ', name: 'r-coloured mid central vowel', kind: 'vowel', examples: [en('butter', 'ˈbʌɾɚ'), en('teacher', 'ˈtitʃɚ'), en('doctor', 'ˈdɑktɚ')] },
  { symbol: 'ɛ', name: 'open-mid front unrounded vowel', kind: 'vowel', file: 'Open-mid front unrounded vowel.ogg', examples: [en('bed', 'bɛd'), en('said', 'sɛd'), en('head', 'hɛd')] },
  { symbol: 'œ', name: 'open-mid front rounded vowel', kind: 'vowel', file: 'Open-mid front rounded vowel.ogg', examples: [x('fr', 'peur', 'pœʁ', 'fear'), x('de', 'können', 'ˈkœnən', 'can')] },
  { symbol: 'ɜ', name: 'open-mid central unrounded vowel', kind: 'vowel', file: 'Open-mid central unrounded vowel.ogg', examples: [gb('bird', 'bɜːd'), gb('nurse', 'nɜːs')] },
  { symbol: 'ɝ', name: 'r-coloured open-mid central vowel', kind: 'vowel', examples: [en('bird', 'bɝd'), en('nurse', 'nɝs'), en('word', 'wɝd')] },
  { symbol: 'ʌ', name: 'open-mid back unrounded vowel', kind: 'vowel', file: 'Open-mid back unrounded vowel.ogg', examples: [en('cup', 'kʌp'), en('love', 'lʌv'), en('sun', 'sʌn')] },
  { symbol: 'ɔ', name: 'open-mid back rounded vowel', kind: 'vowel', file: 'Open-mid back rounded vowel.ogg', examples: [en('law', 'lɔ'), en('thought', 'θɔt'), en('boy', 'bɔɪ')] },
  { symbol: 'æ', name: 'near-open front unrounded vowel', kind: 'vowel', file: 'Near-open front unrounded vowel.ogg', examples: [en('cat', 'kæt'), en('hand', 'hænd'), en('apple', 'ˈæpəl')] },
  { symbol: 'ɐ', name: 'near-open central vowel', kind: 'vowel', file: 'Near-open central unrounded vowel.ogg', examples: [x('pt', 'cama', 'ˈkɐmɐ', 'bed'), x('de', 'oder', 'ˈoːdɐ', 'or')] },
  { symbol: 'a', name: 'open front unrounded vowel', kind: 'vowel', file: 'Open front unrounded vowel.ogg', examples: [x('es', 'casa', 'ˈkasa', 'house'), x('fr', 'patte', 'pat', 'paw'), en('my', 'maɪ')] },
  { symbol: 'ɑ', name: 'open back unrounded vowel', kind: 'vowel', file: 'Open back unrounded vowel.ogg', examples: [en('father', 'ˈfɑðɚ'), en('hot', 'hɑt'), en('spa', 'spɑ')] },
  { symbol: 'ɒ', name: 'open back rounded vowel', kind: 'vowel', file: 'Open back rounded vowel.ogg', examples: [gb('lot', 'lɒt'), gb('not', 'nɒt'), gb('dog', 'dɒɡ')] },

  // Consonants: plosives, nasals, taps and trills, fricatives, affricates, approximants.
  { symbol: 'p', name: 'voiceless bilabial plosive', kind: 'consonant', file: 'Voiceless bilabial plosive.ogg', examples: [en('pen', 'pɛn'), en('happy', 'ˈhæpi'), en('cup', 'kʌp')] },
  { symbol: 'b', name: 'voiced bilabial plosive', kind: 'consonant', file: 'Voiced bilabial plosive.ogg', examples: [en('bed', 'bɛd'), en('rabbit', 'ˈɹæbɪt'), en('cab', 'kæb')] },
  { symbol: 't', name: 'voiceless alveolar plosive', kind: 'consonant', file: 'Voiceless alveolar plosive.ogg', examples: [en('ten', 'tɛn'), en('stop', 'stɑp'), en('cat', 'kæt')] },
  { symbol: 'd', name: 'voiced alveolar plosive', kind: 'consonant', file: 'Voiced alveolar plosive.ogg', examples: [en('dog', 'dɔɡ'), en('lady', 'ˈleɪdi'), en('red', 'ɹɛd')] },
  { symbol: 'ʈ', name: 'voiceless retroflex plosive', kind: 'consonant', file: 'Voiceless retroflex stop.oga', examples: [x('hi', 'टमाटर', 'ʈəmaːʈəɾ', 'tomato')] },
  { symbol: 'ɖ', name: 'voiced retroflex plosive', kind: 'consonant', file: 'Voiced retroflex stop.oga', examples: [x('hi', 'डाल', 'ɖaːl', 'branch')] },
  { symbol: 'c', name: 'voiceless palatal plosive', kind: 'consonant', file: 'Voiceless palatal plosive.ogg', examples: [x('hu', 'tyúk', 'cuːk', 'hen')] },
  { symbol: 'ɟ', name: 'voiced palatal plosive', kind: 'consonant', file: 'Voiced palatal plosive.ogg', examples: [x('hu', 'gyár', 'ɟaːr', 'factory')] },
  { symbol: 'k', name: 'voiceless velar plosive', kind: 'consonant', file: 'Voiceless velar plosive.ogg', examples: [en('cat', 'kæt'), en('sky', 'skaɪ'), en('book', 'bʊk')] },
  { symbol: 'ɡ', name: 'voiced velar plosive', kind: 'consonant', file: 'Voiced velar plosive 02.ogg', examples: [en('go', 'ɡoʊ'), en('bigger', 'ˈbɪɡɚ'), en('bag', 'bæɡ')] },
  { symbol: 'q', name: 'voiceless uvular plosive', kind: 'consonant', file: 'Voiceless uvular plosive.ogg', examples: [x('ar', 'قلب', 'qalb', 'heart')] },
  { symbol: 'ʔ', name: 'glottal stop', kind: 'consonant', file: 'Glottal stop.ogg', examples: [en('uh-oh', 'ˈʌʔoʊ'), en('button', 'ˈbʌʔn̩')] },
  { symbol: 'm', name: 'bilabial nasal', kind: 'consonant', file: 'Bilabial nasal.ogg', examples: [en('man', 'mæn'), en('summer', 'ˈsʌmɚ'), en('room', 'ɹum')] },
  { symbol: 'n', name: 'alveolar nasal', kind: 'consonant', file: 'Alveolar nasal.ogg', examples: [en('no', 'noʊ'), en('dinner', 'ˈdɪnɚ'), en('sun', 'sʌn')] },
  { symbol: 'ɳ', name: 'retroflex nasal', kind: 'consonant', file: 'Retroflex nasal.ogg', examples: [x('sv', 'barn', 'bɑːɳ', 'child')] },
  { symbol: 'ɲ', name: 'palatal nasal', kind: 'consonant', file: 'Palatal nasal.ogg', examples: [x('es', 'año', 'ˈaɲo', 'year'), x('fr', 'montagne', 'mɔ̃taɲ', 'mountain')] },
  { symbol: 'ŋ', name: 'velar nasal', kind: 'consonant', file: 'Velar nasal.ogg', examples: [en('sing', 'sɪŋ'), en('finger', 'ˈfɪŋɡɚ'), en('long', 'lɔŋ')] },
  { symbol: 'r', name: 'alveolar trill', kind: 'consonant', file: 'Alveolar trill.ogg', examples: [x('es', 'perro', 'ˈpero', 'dog'), x('it', 'terra', 'ˈtɛrra', 'earth')] },
  { symbol: 'ɾ', name: 'alveolar tap', kind: 'consonant', file: 'Alveolar tap.ogg', examples: [en('butter', 'ˈbʌɾɚ'), en('water', 'ˈwɔɾɚ'), x('es', 'pero', 'ˈpeɾo', 'but')] },
  { symbol: 'ɸ', name: 'voiceless bilabial fricative', kind: 'consonant', file: 'Voiceless bilabial fricative.ogg', examples: [x('ja', 'ふね', 'ɸɯne', 'boat')] },
  { symbol: 'β', name: 'voiced bilabial fricative', kind: 'consonant', file: 'Voiced bilabial fricative.ogg', examples: [x('es', 'lobo', 'ˈloβo', 'wolf'), x('es', 'haba', 'ˈaβa', 'bean')] },
  { symbol: 'f', name: 'voiceless labiodental fricative', kind: 'consonant', file: 'Voiceless labiodental fricative.ogg', examples: [en('fish', 'fɪʃ'), en('coffee', 'ˈkɔfi'), en('leaf', 'lif')] },
  { symbol: 'v', name: 'voiced labiodental fricative', kind: 'consonant', file: 'Voiced labiodental fricative.ogg', examples: [en('van', 'væn'), en('river', 'ˈɹɪvɚ'), en('love', 'lʌv')] },
  { symbol: 'θ', name: 'voiceless dental fricative', kind: 'consonant', file: 'Voiceless dental fricative.ogg', examples: [en('thin', 'θɪn'), en('author', 'ˈɔθɚ'), en('bath', 'bæθ')] },
  { symbol: 'ð', name: 'voiced dental fricative', kind: 'consonant', file: 'Voiced dental fricative.ogg', examples: [en('this', 'ðɪs'), en('mother', 'ˈmʌðɚ'), en('breathe', 'bɹið')] },
  { symbol: 's', name: 'voiceless alveolar sibilant', kind: 'consonant', file: 'Voiceless alveolar sibilant.ogg', examples: [en('sun', 'sʌn'), en('lesson', 'ˈlɛsən'), en('bus', 'bʌs')] },
  { symbol: 'z', name: 'voiced alveolar sibilant', kind: 'consonant', file: 'Voiced alveolar sibilant.ogg', examples: [en('zoo', 'zu'), en('lazy', 'ˈleɪzi'), en('rose', 'ɹoʊz')] },
  { symbol: 'ʃ', name: 'voiceless postalveolar sibilant', kind: 'consonant', file: 'Voiceless palato-alveolar sibilant.ogg', examples: [en('ship', 'ʃɪp'), en('ocean', 'ˈoʊʃən'), en('fish', 'fɪʃ')] },
  { symbol: 'ʒ', name: 'voiced postalveolar sibilant', kind: 'consonant', file: 'Voiced palato-alveolar sibilant.ogg', examples: [en('measure', 'ˈmɛʒɚ'), en('vision', 'ˈvɪʒən'), en('beige', 'beɪʒ')] },
  { symbol: 'ʂ', name: 'voiceless retroflex sibilant', kind: 'consonant', file: 'Voiceless retroflex sibilant.ogg', examples: [x('pl', 'szok', 'ʂɔk', 'shock'), x('zh', '书', 'ʂu', 'book')] },
  { symbol: 'ʐ', name: 'voiced retroflex sibilant', kind: 'consonant', file: 'Voiced retroflex sibilant.ogg', examples: [x('pl', 'żaba', 'ˈʐaba', 'frog')] },
  { symbol: 'ɕ', name: 'voiceless alveolo-palatal sibilant', kind: 'consonant', file: 'Voiceless alveolo-palatal sibilant.ogg', examples: [x('zh', '西', 'ɕi', 'west'), x('pl', 'siano', 'ˈɕanɔ', 'hay')] },
  { symbol: 'ç', name: 'voiceless palatal fricative', kind: 'consonant', file: 'Voiceless palatal fricative.ogg', examples: [x('de', 'ich', 'ɪç', 'I'), x('de', 'Milch', 'mɪlç', 'milk')] },
  { symbol: 'x', name: 'voiceless velar fricative', kind: 'consonant', file: 'Voiceless velar fricative.ogg', examples: [x('de', 'Bach', 'bax', 'brook'), x('es', 'jamón', 'xaˈmon', 'ham')] },
  { symbol: 'ɣ', name: 'voiced velar fricative', kind: 'consonant', file: 'Voiced velar fricative.ogg', examples: [x('es', 'lago', 'ˈlaɣo', 'lake'), x('el', 'γάλα', 'ˈɣala', 'milk')] },
  { symbol: 'χ', name: 'voiceless uvular fricative', kind: 'consonant', file: 'Voiceless uvular fricative.ogg', examples: [x('cy', 'bach', 'baːχ', 'small')] },
  { symbol: 'ʁ', name: 'voiced uvular fricative', kind: 'consonant', file: 'Voiced uvular fricative.ogg', examples: [x('fr', 'rouge', 'ʁuʒ', 'red'), x('de', 'rot', 'ʁoːt', 'red')] },
  { symbol: 'ħ', name: 'voiceless pharyngeal fricative', kind: 'consonant', file: 'Voiceless pharyngeal fricative.ogg', examples: [x('ar', 'حب', 'ħubb', 'love')] },
  { symbol: 'ʕ', name: 'voiced pharyngeal fricative', kind: 'consonant', file: 'Voiced pharyngeal fricative.ogg', examples: [x('ar', 'عين', 'ʕajn', 'eye')] },
  { symbol: 'h', name: 'voiceless glottal fricative', kind: 'consonant', file: 'Voiceless glottal fricative.ogg', examples: [en('hat', 'hæt'), en('behind', 'bɪˈhaɪnd'), en('hello', 'həˈloʊ')] },
  { symbol: 'ɬ', name: 'voiceless alveolar lateral fricative', kind: 'consonant', file: 'Voiceless alveolar lateral fricative.ogg', examples: [x('cy', 'llan', 'ɬan', 'church'), x('cy', 'lle', 'ɬeː', 'place')] },
  { symbol: 'ts', name: 'voiceless alveolar affricate', kind: 'consonant', file: 'Voiceless alveolar sibilant affricate.oga', examples: [x('de', 'Zeit', 'tsaɪt', 'time'), x('it', 'pizza', 'ˈpittsa', 'pizza')] },
  { symbol: 'tʃ', name: 'voiceless postalveolar affricate', kind: 'consonant', file: 'Voiceless palato-alveolar affricate.ogg', examples: [en('church', 'tʃɝtʃ'), en('kitchen', 'ˈkɪtʃən'), en('watch', 'wɑtʃ')] },
  { symbol: 'dʒ', name: 'voiced postalveolar affricate', kind: 'consonant', file: 'Voiced palato-alveolar affricate.ogg', examples: [en('jam', 'dʒæm'), en('magic', 'ˈmædʒɪk'), en('bridge', 'bɹɪdʒ')] },
  { symbol: 'tɕ', name: 'voiceless alveolo-palatal affricate', kind: 'consonant', file: 'Voiceless alveolo-palatal affricate.ogg', examples: [x('zh', '鸡', 'tɕi', 'chicken'), x('ja', 'ちず', 'tɕizɯ', 'map')] },
  { symbol: 'ʋ', name: 'labiodental approximant', kind: 'consonant', file: 'Labiodental approximant.ogg', examples: [x('nl', 'wat', 'ʋɑt', 'what'), x('hi', 'वन', 'ʋən', 'forest')] },
  { symbol: 'ɹ', name: 'alveolar approximant', kind: 'consonant', file: 'Alveolar approximant.ogg', examples: [en('red', 'ɹɛd'), en('very', 'ˈvɛɹi'), en('sorry', 'ˈsɑɹi')] },
  { symbol: 'j', name: 'palatal approximant', kind: 'consonant', file: 'Palatal approximant.ogg', examples: [en('yes', 'jɛs'), en('you', 'ju'), en('onion', 'ˈʌnjən')] },
  { symbol: 'w', name: 'labial-velar approximant', kind: 'consonant', file: 'Voiced labio-velar approximant.ogg', examples: [en('we', 'wi'), en('away', 'əˈweɪ'), en('quick', 'kwɪk')] },
  { symbol: 'l', name: 'alveolar lateral approximant', kind: 'consonant', file: 'Alveolar lateral approximant.ogg', examples: [en('leg', 'lɛɡ'), en('yellow', 'ˈjɛloʊ'), en('ball', 'bɔl')] },
  { symbol: 'ɫ', name: 'velarized alveolar lateral approximant (dark L)', kind: 'consonant', file: 'Velarized alveolar lateral approximant.ogg', examples: [en('full', 'fʊɫ'), en('milk', 'mɪɫk')] },
  { symbol: 'ʎ', name: 'palatal lateral approximant', kind: 'consonant', file: 'Palatal lateral approximant.ogg', examples: [x('it', 'figlio', 'ˈfiʎʎo', 'son'), x('pt', 'filho', 'ˈfiʎu', 'son')] },
];

export const IPA_BY_SYMBOL: Record<string, IpaSound> = Object.fromEntries(IPA_SOUNDS.map((sound) => [sound.symbol, sound]));

// Locales for speaking example words with a voice service.
export const EXAMPLE_LOCALES: Record<string, string> = {
  en: 'en-US',
  'en-GB': 'en-GB',
  fr: 'fr-FR',
  de: 'de-DE',
  es: 'es-ES',
  it: 'it-IT',
  pt: 'pt-PT',
  ru: 'ru-RU',
  pl: 'pl-PL',
  tr: 'tr-TR',
  nb: 'nb-NO',
  sv: 'sv-SE',
  zh: 'zh-CN',
  ja: 'ja-JP',
  hi: 'hi-IN',
  ar: 'ar-SA',
  cy: 'cy-GB',
  hu: 'hu-HU',
  nl: 'nl-NL',
  el: 'el-GR',
};

export const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  'en-GB': 'British English',
  fr: 'French',
  de: 'German',
  es: 'Spanish',
  it: 'Italian',
  pt: 'Portuguese',
  ru: 'Russian',
  pl: 'Polish',
  tr: 'Turkish',
  nb: 'Norwegian',
  sv: 'Swedish',
  zh: 'Mandarin',
  ja: 'Japanese',
  hi: 'Hindi',
  ar: 'Arabic',
  cy: 'Welsh',
  hu: 'Hungarian',
  nl: 'Dutch',
  el: 'Greek',
};

export function isEnglishExample(example: IpaExample): boolean {
  return example.lang === 'en' || example.lang === 'en-GB';
}

// Sounds heard in English (General American or British).
export function isEnglishSound(sound: IpaSound): boolean {
  return sound.examples.some(isEnglishExample);
}

// Order of learning: English consonants, English vowels, then the sounds of
// other languages (consonants first).
export const LEARNING_ORDER: string[] = IPA_SOUNDS.map((sound, index) => ({ sound, index }))
  .sort(
    (a, b) =>
      Number(!isEnglishSound(a.sound)) - Number(!isEnglishSound(b.sound)) ||
      Number(a.sound.kind === 'vowel') - Number(b.sound.kind === 'vowel') ||
      a.index - b.index
  )
  .map(({ sound }) => sound.symbol);

// Words of a sound's name that describe it ("voiceless", "dental", "fricative").
function features(sound: IpaSound): Set<string> {
  return new Set(
    sound.name
      .replace(/\(.*?\)/g, ' ')
      .toLowerCase()
      .split(/[\s]+/)
      .filter((word) => word && word !== 'vowel')
  );
}

// How alike two sounds are: the number of features their names share
// (θ "voiceless dental fricative" and ð "voiced dental fricative" share 2).
export function soundSimilarity(a: IpaSound, b: IpaSound): number {
  if (a.kind !== b.kind) return -1;
  const other = features(b);
  let shared = 0;
  for (const feature of features(a)) if (other.has(feature)) shared++;
  return shared;
}
