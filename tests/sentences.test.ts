import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import Database from 'better-sqlite3';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lang-sentences-'));
process.env.LANG_DATA_DIR = dataDir;

const { createLanguage, languageSummary } = await import('../backend/src/services/languages.js');
const { importText, importWordList } = await import('../backend/src/services/corpus.js');
const { saveSentenceTranslations, setSentenceExclusion, listSentences, updateWord } = await import('../backend/src/services/words.js');
const { applyResults, undoResults } = await import('../backend/src/services/progress.js');
const { buildQuestion, loadLearners, pickSentence } = await import('../backend/src/services/questions.js');
const { getLanguageConfig } = await import('../backend/src/services/languages.js');
const { saveSettings, getSettings } = await import('../backend/src/services/settings.js');
const { languageDb, closeLanguageDb, languageDbPath, englishDatabase } = await import('../backend/src/db/connection.js');
const { LANGUAGE_SCHEMA_VERSION } = await import('../backend/src/db/schema.js');
const { retranslateSentences } = await import('../backend/src/providers/translation.js');
const { getAudio, regenerateSentenceAudio } = await import('../backend/src/providers/speech.js');
const { GAMES_BY_ID } = await import('../shared/games.js');

const TEXT = 'El gato come pescado. El perro come carne en la casa. Juan come pan con el gato. La casa es grande.';
const WORDS = `word,english,count
el,the,100
come,eats,90
gato,cat,80
la,the,70
casa,house,60
perro,dog,50
pescado,fish,40
carne,meat,30
en,in,20
juan,John,15
pan,bread,10
con,with,9
es,is,8
grande,big,7`;

async function setUp(id: string) {
  createLanguage({ name: 'Spanish', id } as never);
  await importWordList(id, { title: 'words', csv: WORDS });
  await importText(id, { kind: 'text', title: 'text', text: TEXT });
  const db = languageDb(id);
  const sentences = db.prepare(`SELECT id, text FROM sentences`).all() as { id: number; text: string }[];
  saveSentenceTranslations(db, sentences.map((s) => ({ id: s.id, english: `EN ${s.text}` })), 'test');
  return db;
}

const wordId = (db: ReturnType<typeof languageDb>, word: string) => (db.prepare(`SELECT id FROM words WHERE word = ?`).get(word) as { id: number }).id;
const sentenceId = (db: ReturnType<typeof languageDb>, text: string) =>
  (db.prepare(`SELECT id FROM sentences WHERE text LIKE ?`).get(`${text}%`) as { id: number }).id;

function serve(handler: (req: http.IncomingMessage, body: string, res: http.ServerResponse) => void) {
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    handler(req, Buffer.concat(chunks).toString(), res);
  });
  server.listen(0, '127.0.0.1');
  return {
    server,
    url: async () => {
      if (!server.listening) await new Promise((resolve) => server.once('listening', resolve));
      return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    },
  };
}

const progress = { progress() {}, message() {}, checkCancelled() {}, cancelled: false };

test('a version 1 language database is upgraded, keeping its translations and definitions', () => {
  createLanguage({ name: 'Spanish', id: 'old' } as never);
  closeLanguageDb('old');
  // Back to the version 1 tables, with a translated sentence and a defined word.
  const raw = new Database(languageDbPath('old'));
  raw.exec(`DROP INDEX sentences_excluded;
    ALTER TABLE sentences DROP COLUMN excluded_reason;
    ALTER TABLE sentences DROP COLUMN excluded_at;
    DROP TABLE sentence_translations;
    ALTER TABLE words DROP COLUMN english_sources;
    INSERT INTO words (word, display, english, definition_source) VALUES ('gato', 'gato', '["cat","tomcat"]', 'wiktionary');
    INSERT INTO sentences (text, english, translation_source, word_count) VALUES ('El gato.', 'The cat.', 'deepl', 2);
    UPDATE meta SET value = '1' WHERE key = 'schema_version';`);
  raw.close();
  const db = languageDb('old');
  const columns = (db.prepare(`PRAGMA table_info(sentences)`).all() as { name: string }[]).map((column) => column.name);
  assert.ok(columns.includes('excluded_reason') && columns.includes('excluded_at'));
  assert.equal(Number((db.prepare(`SELECT value FROM meta WHERE key = 'schema_version'`).get() as { value: string }).value), LANGUAGE_SCHEMA_VERSION);
  assert.deepEqual(db.prepare(`SELECT english, source FROM sentence_translations`).all(), [{ english: 'The cat.', source: 'deepl' }]);
  assert.equal((db.prepare(`SELECT english_sources AS s FROM words WHERE word = 'gato'`).get() as { s: string }).s, '["wiktionary","wiktionary"]');
});

test('excluded sentences leave the questions and the counts, and come back', async () => {
  saveSettings({});
  const db = await setUp('spanish');
  const perro = wordId(db, 'perro');
  const only = sentenceId(db, 'El perro come carne');
  assert.equal(pickSentence(db, perro, true, 100)?.id, only);
  const count = () => (db.prepare(`SELECT sentence_count AS n, translated_sentence_count AS t FROM words WHERE id = ?`).get(perro) as { n: number; t: number });
  assert.deepEqual(count(), { n: 1, t: 1 });

  setSentenceExclusion('spanish', only, 'translation');
  assert.equal(pickSentence(db, perro, true, 100), null, 'never asked while excluded');
  assert.deepEqual(count(), { n: 0, t: 0 }, 'no sentence games for the word');
  const listed = listSentences('spanish', { offset: 0, limit: 10, q: '', filter: 'translation' });
  assert.equal(listed.total, 1);
  assert.equal(listed.rows[0].excludedReason, 'translation');
  assert.equal(languageSummary('spanish').excludedSentenceCount, 1);
  assert.equal(listSentences('spanish', { offset: 0, limit: 10, q: '', filter: 'audio' }).total, 0);

  setSentenceExclusion('spanish', only, null);
  assert.deepEqual(count(), { n: 1, t: 1 });
  assert.equal(pickSentence(db, perro, true, 100)?.id, only);
});

test('the results of an answer can be taken back', () => {
  const db = languageDb('spanish');
  const gato = wordId(db, 'gato');
  const before = db.prepare(`SELECT recall_level, recall_correct, recall_wrong, last_seen_at FROM words WHERE id = ?`).get(gato);
  const first = applyResults('spanish', [{ wordId: gato, phase: 'recall', correct: true }]);
  const second = applyResults('spanish', [{ wordId: gato, phase: 'recall', correct: false }]);
  assert.notDeepEqual(db.prepare(`SELECT recall_level, recall_correct, recall_wrong, last_seen_at FROM words WHERE id = ?`).get(gato), before);
  assert.equal(undoResults('spanish', second.undoId), true);
  assert.equal((db.prepare(`SELECT recall_wrong AS n FROM words WHERE id = ?`).get(gato) as { n: number }).n, 0);
  assert.equal(undoResults('spanish', first.undoId), true);
  assert.deepEqual(db.prepare(`SELECT recall_level, recall_correct, recall_wrong, last_seen_at FROM words WHERE id = ?`).get(gato), before);
  assert.equal(undoResults('spanish', first.undoId), false, 'only once');
  assert.equal(undoResults('other', second.undoId), false);
});

test('words not met yet are never scored in sentences; excluded words never', () => {
  const db = languageDb('spanish');
  const config = getLanguageConfig(db);
  const settings = getSettings();
  const game = GAMES_BY_ID.foreignSentenceToForeignTyped;
  const perro = loadLearners(db, `word = 'perro'`)[0];
  const build = () => {
    const question = buildQuestion(game, perro, { db, langId: 'spanish', config, settings, frontier: 100, batchWords: [perro] });
    assert.ok(question?.sentence);
    return new Map(question.sentence.tokens.map((token) => [token.text.toLowerCase(), token]));
  };
  let tokens = build();
  assert.equal(tokens.get('perro')?.evaluate, true, 'the word asked about is scored');
  assert.equal(tokens.get('carne')?.evaluate, false);
  assert.equal(tokens.get('carne')?.skip, 'unseen');

  applyResults('spanish', [{ wordId: wordId(db, 'carne'), phase: 'recognition', correct: true }]);
  tokens = build();
  assert.equal(tokens.get('carne')?.evaluate, true, 'scored once met');

  updateWord('spanish', wordId(db, 'carne'), { excluded: true });
  tokens = build();
  assert.equal(tokens.get('carne')?.evaluate, false);
  assert.equal(tokens.get('carne')?.skip, 'excluded', 'a word made neutral is never scored');
  updateWord('spanish', wordId(db, 'carne'), { excluded: null });
});

test('reported translations are translated again; unchanged ones stay excluded', async () => {
  const db = languageDb('spanish');
  const keep = sentenceId(db, 'La casa es grande');
  const fix = sentenceId(db, 'El gato come pescado');
  setSentenceExclusion('spanish', keep, 'translation');
  setSentenceExclusion('spanish', fix, 'translation');
  const requests: unknown[] = [];
  const mock = serve((req, body, res) => {
    const { q } = JSON.parse(body) as { q: string[] };
    requests.push(q);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    // The same translation comes back for "La casa es grande".
    res.end(JSON.stringify({ translatedText: q.map((text) => (text.startsWith('La casa') ? `EN ${text}` : `The cat eats fish.`)) }));
  });
  try {
    saveSettings({ translation: { provider: 'deepl', libretranslate: { url: await mock.url(), apiKey: '' } } });
    const message = await retranslateSentences('spanish', { provider: 'libretranslate' }, progress);
    assert.match(message, /Translated 1 sentence again; 1 came back the same/);
    const rows = db.prepare(`SELECT id, english, translation_source AS source, excluded_reason AS reason FROM sentences WHERE id IN (?, ?)`).all(keep, fix) as {
      id: number;
      english: string;
      source: string;
      reason: string | null;
    }[];
    const byId = new Map(rows.map((row) => [row.id, row]));
    assert.deepEqual(byId.get(fix), { id: fix, english: 'The cat eats fish.', source: 'libretranslate', reason: null });
    assert.equal(byId.get(keep)?.reason, 'translation', 'unchanged: still excluded');
    assert.equal(requests.length, 1);
  } finally {
    mock.server.close();
    setSentenceExclusion('spanish', keep, null);
    saveSettings({});
  }
});

test('reported audio is regenerated with Azure or ElevenLabs and replaces the old recording', async () => {
  const db = languageDb('spanish');
  const english = englishDatabase();
  const id = sentenceId(db, 'Juan come pan');
  const row = db.prepare(`SELECT text, english FROM sentences WHERE id = ?`).get(id) as { text: string; english: string };
  db.prepare(`INSERT INTO audio (text, voice, mime, data, created_at) VALUES (?, 'colab:old', 'audio/mpeg', ?, 1)`).run(row.text, Buffer.from('old'));
  english.prepare(`INSERT INTO audio (text, voice, mime, data, created_at) VALUES (?, 'colab:old-en', 'audio/mpeg', ?, 1)`).run(row.english, Buffer.from('old'));
  setSentenceExclusion('spanish', id, 'audio');

  const calls: string[] = [];
  const mock = serve((req, body, res) => {
    calls.push(`${req.method} ${req.url}`);
    if (req.url === '/cognitiveservices/voices/list') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify([{ ShortName: 'en-US-TestNeural', Locale: 'en-US' }, { ShortName: 'es-ES-TestNeural', Locale: 'es-ES' }]));
      return;
    }
    if (req.url === '/cognitiveservices/v1') {
      assert.equal(req.headers['ocp-apim-subscription-key'], 'azure-key');
      const voice = /voice name="([^"]+)"/.exec(body)?.[1];
      res.writeHead(200, { 'Content-Type': 'audio/mpeg' });
      res.end(`AZURE ${voice} ${/>([^<]*)<\/voice>/.exec(body)?.[1]}`);
      return;
    }
    if (req.url?.startsWith('/v1/text-to-speech/')) {
      assert.equal(req.headers['xi-api-key'], 'eleven-key');
      res.writeHead(200, { 'Content-Type': 'audio/mpeg' });
      res.end(`ELEVEN ${body}`);
      return;
    }
    res.writeHead(404);
    res.end();
  });
  try {
    const url = await mock.url();
    saveSettings({
      tts: {
        provider: 'colab',
        azure: { apiKey: 'azure-key', region: url },
        elevenlabs: { apiKey: 'eleven-key', model: 'eleven_flash_v2_5', voice: 'VOICE1', baseUrl: url },
      },
    });
    const message = await regenerateSentenceAudio('spanish', { provider: 'azure' }, progress);
    assert.match(message, /Regenerated the audio of 1 sentence/);
    const stored = db.prepare(`SELECT voice, data FROM audio WHERE text = ?`).all(row.text) as { voice: string; data: Buffer }[];
    assert.deepEqual(
      stored.map((audio) => [audio.voice, audio.data.toString()]),
      [['azure:es-ES-TestNeural', `AZURE es-ES-TestNeural ${row.text}`]],
      'the old recording is gone'
    );
    const englishAudio = english.prepare(`SELECT voice FROM audio WHERE text = ?`).all(row.english) as { voice: string }[];
    assert.deepEqual(englishAudio, [{ voice: 'azure:en-US-TestNeural' }], 'the English recording is redone too');
    assert.equal((db.prepare(`SELECT excluded_reason AS r FROM sentences WHERE id = ?`).get(id) as { r: string | null }).r, null, 'back in use');
    const listed = listSentences('spanish', { offset: 0, limit: 50, q: 'Juan', filter: 'all' }).rows[0];
    assert.deepEqual(listed.audio.map((recording) => recording.voice), ['azure:es-ES-TestNeural']);
    assert.deepEqual(listed.englishAudio.map((recording) => recording.voice), ['azure:en-US-TestNeural']);

    // One sentence with ElevenLabs and a chosen voice; newer models are told the language.
    await regenerateSentenceAudio('spanish', { ids: [id], provider: 'elevenlabs', voice: 'VOICE2' }, progress);
    const eleven = db.prepare(`SELECT voice, data FROM audio WHERE text = ?`).get(row.text) as { voice: string; data: Buffer };
    assert.equal(eleven.voice, 'elevenlabs:eleven_flash_v2_5:VOICE2');
    assert.deepEqual(JSON.parse(eleven.data.toString().slice('ELEVEN '.length)), {
      text: row.text,
      model_id: 'eleven_flash_v2_5',
      language_code: 'es',
    });
    assert.ok(calls.some((call) => call.startsWith('POST /v1/text-to-speech/VOICE2?output_format=mp3')));

    // getAudio serves the newest recording when the current voice has none.
    const audio = await getAudio('spanish', row.text, false);
    assert.equal(audio?.data.toString().startsWith('ELEVEN'), true);

    // On-device voices cannot be regenerated.
    saveSettings({ tts: { provider: 'browser' } });
    await assert.rejects(regenerateSentenceAudio('spanish', { ids: [id] }, progress), /not stored/);
  } finally {
    mock.server.close();
    saveSettings({});
  }
});

test('sentences keep several translations, each with its source', async () => {
  const { setSentenceTranslations, translationsOf } = await import('../backend/src/services/sentenceTranslations.js');
  const { updateSentence } = await import('../backend/src/services/words.js');
  const db = languageDb('spanish');
  const id = sentenceId(db, 'El gato come pescado');
  const list = () => (translationsOf(db, [id]).get(id) ?? []).map((t) => [t.english, t.source]);
  saveSentenceTranslations(db, [{ id, english: 'The cat; eats fish.' }], 'deepl');
  const main = (db.prepare(`SELECT english FROM sentences WHERE id = ?`).get(id) as { english: string }).english;
  assert.ok(list().some(([english, source]) => english === 'The cat, eats fish.' && source === 'deepl'), 'semicolons never stay inside a translation');
  assert.equal(main, list()[0][0], 'the first translation is the main one');

  updateSentence('spanish', id, { english: `${list()[1][0]}; The cat is eating fish.` });
  assert.deepEqual(list(), [
    ['The cat, eats fish.', 'deepl'],
    ['The cat is eating fish.', 'manual'],
  ]);
  assert.equal((db.prepare(`SELECT english, translation_source AS s FROM sentences WHERE id = ?`).get(id) as { english: string; s: string }).english, 'The cat, eats fish.');

  // Every translation is an accepted answer of a translate question.
  const config = getLanguageConfig(db);
  const gato = loadLearners(db, `word = 'gato'`)[0];
  let question = null;
  for (let i = 0; i < 20 && question?.sentence?.id !== id; i++) {
    question = buildQuestion(GAMES_BY_ID.foreignSentenceToEnglishTyped, gato, { db, langId: 'spanish', config, settings: getSettings(), frontier: 100, batchWords: [gato] });
  }
  assert.equal(question?.sentence?.id, id);
  assert.deepEqual(question?.accepted?.map((a) => a.text), ['The cat, eats fish.', 'The cat is eating fish.']);
  assert.deepEqual(question?.sentence?.translations, ['The cat, eats fish.', 'The cat is eating fish.']);
  setSentenceTranslations(db, id, ['EN El gato come pescado.']);
});

test('meanings of a word keep their sources; edits keep them too', async () => {
  const { saveDefinitions, updateWord, getWord } = await import('../backend/src/services/words.js');
  const db = languageDb('spanish');
  const gato = wordId(db, 'gato');
  const word = () => getWord('spanish', gato);
  assert.deepEqual([word().english, word().englishSources], [['cat'], ['word list: words']]);
  saveDefinitions(db, [{ id: gato, english: ['cat', 'tomcat'], source: 'wiktionary' }], false);
  assert.deepEqual([word().english, word().englishSources], [['cat', 'tomcat'], ['word list: words', 'wiktionary']], 'new meanings are added');
  updateWord('spanish', gato, { english: ['tomcat', 'kitty'] });
  assert.deepEqual([word().english, word().englishSources], [['tomcat', 'kitty'], ['wiktionary', 'manual']]);
  saveDefinitions(db, [{ id: gato, english: ['cat'], source: 'llm:test' }], true);
  assert.deepEqual([word().english, word().englishSources], [['kitty', 'cat'], ['manual', 'llm:test']], 'fetching again keeps typed meanings');
  assert.ok(word().origins?.some((origin) => origin.title === 'text'), 'books the word comes from');
});

test('recite questions ask long sentences in parts; translate questions give unseen words', () => {
  const db = languageDb('spanish');
  const config = getLanguageConfig(db);
  const perro = loadLearners(db, `word = 'perro'`)[0];
  const settings = { ...getSettings(), learning: { ...getSettings().learning, reciteMaxWords: 3 } };
  const ctx = { db, langId: 'spanish', config, settings, frontier: 3, batchWords: [perro] };
  const recite = buildQuestion(GAMES_BY_ID.foreignSentenceToForeignTyped, perro, ctx);
  // "El perro come carne en la casa." (7 words, at most 3) → 3 + 2 + 2.
  assert.equal(recite?.sentence?.text, 'El perro come');
  assert.deepEqual(recite?.sentence?.part, { index: 1, count: 3 });
  assert.equal(recite?.sentence?.full, 'El perro come carne en la casa.');
  assert.equal(recite?.answer, 'El perro come');
  assert.equal(recite?.sentence?.tokens.length, 3);

  const translate = buildQuestion(GAMES_BY_ID.foreignSentenceToEnglishTyped, perro, ctx);
  assert.equal(translate?.sentence?.text, 'El perro come carne en la casa.', 'translate questions use whole sentences');
  const hints = translate?.hints?.map((hint) => hint.text) ?? [];
  assert.ok(hints.includes('carne') && hints.includes('casa'), `unseen words are given: ${hints.join(', ')}`);
  assert.ok(!hints.includes('perro'), 'not the word asked about');
  assert.deepEqual(translate?.hints?.find((hint) => hint.text === 'carne')?.english, ['meat']);
});

test('bad audio only keeps a sentence out of listening questions', () => {
  const db = languageDb('spanish');
  const perro = wordId(db, 'perro');
  const only = sentenceId(db, 'El perro come carne');
  setSentenceExclusion('spanish', only, 'audio');
  assert.equal(pickSentence(db, perro, true, 100, false)?.id, only, 'still read and typed');
  assert.equal(pickSentence(db, perro, true, 100, true), null, 'never listened to');
  assert.equal((db.prepare(`SELECT sentence_count AS n FROM words WHERE id = ?`).get(perro) as { n: number }).n, 1);
  setSentenceExclusion('spanish', only, null);
});
