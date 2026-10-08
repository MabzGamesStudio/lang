import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  alignTokens,
  bestMatch,
  glossKey,
  glossVariants,
  normalizedTokens,
  splitGlossList,
  spokenWordSimilarity,
  stripParentheticals,
} from '../shared/text.js';
import { nextLevel, reviewIntervalMs, DAY_MS } from '../shared/scoring.js';
import { cleanBookText, parseCsv, processText, tidySentence } from '../backend/src/services/textProcessing.js';
import { labelsFromFilename } from '../backend/src/services/english.js';

const foreign = { locale: 'es', side: 'foreign' as const, accentLenient: true, typoTolerance: true };
const english = { locale: 'en', side: 'english' as const, accentLenient: true, typoTolerance: true };

test('gloss keys ignore articles, "to" and parentheses', () => {
  assert.equal(glossKey('To Say (something)'), 'say');
  assert.equal(glossKey('the house'), 'house');
  assert.equal(glossKey('a dog'), 'dog');
  assert.deepEqual(splitGlossList('to say; to tell, said'), ['to say', 'to tell', 'said']);
  assert.ok(glossVariants('(he/she) said').includes('said'));
  assert.ok(glossVariants('he/she said').includes('she said'));
});

test('typed answers are forgiving: accents, typos, variants, synonyms', () => {
  assert.equal(bestMatch('esta', ['está'], foreign)?.quality, 'accent');
  assert.equal(bestMatch('está', ['está'], foreign)?.quality, 'exact');
  assert.equal(bestMatch('cassa', ['casa'], foreign)?.quality, 'typo');
  assert.equal(bestMatch('perro', ['gato'], foreign), null);
  // Short words get no typo budget.
  assert.equal(bestMatch('si', ['no'], foreign), null);
  assert.equal(bestMatch('esta', ['está'], { ...foreign, accentLenient: false, typoTolerance: false }), null);
  assert.equal(bestMatch('say', ['to say'], english)?.quality, 'exact');
  assert.equal(bestMatch('the house', ['house'], english)?.quality, 'exact');
  assert.equal(bestMatch('said', ['(he/she) said'], english)?.quality, 'exact');
  // Second accepted answer (a synonym) is found.
  assert.equal(bestMatch('eso', ['que', 'eso'], foreign)?.index, 1);
});

test('notes in parentheses are never required or spoken', () => {
  assert.equal(stripParentheticals('(he/she) said'), 'said');
  assert.equal(stripParentheticals('el (m.) perro'), 'el perro');
  assert.equal(stripParentheticals('个（量词）'), '个');
  assert.equal(stripParentheticals('dijo (él).'), 'dijo.');
  assert.equal(stripParentheticals('(only a note)'), '(only a note)');
  // Typing without the note is exact; typing it is fine too.
  assert.equal(bestMatch('perro', ['perro (m)'], foreign)?.quality, 'exact');
  assert.equal(bestMatch('perro (m)', ['perro (m)'], foreign)?.quality, 'exact');
  assert.equal(bestMatch('个', ['个（量词）'], { ...foreign, locale: 'zh' })?.quality, 'exact');
  assert.equal(bestMatch('to go', ['to go (somewhere)'], english)?.quality, 'exact');
  assert.equal(spokenWordSimilarity(['perro'], ['perro (m)'], 'es'), 1);
});

test('sentence closeness metric aligns words', () => {
  const opts = { accentLenient: true, closeSimilarity: 0.75 };
  const expected = normalizedTokens('El perro está en la casa.', 'es');
  const perfect = alignTokens(expected, normalizedTokens('el perro esta en la casa', 'es'), opts);
  assert.ok(perfect.score > 0.95);
  const missing = alignTokens(expected, normalizedTokens('el perro en la casa', 'es'), opts);
  assert.equal(missing.expectedStatus[2], 'missing');
  assert.ok(missing.score > 0.8 && missing.score < 1);
  const wrong = alignTokens(expected, normalizedTokens('un gato come pan', 'es'), opts);
  assert.ok(wrong.score < 0.3);
  const typo = alignTokens(expected, normalizedTokens('el pero está en la cassa', 'es'), opts);
  assert.equal(typo.expectedStatus[5], 'close');
});

test('spoken word similarity tolerates recognition noise', () => {
  assert.ok(spokenWordSimilarity(['Perro.'], ['perro'], 'es') === 1);
  assert.ok(spokenWordSimilarity(['pero'], ['perro'], 'es') >= 0.7);
  assert.ok(spokenWordSimilarity(['gato'], ['perro'], 'es') < 0.5);
});

test('levels follow the TODO rules and clamp', () => {
  assert.equal(nextLevel('recognition', 0, true), 1);
  assert.equal(nextLevel('recognition', 2, true), 2);
  assert.equal(nextLevel('recall', 3, false), 1);
  assert.equal(nextLevel('translate', 2, false), 1);
  assert.equal(nextLevel('recite', 1, false), 1);
  assert.equal(reviewIntervalMs(1), DAY_MS);
  assert.equal(reviewIntervalMs(11), 730 * DAY_MS);
  assert.equal(reviewIntervalMs(99), 730 * DAY_MS);
});

test('book text is cleaned and split into words and sentences', () => {
  const raw = `Header\n*** START OF THE PROJECT GUTENBERG EBOOK X ***\nHola _amigo_ [1].\n\nEl perro come.\n*** END OF THE PROJECT GUTENBERG EBOOK X ***\nlicense`;
  const cleaned = cleanBookText(raw);
  assert.ok(!cleaned.includes('Header') && !cleaned.includes('license') && !cleaned.includes('_'));
  const processed = processText(cleaned, 'es', { minWords: 2, maxWords: 20 });
  assert.equal(processed.counts.get('perro')?.count, 1);
  assert.deepEqual(
    processed.sentences.map((s) => s.text),
    ['Hola amigo.', 'El perro come.']
  );
  assert.equal(tidySentence('—¿Qué dices, Sancho? —'), '¿Qué dices, Sancho?');
});

test('CSV parsing and image label filenames', () => {
  assert.deepEqual(parseCsv('word,english\nque,"that, what"\n'), [
    ['word', 'english'],
    ['que', 'that, what'],
  ]);
  assert.deepEqual(labelsFromFilename('dog,puppy_2.jpg'), ['dog', 'puppy']);
  assert.deepEqual(labelsFromFilename('red-apple.png'), ['red apple']);
});
