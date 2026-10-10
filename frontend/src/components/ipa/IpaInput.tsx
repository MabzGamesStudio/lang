import ForeignInput, { type ForeignInputProps, type TypingLanguage } from '../typing/ForeignInput';
import { IPA_SOUNDS } from '../../../../shared/ipa/inventory';

// Answer box for IPA: X-SAMPA typing ("TIn" → θɪn) and a keyboard of the
// symbols that are not on a keyboard (vowels, consonants, then marks).
const IPA_KEYS = [
  ...IPA_SOUNDS.filter((sound) => sound.kind === 'vowel'),
  ...IPA_SOUNDS.filter((sound) => sound.kind === 'consonant'),
]
  .map((sound) => sound.symbol)
  .filter((symbol) => Array.from(symbol).length === 1 && !/^[a-z]$/.test(symbol))
  .concat(['ː', 'ˈ', 'ˌ', 'ʰ', 'ʲ', 'ʷ']);

export const IPA_TYPING: TypingLanguage = {
  id: 'ipa',
  code: 'ipa',
  locale: 'und',
  rtl: false,
  inputMethod: 'phonetic',
  extraCharacters: IPA_KEYS,
  autoCharacters: [],
  wordCount: 0,
  definedWordCount: 0,
};

export default function IpaInput(props: Omit<ForeignInputProps, 'language' | 'alwaysShowLetters' | 'capitals'>) {
  return <ForeignInput {...props} language={IPA_TYPING} alwaysShowLetters capitals={false} />;
}
