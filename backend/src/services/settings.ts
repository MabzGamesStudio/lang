import fs from 'node:fs';
import { SETTINGS_PATH, ensureDataDirs } from '../config.js';
import { DEFAULT_SETTINGS, MASK_PREFIX, SECRET_PATHS, maskSecret, mergeDeep } from '../../../shared/settings.js';
import type { AppSettings } from '../../../shared/types.js';

let cache: AppSettings | null = null;

export function getSettings(): AppSettings {
  if (cache) return cache;
  let stored: unknown = {};
  try {
    stored = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
  } catch {
    stored = {};
  }
  cache = mergeDeep(DEFAULT_SETTINGS, stored);
  return cache;
}

function getPath(obj: unknown, keys: string[]): unknown {
  return keys.reduce<unknown>((value, key) => (value as Record<string, unknown> | undefined)?.[key], obj);
}

function setPath(obj: unknown, keys: string[], value: unknown): void {
  const parent = getPath(obj, keys.slice(0, -1)) as Record<string, unknown> | undefined;
  if (parent) parent[keys[keys.length - 1]] = value;
}

// Settings as shown to the UI: API keys are masked.
export function maskedSettings(): AppSettings {
  const copy = structuredClone(getSettings());
  for (const keys of SECRET_PATHS) setPath(copy, keys, maskSecret(String(getPath(copy, keys) ?? '')));
  return copy;
}

// Saves settings from the UI. Masked keys mean "unchanged".
export function saveSettings(update: unknown): AppSettings {
  const current = getSettings();
  const next = mergeDeep(DEFAULT_SETTINGS, update);
  for (const keys of SECRET_PATHS) {
    const value = String(getPath(next, keys) ?? '');
    if (value.startsWith(MASK_PREFIX)) setPath(next, keys, getPath(current, keys));
  }
  ensureDataDirs();
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(next, null, 2), { mode: 0o600 });
  cache = next;
  return next;
}
