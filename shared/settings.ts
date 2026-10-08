import type { AppSettings } from './types.js';

export const DEFAULT_SETTINGS: AppSettings = {
  colab: { url: '', model: 'qwen2.5:7b' },
  llm: {
    provider: 'none',
    openai: { baseUrl: 'https://api.openai.com/v1', apiKey: '', model: 'gpt-4o-mini' },
    anthropic: { apiKey: '', model: 'claude-opus-5-5' },
    batchSize: 40,
  },
  definitions: { provider: 'wiktionary', batchSize: 40 },
  translation: {
    provider: 'llm',
    deepl: { apiKey: '' },
    google: { apiKey: '' },
    libretranslate: { url: 'https://libretranslate.com', apiKey: '' },
    batchSize: 20,
  },
  tts: {
    provider: 'browser',
    openai: { baseUrl: 'https://api.openai.com/v1', apiKey: '', model: 'tts-1', voice: 'alloy' },
    google: { apiKey: '' },
    englishVoice: '',
    rate: 1,
  },
  stt: {
    provider: 'browser',
    openai: { baseUrl: 'https://api.openai.com/v1', apiKey: '', model: 'whisper-1' },
  },
  huggingface: { token: '', repo: '', private: true, hubUrl: 'https://huggingface.co' },
  learning: {
    requiredCorrect: { recognition: 2, recall: 3, recite: 2, translate: 3 },
    progressionOrder: 'phase',
    disableSpeaking: false,
    disableListening: false,
    disabledGames: [],
    choiceCount: 4,
    accentLenient: true,
    typoTolerance: true,
    sentenceThreshold: 0.8,
    speechThreshold: 0.7,
    autoAdvanceMs: 900,
    retypeOnMistake: true,
    pauseOnInexact: true,
    batchPreview: 'every',
    memorizeHide: true,
    playAudioOnFeedback: true,
    pomodoro: true,
    pomodoroWorkMinutes: 25,
    pomodoroBreakMinutes: 5,
    autoPrepare: true,
    reviewFirst: true,
    llmJudge: false,
  },
};

// Settings fields that hold secrets. They are masked when sent to the UI.
export const SECRET_PATHS: string[][] = [
  ['llm', 'openai', 'apiKey'],
  ['llm', 'anthropic', 'apiKey'],
  ['translation', 'deepl', 'apiKey'],
  ['translation', 'google', 'apiKey'],
  ['translation', 'libretranslate', 'apiKey'],
  ['tts', 'openai', 'apiKey'],
  ['tts', 'google', 'apiKey'],
  ['stt', 'openai', 'apiKey'],
  ['huggingface', 'token'],
];

export const MASK_PREFIX = '••••';

export function maskSecret(value: string): string {
  if (!value) return '';
  return MASK_PREFIX + value.slice(-4);
}

// Deep merge used to fill in defaults for settings saved by older versions.
export function mergeDeep<T>(base: T, override: unknown): T {
  if (Array.isArray(base)) {
    return (Array.isArray(override) ? override : base) as T;
  }
  if (base && typeof base === 'object') {
    const result: Record<string, unknown> = { ...(base as Record<string, unknown>) };
    if (override && typeof override === 'object' && !Array.isArray(override)) {
      for (const [key, value] of Object.entries(override as Record<string, unknown>)) {
        if (!(key in result)) continue;
        result[key] = mergeDeep(result[key], value);
      }
    }
    return result as T;
  }
  if (override === undefined || override === null) return base;
  return (typeof override === typeof base ? override : base) as T;
}
