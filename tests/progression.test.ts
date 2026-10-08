import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Question, WordResult } from '../shared/types.js';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lang-progression-'));
process.env.LANG_DATA_DIR = dataDir;

const { createLanguage, updateLanguage } = await import('../backend/src/services/languages.js');
const { importText, importWordList } = await import('../backend/src/services/corpus.js');
const { saveDefinitions, saveSentenceTranslations } = await import('../backend/src/services/words.js');
const { sessionNext, applyResults, progressRules } = await import('../backend/src/services/progress.js');
const { saveSettings, getSettings } = await import('../backend/src/services/settings.js');
const { inputIndex } = await import('../backend/src/services/inputIndex.js');
const { languageDb } = await import('../backend/src/db/connection.js');
const { nextLevel } = await import('../shared/scoring.js');
const { prepareEntries, searchCandidates } = await import('../shared/ime/index.js');

const here = path.dirname(new URL(import.meta.url).pathname);
const sample = fs.readFileSync(path.join(here, 'fixtures/quijote-sample.txt'), 'utf8');
const wordList = fs.readFileSync(path.join(here, '../langData/spanish/1000Words/1000Words.csv'), 'utf8').split('\n').slice(0, 120).join('\n');

function answer(question: Question, correct: boolean): WordResult[] {
  if (question.sentence) {
    return question.sentence.tokens
      .filter((token) => token.evaluate && token.wordId !== null)
      .map((token) => ({ wordId: token.wordId!, phase: question.phase, correct }));
  }
  return [{ wordId: question.targetWordId, phase: question.phase, correct }];
}

async function freshSpanish(id: string) {
  createLanguage({ name: 'Spanish', id } as never);
  await importText(id, { kind: 'book', title: 'Quijote', text: sample });
  await importWordList(id, { title: 'list', csv: wordList });
  const db = languageDb(id);
  const missing = db.prepare(`SELECT id, word FROM words WHERE english IS NULL`).all() as { id: number; word: string }[];
  saveDefinitions(db, missing.map((w) => ({ id: w.id, english: [`${w.word}-en`], source: 'test' })), false);
  const sentences = db.prepare(`SELECT id, text FROM sentences`).all() as { id: number; text: string }[];
  saveSentenceTranslations(db, sentences.map((s) => ({ id: s.id, english: `EN ${s.text}` })), 'test');
  return db;
}

test('levels with a custom number of correct answers', () => {
  assert.equal(nextLevel('recall', 0, true, 5), 1);
  assert.equal(nextLevel('recall', 4, true, 5), 5);
  assert.equal(nextLevel('recall', 5, true, 5), 5);
  assert.equal(nextLevel('recognition', 1, false, 1), 0, 'one-answer mastery can be lost again');
  assert.equal(nextLevel('recognition', 1, true, 1), 1);
});

test('batches are finished before moving on, and words without data are skipped', async () => {
  saveSettings({});
  const db = await freshSpanish('spanish');
  // Two words of batch 1 lose their translation: they must be skipped, not block.
  const skipped = db.prepare(`SELECT id FROM words WHERE active = 1 ORDER BY rank LIMIT 2 OFFSET 2`).all() as { id: number }[];
  for (const { id } of skipped) db.prepare(`UPDATE words SET english = NULL WHERE id = ?`).run(id);

  let next = sessionNext('spanish', { mode: 'learn', recent: [], lastGameId: null });
  assert.equal(next.state.batch, 1);
  assert.ok(next.question, 'batch 1 is still playable');
  assert.equal(next.notice?.kind, 'missingDefinitions');
  assert.deepEqual(next.notice?.words?.map((w) => w.id).sort(), skipped.map((w) => w.id).sort());
  assert.ok(!skipped.some(({ id }) => id === next.question!.targetWordId), 'skipped words are never asked');

  const required = progressRules(getSettings()).required;
  let previous = { phase: next.state.phase, batch: next.state.batch };
  let transitions = 0;
  let seed = 7;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 4000 && next.question && next.state.block === 1; i++) {
    // About one answer in four is wrong.
    applyResults('spanish', answer(next.question, random() > 0.25));
    next = sessionNext('spanish', { mode: 'learn', recent: [next.question.targetWordId], lastGameId: next.question.gameId });
    const current = { phase: next.state.phase, batch: next.state.batch };
    if (current.phase === previous.phase && (current.batch ?? 0) > (previous.batch ?? 0)) {
      transitions++;
      // Leaving a batch: every word in it that can be practised is mastered.
      const rows = db
        .prepare(
          `SELECT ${previous.phase}_level AS level, english, srs_stage FROM words WHERE active = 1 AND rank BETWEEN ? AND ?`
        )
        .all((previous.batch! - 1) * 7 + 1, previous.batch! * 7) as { level: number; english: string | null; srs_stage: number }[];
      for (const row of rows) {
        if (row.english === null || row.srs_stage > 0) continue;
        assert.ok(row.level >= required[previous.phase!], `left batch ${previous.batch} with an unfinished word`);
      }
    }
    previous = current;
  }
  assert.ok(transitions > 5, `moved through batches (${transitions} transitions)`);
  assert.equal(next.state.block, 2, 'block 1 completed despite the two skipped words');
  const stillLearning = db.prepare(`SELECT srs_stage FROM words WHERE id = ?`).get(skipped[0].id) as { srs_stage: number };
  assert.equal(stillLearning.srs_stage, 0, 'skipped words are not marked learned');
});

test('batch-by-batch order and custom mastery counts', async () => {
  saveSettings({
    learning: { progressionOrder: 'batch', requiredCorrect: { recognition: 1, recall: 1, recite: 1, translate: 1 } },
  });
  const db = await freshSpanish('spanish-batch');
  const seen: string[] = [];
  let next = sessionNext('spanish-batch', { mode: 'learn', recent: [], lastGameId: null });
  let questions = 0;
  while (next.question && (next.state.batch ?? 0) <= 2 && questions < 500) {
    const key = `${next.state.batch}:${next.state.phase}`;
    if (seen[seen.length - 1] !== key) seen.push(key);
    applyResults('spanish-batch', answer(next.question, true));
    next = sessionNext('spanish-batch', { mode: 'learn', recent: [next.question.targetWordId], lastGameId: next.question.gameId });
    questions++;
  }
  const batch1 = seen.filter((key) => key.startsWith('1:'));
  assert.deepEqual(batch1.slice(0, 2), ['1:recognition', '1:recall'], 'batch 1 goes through the phases first');
  assert.ok(seen.indexOf('2:recognition') > seen.lastIndexOf(batch1[batch1.length - 1]), 'batch 2 starts after batch 1 is done');
  const learned = (db.prepare(`SELECT COUNT(*) AS n FROM words WHERE rank <= 7 AND srs_stage = 1`).get() as { n: number }).n;
  assert.equal(learned, 7, 'one correct answer per phase is enough');

  // A review with one-answer mastery still asks every category again.
  db.prepare(`UPDATE words SET next_review_at = 0 WHERE srs_stage = 1`).run();
  const review = sessionNext('spanish-batch', { mode: 'review', recent: [], lastGameId: null });
  assert.ok(review.question, 'due words are asked again');
  assert.equal(review.state.phase, 'recognition');
  const reset = db.prepare(`SELECT recognition_level AS a, translate_level AS b, srs_stage AS stage FROM words WHERE id = ?`).get(review.question!.targetWordId) as {
    a: number;
    b: number;
    stage: number;
  };
  assert.deepEqual(reset, { a: 0, b: 0, stage: 1 });
  saveSettings({});
});

test('sources can be weighted by their number of words', async () => {
  createLanguage({ name: 'Spanish', id: 'weights' } as never);
  // A long text where "perro" is common and a short one where "gato" is.
  await importText('weights', { kind: 'text', title: 'long', text: 'El perro come. '.repeat(400) + 'El gato duerme.' });
  await importText('weights', { kind: 'text', title: 'short', text: 'El gato duerme. El gato come. El gato salta.' });
  const db = languageDb('weights');
  const rank = (word: string) => (db.prepare(`SELECT rank FROM words WHERE word = ?`).get(word) as { rank: number }).rank;
  assert.ok(rank('gato') < rank('perro'), 'equal weighting: each text counts the same');
  updateLanguage('weights', { sourceWeighting: 'size' });
  const { rebuildStatistics } = await import('../backend/src/services/corpus.js');
  rebuildStatistics('weights');
  assert.ok(rank('perro') < rank('gato'), 'size weighting: the long text dominates');
});

test('Chinese word lists keep compound words and get pinyin for typing', async () => {
  createLanguage({ name: 'Chinese' });
  await importWordList('chinese', {
    title: 'hsk',
    csv: 'word,english\n学生,student\n一模一样,exactly the same\n手机号码,phone number\n学校,school\n的,(possessive particle)\n',
  });
  const db = languageDb('chinese');
  const words = db.prepare(`SELECT word, pronunciation FROM words ORDER BY rank`).all() as { word: string; pronunciation: string }[];
  assert.deepEqual(words.map((w) => w.word), ['学生', '一模一样', '手机号码', '学校', '的']);
  assert.equal(words[0].pronunciation, 'xué shēng');
  // IPA from a model is replaced by pinyin.
  const id = (db.prepare(`SELECT id FROM words WHERE word = '学校'`).get() as { id: number }).id;
  saveDefinitions(db, [{ id, english: ['school'], pronunciation: 'ɕɥɛ̌ ɕjâʊ', source: 'test' }], true);
  assert.equal((db.prepare(`SELECT pronunciation FROM words WHERE id = ?`).get(id) as { pronunciation: string }).pronunciation, 'xué xiào');

  const index = inputIndex('chinese');
  assert.equal(index.method, 'pinyin');
  const entries = prepareEntries(index.entries, 'pinyin');
  assert.equal(searchCandidates(entries, 'xuesheng')[0], '学生');
  assert.deepEqual(searchCandidates(entries, 'xx').slice(0, 1), ['学校']);
  assert.ok(searchCandidates(entries, 'xue').includes('学'), 'single characters are typeable');
  assert.equal(inputIndex('spanish').method, null);
});
