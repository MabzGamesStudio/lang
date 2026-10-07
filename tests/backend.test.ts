import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { AddressInfo } from 'node:net';
import type { Question, WordResult } from '../shared/types.js';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lang-test-'));
process.env.LANG_DATA_DIR = dataDir;

const { createLanguage, languageSummary } = await import('../backend/src/services/languages.js');
const { importText, importWordList, listSources } = await import('../backend/src/services/corpus.js');
const { listWords, saveDefinitions, saveSentenceTranslations } = await import('../backend/src/services/words.js');
const { sessionNext, freePlayNext, applyResults, progressSummary } = await import('../backend/src/services/progress.js');
const { addImage } = await import('../backend/src/services/english.js');
const { exportLanguage, importLanguage, exportEnglish, importEnglish } = await import('../backend/src/services/backup.js');
const { importLegacy } = await import('../backend/src/services/legacy.js');
const { languageDb } = await import('../backend/src/db/connection.js');
const { createServer } = await import('../backend/src/server.js');
const { GAMES } = await import('../shared/games.js');

const here = path.dirname(new URL(import.meta.url).pathname);
const sample = fs.readFileSync(path.join(here, 'fixtures/quijote-sample.txt'), 'utf8');
const wordList = fs
  .readFileSync(path.join(here, '../langData/spanish/1000Words/1000Words.csv'), 'utf8')
  .split('\n')
  .slice(0, 120)
  .join('\n');

// What a perfect learner would answer.
function perfectResults(question: Question): WordResult[] {
  if (question.sentence) {
    return question.sentence.tokens
      .filter((token) => token.evaluate && token.wordId !== null)
      .map((token) => ({ wordId: token.wordId!, phase: question.phase, correct: true }));
  }
  return [{ wordId: question.targetWordId, phase: question.phase, correct: true }];
}

test('language lifecycle', async (t) => {
  await t.test('create a language from the catalogue', () => {
    const spanish = createLanguage({ name: 'Spanish' });
    assert.equal(spanish.id, 'spanish');
    assert.equal(spanish.code, 'es');
    assert.equal(spanish.locale, 'es-ES');
    assert.throws(() => createLanguage({ name: 'Spanish' }), /already exists/);
  });

  await t.test('import a book: frequencies, sentences, proper nouns', async () => {
    const summary = await importText('spanish', { kind: 'book', title: 'Quijote', url: 'https://example.org/q.txt', text: sample });
    assert.ok(summary.sentencesAdded > 20, `sentences: ${summary.sentencesAdded}`);
    const db = languageDb('spanish');
    const casa = db.prepare(`SELECT count, active, rank FROM words WHERE word = 'casa'`).get() as { count: number; active: number };
    assert.ok(casa.count >= 6);
    assert.equal(casa.active, 1);
    const sancho = db.prepare(`SELECT active, proper_noun FROM words WHERE word = 'sancho'`).get() as { active: number; proper_noun: number };
    assert.equal(sancho.proper_noun, 1, 'Sancho is detected as a name');
    assert.equal(sancho.active, 0);
    assert.equal(db.prepare(`SELECT 1 FROM words WHERE word = 'gutenberg'`).get(), undefined, 'licence text is stripped');
    assert.equal(db.prepare(`SELECT 1 FROM sentences WHERE text LIKE '%CAPÍTULO%'`).get(), undefined, 'headings are not sentences');
  });

  await t.test('import a word list with translations', async () => {
    const summary = await importWordList('spanish', { title: '1000 words', csv: wordList });
    assert.ok(summary.uniqueWords > 90);
    assert.equal(listSources('spanish').length, 2);
    const words = listWords('spanish', { offset: 0, limit: 5, q: '', filter: 'active', sort: 'rank' }).rows;
    assert.ok(['de', 'que', 'no', 'a', 'la', 'el'].includes(words[0].word), `top word: ${words[0].word}`);
    assert.ok(words[0].english.length > 0);
  });

  await t.test('give every remaining word a definition and translate sentences', () => {
    const db = languageDb('spanish');
    const missing = db.prepare(`SELECT id, word FROM words WHERE english IS NULL`).all() as { id: number; word: string }[];
    saveDefinitions(db, missing.map((w) => ({ id: w.id, english: [`${w.word}-en`], source: 'test' })), false);
    const sentences = db.prepare(`SELECT id, text FROM sentences`).all() as { id: number; text: string }[];
    saveSentenceTranslations(db, sentences.map((s) => ({ id: s.id, english: `EN ${s.text}` })), 'test');
    const summary = languageSummary('spanish');
    assert.equal(summary.definedWordCount, summary.wordCount);
    assert.equal(summary.translatedSentenceCount, summary.sentenceCount);
  });

  await t.test('learn mode: batches of 7, phases in order, block completes', () => {
    const phasesSeen: string[] = [];
    const recent: number[] = [];
    let lastGameId = null;
    let firstState = null;
    let questions = 0;
    for (; questions < 6000; questions++) {
      const next = sessionNext('spanish', { mode: 'learn', recent, lastGameId });
      firstState ??= next.state;
      if (next.state.block !== 1) break;
      assert.ok(next.question, `question expected: ${next.notice?.message}`);
      const question = next.question!;
      assert.equal(next.state.batchWords.length, 7);
      if (phasesSeen[phasesSeen.length - 1] !== next.state.phase) phasesSeen.push(next.state.phase!);
      if (question.options) {
        assert.ok(question.options.some((o) => o.correct && o.wordId === question.targetWordId));
        assert.equal(new Set(question.options.map((o) => o.text)).size, question.options.length, 'options are unique');
      }
      applyResults('spanish', perfectResults(question));
      recent.unshift(question.targetWordId);
      recent.length = Math.min(recent.length, 5);
      lastGameId = question.gameId;
    }
    assert.equal(firstState?.phase, 'recognition');
    assert.equal(firstState?.batch, 1);
    assert.equal(firstState?.newBatch, true);
    assert.deepEqual(phasesSeen, ['recognition', 'recall', 'recite', 'translate']);
    const db = languageDb('spanish');
    const learned = (db.prepare(`SELECT COUNT(*) AS n FROM words WHERE rank <= 98 AND srs_stage = 1`).get() as { n: number }).n;
    assert.equal(learned, 98, `all of block 1 learned after ${questions} questions`);
    const summary = progressSummary('spanish');
    assert.equal(summary.learn?.block, 2);
    assert.equal(summary.learnedWords, 98);
  });

  await t.test('wrong answers lower levels', () => {
    const db = languageDb('spanish');
    const word = db.prepare(`SELECT id, recall_level FROM words WHERE rank = 1`).get() as { id: number; recall_level: number };
    const result = applyResults('spanish', [{ wordId: word.id, phase: 'recall', correct: false }]);
    assert.equal(result.levels[word.id].recall, word.recall_level - 2);
  });

  await t.test('review mode: due words are reset to 1 and rescheduled', () => {
    const db = languageDb('spanish');
    db.prepare(`UPDATE words SET next_review_at = ? WHERE rank BETWEEN 2 AND 8`).run(Date.now() - 1000);
    let next = sessionNext('spanish', { mode: 'review', recent: [], lastGameId: null });
    assert.equal(next.state.mode, 'review');
    assert.equal(next.state.batchWords.length, 7);
    assert.ok(next.state.batchWords.every((w) => w.levels.recognition <= 1));
    for (let i = 0; i < 500 && next.question; i++) {
      applyResults('spanish', perfectResults(next.question));
      next = sessionNext('spanish', { mode: 'review', recent: [next.question.targetWordId], lastGameId: next.question.gameId });
    }
    assert.equal(next.notice?.kind, 'reviewsDone');
    const stages = db.prepare(`SELECT srs_stage FROM words WHERE rank BETWEEN 2 AND 8`).all() as { srs_stage: number }[];
    assert.ok(stages.every((s) => s.srs_stage === 2), JSON.stringify(stages));
  });

  await t.test('every minigame works in free play, images accept every label', () => {
    const db = languageDb('spanish');
    const target = db.prepare(`SELECT id, english FROM words WHERE word = 'casa'`).get() as { id: number; english: string };
    const gloss = JSON.parse(target.english)[0] as string;
    const batch = Math.ceil((db.prepare(`SELECT rank FROM words WHERE id = ?`).get(target.id) as { rank: number }).rank / 7);
    // An image labelled with two meanings; "hogar" also means home.
    const hogar = db.prepare(`SELECT id FROM words WHERE word = 'hogar'`).get() as { id: number } | undefined;
    if (hogar) saveDefinitions(db, [{ id: hogar.id, english: ['home'], source: 'test' }], true);
    addImage({ data: Buffer.from([0xff, 0xd8, 0xff, 0xd9]), mime: 'image/jpeg', labels: [gloss, 'home'], status: 'labeled' });
    for (const game of GAMES) {
      const next = freePlayNext('spanish', { gameId: game.id, batch, cumulative: false, recent: [] });
      assert.ok(next.question, `${game.id}: ${next.notice?.message}`);
      const question = next.question!;
      assert.equal(question.gameId, game.id);
      if (game.prompt.mode === 'image') {
        assert.ok(question.prompt.imageId);
        if (game.response.mode === 'type') {
          assert.ok(question.accepted!.some((a) => a.wordId === target.id));
        }
      }
      if (game.unit === 'sentence') {
        assert.ok(question.sentence!.tokens.some((token) => token.target));
        assert.ok(question.answer.length > 0);
      }
    }
  });

  await t.test('backups round-trip', async () => {
    const before = languageSummary('spanish');
    const backup = await exportLanguage('spanish');
    assert.ok(backup.fileName.endsWith('.zip'));
    languageDb('spanish').exec(`DELETE FROM sentences`);
    const restored = await importLanguage(backup.data);
    assert.equal(restored.sentenceCount, before.sentenceCount);
    assert.equal(restored.learnedCount, before.learnedCount);
    await assert.rejects(importEnglish(backup.data), /language backup/);
    const english = await exportEnglish();
    await importEnglish(english.data);
    await assert.rejects(importLanguage(Buffer.from('not a zip')), /not a zip/);
  });

  await t.test('data from the previous version is imported', async () => {
    const legacy = new Database(path.join(dataDir, 'app.db'));
    legacy.exec(`
      CREATE TABLE image_data (id INTEGER PRIMARY KEY, image_description TEXT, data BLOB);
      CREATE TABLE words_list (id INTEGER PRIMARY KEY, language TEXT, frequency_rank INTEGER, frequency_group_rank INTEGER,
        english_value TEXT, foreign_value TEXT, recognition_level INTEGER, recall_level INTEGER, recite_level INTEGER,
        translate_level INTEGER, english_speech_male BLOB, foreign_speech_male BLOB, english_speech_female BLOB,
        foreign_speech_female BLOB, image_id INTEGER);
    `);
    legacy.prepare(`INSERT INTO image_data VALUES (1, 'cat', ?)`).run(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const insert = legacy.prepare(`INSERT INTO words_list VALUES (NULL, 'french', ?, 1, ?, ?, ?, 3, 0, 0, NULL, ?, NULL, NULL, ?)`);
    insert.run(1, 'the', 'le', 2, Buffer.from('mp3'), null);
    insert.run(2, 'cat', 'chat', 1, null, 1);
    insert.run(3, 'the', 'la', 0, null, null);
    legacy.close();
    const message = await importLegacy();
    assert.match(message, /french: 3 words/);
    const db = languageDb('french');
    const le = db.prepare(`SELECT recognition_level, recall_level, english FROM words WHERE word = 'le'`).get() as {
      recognition_level: number;
      recall_level: number;
      english: string;
    };
    assert.equal(le.recognition_level, 2);
    assert.equal(le.recall_level, 3);
    assert.deepEqual(JSON.parse(le.english), ['the']);
    assert.ok(db.prepare(`SELECT 1 FROM audio WHERE text = 'le'`).get());
  });

  await t.test('HTTP API', async () => {
    const server = createServer().listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
    try {
      const languages = (await (await fetch(`${base}/languages`)).json()) as { id: string }[];
      assert.deepEqual(languages.map((l) => l.id), ['french', 'spanish']);
      const next = await fetch(`${base}/languages/spanish/session/next`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'learn', recent: [] }),
      });
      assert.equal(next.status, 200);
      const audio = await fetch(`${base}/audio?lang=spanish&text=casa`);
      assert.equal(audio.status, 204, 'browser speech is used when no TTS service is configured');
      const missing = await fetch(`${base}/languages/klingon`);
      assert.equal(missing.status, 404);
      const bad = await fetch(`${base}/languages/..%2Fetc`);
      assert.equal(bad.status, 400);
      const settings = await fetch(`${base}/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ llm: { provider: 'openai', openai: { apiKey: 'sk-secret-1234' } } }),
      });
      const masked = (await settings.json()) as { llm: { openai: { apiKey: string } } };
      assert.equal(masked.llm.openai.apiKey, '••••1234');
      const again = await fetch(`${base}/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(masked),
      });
      assert.equal(again.status, 200);
      const stored = JSON.parse(fs.readFileSync(path.join(dataDir, 'settings.json'), 'utf8'));
      assert.equal(stored.llm.openai.apiKey, 'sk-secret-1234', 'masked keys are not overwritten');
    } finally {
      server.close();
    }
  });
});
