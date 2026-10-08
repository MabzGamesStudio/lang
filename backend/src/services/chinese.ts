import { pinyin } from 'pinyin-pro';
import type { DB } from '../db/connection.js';
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

function needsPinyin(pronunciation: string | null): boolean {
  if (!pronunciation) return true;
  return IPA.test(pronunciation) || !/[a-zA-Zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜü]/.test(pronunciation);
}

// Fills in pinyin for Chinese words without a (pinyin) pronunciation.
export function fillChinesePinyin(db: DB, wordIds?: number[]): number {
  const rows = (
    wordIds
      ? db.prepare(`SELECT id, word, pronunciation FROM words WHERE id IN (SELECT value FROM json_each(?))`).all(JSON.stringify(wordIds))
      : db.prepare(`SELECT id, word, pronunciation FROM words`).all()
  ) as { id: number; word: string; pronunciation: string | null }[];
  const update = db.prepare(`UPDATE words SET pronunciation = ? WHERE id = ?`);
  let filled = 0;
  db.transaction(() => {
    for (const row of rows) {
      if (!HAN.test(row.word) || !needsPinyin(row.pronunciation)) continue;
      const value = pinyinWithTones(row.word);
      if (!value) continue;
      update.run(value, row.id);
      filled++;
    }
  })();
  return filled;
}
