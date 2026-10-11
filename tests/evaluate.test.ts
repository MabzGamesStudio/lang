import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acceptedByYou, evaluateTyped } from '../frontend/src/lib/evaluate.js';
import { DEFAULT_SETTINGS } from '../shared/settings.js';
import type { Question } from '../shared/types.js';

// "Sancho come pan": only "come" and "pan" are scored (Sancho is a name).
const question: Question = {
  key: 'q',
  gameId: 'foreignSentenceToForeignTyped',
  phase: 'recite',
  targetWordId: 2,
  prompt: { mode: 'text', side: 'foreign', text: 'Sancho come pan', memorize: false },
  response: { mode: 'type', side: 'foreign' },
  accepted: [{ text: 'Sancho come pan', wordId: null, evaluate: false }],
  sentence: {
    id: 1,
    text: 'Sancho come pan',
    english: 'Sancho eats bread',
    tokens: [
      { text: 'Sancho', wordId: 1, evaluate: false, target: false, skip: 'excluded' },
      { text: 'come', wordId: 2, evaluate: true, target: true },
      { text: 'pan', wordId: 3, evaluate: true, target: false },
    ],
  },
  answer: 'Sancho come pan',
  answerSide: 'foreign',
  words: [],
};
const learning = { ...DEFAULT_SETTINGS.learning, sentenceThreshold: 0.8 };

test('words that are not scored never make a sentence wrong', () => {
  const outcome = evaluateTyped(question, 'Xanco come pan', 'es', learning);
  assert.equal(outcome.correct, true, 'a misspelt name does not count');
  assert.equal(outcome.quality, 'close', 'but the answer is not shown as exact');
  assert.deepEqual(outcome.results.map((r) => [r.wordId, r.correct]).sort(), [
    [2, true],
    [3, true],
  ]);
  const wrong = evaluateTyped(question, 'Sancho come', 'es', learning);
  assert.equal(wrong.correct, false, 'a scored word missing still counts');
  assert.deepEqual(wrong.results.find((r) => r.wordId === 3)?.correct, false);
  assert.equal(evaluateTyped(question, 'Sancho come pan', 'es', learning).quality, 'exact');
});

// "Yo tengo mucho dinero": every word is scored.
const translate = (side: 'foreign' | 'english'): Question => ({
  key: 't',
  gameId: side === 'foreign' ? 'englishSentenceToForeignTyped' : 'foreignSentenceToEnglishTyped',
  phase: 'translate',
  targetWordId: 12,
  prompt: { mode: 'text', side: side === 'foreign' ? 'english' : 'foreign', text: '', memorize: false },
  response: { mode: 'type', side },
  accepted: [{ text: side === 'foreign' ? 'Yo tengo mucho dinero' : 'I have a lot of money', wordId: null, evaluate: false }],
  sentence: {
    id: 2,
    text: 'Yo tengo mucho dinero',
    english: 'I have a lot of money',
    translations: ['I have a lot of money'],
    tokens: [
      { text: 'Yo', wordId: 11, evaluate: true, target: false, english: ['I'] },
      { text: 'tengo', wordId: 12, evaluate: true, target: true, english: ['I have', 'to have'] },
      { text: 'mucho', wordId: 13, evaluate: true, target: false, english: ['a lot', 'much', 'many'] },
      { text: 'dinero', wordId: 14, evaluate: true, target: false, english: ['money'] },
    ],
  },
  answer: side === 'foreign' ? 'Yo tengo mucho dinero' : 'I have a lot of money',
  answerSide: side,
  words: [],
});
const points = (outcome: { results: { wordId: number; correct: boolean }[] }) =>
  Object.fromEntries(outcome.results.map((result) => [result.wordId, result.correct]));

test('each word right in a sentence earns its point, even when the sentence is wrong', () => {
  const foreign = evaluateTyped(translate('foreign'), 'tengo muy dinero', 'es', learning);
  assert.equal(foreign.correct, false);
  assert.deepEqual(points(foreign), { 11: false, 12: true, 13: false, 14: true });

  const english = evaluateTyped(translate('english'), 'I have very money', 'es', learning);
  assert.equal(english.correct, false);
  assert.deepEqual(points(english), { 11: true, 12: true, 13: false, 14: true }, '“a lot” is in the translation but not in the answer');

  // A meaning the translation does not use is not held against the word.
  const other = { ...translate('english') };
  other.sentence = { ...other.sentence!, tokens: other.sentence!.tokens.map((token) => (token.wordId === 13 ? { ...token, english: ['plenty'] } : token)) };
  assert.deepEqual(points(evaluateTyped(other, 'I have very money', 'es', learning)), { 11: true, 12: true, 14: true });

  // The word asked about counts against a wrong answer even without its meaning in the translation.
  assert.deepEqual(points(evaluateTyped(translate('english'), 'you are rich', 'es', learning)), { 11: false, 12: false, 13: false, 14: false });
});

test('an answer you count as right gives every scored word its point', () => {
  const question = translate('english');
  const outcome = evaluateTyped(question, 'I own lots of cash', 'es', learning);
  assert.equal(outcome.correct, false);
  const yours = acceptedByYou(question, outcome);
  assert.equal(yours.correct, true);
  assert.equal(yours.quality, 'yours');
  assert.deepEqual(points(yours), { 11: true, 12: true, 13: true, 14: true });
});
