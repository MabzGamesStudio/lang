import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import Database from 'better-sqlite3';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lang-ipa-'));
process.env.LANG_DATA_DIR = dataDir;

const { IPA_SOUNDS, IPA_BY_SYMBOL, LEARNING_ORDER, isEnglishSound } = await import('../shared/ipa/inventory.js');
const { blankSound, compareIpa, firstTranscription, looksLikeIpa, looseIpa, replaceSound, segmentIpa, soundsIn, baseSound } = await import(
  '../shared/ipa/text.js'
);
const { IPA_GAMES } = await import('../shared/ipa/games.js');
const { phoneticConsumes, phoneticScheme, transliterate } = await import('../shared/ime/transliterate.js');
const ipa = await import('../backend/src/services/ipa.js');
const { englishDatabase, closeEnglishDb } = await import('../backend/src/db/connection.js');
const { ENGLISH_SCHEMA_VERSION } = await import('../backend/src/db/schema.js');
const { createLanguage } = await import('../backend/src/services/languages.js');
const { importWordList } = await import('../backend/src/services/corpus.js');
const { saveSettings } = await import('../backend/src/services/settings.js');
const { ENGLISH_DB_PATH } = await import('../backend/src/config.js');

const ctx = { progress() {}, message() {}, checkCancelled() {}, cancelled: false };

test('transcriptions are split into sounds and compared sound by sound', () => {
  assert.deepEqual(segmentIpa('ˈtʃɝtʃ'), ['tʃ', 'ɝ', 'tʃ']);
  assert.deepEqual(segmentIpa('/ʃøːn/'), ['ʃ', 'øː', 'n']);
  assert.deepEqual(segmentIpa('t͡saɪt'), ['ts', 'a', 'ɪ', 't'], 'tie bars are ignored');
  assert.deepEqual(soundsIn('kæt'), ['k', 'æ', 't']);

  const exact = compareIpa('θɪn', '/θɪn/');
  assert.ok(exact.correct && exact.exact);
  const loose = compareIpa('ˈbʌɾɚ', 'bəɾəɹ');
  assert.ok(loose.correct && !loose.exact, 'ʌ / ə and ɚ / əɹ are accepted');
  const wrong = compareIpa('θɪn', 'ðɪn');
  assert.equal(wrong.correct, false);
  assert.deepEqual(
    wrong.segments.map((segment) => segment.status),
    ['missing', 'exact', 'exact']
  );
  assert.deepEqual(wrong.extra, ['ð']);
  const length = compareIpa('ʃøːn', 'ʃøn');
  assert.equal(length.segments[1].status, 'close', 'the vowel without its length mark is close');
  assert.ok(length.correct);

  assert.equal(replaceSound('ˈθɪŋk', 'θ', 'ð'), 'ˈðɪŋk');
  assert.equal(replaceSound('tʃɝtʃ', 't', 'd'), 'tʃɝtʃ', 'the t of tʃ is not a t');
  assert.equal(replaceSound('ʃøːn', 'ø', 'o'), 'ʃoːn', 'diacritics stay');
  assert.equal(blankSound('ˈθɪŋkθ', 'θ'), 'ˈ_ɪŋk_');
  assert.equal(looseIpa('ˈwɔɾɚ'), 'wɔɾəɹ');
  assert.equal(firstTranscription('/ˈpe.ro/, /ˈpero/'), 'ˈpe.ro');
  assert.ok(looksLikeIpa('ˈpe.ro'));
  assert.ok(!looksLikeIpa('xué shēng'), 'pinyin');
  assert.ok(!looksLikeIpa('がくせい'), 'kana');
});

test('the inventory: each example contains its sound, English sounds come first', () => {
  const symbols = new Set<string>();
  for (const sound of IPA_SOUNDS) {
    assert.ok(!symbols.has(sound.symbol), `${sound.symbol} once`);
    symbols.add(sound.symbol);
    assert.ok(sound.examples.length >= 1, `${sound.symbol} has examples`);
    for (const example of sound.examples) {
      assert.ok(segmentIpa(example.ipa).map(baseSound).includes(sound.symbol), `${example.word} [${example.ipa}] has ${sound.symbol}`);
      if (example.lang !== 'en' && example.lang !== 'en-GB') assert.ok(example.gloss, `${example.word} has a meaning`);
    }
  }
  assert.equal(LEARNING_ORDER.length, IPA_SOUNDS.length);
  const firstOther = LEARNING_ORDER.findIndex((symbol) => !isEnglishSound(IPA_BY_SYMBOL[symbol]));
  assert.ok(LEARNING_ORDER.slice(firstOther).every((symbol) => !isEnglishSound(IPA_BY_SYMBOL[symbol])));
  assert.equal(IPA_BY_SYMBOL[LEARNING_ORDER[0]].kind, 'consonant');
  assert.equal(IPA_GAMES.length, 10);
});

test('X-SAMPA typing gives IPA, upper and lower case being different letters', () => {
  const scheme = phoneticScheme('ipa')!;
  assert.equal(transliterate('"TIN', scheme), 'ˈθɪŋ');
  assert.equal(transliterate('tS3`tS', scheme), 'tʃɝtʃ');
  assert.equal(transliterate('sS', scheme), 'sʃ');
  assert.equal(transliterate('r\\Ed', scheme), 'ɹɛd');
  assert.equal(transliterate('b{t@`', scheme), 'bætɚ');
  assert.equal(transliterate('Si:', scheme), 'ʃiː');
  assert.equal(transliterate('t`', scheme), 'ʈ');
  assert.ok(phoneticConsumes(scheme, 'S') && phoneticConsumes(scheme, '\\') && phoneticConsumes(scheme, '`') && phoneticConsumes(scheme, '{'));
  // Other schemes still ignore case.
  assert.equal(transliterate('Privet', phoneticScheme('ru')!), 'Привет');
});

// A small stand-in for the Commons API and its file server.
function fakeCommons() {
  const files: Record<string, { license?: string; artist?: string }> = {
    'Voiceless dental fricative.ogg': { license: 'CC BY-SA 3.0', artist: '<a href="//commons.wikimedia.org/wiki/User:Peter_Isotalo">Peter Isotalo</a>' },
    'Voiced dental fricative 02.ogg': { license: 'Public domain', artist: 'Someone &amp; co' },
    'En-us-thin.ogg': { license: 'CC BY-SA 3.0', artist: 'Commons user' },
    'LL-Q150 (fra)-Lepticed7-tu.wav': { license: 'CC BY-SA 4.0', artist: 'Lepticed7' },
    'LL-Q150 (fra)-Lepticed7-tue.wav': { license: 'CC BY-SA 4.0', artist: 'Lepticed7' },
  };
  const requests: string[] = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    requests.push(url.pathname + url.search);
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    if (url.pathname.startsWith('/files/')) {
      res.setHeader('Content-Type', 'application/ogg');
      res.end(Buffer.from(`OggS fake audio of ${decodeURIComponent(url.pathname.slice(7))}`));
      return;
    }
    const page = (title: string, index?: number) => {
      const name = title.replace(/^File:/, '');
      const file = files[name];
      if (!file) return { title, missing: true };
      return {
        title,
        ...(index !== undefined ? { index } : {}),
        imageinfo: [
          {
            url: `${base}/files/${encodeURIComponent(name)}`,
            descriptionurl: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(name.replace(/ /g, '_'))}`,
            mime: name.endsWith('.wav') ? 'audio/wav' : 'application/ogg',
            size: 1000,
            extmetadata: { LicenseShortName: { value: file.license }, Artist: { value: file.artist } },
          },
        ],
      };
    };
    let pages: unknown[] = [];
    const titles = url.searchParams.get('titles');
    const search = url.searchParams.get('gsrsearch');
    if (titles) pages = titles.split('|').map((title) => page(title));
    else if (search?.toLowerCase().includes('voiced dental fricative')) pages = [page('File:Voiced dental fricative 02.ogg', 1)];
    else if (search?.includes('"tu"') && search.includes('fra')) {
      pages = [page('File:LL-Q150 (fra)-Lepticed7-tue.wav', 1), page('File:LL-Q150 (fra)-Lepticed7-tu.wav', 2)];
    }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ batchcomplete: true, query: { pages } }));
  });
  server.listen(0, '127.0.0.1');
  return {
    requests,
    url: async () => {
      if (!server.listening) await new Promise((resolve) => server.once('listening', resolve));
      return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    },
    close: () => server.close(),
  };
}

test('an English database of version 1 gets the pronunciation tables', () => {
  englishDatabase();
  closeEnglishDb();
  const raw = new Database(ENGLISH_DB_PATH);
  raw.exec(`DROP TABLE ipa_audio; DROP TABLE ipa_progress; UPDATE meta SET value = '1' WHERE key = 'schema_version';`);
  raw.close();
  const db = englishDatabase();
  const tables = (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[]).map((row) => row.name);
  assert.ok(tables.includes('ipa_audio') && tables.includes('ipa_progress'));
  assert.equal(Number((db.prepare(`SELECT value FROM meta WHERE key = 'schema_version'`).get() as { value: string }).value), ENGLISH_SCHEMA_VERSION);
});

test('sound games wait for the recordings of the sounds', () => {
  saveSettings({});
  const next = ipa.nextIpaQuestion({ gameId: 'soundToSymbol', recent: [], sounds: 'english', words: 'examples' });
  assert.equal(next.question, null);
  assert.match(next.notice ?? '', /not downloaded/);
});

test('recordings come from Wikimedia Commons with their licence and author', async () => {
  const commons = fakeCommons();
  process.env.LANG_COMMONS_API = `${await commons.url()}/w/api.php`;
  try {
    const summary = await ipa.downloadIpaRecordings(ctx);
    assert.match(summary, /4 recordings from Wikimedia Commons/);
    const db = englishDatabase();
    const rows = db.prepare(`SELECT lang, text, source, license, author, url FROM ipa_audio ORDER BY lang, text`).all();
    assert.deepEqual(rows, [
      { lang: 'en', text: 'thin', source: 'commons:En-us-thin.ogg', license: 'CC BY-SA 3.0', author: 'Commons user', url: 'https://commons.wikimedia.org/wiki/File:En-us-thin.ogg' },
      {
        lang: 'fr',
        text: 'tu',
        source: 'commons:LL-Q150 (fra)-Lepticed7-tu.wav',
        license: 'CC BY-SA 4.0',
        author: 'Lepticed7',
        url: 'https://commons.wikimedia.org/wiki/File:LL-Q150_(fra)-Lepticed7-tu.wav',
      },
      {
        lang: 'ipa',
        text: 'ð',
        source: 'commons:Voiced dental fricative 02.ogg',
        license: 'Public domain',
        author: 'Someone & co',
        url: 'https://commons.wikimedia.org/wiki/File:Voiced_dental_fricative_02.ogg',
      },
      {
        lang: 'ipa',
        text: 'θ',
        source: 'commons:Voiceless dental fricative.ogg',
        license: 'CC BY-SA 3.0',
        author: 'Peter Isotalo',
        url: 'https://commons.wikimedia.org/wiki/File:Voiceless_dental_fricative.ogg',
      },
    ]);
    // English words only take recordings of their accent (no search for other speakers).
    assert.ok(!commons.requests.some((request) => /gsrsearch=[^&]*%22thin%22/.test(request)));

    const audio = await ipa.ipaAudio({ kind: 'sound', lang: 'ipa', text: 'θ' });
    assert.match(audio!.data.toString(), /Voiceless dental fricative/);
    assert.equal(audio!.mime, 'audio/ogg');
    assert.equal(await ipa.ipaAudio({ kind: 'sound', lang: 'ipa', text: 'ʃ' }), null, 'no recording: nothing to play');
    assert.equal(await ipa.ipaAudio({ kind: 'example', lang: 'en', text: 'ship' }), null, 'no voice service: the device speaks');
    await assert.rejects(ipa.ipaAudio({ kind: 'example', lang: 'en', text: 'anything' }), /not an example word/);

    const overview = ipa.ipaSummary();
    assert.equal(overview.download.sounds, 2);
    assert.equal(overview.download.words, 2);
    const theta = overview.sounds.find((sound) => sound.symbol === 'θ')!;
    assert.equal(theta.recordings[0].author, 'Peter Isotalo');
    assert.equal(theta.examples.find((example) => example.word === 'thin')!.recordings.length, 1);

    // Downloading again only asks for what is still missing.
    assert.ok(commons.requests.some((request) => request.includes('Voiceless+dental+fricative')));
    commons.requests.length = 0;
    await ipa.downloadIpaRecordings(ctx);
    assert.ok(!commons.requests.some((request) => request.includes('Voiceless+dental+fricative')));
  } finally {
    commons.close();
  }
});

test('when Commons cannot be reached the download says so', async () => {
  const closed = http.createServer();
  await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve));
  const port = (closed.address() as AddressInfo).port;
  closed.close();
  process.env.LANG_COMMONS_API = `http://127.0.0.1:${port}/w/api.php`;
  englishDatabase().prepare(`DELETE FROM ipa_audio WHERE lang = 'ipa'`).run();
  await assert.rejects(ipa.downloadIpaRecordings(ctx), /Wikimedia Commons could not be reached/);
});

test('sound questions use the sounds with a recording; options are similar sounds', () => {
  const db = englishDatabase();
  db.prepare(`DELETE FROM ipa_audio`).run();
  const insert = db.prepare(`INSERT INTO ipa_audio (lang, text, source, mime, data, created_at) VALUES ('ipa', ?, 'commons:x', 'audio/ogg', x'00', 0)`);
  for (const symbol of ['θ', 'ð', 'f', 's', 'p']) insert.run(symbol);
  for (let i = 0; i < 20; i++) {
    const { question } = ipa.nextIpaQuestion({ gameId: 'soundToSymbol', recent: [], sounds: 'english', words: 'examples' });
    assert.ok(question && ['θ', 'ð', 'f', 's', 'p'].includes(question.symbol));
    assert.equal(question.audio?.kind, 'sound');
    assert.equal(question.options!.length, 4);
    assert.equal(question.options!.filter((option) => option.correct).length, 1);
    assert.ok(question.options!.every((option) => IPA_BY_SYMBOL[option.text]?.kind === question.sound.kind), 'same kind of sound');
    const pick = ipa.nextIpaQuestion({ gameId: 'symbolToSound', recent: [], sounds: 'english', words: 'examples' }).question!;
    assert.ok(pick.options!.every((option) => option.audio?.kind === 'sound' && ['θ', 'ð', 'f', 's', 'p'].includes(option.text)));
  }
});

test('word questions: transcriptions to choose, words to read, sounds left out', () => {
  for (let i = 0; i < 30; i++) {
    const choice = ipa.nextIpaQuestion({ gameId: 'wordAudioToIpa', recent: [], sounds: 'english', words: 'examples' }).question!;
    assert.ok(choice.word && soundsIn(choice.word.ipa).includes(choice.symbol));
    assert.ok(choice.word.lang === 'en' || choice.word.lang === 'en-GB', 'English words for English sounds');
    const texts = choice.options!.map((option) => looseIpa(option.text));
    assert.equal(new Set(texts).size, texts.length, 'no two options count as the same transcription');
    assert.equal(choice.options!.find((option) => option.correct)!.text, choice.word.ipa);
    assert.equal(choice.audio?.kind, 'example');

    const blanks = ipa.nextIpaQuestion({ gameId: 'examplesToSymbolTyped', recent: [], sounds: 'all', words: 'examples' }).question!;
    assert.ok(blanks.examples!.length >= 1);
    for (const example of blanks.examples!) {
      assert.ok(example.blanked.includes('_'));
      assert.ok(!soundsIn(example.blanked).includes(blanks.symbol));
    }
    assert.equal(blanks.answer, blanks.symbol);

    const read = ipa.nextIpaQuestion({ gameId: 'ipaToWordTyped', recent: [], sounds: 'all', words: 'examples' }).question!;
    assert.match(read.answer, /^[\p{Script=Latin}\s'’-]+$/u, 'a word that can be typed');
    assert.equal(read.audio, undefined, 'the word is not played before answering');

    const records = ipa.nextIpaQuestion({ gameId: 'ipaToWordAudio', recent: [], sounds: 'english', words: 'examples' }).question!;
    assert.ok(records.options!.length >= 2);
    assert.ok(records.options!.every((option) => option.audio && option.word?.lang === records.word!.lang));
  }
});

test('typed transcriptions also score the sounds of the word met before', () => {
  ipa.resetIpaProgress();
  const levels = ipa.applyIpaResults([
    { symbol: 'ɪ', phase: 'recite', correct: true },
    { symbol: 'nope', phase: 'recite', correct: true },
  ]);
  assert.deepEqual(Object.keys(levels), ['ɪ']);
  assert.equal(levels['ɪ'].recite, 1);
  let found = false;
  for (let i = 0; i < 200 && !found; i++) {
    const question = ipa.nextIpaQuestion({ gameId: 'wordAudioToIpaTyped', recent: [], sounds: 'english', words: 'examples' }).question!;
    if (question.symbol === 'ɪ' || !soundsIn(question.word!.ipa).includes('ɪ')) continue;
    found = true;
    assert.deepEqual(question.scored, [question.symbol, 'ɪ']);
  }
  assert.ok(found, 'a word with ɪ was asked');
});

test('levels follow the required number of correct answers', () => {
  ipa.resetIpaProgress();
  assert.equal(ipa.applyIpaResults([{ symbol: 'θ', phase: 'recognition', correct: true }])['θ'].recognition, 1);
  assert.equal(ipa.applyIpaResults([{ symbol: 'θ', phase: 'recognition', correct: true }])['θ'].recognition, 2);
  assert.equal(ipa.applyIpaResults([{ symbol: 'θ', phase: 'recognition', correct: true }])['θ'].recognition, 2, 'mastered');
  assert.equal(ipa.applyIpaResults([{ symbol: 'θ', phase: 'recognition', correct: false }])['θ'].recognition, 1);
  const theta = ipa.ipaSummary().sounds.find((sound) => sound.symbol === 'θ')!;
  assert.deepEqual([theta.correct, theta.wrong], [3, 1]);
  // The first sounds not mastered yet are asked first.
  ipa.resetIpaProgress();
  const asked = new Set<string>();
  for (let i = 0; i < 60; i++) {
    asked.add(ipa.nextIpaQuestion({ gameId: 'wordToIpaTyped', recent: [], sounds: 'english', words: 'examples' }).question!.symbol);
  }
  const firstSeven = LEARNING_ORDER.filter((symbol) => isEnglishSound(IPA_BY_SYMBOL[symbol])).slice(0, 7);
  assert.ok([...asked].every((symbol) => firstSeven.includes(symbol)), `${[...asked].join(' ')} within ${firstSeven.join(' ')}`);
});

test('words of your languages with an IPA pronunciation can be practised', async () => {
  createLanguage({ name: 'Spanish', id: 'es-ipa', code: 'es' } as never);
  await importWordList('es-ipa', {
    title: 'words',
    csv: 'word,english,count,ipa\nperro,dog,50,/ˈpe.ro/\ngato,cat,40,ˈɡato\ncasa,house,30,ˈkasa\nsol,sun,20,sol\nluna,moon,10,ˈluna',
  });
  const summary = ipa.ipaSummary();
  assert.deepEqual(summary.languages, [{ id: 'es-ipa', name: 'Spanish', words: 5 }]);
  for (let i = 0; i < 20; i++) {
    const question = ipa.nextIpaQuestion({ gameId: 'wordToIpaTyped', recent: [], sounds: 'all', words: 'es-ipa' }).question!;
    assert.equal(question.word!.lang, 'es-ipa');
    assert.equal(question.word!.audio.kind, 'word');
    assert.ok(['ˈpe.ro', 'ˈɡato', 'ˈkasa', 'sol', 'ˈluna'].includes(question.answer));
    assert.ok(soundsIn(question.answer).includes(question.symbol));
  }
  createLanguage({ name: 'Chinese', id: 'zh-ipa', code: 'zh' } as never);
  const chinese = ipa.nextIpaQuestion({ gameId: 'wordToIpaTyped', recent: [], sounds: 'all', words: 'zh-ipa' });
  assert.equal(chinese.question, null);
  assert.match(chinese.notice ?? '', /no words with an IPA pronunciation/);
});
