import {
  alignTokens,
  bestMatch,
  normalizeForCompare,
  normalizedTokens,
  spokenWordSimilarity,
  stripParentheticals,
  type AlignedToken,
} from '../../../shared/text';
import type { LearningSettings, Question, WordResult } from '../../../shared/types';

// Turns an answer into immediate feedback and the per-word score changes.
// Evaluation is deliberately forgiving: synonyms, homographs, every word an
// image stands for, missing accents, small typos and near-miss sentences.

export type Quality = 'exact' | 'accent' | 'typo' | 'synonym' | 'close' | 'wrong';

export interface Outcome {
  correct: boolean;
  quality: Quality;
  response: string;
  score?: number;
  alignment?: AlignedToken[];
  matched?: string;
  note?: string;
  results: WordResult[];
}

function wrong(question: Question, response: string, extra: WordResult[] = []): Outcome {
  return {
    correct: false,
    quality: 'wrong',
    response,
    results: [{ wordId: question.targetWordId, phase: question.phase, correct: false }, ...extra],
  };
}

export function evaluateChoice(question: Question, index: number): Outcome {
  const option = question.options![index];
  if (option.correct) {
    return {
      correct: true,
      quality: option.wordId === question.targetWordId ? 'exact' : 'synonym',
      response: option.text,
      matched: option.text,
      results: [{ wordId: question.targetWordId, phase: question.phase, correct: true }],
    };
  }
  // The learner confused the two words: both need more practice.
  const confused: WordResult[] = option.evaluate ? [{ wordId: option.wordId, phase: question.phase, correct: false }] : [];
  return wrong(question, option.text, confused);
}

function wordOutcome(question: Question, response: string, locale: string, settings: LearningSettings): Outcome {
  const accepted = question.accepted ?? [];
  const side = question.response.side;
  const match = bestMatch(
    response,
    accepted.map((answer) => answer.text),
    { locale: side === 'foreign' ? locale : 'en', side, accentLenient: settings.accentLenient, typoTolerance: settings.typoTolerance }
  );
  if (!match) return wrong(question, response);
  const answer = accepted[match.index];
  if (answer.wordId !== null && answer.wordId !== question.targetWordId) {
    // A synonym: correct, credited to the word that was typed.
    return {
      correct: true,
      quality: 'synonym',
      response,
      matched: answer.text,
      results: answer.evaluate ? [{ wordId: answer.wordId, phase: question.phase, correct: true }] : [],
    };
  }
  return {
    correct: true,
    quality: match.quality,
    response,
    matched: answer.text,
    results: [{ wordId: question.targetWordId, phase: question.phase, correct: true }],
  };
}

// Like the alignment score, but only over the words that are scored: names
// and words not met yet neither help nor hurt. Extra words still count.
function countedScore(alignment: AlignedToken[], counts: boolean[]): number {
  let total = 0;
  let size = 0;
  for (const token of alignment) {
    if (token.expectedIndex !== null && !counts[token.expectedIndex]) continue;
    if (token.expected !== null) size++;
    if (token.actual !== null) size++;
    if (token.status === 'exact' || token.status === 'close') total += token.weight ?? 1;
  }
  return size === 0 ? 1 : (2 * total) / size;
}

function sentenceOutcome(
  question: Question,
  response: string,
  actual: string[],
  locale: string,
  threshold: number,
  closeSimilarity: number,
  accentLenient: boolean
): Outcome {
  const sentence = question.sentence!;
  const foreignAnswer = question.response.side === 'foreign';
  const expected = foreignAnswer
    ? sentence.tokens.map((token) => normalizeForCompare(token.text, locale))
    : normalizedTokens(stripParentheticals(question.answer), 'en');
  const alignment = alignTokens(expected, actual, { accentLenient, closeSimilarity });
  const score = foreignAnswer
    ? countedScore(
        alignment.tokens,
        sentence.tokens.map((token) => token.evaluate)
      )
    : alignment.score;
  const correct = score >= threshold;
  const results: WordResult[] = [];
  if (foreignAnswer) {
    // Each known word in the sentence is scored on its own.
    const perWord = new Map<number, boolean>();
    sentence.tokens.forEach((token, index) => {
      if (!token.evaluate || token.wordId === null) return;
      const status = alignment.expectedStatus[index];
      const ok = status === 'exact' || status === 'close';
      perWord.set(token.wordId, (perWord.get(token.wordId) ?? true) && ok);
    });
    for (const [wordId, ok] of perWord) results.push({ wordId, phase: question.phase, correct: ok });
  } else if (correct) {
    for (const wordId of new Set(sentence.tokens.filter((t) => t.evaluate && t.wordId !== null).map((t) => t.wordId!))) {
      results.push({ wordId, phase: question.phase, correct: true });
    }
  } else {
    results.push({ wordId: question.targetWordId, phase: question.phase, correct: false });
  }
  return {
    correct,
    quality: correct ? (alignment.score >= 0.999 ? 'exact' : 'close') : 'wrong',
    response,
    score,
    alignment: alignment.tokens,
    results,
  };
}

export function evaluateTyped(question: Question, response: string, locale: string, settings: LearningSettings): Outcome {
  if (question.sentence) {
    const side = question.response.side === 'foreign' ? locale : 'en';
    return sentenceOutcome(
      question,
      response,
      normalizedTokens(response, side),
      locale,
      settings.sentenceThreshold,
      0.75,
      settings.accentLenient
    );
  }
  return wordOutcome(question, response, locale, settings);
}

export function evaluateSpoken(question: Question, heard: string[], locale: string, settings: LearningSettings): Outcome {
  const response = heard[0] ?? '';
  if (question.sentence) {
    const side = question.response.side === 'foreign' ? locale : 'en';
    let best: Outcome | null = null;
    for (const alternative of heard.length ? heard : ['']) {
      const outcome = sentenceOutcome(question, alternative, normalizedTokens(alternative, side), locale, settings.speechThreshold, 0.6, true);
      if (!best || (outcome.score ?? 0) > (best.score ?? 0)) best = outcome;
    }
    return best!;
  }
  const accepted = (question.accepted ?? []).map((answer) => answer.text);
  const score = spokenWordSimilarity(heard, accepted, question.response.side === 'foreign' ? locale : 'en');
  if (score >= settings.speechThreshold) {
    return {
      correct: true,
      quality: score >= 0.999 ? 'exact' : 'close',
      response,
      score,
      matched: accepted[0],
      results: [{ wordId: question.targetWordId, phase: question.phase, correct: true }],
    };
  }
  return { ...wrong(question, response), score };
}

// After an LLM judge accepted a translation that the word metric rejected.
export function acceptedByJudge(question: Question, outcome: Outcome, feedback: string): Outcome {
  const results = new Map<number, WordResult>();
  for (const token of question.sentence?.tokens ?? []) {
    if (token.evaluate && token.wordId !== null) results.set(token.wordId, { wordId: token.wordId, phase: question.phase, correct: true });
  }
  return { ...outcome, correct: true, quality: 'close', note: feedback, results: [...results.values()] };
}

export function qualityLabel(outcome: Outcome): string {
  switch (outcome.quality) {
    case 'exact':
      return 'Correct!';
    case 'accent':
      return 'Correct — watch the accents';
    case 'typo':
      return 'Correct — small typo';
    case 'synonym':
      return 'Also correct';
    case 'close':
      return outcome.score !== undefined ? `Close enough (${Math.round(outcome.score * 100)}%)` : 'Close enough';
    default:
      return outcome.score !== undefined ? `Not quite (${Math.round(outcome.score * 100)}%)` : 'Not quite';
  }
}
