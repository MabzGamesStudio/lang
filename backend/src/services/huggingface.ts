import { createRepo, downloadFile, listFiles, uploadFile, whoAmI } from '@huggingface/hub';
import { HttpError } from '../db/connection.js';
import { getSettings } from './settings.js';
import { proxyFetch } from './http.js';
import { exportEnglish, exportLanguage, importEnglish, importLanguage } from './backup.js';
import type { JobContext } from './jobs.js';
import type { HubBackup } from '../../../shared/types.js';

// Backups on the Hugging Face Hub, in a dataset repository:
//   languages/<id>.zip   one zip per language (same format as the download)
//   english-images.zip   English words, images and English audio

const DEFAULT_HUB = 'https://huggingface.co';

interface HubTarget {
  accessToken: string;
  hubUrl: string;
  repo: { type: 'dataset'; name: string };
  visibility: 'private' | 'public';
}

export function repoName(input: string): string {
  return input
    .trim()
    .replace(/^https?:\/\/[^/]+\/(datasets\/)?/, '')
    .replace(/\/(tree|blob)\/.*$/, '')
    .replace(/\/+$/, '');
}

async function hubTarget(): Promise<HubTarget> {
  const settings = getSettings().huggingface;
  const accessToken = settings.token.trim();
  if (!accessToken) {
    throw new HttpError(400, 'Add a Hugging Face access token with write permission in Configuration → Save & transfer.');
  }
  const hubUrl = (settings.hubUrl.trim() || DEFAULT_HUB).replace(/\/+$/, '');
  let name = repoName(settings.repo) || 'lang-data';
  if (!name.includes('/')) {
    const me = await whoAmI({ accessToken, hubUrl, fetch: proxyFetch });
    name = `${me.name}/${name}`;
  }
  return {
    accessToken,
    hubUrl,
    repo: { type: 'dataset', name },
    visibility: settings.private ? 'private' : 'public',
  };
}

function statusOf(error: unknown): number | undefined {
  return (error as { statusCode?: number }).statusCode;
}

async function ensureRepo(target: HubTarget): Promise<void> {
  try {
    await createRepo({
      repo: target.repo,
      accessToken: target.accessToken,
      hubUrl: target.hubUrl,
      visibility: target.visibility,
      fetch: proxyFetch,
    });
  } catch (error) {
    // Already exists: fine.
    if (statusOf(error) !== 409 && !/already (exists|created)/i.test((error as Error).message)) throw error;
  }
}

export function repoUrl(target: { hubUrl: string; repo: { name: string } }): string {
  return `${target.hubUrl}/datasets/${target.repo.name}`;
}

export async function uploadToHub(
  what: { kind: 'language'; langId: string } | { kind: 'english' },
  ctx: JobContext
): Promise<string> {
  const target = await hubTarget();
  ctx.message('Creating the backup zip…');
  const backup = what.kind === 'language' ? await exportLanguage(what.langId) : await exportEnglish();
  const path = what.kind === 'language' ? `languages/${what.langId}.zip` : 'english-images.zip';
  ctx.checkCancelled();
  ctx.message(`Making sure ${target.repo.name} exists…`);
  await ensureRepo(target);
  ctx.message(`Uploading ${(backup.data.length / 1_000_000).toFixed(1)} MB to ${target.repo.name}…`);
  await uploadFile({
    repo: target.repo,
    accessToken: target.accessToken,
    hubUrl: target.hubUrl,
    fetch: proxyFetch,
    file: { path, content: new Blob([new Uint8Array(backup.data)]) },
    commitTitle: `Update ${path}`,
  });
  return `Uploaded ${path} to ${repoUrl(target)}`;
}

export async function listHubBackups(): Promise<{ repo: string; url: string; backups: HubBackup[] }> {
  const target = await hubTarget();
  const backups: HubBackup[] = [];
  try {
    for await (const entry of listFiles({
      repo: target.repo,
      accessToken: target.accessToken,
      hubUrl: target.hubUrl,
      fetch: proxyFetch,
      recursive: true,
      expand: true,
    })) {
      if (entry.type !== 'file' || !entry.path.endsWith('.zip')) continue;
      backups.push({ path: entry.path, size: entry.lfs?.size ?? entry.size, updatedAt: entry.lastCommit?.date ?? null });
    }
  } catch (error) {
    if (statusOf(error) !== 404) throw error;
  }
  backups.sort((a, b) => a.path.localeCompare(b.path));
  return { repo: target.repo.name, url: repoUrl(target), backups };
}

export async function restoreFromHub(path: string, ctx: JobContext): Promise<string> {
  if (!/^(languages\/[a-z0-9-]+\.zip|english-images\.zip)$/.test(path)) throw new HttpError(400, 'Not a backup made by this app');
  const target = await hubTarget();
  ctx.message(`Downloading ${path}…`);
  const blob = await downloadFile({
    repo: target.repo,
    path,
    accessToken: target.accessToken,
    hubUrl: target.hubUrl,
    fetch: proxyFetch,
  });
  if (!blob) throw new HttpError(404, `${path} was not found in ${target.repo.name}`);
  const buffer = Buffer.from(await blob.arrayBuffer());
  ctx.message('Restoring…');
  if (path.startsWith('languages/')) {
    const summary = await importLanguage(buffer);
    return `Restored ${summary.name} (${summary.wordCount.toLocaleString()} words) from ${target.repo.name}`;
  }
  await importEnglish(buffer);
  return `Restored English words and images from ${target.repo.name}`;
}
