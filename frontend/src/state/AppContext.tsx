import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, errorMessage } from '../api';
import type { AppSettings, JobInfo, LanguageSummary } from '../../../shared/types';

export interface Toast {
  id: number;
  message: string;
  kind: 'info' | 'success' | 'error';
}

interface AppState {
  ready: boolean;
  backendError: string | null;
  languages: LanguageSummary[];
  language: LanguageSummary | null;
  languageId: string | null;
  selectLanguage(id: string | null): void;
  refreshLanguages(): Promise<LanguageSummary[]>;
  settings: AppSettings | null;
  saveSettings(next: AppSettings): Promise<void>;
  jobs: JobInfo[];
  trackJob(job: JobInfo | null | undefined): void;
  cancelJob(id: string): Promise<void>;
  toasts: Toast[];
  notify(message: string, kind?: Toast['kind']): void;
  dismissToast(id: number): void;
}

const AppContext = createContext<AppState | null>(null);
const LANGUAGE_KEY = 'lang.selectedLanguage';

function storedLanguage(): string | null {
  try {
    return localStorage.getItem(LANGUAGE_KEY);
  } catch {
    return null;
  }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [backendError, setBackendError] = useState<string | null>(null);
  const [languages, setLanguages] = useState<LanguageSummary[]>([]);
  const [languageId, setLanguageId] = useState<string | null>(storedLanguage());
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [jobs, setJobs] = useState<JobInfo[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);
  const knownJobs = useRef(new Map<string, JobInfo['status']>());

  const notify = useCallback((message: string, kind: Toast['kind'] = 'info') => {
    const id = ++toastId.current;
    setToasts((current) => [...current.slice(-4), { id, message, kind }]);
    window.setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), kind === 'error' ? 9000 : 5000);
  }, []);

  const dismissToast = useCallback((id: number) => setToasts((current) => current.filter((toast) => toast.id !== id)), []);

  const refreshLanguages = useCallback(async () => {
    const list = await api.languages();
    setLanguages(list);
    return list;
  }, []);

  const selectLanguage = useCallback((id: string | null) => {
    setLanguageId(id);
    try {
      if (id) localStorage.setItem(LANGUAGE_KEY, id);
      else localStorage.removeItem(LANGUAGE_KEY);
    } catch {
      // storage unavailable: selection lasts for this session only
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const [list, loadedSettings] = await Promise.all([api.languages(), api.settings()]);
        setLanguages(list);
        setSettings(loadedSettings);
        setJobs(await api.jobs());
        setBackendError(null);
      } catch (error) {
        setBackendError(errorMessage(error));
      } finally {
        setReady(true);
      }
    })();
  }, []);

  // Keep the selection valid when languages are added or removed.
  useEffect(() => {
    if (!ready) return;
    if (languages.length === 0) {
      if (languageId) selectLanguage(null);
    } else if (!languageId || !languages.some((language) => language.id === languageId)) {
      selectLanguage(languages[0].id);
    }
  }, [ready, languages, languageId, selectLanguage]);

  const saveSettings = useCallback(
    async (next: AppSettings) => {
      setSettings(next);
      try {
        setSettings(await api.saveSettings(next));
      } catch (error) {
        notify(`Settings not saved: ${errorMessage(error)}`, 'error');
      }
    },
    [notify]
  );

  // Poll background jobs while any is running and report when they finish.
  const running = jobs.some((job) => job.status === 'running');
  const pollJobs = useCallback(async () => {
    try {
      const list = await api.jobs();
      let finished = false;
      for (const job of list) {
        const previous = knownJobs.current.get(job.id);
        if (previous === 'running' && job.status !== 'running') {
          finished = true;
          if (job.status === 'done') notify(`${job.title}: ${job.message}`, 'success');
          if (job.status === 'error') notify(`${job.title} failed: ${job.error}`, 'error');
        }
        knownJobs.current.set(job.id, job.status);
      }
      setJobs(list);
      if (finished) await refreshLanguages();
    } catch {
      // backend temporarily unavailable
    }
  }, [notify, refreshLanguages]);

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(pollJobs, 1200);
    return () => window.clearInterval(timer);
  }, [running, pollJobs]);

  const trackJob = useCallback((job: JobInfo | null | undefined) => {
    if (!job) return;
    knownJobs.current.set(job.id, job.status);
    setJobs((current) => [job, ...current.filter((existing) => existing.id !== job.id)]);
  }, []);

  const cancelJob = useCallback(
    async (id: string) => {
      await api.cancelJob(id);
      await pollJobs();
    },
    [pollJobs]
  );

  const language = languages.find((entry) => entry.id === languageId) ?? null;

  const value = useMemo<AppState>(
    () => ({
      ready,
      backendError,
      languages,
      language,
      languageId: language?.id ?? null,
      selectLanguage,
      refreshLanguages,
      settings,
      saveSettings,
      jobs,
      trackJob,
      cancelJob,
      toasts,
      notify,
      dismissToast,
    }),
    [ready, backendError, languages, language, selectLanguage, refreshLanguages, settings, saveSettings, jobs, trackJob, cancelJob, toasts, notify, dismissToast]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppState {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used inside AppProvider');
  return context;
}

// Runs an action, reporting failures as toasts. Returns the result or undefined.
export function useAction() {
  const { notify } = useApp();
  return useCallback(
    async <T,>(action: () => Promise<T>, success?: string): Promise<T | undefined> => {
      try {
        const result = await action();
        if (success) notify(success, 'success');
        return result;
      } catch (error) {
        notify(errorMessage(error), 'error');
        return undefined;
      }
    },
    [notify]
  );
}
