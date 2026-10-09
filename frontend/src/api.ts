import type { GameId } from '../../shared/games';
import type {
  AppSettings,
  GutenbergBook,
  HubBackup,
  ImageRow,
  InputIndex,
  JobInfo,
  JudgeResponse,
  LanguageConfig,
  LanguageSummary,
  NextResponse,
  Paged,
  ProgressSummary,
  ResultsResponse,
  SentenceExclusion,
  SentenceRow,
  SourceRow,
  TranslationProvider,
  TtsProvider,
  WordResult,
  WordRow,
} from '../../shared/types';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown, raw?: { data: Blob | ArrayBuffer; type: string }): Promise<T> {
  const init: RequestInit = { method };
  if (raw) {
    init.body = raw.data;
    init.headers = { 'Content-Type': raw.type || 'application/octet-stream' };
  } else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { 'Content-Type': 'application/json' };
  }
  let response: Response;
  try {
    response = await fetch(`/api${path}`, init);
  } catch {
    throw new ApiError('Cannot reach the app backend. Is it running?', 0);
  }
  if (!response.ok) {
    let message = response.statusText;
    try {
      message = ((await response.json()) as { error?: string }).error ?? message;
    } catch {
      // keep status text
    }
    throw new ApiError(message, response.status);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

const get = <T>(path: string) => request<T>('GET', path);
const post = <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {});
const put = <T>(path: string, body: unknown) => request<T>('PUT', path, body);
const del = <T>(path: string) => request<T>('DELETE', path);

function query(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

const L = (id: string) => `/languages/${encodeURIComponent(id)}`;

export const api = {
  // Languages
  languages: () => get<LanguageSummary[]>('/languages'),
  language: (id: string) => get<LanguageSummary>(L(id)),
  createLanguage: (config: Partial<LanguageConfig> & { name: string }) => post<LanguageSummary>('/languages', config),
  updateLanguage: (id: string, patch: Partial<LanguageConfig>) => put<LanguageSummary>(L(id), patch),
  deleteLanguage: (id: string) => del<{ ok: true }>(L(id)),
  rebuild: (id: string) => post<LanguageSummary>(`${L(id)}/rebuild`),

  // Sources
  sources: (id: string) => get<SourceRow[]>(`${L(id)}/sources`),
  addUrl: (id: string, url: string, title?: string) => post<JobInfo>(`${L(id)}/sources/url`, { url, title }),
  addText: (id: string, title: string, text: string) => post<JobInfo>(`${L(id)}/sources/text`, { title, text }),
  addWordList: (id: string, title: string, csv: string) => post<JobInfo>(`${L(id)}/sources/wordlist`, { title, csv }),
  addGutenbergTop: (id: string, count: number) => post<JobInfo>(`${L(id)}/sources/gutenberg`, { count }),
  searchGutenberg: (id: string, q: string, page: number) =>
    get<{ books: GutenbergBook[]; hasMore: boolean }>(`${L(id)}/gutenberg${query({ q, page })}`),
  updateSource: (id: string, sourceId: number, patch: { title?: string; weight?: number }) =>
    put<SourceRow[]>(`${L(id)}/sources/${sourceId}`, patch),
  deleteSource: (id: string, sourceId: number) => del<SourceRow[]>(`${L(id)}/sources/${sourceId}`),

  // Words & sentences
  words: (id: string, params: { offset: number; limit: number; q?: string; filter?: string; sort?: string }) =>
    get<Paged<WordRow>>(`${L(id)}/words${query(params)}`),
  updateWord: (
    id: string,
    wordId: number,
    patch: { english?: string[]; pronunciation?: string | null; pos?: string | null; excluded?: boolean | null }
  ) => put<WordRow>(`${L(id)}/words/${wordId}`, patch),
  resetWord: (id: string, wordId: number) => post<WordRow>(`${L(id)}/words/${wordId}/reset`),
  sentences: (id: string, params: { offset: number; limit: number; q?: string; filter?: string; word?: number }) =>
    get<Paged<SentenceRow>>(`${L(id)}/sentences${query(params)}`),
  updateSentence: (id: string, sentenceId: number, english: string | null) =>
    put<{ ok: true }>(`${L(id)}/sentences/${sentenceId}`, { english }),
  deleteSentence: (id: string, sentenceId: number) => del<{ ok: true }>(`${L(id)}/sentences/${sentenceId}`),
  excludeSentence: (id: string, sentenceId: number, reason: SentenceExclusion, undoId?: string) =>
    post<{ ok: true; undone: boolean }>(`${L(id)}/sentences/${sentenceId}/exclude`, { reason, undoId }),
  restoreSentence: (id: string, sentenceId: number) => post<{ ok: true }>(`${L(id)}/sentences/${sentenceId}/restore`),
  retranslateSentences: (id: string, body: { ids?: number[]; provider?: TranslationProvider }) =>
    post<JobInfo>(`${L(id)}/sentences/retranslate`, body),
  regenerateSentenceAudio: (id: string, body: { ids?: number[]; provider?: TtsProvider; voice?: string }) =>
    post<JobInfo>(`${L(id)}/sentences/regenerate-audio`, body),

  // Settings, services and jobs
  settings: () => get<AppSettings>('/settings'),
  saveSettings: (settings: AppSettings) => put<AppSettings>('/settings', settings),
  testService: (service: 'llm' | 'tts' | 'translation', lang?: string) =>
    post<{ ok: boolean; message: string }>('/services/test', { service, lang }),
  jobs: (lang?: string) => get<JobInfo[]>(`/jobs${query({ lang })}`),
  cancelJob: (jobId: string) => post<{ cancelled: boolean }>(`/jobs/${jobId}/cancel`),
  fetchDefinitions: (id: string, limit: number, overwrite = false) => post<JobInfo>(`${L(id)}/definitions`, { limit, overwrite }),
  translateSentences: (id: string, limit: number) => post<JobInfo>(`${L(id)}/translations`, { limit }),
  generateSentences: (id: string, limit: number, minSentences: number) =>
    post<JobInfo>(`${L(id)}/generate-sentences`, { limit, minSentences }),
  generateAudio: (id: string, words: number, sentences: number) => post<JobInfo>(`${L(id)}/audio`, { words, sentences }),
  suggestImages: (id: string, words: number, perWord: number) => post<JobInfo>(`${L(id)}/images/suggest`, { words, perWord }),
  prepare: (id: string) => post<JobInfo | null>(`${L(id)}/prepare`),
  autopilot: (id: string, words: number) => post<JobInfo>(`${L(id)}/autopilot`, { words }),
  colabJobUrl: (id: string, type: 'definitions' | 'translations', limit: number) =>
    `/api${L(id)}/colab-job${query({ type, limit })}`,
  colabResults: (id: string, results: unknown) => post<{ saved: number }>(`${L(id)}/colab-results`, results),

  inputIndex: (id: string) => get<InputIndex>(`${L(id)}/input-index`),

  // Learning
  sessionNext: (id: string, body: { mode: 'learn' | 'review'; recent: number[]; lastGameId: GameId | null }) =>
    post<NextResponse>(`${L(id)}/session/next`, body),
  playNext: (id: string, body: { gameId: GameId; batch: number; cumulative: boolean; recent: number[] }) =>
    post<NextResponse>(`${L(id)}/play/next`, body),
  results: (id: string, results: WordResult[]) => post<ResultsResponse>(`${L(id)}/results`, { results }),
  judge: (id: string, body: { direction: 'toEnglish' | 'toForeign'; source: string; reference: string; answer: string }) =>
    post<JudgeResponse>(`${L(id)}/judge`, body),
  progress: (id: string) => get<ProgressSummary>(`${L(id)}/progress`),
  resetProgress: (id: string) => post<{ ok: true }>(`${L(id)}/progress/reset`),

  // Audio
  audioUrl: (target: string, text: string) => `/api/audio${query({ lang: target, text })}`,
  transcribe: (target: string, audio: Blob) =>
    request<{ text: string }>('POST', `/stt${query({ lang: target })}`, undefined, { data: audio, type: audio.type }),

  // English words & images
  englishWords: (q: string) => get<string[]>(`/english/words${query({ q })}`),
  englishStats: () => get<{ labeled: number; pending: number; englishWords: number }>('/english/stats'),
  images: (params: { status?: string; q?: string; offset: number; limit: number }) =>
    get<Paged<ImageRow>>(`/english/images${query(params)}`),
  imageUrl: (imageId: number) => `/api/english/images/${imageId}/file`,
  uploadImage: (file: File, options: { labels?: string[]; review?: boolean }) =>
    request<{ id: number | null }>(
      'POST',
      `/english/images${query({ name: file.name, labels: options.labels?.join(','), review: options.review ? 1 : undefined })}`,
      undefined,
      { data: file, type: file.type || 'image/jpeg' }
    ),
  updateImage: (imageId: number, patch: { labels?: string[]; status?: 'labeled' | 'pending' }) =>
    put<ImageRow>(`/english/images/${imageId}`, patch),
  deleteImage: (imageId: number) => del<{ ok: true }>(`/english/images/${imageId}`),

  // Backups
  exportLanguageUrl: (id: string) => `/api${L(id)}/export`,
  importLanguage: (file: File) => request<LanguageSummary>('POST', '/import/language', undefined, { data: file, type: 'application/zip' }),
  exportEnglishUrl: () => '/api/english/export',
  importEnglish: (file: File) => request<{ ok: true }>('POST', '/import/english', undefined, { data: file, type: 'application/zip' }),
  hubUpload: (target: { kind: 'language'; lang: string } | { kind: 'english' }) => post<JobInfo>('/huggingface/upload', target),
  hubBackups: () => get<{ repo: string; url: string; backups: HubBackup[] }>('/huggingface/backups'),
  hubRestore: (path: string) => post<JobInfo>('/huggingface/restore', { path }),
  legacy: () => get<{ available: boolean; imported: boolean }>('/legacy'),
  importLegacy: () => post<{ message: string }>('/legacy/import'),
};

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
