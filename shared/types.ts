import type { GameId, Phase, PromptMode, ResponseMode, Side } from './games.js';

// ---------------------------------------------------------------------------
// Languages, words, sentences and sources

// How answers in the foreign language are typed.
export type InputMethod = 'auto' | 'system' | 'letters' | 'phonetic' | 'pinyin' | 'japanese' | 'hangul';

// How sources combine into word frequencies: every source counts the same
// (per million words), or bigger texts count more (pooled word counts).
export type SourceWeighting = 'equal' | 'size';

export interface LanguageConfig {
  id: string;
  name: string;
  code: string;
  locale: string;
  rtl: boolean;
  detectProperNouns: boolean;
  inputMethod: InputMethod;
  sourceWeighting: SourceWeighting;
  extraCharacters: string[]; // empty = derived automatically from the corpus
  minSentenceWords: number;
  maxSentenceWords: number;
  ttsVoice: string;
  createdAt: number;
}

export interface LanguageSummary extends LanguageConfig {
  wordCount: number;
  definedWordCount: number;
  sentenceCount: number;
  translatedSentenceCount: number;
  excludedSentenceCount: number;
  learnedCount: number;
  dueCount: number;
  sourceCount: number;
  autoCharacters: string[];
}

export interface WordLevels {
  recognition: number;
  recall: number;
  recite: number;
  translate: number;
}

// A stored audio recording of a word or sentence, and the voice that made it
// ("colab:es-ES-ElviraNeural", "azure:…", "legacy-male"...).
export interface Recording {
  id: number;
  voice: string;
  createdAt: number;
}

export interface WordRow {
  id: number;
  word: string;
  display: string;
  rank: number | null;
  count: number;
  score: number;
  english: string[];
  // Where each English meaning came from ("wiktionary", "llm:…", "manual"...).
  englishSources: string[];
  // Books and word lists the word was found in (listings only).
  origins?: { title: string; count: number }[];
  audio?: Recording[];
  pronunciation: string | null;
  pos: string | null;
  definitionSource: string | null;
  active: boolean;
  properNoun: boolean;
  userExcluded: boolean | null;
  sentenceCount: number;
  translatedSentenceCount: number;
  levels: WordLevels;
  srsStage: number;
  nextReviewAt: number | null;
  reviewing: boolean;
  lastSeenAt: number | null;
}

// Why a sentence was taken out of the questions.
export type SentenceExclusion = 'translation' | 'nonsense' | 'audio' | 'other';

export interface SentenceRow {
  id: number;
  text: string;
  english: string | null;
  translationSource: string | null;
  sourceId: number | null;
  wordCount: number;
  maxRank: number | null;
  excludedReason: SentenceExclusion | null;
  excludedAt: number | null;
  // The book or text the sentence comes from.
  sourceTitle: string | null;
  // Every translation with its source; the first is the main one (english).
  translations: { id: number; english: string; source: string }[];
  // Stored recordings of the sentence and of its main translation.
  audio: Recording[];
  englishAudio: Recording[];
}

export interface SourceRow {
  id: number;
  kind: 'book' | 'text' | 'wordlist' | 'generated' | 'legacy';
  title: string;
  url: string | null;
  tokenCount: number;
  sentenceCount: number;
  wordCount: number;
  weight: number;
  addedAt: number;
}

export interface Paged<T> {
  rows: T[];
  total: number;
}

// ---------------------------------------------------------------------------
// Questions and answers

export interface ChoiceOption {
  text: string;
  wordId: number;
  correct: boolean;
  evaluate: boolean;
}

export interface AcceptedAnswer {
  text: string;
  wordId: number | null;
  evaluate: boolean;
}

export interface SentenceToken {
  text: string;
  wordId: number | null;
  evaluate: boolean;
  target: boolean;
  // Why a word is not scored: not counted (a name or excluded word), not met
  // yet, or further on in the vocabulary.
  skip?: 'excluded' | 'unseen' | 'later';
}

export interface QuestionWord {
  id: number;
  display: string;
  english: string[];
  pronunciation: string | null;
  pos: string | null;
}

export interface Question {
  key: string;
  gameId: GameId;
  phase: Phase;
  targetWordId: number;
  prompt: { mode: PromptMode; side: Side; text: string; imageId?: number; memorize: boolean };
  response: { mode: ResponseMode; side: Side };
  options?: ChoiceOption[];
  accepted?: AcceptedAnswer[];
  sentence?: {
    id: number;
    // The sentence, or the part of it a recite question asks for.
    text: string;
    // Main translation, and every translation (answers are checked against all).
    english: string | null;
    translations: string[];
    tokens: SentenceToken[];
    // Recite questions on long sentences: the whole sentence, and which part this is.
    full?: string;
    part?: { index: number; count: number };
  };
  // Translate questions: the words of the sentence that are not scored (not
  // met yet, further on, names), given with their meanings.
  hints?: { text: string; english: string[] }[];
  answer: string;
  answerSide: Side;
  words: QuestionWord[];
  imageLabels?: string[];
  filler?: boolean;
}

export interface WordResult {
  wordId: number;
  phase: Phase;
  correct: boolean;
}

export type SessionMode = 'learn' | 'review' | 'free';

export interface BatchWord {
  id: number;
  rank: number | null;
  display: string;
  english: string[];
  pronunciation: string | null;
  levels: WordLevels;
  ready: boolean;
  srsStage: number;
}

export interface SessionState {
  mode: SessionMode;
  block: number | null;
  phase: Phase | null;
  batch: number | null;
  batchWords: BatchWord[];
  newBatch: boolean;
  frontier: number;
}

export type NoticeKind = 'empty' | 'missingDefinitions' | 'noQuestion' | 'reviewsDone' | 'complete';

export interface Notice {
  kind: NoticeKind;
  message: string;
  words?: BatchWord[];
  nextDueAt?: number | null;
}

export interface NextResponse {
  state: SessionState;
  question: Question | null;
  notice: Notice | null;
}

export interface ResultsResponse {
  learned: number[];
  reviewed: number[];
  levels: Record<number, WordLevels>;
  // Takes these results back (when the question is reported as bad).
  undoId: string;
}

// ---------------------------------------------------------------------------
// Progress

export interface ProgressSummary {
  totalWords: number;
  readyWords: number;
  learnedWords: number;
  reviewingWords: number;
  dueNow: number;
  dueToday: number;
  nextDueAt: number | null;
  learn: SessionState | null;
  learnNotice: Notice | null;
  phaseLevels: Record<Phase, number[]>;
  srsStages: number[];
  upcoming: { day: string; count: number }[];
  activity: { day: string; correct: number; wrong: number }[];
  streak: number;
  blocks: { block: number; words: number; learned: number; complete: Record<Phase, number>; applicable: Record<Phase, number> }[];
}

// ---------------------------------------------------------------------------
// Settings

export type LlmProvider = 'none' | 'colab' | 'openai' | 'anthropic';
export type DefinitionProvider = 'llm' | 'wiktionary';
export type TranslationProvider = 'llm' | 'deepl' | 'google' | 'libretranslate';
export type TtsProvider = 'browser' | 'colab' | 'openai' | 'google' | 'azure' | 'elevenlabs';
export type SttProvider = 'browser' | 'colab' | 'openai';

export type BatchPreviewMode = 'every' | 'new' | 'off';
export type ProgressionOrder = 'phase' | 'batch';

export interface LearningSettings {
  // Correct answers needed to master a word in each phase.
  requiredCorrect: Record<Phase, number>;
  // 'phase': all batches of a block go through recognition, then recall...
  // 'batch': each batch goes through all four phases before the next batch.
  progressionOrder: ProgressionOrder;
  disableSpeaking: boolean;
  disableListening: boolean;
  disabledGames: GameId[];
  choiceCount: number;
  accentLenient: boolean;
  typoTolerance: boolean;
  sentenceThreshold: number;
  speechThreshold: number;
  autoAdvanceMs: number;
  retypeOnMistake: boolean;
  // Stay on the feedback when a typed answer was accepted but not spelled exactly.
  pauseOnInexact: boolean;
  // Recite questions: longer sentences are split into parts of at most this
  // many words (0 = whole sentences).
  reciteMaxWords: number;
  // Size of the text of questions and answers, in percent.
  questionTextScale: number;
  batchPreview: BatchPreviewMode;
  memorizeHide: boolean;
  playAudioOnFeedback: boolean;
  pomodoro: boolean;
  pomodoroWorkMinutes: number;
  pomodoroBreakMinutes: number;
  autoPrepare: boolean;
  reviewFirst: boolean;
  llmJudge: boolean;
}

export interface AppSettings {
  colab: { url: string; model: string };
  llm: {
    provider: LlmProvider;
    openai: { baseUrl: string; apiKey: string; model: string };
    anthropic: { apiKey: string; model: string };
    batchSize: number;
  };
  definitions: { provider: DefinitionProvider; batchSize: number };
  translation: {
    provider: TranslationProvider;
    deepl: { apiKey: string };
    google: { apiKey: string };
    libretranslate: { url: string; apiKey: string };
    batchSize: number;
  };
  tts: {
    provider: TtsProvider;
    openai: { baseUrl: string; apiKey: string; model: string; voice: string };
    google: { apiKey: string };
    azure: { apiKey: string; region: string };
    elevenlabs: { apiKey: string; model: string; voice: string; baseUrl: string };
    englishVoice: string;
    rate: number;
  };
  stt: {
    provider: SttProvider;
    openai: { baseUrl: string; apiKey: string; model: string };
  };
  huggingface: { token: string; repo: string; private: boolean; hubUrl: string };
  learning: LearningSettings;
}

// ---------------------------------------------------------------------------
// Jobs, images, misc

export type JobStatus = 'running' | 'done' | 'error' | 'cancelled';

export interface JobInfo {
  id: string;
  langId: string | null;
  type: string;
  title: string;
  status: JobStatus;
  done: number;
  total: number;
  message: string;
  error: string | null;
  startedAt: number;
  finishedAt: number | null;
}

export interface ImageRow {
  id: number;
  labels: string[];
  status: 'labeled' | 'pending';
  source: string | null;
  sourceUrl: string | null;
  license: string | null;
  attribution: string | null;
  createdAt: number;
}

export interface GutenbergBook {
  id: number;
  title: string;
  authors: string[];
  downloads: number;
  textUrl: string | null;
  imported: boolean;
}

// Dictionary used by the Chinese (pinyin) and Japanese (romaji) input methods:
// [word, key, frequency rank]. Pinyin keys separate syllables with "'".
export interface InputIndex {
  method: 'pinyin' | 'japanese' | null;
  entries: [string, string, number][];
}

export interface HubBackup {
  path: string;
  size: number;
  updatedAt: string | null;
}

export interface JudgeResponse {
  correct: boolean;
  feedback: string;
}
