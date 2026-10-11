import type { DB } from '../db/connection.js';
import { getLanguageConfig } from './languages.js';
import type { SourcePreferences, SourcedKind } from '../../../shared/types.js';

// Values that keep their source (meanings, pronunciations, translations,
// recordings) are used in this order: a pinned value first, then the
// preferred sources of the language (in their order), then the order the
// values were added.

// Rank of a source that is not in the preferred list.
export const UNRANKED = 1_000_000;

// SQL rank of a source column; binds one parameter: the JSON list of preferred sources.
export function rankSql(column: string): string {
  return `COALESCE((SELECT CAST(pref.key AS INTEGER) FROM json_each(?) pref WHERE pref.value = ${column}), ${UNRANKED})`;
}

export function preferencesOf(db: DB): SourcePreferences {
  return getLanguageConfig(db).sourcePreferences;
}

export function preferenceJson(db: DB, kind: SourcedKind): string {
  return JSON.stringify(preferencesOf(db)[kind]);
}

// Values typed by you are never removed automatically.
export const MANUAL = 'manual';

export function idList(ids: number[]): string {
  return JSON.stringify([...new Set(ids)]);
}
