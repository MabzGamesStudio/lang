import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import Database from 'better-sqlite3';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lang-sources-'));
process.env.LANG_DATA_DIR = dataDir;

const { createLanguage } = await import('../backend/src/services/languages.js');
const { importText, importWordList, deleteSource } = await import('../backend/src/services/corpus.js');
const words = await import('../backend/src/services/words.js');
const { saveSettings } = await import('../backend/src/services/settings.js');
const { englishDatabase, languageDb, closeLanguageDb, languageDbPath } = await import('../backend/src/db/connection.js');
const { LANGUAGE_SCHEMA_VERSION } = await import('../backend/src/db/schema.js');
const { fetchDefinitions, fetchPronunciations } = await import('../backend/src/providers/definitions.js');
const { translateSentences } = await import('../backend/src/providers/translation.js');
const { getAudio, pinRecording, pregenerateAudio } = await import('../backend/src/providers/speech.js');
const { countNeeding, saveSourcePreferences, sourceInventory } = await import('../backend/src/services/regenerate.js');

const progress = { progress() {}, message() {}, checkCancelled() {}, cancelled: false };

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

const LIST = `word,english,count,ipa
el,the,100,el
perro,dog,90,ˈpero
gato,cat,80,/ˈgato/
come,eats,70,
casa,house,60,ˈkasa
pan,bread,50,`;

async function setUp(id: string) {
  createLanguage({ name: 'Spanish', id, code: 'es' } as never);
  await importWordList(id, { title: 'Basics', csv: LIST });
  await importText(id, { kind: 'text', title: 'Story A', text: 'El perro come pan. El gato come pan en la casa.' });
  return languageDb(id);
}

const wordId = (db: ReturnType<typeof languageDb>, word: string) => (db.prepare(`SELECT id FROM words WHERE word = ?`).get(word) as { id: number }).id;
const row = (db: ReturnType<typeof languageDb>, word: string) =>
  db.prepare(`SELECT english, english_sources AS sources, pronunciation FROM words WHERE word = ?`).get(word) as {
    english: string | null;
    sources: string | null;
    pronunciation: string | null;
  };

test('a version 3 database keeps every meaning, pronunciation and text, each with its source', () => {
  createLanguage({ name: 'Spanish', id: 'old', code: 'es' } as never);
  closeLanguageDb('old');
  const raw = new Database(languageDbPath('old'));
  raw.exec(`DROP TABLE word_meanings; DROP TABLE word_pronunciations; DROP TABLE sentence_sources;
    ALTER TABLE sentence_translations DROP COLUMN pinned; ALTER TABLE audio DROP COLUMN pinned;
    INSERT INTO sources (id, kind, title, added_at) VALUES (7, 'text', 'Story', 1);
    INSERT INTO words (word, display, english, english_sources, definition_source, pronunciation)
      VALUES ('gato', 'gato', '["cat","tomcat"]', '["wiktionary","manual"]', 'wiktionary', 'ˈgato');
    INSERT INTO sentences (text, source_id, word_count) VALUES ('El gato.', 7, 2);
    UPDATE meta SET value = '3' WHERE key = 'schema_version';`);
  raw.close();
  const db = languageDb('old');
  assert.equal(Number((db.prepare(`SELECT value FROM meta WHERE key = 'schema_version'`).get() as { value: string }).value), LANGUAGE_SCHEMA_VERSION);
  assert.deepEqual(db.prepare(`SELECT english, source, position FROM word_meanings ORDER BY position`).all(), [
    { english: 'cat', source: 'wiktionary', position: 0 },
    { english: 'tomcat', source: 'manual', position: 1 },
  ]);
  assert.deepEqual(db.prepare(`SELECT pronunciation, source FROM word_pronunciations`).all(), [{ pronunciation: 'ˈgato', source: 'wiktionary' }]);
  assert.deepEqual(db.prepare(`SELECT source_id FROM sentence_sources`).all(), [{ source_id: 7 }]);
  const columns = (table: string) => (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((column) => column.name);
  assert.ok(columns('sentence_translations').includes('pinned') && columns('audio').includes('pinned'));
});

test('meanings and pronunciations keep their sources; the preferred source or a pin decides which is used', async () => {
  const db = await setUp('es1');
  const perro = wordId(db, 'perro');
  assert.deepEqual(row(db, 'perro'), { english: '["dog"]', sources: '["word list: Basics"]', pronunciation: 'ˈpero' });
  assert.equal(row(db, 'gato').pronunciation, 'ˈgato', 'stored without slashes');

  // Another source: added after the first.
  words.saveDefinitions(db, [{ id: perro, english: ['hound'], pronunciation: 'ˈpe.ro', pos: 'noun', source: 'wiktionary' }], false);
  assert.deepEqual(row(db, 'perro'), { english: '["dog","hound"]', sources: '["word list: Basics","wiktionary"]', pronunciation: 'ˈpero' });
  const details = words.wordDetails('es1', perro);
  assert.deepEqual(
    details.pronunciations.map((value) => [value.text, value.source]),
    [
      ['ˈpero', 'word list: Basics'],
      ['ˈpe.ro', 'wiktionary'],
    ]
  );
  assert.deepEqual(details.origins.map((origin) => origin.title).sort(), ['Basics', 'Story A']);

  // Wiktionary preferred for meanings and pronunciations.
  saveSourcePreferences('es1', { meanings: ['wiktionary'], pronunciations: ['wiktionary'] });
  assert.deepEqual(row(db, 'perro'), { english: '["hound","dog"]', sources: '["wiktionary","word list: Basics"]', pronunciation: 'ˈpe.ro' });

  // A pin wins over the preferences.
  const dog = words.wordDetails('es1', perro).meanings.find((meaning) => meaning.text === 'dog')!;
  let changed = words.changeMeaning('es1', perro, { pin: dog.id, pinned: true });
  assert.equal(changed.meanings[0].text, 'dog');
  assert.equal(changed.meanings[0].pinned, true);
  assert.equal(JSON.parse(row(db, 'perro').english!)[0], 'dog');
  changed = words.changeMeaning('es1', perro, { pin: dog.id, pinned: false });
  assert.equal(changed.meanings[0].text, 'hound');

  // Editing makes a value yours; deleting removes it.
  changed = words.changeMeaning('es1', perro, { edit: dog.id, text: 'doggy' });
  assert.deepEqual(
    changed.meanings.map((meaning) => [meaning.text, meaning.source]),
    [
      ['hound', 'wiktionary'],
      ['doggy', 'manual'],
    ]
  );
  changed = words.changeMeaning('es1', perro, { add: 'mutt' });
  assert.equal(changed.meanings.at(-1)?.source, 'manual');
  const hound = changed.meanings.find((meaning) => meaning.text === 'hound')!;
  changed = words.changeMeaning('es1', perro, { remove: hound.id });
  assert.deepEqual(JSON.parse(row(db, 'perro').english!), ['doggy', 'mutt']);

  const typed = words.changePronunciation('es1', perro, { add: '/ˈpe.ro/' });
  assert.equal(typed.pronunciations.length, 2, 'the same pronunciation is not added twice');
  const pinned = words.changePronunciation('es1', perro, { pin: typed.pronunciations[1].id, pinned: true });
  assert.equal(row(db, 'perro').pronunciation, pinned.pronunciations[0].text);
  assert.equal(pinned.pronunciations[0].source, 'word list: Basics');

  const inventory = sourceInventory('es1');
  assert.ok(inventory.meanings.some((entry) => entry.source === 'word list: Basics' && entry.count >= 4));
  assert.ok(inventory.pronunciations.some((entry) => entry.source === 'wiktionary'));
  assert.deepEqual(inventory.sentences.map((entry) => entry.title), ['Story A']);
});

test('a sentence found in several texts lists them all and stays while one of them does', async () => {
  const db = languageDb('es1');
  await importText('es1', { kind: 'text', title: 'Story B', text: 'El perro come pan. La casa es grande.' });
  const sentence = (db.prepare(`SELECT id FROM sentences WHERE text = 'El perro come pan.'`).get() as { id: number }).id;
  let listed = words.getSentence('es1', sentence);
  assert.deepEqual(
    listed.origins.map((origin) => origin.title),
    ['Story A', 'Story B']
  );
  assert.equal(listed.sourceTitle, 'Story A');
  const storyA = listed.origins[0].id;
  const storyB = listed.origins[1].id;
  assert.equal(words.listSentences('es1', { offset: 0, limit: 10, q: '', filter: 'all', sourceId: storyB }).total, 2);
  deleteSource('es1', storyA);
  listed = words.getSentence('es1', sentence);
  assert.deepEqual(
    listed.origins.map((origin) => origin.title),
    ['Story B']
  );
  assert.equal(listed.sourceTitle, 'Story B');
  assert.equal(db.prepare(`SELECT 1 FROM sentences WHERE text = 'El gato come pan en la casa.'`).get(), undefined, 'only in Story A: gone');
  deleteSource('es1', storyB);
  assert.equal(db.prepare(`SELECT 1 FROM sentences WHERE id = ?`).get(sentence), undefined);
});

test('translations: the preferred source is the main one, a pinned one always', async () => {
  const db = await setUp('es2');
  const id = (db.prepare(`SELECT id FROM sentences WHERE text = 'El perro come pan.'`).get() as { id: number }).id;
  words.saveSentenceTranslations(db, [{ id, english: 'The dog eats bread.' }], 'llm:test');
  words.saveSentenceTranslations(db, [{ id, english: 'The dog is eating bread.' }], 'deepl');
  const main = () => (db.prepare(`SELECT english, translation_source AS source FROM sentences WHERE id = ?`).get(id) as { english: string; source: string });
  assert.deepEqual(main(), { english: 'The dog eats bread.', source: 'llm:test' });
  saveSourcePreferences('es2', { translations: ['deepl'] });
  assert.deepEqual(main(), { english: 'The dog is eating bread.', source: 'deepl' });
  const llm = words.getSentence('es2', id).translations.find((translation) => translation.source === 'llm:test')!;
  let sentence = words.changeTranslation('es2', id, { pin: llm.id, pinned: true });
  assert.deepEqual(main(), { english: 'The dog eats bread.', source: 'llm:test' });
  assert.equal(sentence.translations[0].pinned, true);
  sentence = words.changeTranslation('es2', id, { edit: llm.id, text: 'The dog eats the bread; really' });
  assert.deepEqual(main(), { english: 'The dog eats the bread, really', source: 'manual' }, 'edited: yours, still pinned');
  sentence = words.changeTranslation('es2', id, { remove: sentence.translations[0].id });
  assert.deepEqual(main(), { english: 'The dog is eating bread.', source: 'deepl' });
  sentence = words.changeTranslation('es2', id, { add: 'Dog eats bread.' });
  assert.deepEqual(
    sentence.translations.map((translation) => translation.source),
    ['deepl', 'manual']
  );
});

test('recordings: a pinned one is played, else the preferred voice', async () => {
  const db = languageDb('es2');
  const insert = db.prepare(`INSERT INTO audio (text, voice, mime, data, created_at) VALUES ('casa', ?, 'audio/mpeg', ?, ?)`);
  insert.run('colab:a', Buffer.from('A'), 1);
  insert.run('azure:b', Buffer.from('B'), 2);
  saveSourcePreferences('es2', { audio: ['azure:b'] });
  for (let i = 0; i < 5; i++) assert.equal((await getAudio('es2', 'casa', false))!.data.toString(), 'B');
  const listed = words.recordingsOf(db, 'casa', JSON.stringify(['azure:b']));
  assert.deepEqual(
    listed.map((recording) => recording.voice),
    ['azure:b', 'colab:a']
  );
  const colab = listed.find((recording) => recording.voice === 'colab:a')!;
  assert.equal(pinRecording('es2', colab.id, true), true);
  for (let i = 0; i < 5; i++) assert.equal((await getAudio('es2', 'casa', false))!.data.toString(), 'A');
  pinRecording('es2', colab.id, false);
  assert.equal((await getAudio('es2', 'casa', false))!.data.toString(), 'B');
});

test('definitions: which words are done again depends on the sources of their meanings', async () => {
  const db = await setUp('es3');
  const asked: string[][] = [];
  const llm = serve((req, body, res) => {
    const prompt = (JSON.parse(body) as { messages: { content: string }[] }).messages.at(-1)!.content;
    const list = JSON.parse(/Words: (\[.*\])/.exec(prompt)?.[1] ?? /(\[[^\]]*\])\s*$/.exec(prompt)?.[1] ?? '[]') as string[];
    asked.push(list);
    const items = list.map((word) => ({ word, english: [`${word} (llm)`], ipa: `${word}-llm`, pos: 'noun' }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ items }) } }] }));
  });
  try {
    saveSettings({ llm: { provider: 'openai', openai: { baseUrl: await llm.url(), apiKey: '', model: 'mock' } }, definitions: { provider: 'llm' } });
    const casa = wordId(db, 'casa');
    words.changeMeaning('es3', casa, { add: 'home' });
    // Words of the text without a meaning: la, en (only missing).
    const missing = countNeeding('es3', 'meanings', { mode: 'missing', keep: [], replace: false });
    await fetchDefinitions('es3', { limit: 50, policy: { mode: 'missing', keep: [], replace: false } }, progress);
    assert.equal(asked.flat().length, missing);
    assert.ok(!asked.flat().includes('perro'));

    // Again, except for words with a meaning you typed: casa is kept as it is.
    asked.length = 0;
    const policy = { mode: 'unless' as const, keep: ['manual'], replace: true };
    const expected = countNeeding('es3', 'meanings', policy);
    await fetchDefinitions('es3', { limit: 50, policy }, progress);
    assert.equal(asked.flat().length, expected);
    assert.ok(asked.flat().includes('perro') && !asked.flat().includes('casa'));
    assert.deepEqual(row(db, 'perro').sources, '["llm:mock"]', 'the word list meaning was replaced');
    assert.equal(JSON.parse(row(db, 'casa').english!).includes('home'), true);
    assert.deepEqual(
      words.wordDetails('es3', wordId(db, 'perro')).pronunciations.map((value) => value.source),
      ['llm:mock'],
      'the pronunciation from the list was replaced too'
    );

    // Keeping the language model's meanings: nothing left to do.
    assert.equal(countNeeding('es3', 'meanings', { mode: 'unless', keep: ['manual', 'llm:mock'], replace: false }), 0);

    // Pronunciations alone, without replacing: added as another one.
    asked.length = 0;
    const gato = wordId(db, 'gato');
    await fetchPronunciations('es3', { wordIds: [gato], policy: { mode: 'unless', keep: [], replace: false }, provider: 'llm' }, progress);
    assert.deepEqual(asked, [['gato']]);
    assert.ok(words.wordDetails('es3', gato).pronunciations.some((value) => value.text === 'gato-llm'));
  } finally {
    llm.server.close();
    saveSettings({});
  }
});

test('translations and audio: done again unless they come from the sources kept', async () => {
  const db = languageDb('es3');
  const translator = serve((req, body, res) => {
    const { q } = JSON.parse(body) as { q: string[] };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ translatedText: q.map((text) => `LT ${text}`) }));
  });
  const voice = serve((req, body, res) => {
    res.writeHead(200, { 'Content-Type': 'audio/mpeg' });
    res.end(`VOICE ${(JSON.parse(body) as { input: string }).input}`);
  });
  try {
    saveSettings({
      translation: { provider: 'libretranslate', libretranslate: { url: await translator.url(), apiKey: '' } },
      tts: { provider: 'openai', openai: { baseUrl: await voice.url(), apiKey: '', model: 'tts-mock', voice: 'v1' } },
    });
    const sentences = db.prepare(`SELECT id, text FROM sentences ORDER BY id`).all() as { id: number; text: string }[];
    words.saveSentenceTranslations(db, [{ id: sentences[0].id, english: 'Typed.' }], 'manual');
    words.saveSentenceTranslations(db, [{ id: sentences[1].id, english: 'Old.' }], 'llm:old');
    // Keep what you typed; replace the old model's translation.
    await translateSentences('es3', { limit: 10, policy: { mode: 'unless', keep: ['manual'], replace: true } }, progress);
    const translations = (id: number) => words.getSentence('es3', id).translations.map((translation) => `${translation.english} [${translation.source}]`);
    assert.deepEqual(translations(sentences[0].id), ['Typed. [manual]']);
    assert.deepEqual(translations(sentences[1].id), [`LT ${sentences[1].text} [libretranslate]`]);

    // Audio: words without a recording by the kept voice get one; the others are replaced.
    db.prepare(`INSERT INTO audio (text, voice, mime, data, created_at) VALUES ('perro', 'colab:old', 'audio/mpeg', ?, 1)`).run(Buffer.from('old'));
    db.prepare(`INSERT INTO audio (text, voice, mime, data, created_at) VALUES ('gato', 'openai:tts-mock:v1', 'audio/mpeg', ?, 1)`).run(Buffer.from('kept'));
    const policy = { mode: 'unless' as const, keep: ['openai:tts-mock:v1'], replace: true };
    const before = countNeeding('es3', 'audio', policy);
    await pregenerateAudio('es3', { words: 100, sentences: 0, policy }, progress);
    const voices = (text: string) => (db.prepare(`SELECT voice, data FROM audio WHERE text = ?`).all(text) as { voice: string; data: Buffer }[]).map((r) => `${r.voice}=${r.data}`);
    assert.deepEqual(voices('perro'), ['openai:tts-mock:v1=VOICE perro'], 'the old voice was replaced');
    assert.deepEqual(voices('gato'), ['openai:tts-mock:v1=kept'], 'kept as it was');
    // The English meaning of a word that already had its recording gets one too.
    const gloss = JSON.parse(row(db, 'gato').english!)[0] as string;
    assert.ok(englishDatabase().prepare(`SELECT 1 FROM audio WHERE text = ?`).get(words.audioText(gloss)), 'English recording of “gato”');
    assert.ok(before > 0);
    assert.equal(countNeeding('es3', 'audio', { ...policy, replace: false }) < before, true);
  } finally {
    translator.server.close();
    voice.server.close();
    saveSettings({});
  }
});
