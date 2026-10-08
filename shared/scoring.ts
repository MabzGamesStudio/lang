import type { Phase } from './games.js';

// Words are learnt in batches of 7 (working-memory sized), and progression
// moves through blocks of 14 batches: every batch of a block goes through
// recognition, then recall, then recite, then translate.
export const BATCH_SIZE = 7;
export const BLOCK_BATCHES = 14;
export const BLOCK_SIZE = BATCH_SIZE * BLOCK_BATCHES;

// Mastery levels per category. 0 = not encountered yet. These are the
// defaults; the number of correct answers needed is adjustable in settings.
export const MAX_LEVEL: Record<Phase, number> = {
  recognition: 2,
  recall: 3,
  recite: 2,
  translate: 3,
};

export const MAX_REQUIRED_CORRECT = 10;

// Correct answers needed per phase, from the learning settings.
export function requiredLevels(learning?: { requiredCorrect?: Partial<Record<Phase, number>> }): Record<Phase, number> {
  const result = { ...MAX_LEVEL };
  for (const phase of Object.keys(result) as Phase[]) {
    const value = Math.round(Number(learning?.requiredCorrect?.[phase]));
    if (Number.isFinite(value)) result[phase] = Math.max(1, Math.min(MAX_REQUIRED_CORRECT, value));
  }
  return result;
}

export const LEVEL_DELTA: Record<Phase, { correct: number; wrong: number }> = {
  recognition: { correct: 1, wrong: -1 },
  recall: { correct: 1, wrong: -2 },
  recite: { correct: 1, wrong: -1 },
  translate: { correct: 1, wrong: -2 },
};

export const LEVEL_NAMES: Record<Phase, string[]> = {
  recognition: ['Not encountered', 'Bad recognition', 'Good recognition'],
  recall: ['Not encountered', 'Bad recall', 'Okay recall', 'Good recall'],
  recite: ['Not encountered', 'Bad sentence integration', 'Good sentence integration'],
  translate: ['Not encountered', 'Bad translation', 'Okay translation', 'Good translation'],
};

export function nextLevel(phase: Phase, level: number, correct: boolean, max = MAX_LEVEL[phase]): number {
  const delta = correct ? LEVEL_DELTA[phase].correct : LEVEL_DELTA[phase].wrong;
  // Once encountered a word stays at level 1 or more, unless one correct
  // answer is enough to master it: then a mistake must undo the mastery.
  const floor = max >= 2 ? 1 : 0;
  return Math.max(floor, Math.min(max, level + delta));
}

// Names for each level of a phase. The TODO.txt names are kept for the
// default number of levels; custom numbers get generic names.
export function levelNames(phase: Phase, max: number): string[] {
  if (max === MAX_LEVEL[phase]) return LEVEL_NAMES[phase];
  return Array.from({ length: max + 1 }, (_, level) =>
    level === 0 ? 'Not encountered' : level === max ? 'Mastered' : `Level ${level}`
  );
}

// Long term repetition milestones (exponentially growing delays).
export const REVIEW_INTERVALS_DAYS = [1, 2, 4, 7, 14, 30, 60, 120, 180, 365, 730];
export const MAX_SRS_STAGE = REVIEW_INTERVALS_DAYS.length;
export const DAY_MS = 24 * 60 * 60 * 1000;

export function reviewIntervalMs(stage: number): number {
  const index = Math.max(1, Math.min(MAX_SRS_STAGE, stage)) - 1;
  return REVIEW_INTERVALS_DAYS[index] * DAY_MS;
}

export function describeInterval(days: number): string {
  if (days < 7) return `${days} day${days === 1 ? '' : 's'}`;
  if (days < 30) return `${Math.round(days / 7)} week${days < 14 ? '' : 's'}`;
  if (days < 365) return `${Math.round(days / 30)} month${days < 60 ? '' : 's'}`;
  return `${Math.round(days / 365)} year${days < 730 ? '' : 's'}`;
}

export function batchOfRank(rank: number): number {
  return Math.floor((rank - 1) / BATCH_SIZE) + 1;
}

export function blockOfBatch(batch: number): number {
  return Math.floor((batch - 1) / BLOCK_BATCHES) + 1;
}

export function batchRankRange(batch: number): [number, number] {
  return [(batch - 1) * BATCH_SIZE + 1, batch * BATCH_SIZE];
}

export function blockRankRange(block: number): [number, number] {
  return [(block - 1) * BLOCK_SIZE + 1, block * BLOCK_SIZE];
}
