import type { GameId, Phase, PromptMode, ResponseMode, Side } from './games.js';

// ---------------------------------------------------------------------------
// Languages, words, sentences and sources

export interface LanguageConfig {
  id: string;
  name: string;
  code: string;
  locale: string;
  rtl: boolean;
  detectProperNouns: boolean;
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

export interface WordRow {
  id: number;
  word: string;
  display: string;
  rank: number | null;
  count: number;
  score: number;
  english: string[];
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

export interface SentenceRow {
  id: number;
  text: string;
  english: string | null;
  translationSource: string | null;
  sourceId: number | null;
  wordCount: number;
  maxRank: number | null;
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
  sentence?: { id: number; text: string; english: string | null; tokens: SentenceToken[] };
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
export type TtsProvider = 'browser' | 'colab' | 'openai' | 'google';
export type SttProvider = 'browser' | 'colab' | 'openai';

export interface LearningSettings {
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
  batchPreview: boolean;
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
    englishVoice: string;
    rate: number;
  };
  stt: {
    provider: SttProvider;
    openai: { baseUrl: string; apiKey: string; model: string };
  };
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

export interface JudgeResponse {
  correct: boolean;
  feedback: string;
}
