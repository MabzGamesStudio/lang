import type { Phase } from '../games.js';
import type { WordLevels } from '../types.js';
import type { IpaExample, SoundKind } from './inventory.js';

// The pronunciation mode: learning the sounds of the International Phonetic
// Alphabet (IPA) with the same four phases as words. Each question practises
// one sound; questions on words also score the other sounds of the word that
// were met before.

export type IpaGameId =
  | 'soundToSymbol'
  | 'symbolToSound'
  | 'wordAudioToIpa'
  | 'ipaToWordAudio'
  | 'soundToSymbolTyped'
  | 'examplesToSymbolTyped'
  | 'wordAudioToIpaTyped'
  | 'ipaFromMemory'
  | 'wordToIpaTyped'
  | 'ipaToWordTyped';

// What the question shows or plays.
export type IpaPrompt = 'sound' | 'symbol' | 'examples' | 'wordAudio' | 'ipa' | 'word';
// How it is answered.
export type IpaResponse = 'symbolChoice' | 'soundChoice' | 'ipaChoice' | 'wordAudioChoice' | 'symbolTyped' | 'ipaTyped' | 'wordTyped';

export interface IpaGameDef {
  id: IpaGameId;
  phase: Phase;
  unit: 'sound' | 'word';
  prompt: IpaPrompt;
  response: IpaResponse;
  title: string;
  // The transcription is shown, then hidden before answering.
  memorize?: boolean;
}

export const IPA_GAMES: IpaGameDef[] = [
  // Recognition
  { id: 'soundToSymbol', phase: 'recognition', unit: 'sound', prompt: 'sound', response: 'symbolChoice', title: 'Listen to a sound → pick its symbol' },
  { id: 'symbolToSound', phase: 'recognition', unit: 'sound', prompt: 'symbol', response: 'soundChoice', title: 'Symbol → pick its sound' },
  { id: 'wordAudioToIpa', phase: 'recognition', unit: 'word', prompt: 'wordAudio', response: 'ipaChoice', title: 'Listen to a word → pick its transcription' },
  { id: 'ipaToWordAudio', phase: 'recognition', unit: 'word', prompt: 'ipa', response: 'wordAudioChoice', title: 'Transcription → pick the matching recording' },
  // Recall
  { id: 'soundToSymbolTyped', phase: 'recall', unit: 'sound', prompt: 'sound', response: 'symbolTyped', title: 'Listen to a sound → type its symbol' },
  { id: 'examplesToSymbolTyped', phase: 'recall', unit: 'sound', prompt: 'examples', response: 'symbolTyped', title: 'Words with the sound left out → type the symbol' },
  // Recite
  { id: 'wordAudioToIpaTyped', phase: 'recite', unit: 'word', prompt: 'wordAudio', response: 'ipaTyped', title: 'Listen to a word → type its transcription' },
  { id: 'ipaFromMemory', phase: 'recite', unit: 'word', prompt: 'ipa', response: 'ipaTyped', title: 'Transcription → type it from memory', memorize: true },
  // Translate
  { id: 'wordToIpaTyped', phase: 'translate', unit: 'word', prompt: 'word', response: 'ipaTyped', title: 'Word → type its transcription' },
  { id: 'ipaToWordTyped', phase: 'translate', unit: 'word', prompt: 'ipa', response: 'wordTyped', title: 'Transcription → type the word' },
];

export const IPA_GAMES_BY_ID = Object.fromEntries(IPA_GAMES.map((game) => [game.id, game])) as Record<IpaGameId, IpaGameDef>;

export function isIpaGameId(value: unknown): value is IpaGameId {
  return typeof value === 'string' && value in IPA_GAMES_BY_ID;
}

// Which sounds are practised: the sounds of English, or every sound.
export type IpaSoundSet = 'english' | 'all';

// Something to play: a sound on its own, an example word of the inventory or
// a word of one of your languages. When nothing is stored, words are spoken
// by the device's voice (`locale`).
export interface IpaAudioRef {
  kind: 'sound' | 'example' | 'word';
  text: string;
  // "ipa" for sounds, the language of an example ("en", "fr"…) or a language id.
  lang: string;
  locale: string;
}

export interface IpaWord {
  word: string;
  ipa: string;
  lang: string;
  langName: string;
  gloss?: string;
  audio: IpaAudioRef;
}

export interface IpaOption {
  // A symbol, a transcription or a word.
  text: string;
  correct: boolean;
  // The sound this option stands for, and whether picking it wrongly counts
  // against it too (only for sounds met before in this phase).
  symbol?: string;
  scored?: boolean;
  audio?: IpaAudioRef;
  word?: IpaWord;
}

export interface IpaQuestion {
  key: string;
  gameId: IpaGameId;
  phase: Phase;
  // The sound practised.
  symbol: string;
  sound: { symbol: string; name: string; kind: SoundKind };
  word?: IpaWord;
  audio?: IpaAudioRef;
  // Recall: words with the sound left out of their transcription ("_ɪn").
  examples?: (IpaWord & { blanked: string })[];
  options?: IpaOption[];
  answer: string;
  // Sounds whose result counts: the sound practised and the sounds of the
  // word met before in this phase.
  scored: string[];
}

export interface IpaNextRequest {
  gameId: IpaGameId;
  recent: string[];
  sounds: IpaSoundSet;
  // "examples" (the example words of each sound) or the id of one of your
  // languages (its words with an IPA pronunciation).
  words: string;
}

export interface IpaNextResponse {
  question: IpaQuestion | null;
  notice: string | null;
}

export interface IpaResult {
  symbol: string;
  phase: Phase;
  correct: boolean;
}

// A stored recording and where it came from: "commons:<file name>" (Wikimedia
// Commons) or the key of a voice service ("colab:en-US-AriaNeural").
export interface IpaRecording {
  id: number;
  source: string;
  license: string | null;
  author: string | null;
  url: string | null;
  createdAt: number;
}

export interface IpaSoundSummary {
  symbol: string;
  name: string;
  kind: SoundKind;
  english: boolean;
  // Commons file of the sound on its own, when one is known.
  file: string | null;
  recordings: IpaRecording[];
  examples: (IpaExample & { langName: string; recordings: IpaRecording[] })[];
  levels: WordLevels;
  correct: number;
  wrong: number;
}

export interface IpaSummary {
  sounds: IpaSoundSummary[];
  required: Record<Phase, number>;
  // Your languages with words that have an IPA pronunciation.
  languages: { id: string; name: string; words: number }[];
  download: { sounds: number; soundFiles: number; words: number; wordTotal: number };
}
