import { HttpError, englishDatabase, type DB } from '../db/connection.js';
import { getSettings } from './settings.js';
import { buildIpaQuestion, ipaContext, ipaGameApplicable, ipaLanguages, levelsOnly, progressOf, type IpaContext } from './ipa.js';
import { localDay, pickRandom, pickWeighted, shuffle } from './util.js';
import { PHASES, type Phase } from '../../../shared/games.js';
import { BATCH_SIZE, DAY_MS, MAX_SRS_STAGE, nextLevel, requiredLevels, reviewIntervalMs } from '../../../shared/scoring.js';
import { IPA_BY_SYMBOL, type IpaSound } from '../../../shared/ipa/inventory.js';
import {
  IPA_BLOCK_BATCHES,
  IPA_GAMES,
  type IpaBatchSound,
  type IpaGameDef,
  type IpaGameId,
  type IpaNextResponse,
  type IpaNotice,
  type IpaProgressSummary,
  type IpaResult,
  type IpaResultsResponse,
  type IpaScope,
  type IpaSessionRequest,
  type IpaSessionState,
} from '../../../shared/ipa/games.js';
import type { ProgressionOrder, WordLevels } from '../../../shared/types.js';

// Personal progress of the pronunciation mode, the same way as for words:
// sounds are learnt in batches of 7 (in learning order); each batch goes
// through recognition, recall, recite and translate, and is only left when
// every sound in it is mastered. Mastered sounds come back for reviews after
// 1 day, 2 days, 4 days… (at each review every phase restarts from level 1).

interface SoundRow {
  symbol: string;
  recognition_level: number;
  recall_level: number;
  recite_level: number;
  translate_level: number;
  first_seen_at: number | null;
  srs_stage: number;
  next_review_at: number | null;
  review_started_at: number | null;
  review_errors: number;
}

interface SoundLearner {
  sound: IpaSound;
  batch: number;
  block: number;
  levels: WordLevels;
  srsStage: number;
  nextReviewAt: number | null;
  reviewStartedAt: number | null;
  reviewErrors: number;
  seen: boolean;
}

interface Rules {
  required: Record<Phase, number>;
  order: ProgressionOrder;
}

function rules(): Rules {
  const learning = getSettings().learning;
  return { required: requiredLevels(learning), order: learning.progressionOrder === 'batch' ? 'batch' : 'phase' };
}

// The sounds practised with their progress, in learning order.
function loadLearners(ctx: IpaContext): SoundLearner[] {
  const rows = new Map(
    (
      ctx.db
        .prepare(
          `SELECT symbol, recognition_level, recall_level, recite_level, translate_level, first_seen_at,
                  srs_stage, next_review_at, review_started_at, review_errors FROM ipa_progress`
        )
        .all() as SoundRow[]
    ).map((row) => [row.symbol, row])
  );
  return ctx.ordered.map((sound, index) => {
    const row = rows.get(sound.symbol);
    const batch = Math.floor(index / BATCH_SIZE) + 1;
    return {
      sound,
      batch,
      block: Math.floor((batch - 1) / IPA_BLOCK_BATCHES) + 1,
      levels: {
        recognition: row?.recognition_level ?? 0,
        recall: row?.recall_level ?? 0,
        recite: row?.recite_level ?? 0,
        translate: row?.translate_level ?? 0,
      },
      srsStage: row?.srs_stage ?? 0,
      nextReviewAt: row?.next_review_at ?? null,
      reviewStartedAt: row?.review_started_at ?? null,
      reviewErrors: row?.review_errors ?? 0,
      seen: Boolean(row?.first_seen_at),
    };
  });
}

function phaseApplicable(phase: Phase, sound: IpaSound, ctx: IpaContext): boolean {
  return IPA_GAMES.some((game) => game.phase === phase && ipaGameApplicable(game, sound.symbol, ctx));
}

function applicablePhases(sound: IpaSound, ctx: IpaContext): Phase[] {
  return PHASES.filter((phase) => phaseApplicable(phase, sound, ctx));
}

// A sound no game can practise (no word with it, no recording of it) is skipped.
function practicable(learner: SoundLearner, ctx: IpaContext): boolean {
  return applicablePhases(learner.sound, ctx).length > 0;
}

function soundComplete(learner: SoundLearner, ctx: IpaContext, rules: Rules): boolean {
  const phases = applicablePhases(learner.sound, ctx);
  return phases.length > 0 && phases.every((phase) => learner.levels[phase] >= rules.required[phase]);
}

function needsPractice(learner: SoundLearner, phase: Phase, ctx: IpaContext, rules: Rules): boolean {
  return learner.srsStage === 0 && learner.levels[phase] < rules.required[phase] && phaseApplicable(phase, learner.sound, ctx);
}

function toBatchSound(learner: SoundLearner, ctx: IpaContext): IpaBatchSound {
  return {
    symbol: learner.sound.symbol,
    name: learner.sound.name,
    kind: learner.sound.kind,
    levels: learner.levels,
    srsStage: learner.srsStage,
    phases: applicablePhases(learner.sound, ctx),
  };
}

// ---------------------------------------------------------------------------
// Long term repetition

function markLearned(db: DB, symbols: string[], now: number): void {
  const statement = db.prepare(`UPDATE ipa_progress SET srs_stage = 1, learned_at = ?, next_review_at = ? WHERE symbol = ? AND srs_stage = 0`);
  for (const symbol of symbols) statement.run(now, now + reviewIntervalMs(1), symbol);
}

// A review is finished: the next (longer) interval, or one step back after mistakes.
function completeReview(db: DB, learner: SoundLearner, now: number): void {
  const stage = learner.reviewErrors === 0 ? Math.min(MAX_SRS_STAGE, learner.srsStage + 1) : Math.max(1, learner.srsStage - 1);
  db.prepare(`UPDATE ipa_progress SET srs_stage = ?, next_review_at = ?, review_started_at = NULL, review_errors = 0 WHERE symbol = ?`).run(
    stage,
    now + reviewIntervalMs(stage),
    learner.sound.symbol
  );
}

// At a review every phase goes back to level 1 (0 when one answer is enough).
function startReview(db: DB, symbols: string[], now: number, required: Record<Phase, number>): void {
  const reset = (phase: Phase) => Math.min(1, required[phase] - 1);
  const statement = db.prepare(
    `UPDATE ipa_progress SET review_started_at = ?, review_errors = 0,
       recognition_level = MIN(recognition_level, ?), recall_level = MIN(recall_level, ?),
       recite_level = MIN(recite_level, ?), translate_level = MIN(translate_level, ?)
     WHERE symbol = ? AND review_started_at IS NULL`
  );
  for (const symbol of symbols) statement.run(now, reset('recognition'), reset('recall'), reset('recite'), reset('translate'), symbol);
}

// ---------------------------------------------------------------------------
// Where the learner is

interface EngineState {
  state: IpaSessionState;
  batch: SoundLearner[];
  candidates: SoundLearner[];
  notice: IpaNotice | null;
}

function emptyState(mode: 'learn' | 'review'): IpaSessionState {
  return { mode, block: null, batch: null, phase: null, batchSounds: [], newBatch: false };
}

// The batch and phase to practise in a block, or null when it is done.
function nextPosition(learners: SoundLearner[], ctx: IpaContext, rules: Rules): { batch: number; phase: Phase } | null {
  if (rules.order === 'batch') {
    const batches = [...new Set(learners.map((learner) => learner.batch))].sort((a, b) => a - b);
    for (const batch of batches) {
      for (const phase of PHASES) {
        if (learners.some((learner) => learner.batch === batch && needsPractice(learner, phase, ctx, rules))) return { batch, phase };
      }
    }
    return null;
  }
  for (const phase of PHASES) {
    const candidates = learners.filter((learner) => needsPractice(learner, phase, ctx, rules));
    if (candidates.length) return { phase, batch: Math.min(...candidates.map((learner) => learner.batch)) };
  }
  return null;
}

function learnState(ctx: IpaContext, rules: Rules): EngineState {
  let learners = loadLearners(ctx);
  if (learners.length === 0) {
    return { state: emptyState('learn'), batch: [], candidates: [], notice: { kind: 'empty', message: 'There are no sounds to learn.' } };
  }
  // Sounds mastered in every phase (in any game) are learnt.
  const complete = learners.filter((learner) => learner.srsStage === 0 && soundComplete(learner, ctx, rules));
  if (complete.length) {
    markLearned(ctx.db, complete.map((learner) => learner.sound.symbol), Date.now());
    learners = loadLearners(ctx);
  }
  const blocks = [...new Set(learners.map((learner) => learner.block))].sort((a, b) => a - b);
  for (const block of blocks) {
    const inBlock = learners.filter((learner) => learner.block === block);
    const position = nextPosition(inBlock, ctx, rules);
    if (!position) continue;
    const batch = inBlock.filter((learner) => learner.batch === position.batch);
    return {
      state: {
        mode: 'learn',
        block,
        batch: position.batch,
        phase: position.phase,
        batchSounds: batch.map((learner) => toBatchSound(learner, ctx)),
        newBatch: batch.every((learner) => !learner.seen),
      },
      batch,
      candidates: batch.filter((learner) => needsPractice(learner, position.phase, ctx, rules)),
      notice: null,
    };
  }
  const skipped = learners.filter((learner) => learner.srsStage === 0 && !practicable(learner, ctx));
  return {
    state: emptyState('learn'),
    batch: [],
    candidates: [],
    notice: {
      kind: 'complete',
      message: skipped.length
        ? `Every sound that can be practised is learned. ${skipped.map((learner) => learner.sound.symbol).join(' ')} cannot be practised with these words: choose other words or download the recordings of the sounds.`
        : 'Every sound is learned. Review the sounds that are due, or practise all the sounds instead of only the English ones.',
    },
  };
}

// Sounds whose review is due, 7 at a time in learning order. A review batch
// is finished before the next one starts.
function reviewState(ctx: IpaContext, rules: Rules): EngineState {
  const now = Date.now();
  for (let attempt = 0; attempt < 50; attempt++) {
    const learners = loadLearners(ctx);
    let batch = learners.filter((learner) => learner.srsStage > 0 && learner.reviewStartedAt !== null).slice(0, BATCH_SIZE);
    if (batch.length === 0) {
      const due = learners
        .filter((learner) => learner.srsStage > 0 && learner.nextReviewAt !== null && learner.nextReviewAt <= now)
        .slice(0, BATCH_SIZE);
      if (due.length === 0) {
        const upcoming = learners.filter((learner) => learner.srsStage > 0 && learner.nextReviewAt !== null).map((learner) => learner.nextReviewAt!);
        return {
          state: emptyState('review'),
          batch: [],
          candidates: [],
          notice: { kind: 'reviewsDone', message: 'No sounds are due for review.', nextDueAt: upcoming.length ? Math.min(...upcoming) : null },
        };
      }
      startReview(ctx.db, due.map((learner) => learner.sound.symbol), now, rules.required);
      const started = new Set(due.map((learner) => learner.sound.symbol));
      batch = loadLearners(ctx).filter((learner) => started.has(learner.sound.symbol));
    }
    for (const phase of PHASES) {
      const candidates = batch.filter((learner) => learner.levels[phase] < rules.required[phase] && phaseApplicable(phase, learner.sound, ctx));
      if (candidates.length === 0) continue;
      return {
        state: { mode: 'review', block: null, batch: null, phase, batchSounds: batch.map((learner) => toBatchSound(learner, ctx)), newBatch: false },
        batch,
        candidates,
        notice: null,
      };
    }
    // Nothing left to practise in this batch.
    for (const learner of batch) completeReview(ctx.db, learner, now);
  }
  throw new HttpError(500, 'Could not determine the next review batch');
}

// ---------------------------------------------------------------------------
// The next question

function chooseTarget(candidates: SoundLearner[], batch: SoundLearner[], phase: Phase, recent: string[], ctx: IpaContext, rules: Rules): SoundLearner | null {
  if (candidates.length === 0) return null;
  // Not the sound just asked again, if there is another one: a sound of the
  // batch already mastered fills in when only one is left.
  if (candidates.length === 1 && recent[0] === candidates[0].sound.symbol) {
    const filler = pickRandom(batch.filter((learner) => learner !== candidates[0] && phaseApplicable(phase, learner.sound, ctx)));
    if (filler) return filler;
  }
  const avoid = new Set(recent.slice(0, Math.min(2, candidates.length - 1)));
  const pool = candidates.filter((learner) => !avoid.has(learner.sound.symbol));
  return pickWeighted(pool.length ? pool : candidates, (learner) => Math.max(1, rules.required[phase] - learner.levels[phase] + 1)) ?? null;
}

// Every game of the phase in turn (not the same game twice in a row).
function questionFor(phase: Phase, learner: SoundLearner, ctx: IpaContext, lastGameId: IpaGameId | null) {
  let games: IpaGameDef[] = IPA_GAMES.filter((game) => game.phase === phase && ipaGameApplicable(game, learner.sound.symbol, ctx));
  if (games.length > 1 && lastGameId) {
    const varied = games.filter((game) => game.id !== lastGameId);
    if (varied.length) games = varied;
  }
  for (const game of shuffle(games)) {
    const question = buildIpaQuestion(game, learner.sound.symbol, ctx);
    if (question) return question;
  }
  return null;
}

export function ipaSessionNext(request: IpaSessionRequest): IpaNextResponse {
  const ctx = ipaContext(request);
  const current = rules();
  const engine = request.mode === 'review' ? reviewState(ctx, current) : learnState(ctx, current);
  if (!engine.state.phase || engine.candidates.length === 0) return { state: engine.state, question: null, notice: engine.notice };
  // Reviews may have reset levels: sounds met before are read afresh.
  ctx.progress = progressOf(ctx.db);
  const tried = new Set<string>();
  let recent = Array.isArray(request.recent) ? request.recent.filter((symbol) => typeof symbol === 'string') : [];
  for (let attempt = 0; attempt < 8; attempt++) {
    const target = chooseTarget(
      engine.candidates.filter((learner) => !tried.has(learner.sound.symbol)),
      engine.batch.filter((learner) => !tried.has(learner.sound.symbol)),
      engine.state.phase,
      recent,
      ctx,
      current
    );
    if (!target) break;
    const question = questionFor(engine.state.phase, target, ctx, request.lastGameId);
    if (question) return { state: engine.state, question, notice: null };
    tried.add(target.sound.symbol);
    recent = [];
  }
  return {
    state: engine.state,
    question: null,
    notice: { kind: 'noQuestion', message: 'No question could be made for these sounds: choose other words, or download the recordings of the sounds.' },
  };
}

// ---------------------------------------------------------------------------
// Answers

export function applyIpaResults(results: IpaResult[], scope: IpaScope): IpaResultsResponse {
  const ctx = ipaContext(scope);
  const current = rules();
  const now = Date.now();
  const learned: string[] = [];
  const reviewed: string[] = [];
  const touched = new Set<string>();
  ctx.db.transaction(() => {
    const create = ctx.db.prepare(`INSERT OR IGNORE INTO ipa_progress (symbol) VALUES (?)`);
    let correct = 0;
    let wrong = 0;
    for (const result of results) {
      if (!IPA_BY_SYMBOL[result.symbol] || !PHASES.includes(result.phase)) continue;
      const phase: Phase = result.phase;
      create.run(result.symbol);
      const row = ctx.db.prepare(`SELECT ${phase}_level AS level, review_started_at AS reviewing FROM ipa_progress WHERE symbol = ?`).get(result.symbol) as {
        level: number;
        reviewing: number | null;
      };
      ctx.db
        .prepare(
          `UPDATE ipa_progress SET ${phase}_level = ?, correct = correct + ?, wrong = wrong + ?,
             first_seen_at = COALESCE(first_seen_at, ?), last_seen_at = ?, review_errors = review_errors + ?
           WHERE symbol = ?`
        )
        .run(
          nextLevel(phase, row.level, result.correct, current.required[phase]),
          result.correct ? 1 : 0,
          result.correct ? 0 : 1,
          now,
          now,
          !result.correct && row.reviewing !== null ? 1 : 0,
          result.symbol
        );
      touched.add(result.symbol);
      if (result.correct) correct++;
      else wrong++;
    }
    ctx.db
      .prepare(
        `INSERT INTO ipa_activity (day, correct, wrong) VALUES (?, ?, ?)
         ON CONFLICT(day) DO UPDATE SET correct = correct + excluded.correct, wrong = wrong + excluded.wrong`
      )
      .run(localDay(now), correct, wrong);
    // Mastered in every phase: learnt, or the review is done.
    for (const learner of loadLearners(ctx)) {
      if (!touched.has(learner.sound.symbol) || !soundComplete(learner, ctx, current)) continue;
      if (learner.srsStage === 0) {
        markLearned(ctx.db, [learner.sound.symbol], now);
        learned.push(learner.sound.symbol);
      } else if (learner.reviewStartedAt !== null) {
        completeReview(ctx.db, learner, now);
        reviewed.push(learner.sound.symbol);
      }
    }
  })();
  const progress = progressOf(ctx.db);
  return {
    levels: Object.fromEntries([...touched].map((symbol) => [symbol, levelsOnly(progress.get(symbol))])),
    learned,
    reviewed,
  };
}

export function resetIpaProgress(): void {
  englishDatabase().exec(`DELETE FROM ipa_progress; DELETE FROM ipa_activity;`);
}

// ---------------------------------------------------------------------------
// Dashboard

export function ipaProgressSummary(scope: IpaScope): IpaProgressSummary {
  const ctx = ipaContext(scope);
  const current = rules();
  const learn = learnState(ctx, current);
  const learners = loadLearners(ctx);
  const now = Date.now();
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);

  const learnedSounds = learners.filter((learner) => learner.srsStage > 0);
  const upcomingTimes = learnedSounds.map((learner) => learner.nextReviewAt).filter((at): at is number => at !== null);
  const currentBlock = learn.state.block ?? Math.max(1, ...learners.map((learner) => learner.block));

  const phaseLevels = Object.fromEntries(PHASES.map((phase) => [phase, new Array<number>(current.required[phase] + 1).fill(0)])) as Record<
    Phase,
    number[]
  >;
  const blocks = new Map<number, IpaProgressSummary['blocks'][number]>();
  for (const learner of learners) {
    let entry = blocks.get(learner.block);
    if (!entry) {
      entry = {
        block: learner.block,
        sounds: [],
        learned: 0,
        complete: { recognition: 0, recall: 0, recite: 0, translate: 0 },
        applicable: { recognition: 0, recall: 0, recite: 0, translate: 0 },
      };
      blocks.set(learner.block, entry);
    }
    entry.sounds.push(learner.sound.symbol);
    if (learner.srsStage > 0) entry.learned++;
    for (const phase of applicablePhases(learner.sound, ctx)) {
      entry.applicable[phase]++;
      if (learner.srsStage > 0 || learner.levels[phase] >= current.required[phase]) entry.complete[phase]++;
      if (learner.block <= currentBlock) phaseLevels[phase][Math.min(learner.levels[phase], current.required[phase])]++;
    }
  }

  const srsStages = new Array<number>(MAX_SRS_STAGE + 1).fill(0);
  for (const learner of learners) if (learner.seen) srsStages[Math.min(learner.srsStage, MAX_SRS_STAGE)]++;

  const upcomingCounts = new Map<string, number>();
  for (const at of upcomingTimes) {
    if (at >= now + 14 * DAY_MS) continue;
    const day = localDay(Math.max(at, now));
    upcomingCounts.set(day, (upcomingCounts.get(day) ?? 0) + 1);
  }
  const upcoming = Array.from({ length: 14 }, (_, i) => {
    const day = localDay(now + i * DAY_MS);
    return { day, count: upcomingCounts.get(day) ?? 0 };
  });

  const activityRows = new Map(
    (ctx.db.prepare(`SELECT day, correct, wrong FROM ipa_activity WHERE day >= ?`).all(localDay(now - 400 * DAY_MS)) as {
      day: string;
      correct: number;
      wrong: number;
    }[]).map((row) => [row.day, row])
  );
  const activity = Array.from({ length: 30 }, (_, i) => {
    const day = localDay(now - (29 - i) * DAY_MS);
    const row = activityRows.get(day);
    return { day, correct: row?.correct ?? 0, wrong: row?.wrong ?? 0 };
  });
  let streak = 0;
  for (let i = 0; i < 365; i++) {
    const row = activityRows.get(localDay(now - i * DAY_MS));
    if (row && row.correct + row.wrong > 0) streak++;
    else if (i > 0) break;
  }

  return {
    languages: ipaLanguages(),
    totalSounds: learners.length,
    learnedSounds: learnedSounds.length,
    reviewingSounds: learners.filter((learner) => learner.reviewStartedAt !== null).length,
    dueNow: learnedSounds.filter((learner) => learner.reviewStartedAt !== null || (learner.nextReviewAt !== null && learner.nextReviewAt <= now)).length,
    dueToday: learnedSounds.filter((learner) => learner.nextReviewAt !== null && learner.nextReviewAt <= endOfToday.getTime()).length,
    nextDueAt: upcomingTimes.filter((at) => at > now).reduce<number | null>((min, at) => (min === null || at < min ? at : min), null),
    unavailable: learners.filter((learner) => !practicable(learner, ctx)).map((learner) => learner.sound.symbol),
    learn: learn.state.phase ? learn.state : null,
    learnNotice: learn.notice,
    phaseLevels,
    srsStages,
    upcoming,
    activity,
    streak,
    blocks: [...blocks.values()].sort((a, b) => a.block - b.block),
  };
}
