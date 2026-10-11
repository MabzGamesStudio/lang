import { pinyin } from 'pinyin-pro';
import type { DB } from '../db/connection.js';
import { addPronunciations, syncPronunciations } from './pronunciations.js';
import type { LanguageConfig } from '../../../shared/types.js';

// Chinese words get Hanyu Pinyin (with tone marks) as their pronunciation,
// computed offline. It is also the dictionary of the pinyin input method.

export function isChinese(config: Pick<LanguageConfig, 'code'>): boolean {
  return config.code.toLowerCase().split('-')[0] === 'zh';
}

const HAN = /\p{Script=Han}/u;
// IPA (as returned by some models for Mandarin) is replaced by pinyin.
const IPA = /[ɕʂʐʈɥəŋɤɿʅɑɛɔʊɪʃʒθðæʌ˥˦˧˨˩ʰː]/;

export function pinyinWithTones(text: string): string {
  return pinyin(text, { nonZh: 'consecutive' }).replace(/\s+/g, ' ').trim();
}

// Toneless syllables joined with "'" ("xue'sheng"); ü is written v.
export function pinyinKey(text: string): string {
  return pinyin(text, { toneType: 'none', type: 'array', v: true, nonZh: 'removed' })
    .map((syllable) => syllable.toLowerCase().replace(/[^a-z]/g, ''))
    .filter(Boolean)
    .join("'");
}

export function pinyinReadings(char: string): string[] {
  return [...new Set(pinyin(char, { toneType: 'none', type: 'array', v: true, multiple: true }).map((r) => r.toLowerCase()))];
}

// Pinyin with or without tone marks (not IPA, not characters).
export function isPinyin(pronunciation: string | null): boolean {
  if (!pronunciation) return false;
  return !IPA.test(pronunciation) && /[a-zA-Zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜü]/.test(pronunciation);
}

// Fills in pinyin (made offline, source "pinyin") for Chinese words without a
// pinyin pronunciation. Other kinds of pronunciation are not kept for Chinese.
export function fillChinesePinyin(db: DB, wordIds?: number[]): number {
  const rows = (
    wordIds
      ? db.prepare(`SELECT id, word, pronunciation FROM words WHERE id IN (SELECT value FROM json_each(?))`).all(JSON.stringify(wordIds))
      : db.prepare(`SELECT id, word, pronunciation FROM words`).all()
  ) as { id: number; word: string; pronunciation: string | null }[];
  const items: { id: number; pronunciation: string }[] = [];
  const others = db.prepare(`SELECT id, pronunciation FROM word_pronunciations WHERE word_id = ?`);
  const remove = db.prepare(`DELETE FROM word_pronunciations WHERE id = ?`);
  db.transaction(() => {
    for (const row of rows) {
      if (!HAN.test(row.word) || isPinyin(row.pronunciation)) continue;
      for (const other of others.all(row.id) as { id: number; pronunciation: string }[]) {
        if (!isPinyin(other.pronunciation)) remove.run(other.id);
      }
      const value = pinyinWithTones(row.word);
      if (value) items.push({ id: row.id, pronunciation: value });
    }
  })();
  if (rows.length) syncPronunciations(db, rows.map((row) => row.id));
  return addPronunciations(db, items, 'pinyin');
}
