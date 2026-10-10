import { baseSound, compareIpa, normalizeIpa, type IpaComparison } from '../../../shared/ipa/text';
import { IPA_GAMES_BY_ID, type IpaQuestion, type IpaResult } from '../../../shared/ipa/games';
import { bestMatch } from '../../../shared/text';
import type { LearningSettings } from '../../../shared/types';

// Answers of the pronunciation mode. Transcriptions are compared sound by
// sound: each sound of the word that counts is right when every time it
// occurs it was typed (length marks and other diacritics aside).

export type IpaQuality = 'exact' | 'close' | 'accent' | 'typo' | 'wrong';

export interface IpaOutcome {
  correct: boolean;
  quality: IpaQuality;
  response: string;
  // Multiple choice: the option picked.
  chosen?: number;
  // Typed transcriptions: the comparison sound by sound.
  comparison?: IpaComparison;
  results: IpaResult[];
}

export function evaluateIpaChoice(question: IpaQuestion, index: number): IpaOutcome {
  const option = question.options![index];
  const results: IpaResult[] = [{ symbol: question.symbol, phase: question.phase, correct: option.correct }];
  // Confusing two sounds met before: both need more practice.
  if (!option.correct && option.scored && option.symbol && option.symbol !== question.symbol) {
    results.push({ symbol: option.symbol, phase: question.phase, correct: false });
  }
  return { correct: option.correct, quality: option.correct ? 'exact' : 'wrong', response: option.text, chosen: index, results };
}

export function soundRight(comparison: IpaComparison, symbol: string): boolean {
  const own = comparison.segments.filter((segment) => baseSound(segment.segment) === symbol);
  return own.length > 0 && own.every((segment) => segment.status !== 'missing');
}

export function evaluateIpaTyped(question: IpaQuestion, typed: string, locale: string, settings: LearningSettings): IpaOutcome {
  const response = typed.trim();
  const { phase, symbol } = question;
  const game = IPA_GAMES_BY_ID[question.gameId];
  if (game.response === 'symbolTyped') {
    const correct = normalizeIpa(response) === normalizeIpa(question.answer);
    return { correct, quality: correct ? 'exact' : 'wrong', response, results: [{ symbol, phase, correct }] };
  }
  if (game.response === 'ipaTyped') {
    const comparison = compareIpa(question.answer, response);
    return {
      correct: comparison.correct,
      quality: comparison.exact ? 'exact' : comparison.correct ? 'close' : 'wrong',
      response,
      comparison,
      results: question.scored.map((sound) => ({ symbol: sound, phase, correct: comparison.correct || soundRight(comparison, sound) })),
    };
  }
  // The word of a transcription.
  const match = bestMatch(response, [question.answer], {
    locale,
    side: 'foreign',
    accentLenient: settings.accentLenient,
    typoTolerance: settings.typoTolerance,
  });
  return { correct: Boolean(match), quality: match?.quality ?? 'wrong', response, results: [{ symbol, phase, correct: Boolean(match) }] };
}

export function ipaQualityLabel(outcome: IpaOutcome): string {
  switch (outcome.quality) {
    case 'exact':
      return 'Correct!';
    case 'close':
      return 'Correct — close enough';
    case 'accent':
      return 'Correct — watch the accents';
    case 'typo':
      return 'Correct — small typo';
    default:
      return 'Not quite';
  }
}
