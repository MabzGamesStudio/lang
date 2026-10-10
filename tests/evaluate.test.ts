import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateTyped } from '../frontend/src/lib/evaluate.js';
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
