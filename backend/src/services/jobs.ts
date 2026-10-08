import { randomUUID } from 'node:crypto';
import type { JobInfo } from '../../../shared/types.js';

export class JobCancelled extends Error {
  constructor() {
    super('Cancelled');
  }
}

export interface JobContext {
  progress(done: number, total: number, message?: string): void;
  message(message: string): void;
  // Throws JobCancelled when the user cancelled the job. Call between batches.
  checkCancelled(): void;
  readonly cancelled: boolean;
}

interface JobEntry {
  info: JobInfo;
  cancelRequested: boolean;
}

const jobs = new Map<string, JobEntry>();
const MAX_FINISHED = 30;

function prune(): void {
  const finished = [...jobs.values()]
    .filter((job) => job.info.status !== 'running')
    .sort((a, b) => (b.info.finishedAt ?? 0) - (a.info.finishedAt ?? 0));
  for (const job of finished.slice(MAX_FINISHED)) jobs.delete(job.info.id);
}

// Starts a long running task (book import, translation batches, audio...).
// Only one job of a given type runs per language at a time.
export function startJob(
  langId: string | null,
  type: string,
  title: string,
  run: (ctx: JobContext) => Promise<string | void>
): JobInfo {
  const existing = [...jobs.values()].find(
    (job) => job.info.status === 'running' && job.info.type === type && job.info.langId === langId
  );
  if (existing) return existing.info;

  const entry: JobEntry = {
    cancelRequested: false,
    info: {
      id: randomUUID(),
      langId,
      type,
      title,
      status: 'running',
      done: 0,
      total: 0,
      message: 'Starting…',
      error: null,
      startedAt: Date.now(),
      finishedAt: null,
    },
  };
  jobs.set(entry.info.id, entry);

  const ctx: JobContext = {
    progress(done, total, message) {
      entry.info.done = done;
      entry.info.total = total;
      if (message !== undefined) entry.info.message = message;
    },
    message(message) {
      entry.info.message = message;
    },
    checkCancelled() {
      if (entry.cancelRequested) throw new JobCancelled();
    },
    get cancelled() {
      return entry.cancelRequested;
    },
  };

  // Let the HTTP response return before heavy synchronous work starts.
  setImmediate(async () => {
    try {
      const summary = await run(ctx);
      entry.info.status = 'done';
      entry.info.message = summary || 'Finished';
    } catch (error) {
      if (error instanceof JobCancelled) {
        entry.info.status = 'cancelled';
        entry.info.message = 'Cancelled';
      } else {
        entry.info.status = 'error';
        entry.info.error = (error as Error).message;
        entry.info.message = 'Failed';
        console.error(`Job "${title}" failed:`, error);
      }
    } finally {
      entry.info.finishedAt = Date.now();
      prune();
    }
  });
  return entry.info;
}

export function listJobs(langId?: string): JobInfo[] {
  return [...jobs.values()]
    .map((job) => job.info)
    .filter((info) => !langId || info.langId === langId || info.langId === null)
    .sort((a, b) => b.startedAt - a.startedAt);
}

export function cancelJob(id: string): boolean {
  const job = jobs.get(id);
  if (!job || job.info.status !== 'running') return false;
  job.cancelRequested = true;
  job.info.message = 'Cancelling…';
  return true;
}

export function isJobRunning(langId: string, type: string): boolean {
  return [...jobs.values()].some((job) => job.info.status === 'running' && job.info.langId === langId && job.info.type === type);
}

// Yields to the event loop so the server stays responsive during long jobs.
export function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
