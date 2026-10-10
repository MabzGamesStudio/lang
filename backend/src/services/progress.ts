import { randomUUID } from 'node:crypto';
import { languageDb, HttpError, type DB } from '../db/connection.js';
import { getLanguageConfig } from './languages.js';
import { getSettings } from './settings.js';
import { buildQuestion, loadLearners, toLearner, type BuildContext, type Learner } from './questions.js';
import { WORD_COLUMNS, levelsOf, type WordDbRow } from './words.js';
import { localDay, pickRandom, pickWeighted, shuffle } from './util.js';
import {
  GAMES,
  GAMES_BY_ID,
  PHASES,
  isListeningGame,
  isSpeakingGame,
  needsEnglish,
  needsSentenceTranslation,
  type GameDef,
  type GameId,
  type Phase,
} from '../../../shared/games.js';
import {
  BATCH_SIZE,
  DAY_MS,
  MAX_SRS_STAGE,
  batchOfRank,
  batchRankRange,
  blockOfBatch,
  blockRankRange,
  nextLevel,
  requiredLevels,
  reviewIntervalMs,
} from '../../../shared/scoring.js';
import type {
  AppSettings,
  BatchWord,
  NextResponse,
  Notice,
  ProgressionOrder,
  ProgressSummary,
  ResultsResponse,
  SessionMode,
  SessionState,
  WordLevels,
  WordResult,
} from '../../../shared/types.js';

// ---------------------------------------------------------------------------
// Which minigames apply to which words

// Minigames used by Personal Progress (speaking/listening can be switched off).
export function progressGames(settings: AppSettings): GameDef[] {
  const learning = settings.learning;
  return GAMES.filter(
    (game) =>
      !learning.disabledGames.includes(game.id) &&
      !(learning.disableSpeaking && isSpeakingGame(game)) &&
      !(learning.disableListening && isListeningGame(game))
  );
}

export function gameApplicable(game: GameDef, word: Learner): boolean {
  if (needsEnglish(game) && word.glosses.length === 0) return false;
  if (game.prompt.mode === 'image' && !word.hasImage) return false;
  if (game.unit === 'sentence') {
    return needsSentenceTranslation(game) ? word.translated_sentence_count > 0 : word.sentence_count > 0;
  }
  return true;
}

function ready(word: Learner): boolean {
  return word.glosses.length > 0;
}

function level(word: Learner | WordDbRow, phase: Phase): number {
  return levelsOf(word as WordDbRow)[phase];
}

// What Personal progress plays and how much practice mastery takes.
export interface Rules {
  games: GameDef[];
  // Correct answers needed per phase (adjustable in settings).
  required: Record<Phase, number>;
  order: ProgressionOrder;
}

export function progressRules(settings: AppSettings): Rules {
  return {
    games: progressGames(settings),
    required: requiredLevels(settings.learning),
    order: settings.learning.progressionOrder === 'batch' ? 'batch' : 'phase',
  };
}

function phaseApplicable(phase: Phase, word: Learner, games: GameDef[]): boolean {
  return games.some((game) => game.phase === phase && gameApplicable(game, word));
}

function phaseDone(phase: Phase, word: Learner, rules: Rules): boolean {
  return !phaseApplicable(phase, word, rules.games) || level(word, phase) >= rules.required[phase];
}

function wordComplete(word: Learner, rules: Rules): boolean {
  return ready(word) && PHASES.every((phase) => phaseDone(phase, word, rules));
}

// A word still being learnt that can be practised in this phase. Words with
// missing data (no English translation) are skipped so they never hold up a batch.
function needsPractice(word: Learner, phase: Phase, rules: Rules): boolean {
  return (
    word.srs_stage === 0 &&
    ready(word) &&
    phaseApplicable(phase, word, rules.games) &&
    level(word, phase) < rules.required[phase]
  );
}

function toBatchWord(word: Learner): BatchWord {
  return {
    id: word.id,
    rank: word.rank,
    display: word.display,
    english: word.glosses,
    pronunciation: word.pronunciation,
    levels: levelsOf(word),
    ready: ready(word),
    srsStage: word.srs_stage,
  };
}

// ---------------------------------------------------------------------------
// Long term repetition

function markLearned(db: DB, ids: number[], now: number): void {
  const statement = db.prepare(
    `UPDATE words SET srs_stage = 1, learned_at = ?, next_review_at = ? WHERE id = ? AND srs_stage = 0`
  );
  for (const id of ids) statement.run(now, now + reviewIntervalMs(1), id);
}

// A review milestone was passed: move to the next (longer) interval, or back
// one step when mistakes were made during the review.
function completeReview(db: DB, word: Learner, now: number): void {
  const stage = word.review_errors === 0 ? Math.min(MAX_SRS_STAGE, word.srs_stage + 1) : Math.max(1, word.srs_stage - 1);
  db.prepare(
    `UPDATE words SET srs_stage = ?, next_review_at = ?, review_started_at = NULL, review_errors = 0 WHERE id = ?`
  ).run(stage, now + reviewIntervalMs(stage), word.id);
}

// At each repetition milestone every category is reset to 1 (0 when one
// correct answer is enough) and has to be brought back to mastery again.
function startReview(db: DB, ids: number[], now: number, required: Record<Phase, number>): void {
  const reset = (phase: Phase) => Math.min(1, required[phase] - 1);
  const statement = db.prepare(
    `UPDATE words SET review_started_at = ?, review_errors = 0,
       recognition_level = MIN(recognition_level, ?), recall_level = MIN(recall_level, ?),
       recite_level = MIN(recite_level, ?), translate_level = MIN(translate_level, ?)
     WHERE id = ? AND review_started_at IS NULL`
  );
  for (const id of ids) statement.run(now, reset('recognition'), reset('recall'), reset('recite'), reset('translate'), id);
}

// ---------------------------------------------------------------------------
// Where the learner currently is

interface EngineState {
  state: SessionState;
  candidates: Learner[];
  batchWords: Learner[];
  notice: Notice | null;
}

function emptyState(mode: SessionMode): SessionState {
  return { mode, block: null, phase: null, batch: null, batchWords: [], newBatch: false, frontier: 0 };
}

const COMPLETE_NOTICE: Notice = {
  kind: 'complete',
  message: 'Every word has been learned. Add more books to keep going, or review due words.',
};

function missingNotice(words: Learner[], blocking: boolean): Notice {
  const n = words.length;
  return {
    kind: 'missingDefinitions',
    message: blocking
      ? `The next word${n === 1 ? ' has' : 's have'} no English translation yet. Add ${n === 1 ? 'it' : 'them'} here, exclude ${n === 1 ? 'it' : 'them'}, or let a service fetch translations (Configuration → Services).`
      : `${n} word${n === 1 ? ' is' : 's are'} skipped in this batch until ${n === 1 ? 'it has' : 'they have'} an English translation.`,
    words: words.map(toBatchWord),
  };
}

// Learn mode. Words are learnt in batches of 7, in frequency order, and a
// batch is never left until every word of it is mastered in the current phase
// (only words with missing data are skipped).
// - 'phase' order: every batch of the block (14 batches) goes through
//   recognition, then every batch through recall, then recite, then translate.
// - 'batch' order: each batch goes through all four phases before the next.
export function learnState(db: DB, rules: Rules): EngineState {
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM words WHERE active = 1 AND rank IS NOT NULL`).get() as { n: number }).n;
  if (total === 0) {
    return {
      state: emptyState('learn'),
      candidates: [],
      batchWords: [],
      notice: { kind: 'empty', message: 'This language has no words yet. Add a book or a word list in Configuration → Sources.' },
    };
  }
  const now = Date.now();
  const first = (
    db
      .prepare(`SELECT MIN(rank) AS rank FROM words WHERE active = 1 AND rank IS NOT NULL AND srs_stage = 0 AND english IS NOT NULL`)
      .get() as { rank: number | null }
  ).rank;
  if (first !== null) {
    for (let block = blockOfBatch(batchOfRank(first)); block < 100_000; block++) {
      const [low, high] = blockRankRange(block);
      const words = loadLearners(db, `active = 1 AND rank BETWEEN ? AND ? ORDER BY rank`, low, high);
      if (words.length === 0) break;
      const complete = words.filter((w) => w.srs_stage === 0 && wordComplete(w, rules));
      if (complete.length) {
        markLearned(db, complete.map((w) => w.id), now);
        for (const word of complete) word.srs_stage = 1;
      }
      const position = nextPosition(words, rules);
      if (!position) continue;
      const blockEnd = words[words.length - 1].rank ?? high;
      const batchWords = words.filter((w) => batchOfRank(w.rank!) === position.batch);
      const missing = batchWords.filter((w) => w.srs_stage === 0 && !ready(w));
      const learning = batchWords.filter((w) => w.srs_stage === 0 && ready(w));
      return {
        state: {
          mode: 'learn',
          block,
          phase: position.phase,
          batch: position.batch,
          batchWords: batchWords.map(toBatchWord),
          newBatch: position.phase === 'recognition' && learning.every((w) => w.recognition_level === 0),
          // Words introduced so far: scored in sentences and used as distractors.
          frontier: rules.order === 'batch' || position.phase === 'recognition' ? position.batch * BATCH_SIZE : blockEnd,
        },
        batchWords,
        candidates: batchWords.filter((w) => needsPractice(w, position.phase, rules)),
        notice: missing.length ? missingNotice(missing, false) : null,
      };
    }
  }
  // Nothing can be practised: the only words left have no translation yet.
  const missingRank = (
    db
      .prepare(`SELECT MIN(rank) AS rank FROM words WHERE active = 1 AND rank IS NOT NULL AND srs_stage = 0 AND english IS NULL`)
      .get() as { rank: number | null }
  ).rank;
  if (missingRank === null) return { state: emptyState('learn'), candidates: [], batchWords: [], notice: COMPLETE_NOTICE };
  const batch = batchOfRank(missingRank);
  const [low, high] = batchRankRange(batch);
  const batchWords = loadLearners(db, `active = 1 AND rank BETWEEN ? AND ? ORDER BY rank`, low, high);
  return {
    state: {
      mode: 'learn',
      block: blockOfBatch(batch),
      phase: 'recognition',
      batch,
      batchWords: batchWords.map(toBatchWord),
      newBatch: false,
      frontier: high,
    },
    batchWords,
    candidates: [],
    notice: missingNotice(
      batchWords.filter((w) => w.srs_stage === 0 && !ready(w)),
      true
    ),
  };
}

// The batch and phase to practise in a block, or null when nothing is left.
function nextPosition(words: Learner[], rules: Rules): { batch: number; phase: Phase } | null {
  const pending = words.filter((w) => w.srs_stage === 0 && ready(w));
  if (rules.order === 'batch') {
    const batches = [...new Set(pending.map((w) => batchOfRank(w.rank!)))].sort((a, b) => a - b);
    for (const batch of batches) {
      const inBatch = pending.filter((w) => batchOfRank(w.rank!) === batch);
      for (const phase of PHASES) {
        if (inBatch.some((w) => needsPractice(w, phase, rules))) return { batch, phase };
      }
    }
    return null;
  }
  for (const phase of PHASES) {
    const candidates = pending.filter((w) => needsPractice(w, phase, rules));
    if (candidates.length) return { phase, batch: Math.min(...candidates.map((w) => batchOfRank(w.rank!))) };
  }
  return null;
}

// Review mode: words whose repetition milestone is due, 7 at a time, in
// frequency order. A review batch is finished before the next one starts.
export function reviewState(db: DB, rules: Rules): EngineState {
  const now = Date.now();
  const frontier =
    (db.prepare(`SELECT MAX(rank) AS rank FROM words WHERE active = 1 AND srs_stage > 0`).get() as { rank: number | null })
      .rank ?? 0;
  for (let attempt = 0; attempt < 50; attempt++) {
    let batch = loadLearners(
      db,
      `active = 1 AND srs_stage > 0 AND review_started_at IS NOT NULL ORDER BY rank LIMIT ?`,
      BATCH_SIZE
    );
    if (batch.length === 0) {
      const due = loadLearners(db, `active = 1 AND srs_stage > 0 AND next_review_at <= ? ORDER BY rank LIMIT ?`, now, BATCH_SIZE);
      if (due.length === 0) {
        const next = db
          .prepare(`SELECT MIN(next_review_at) AS at FROM words WHERE active = 1 AND srs_stage > 0`)
          .get() as { at: number | null };
        return {
          state: emptyState('review'),
          candidates: [],
          batchWords: [],
          notice: { kind: 'reviewsDone', message: 'No reviews are due right now.', nextDueAt: next.at },
        };
      }
      startReview(db, due.map((w) => w.id), now, rules.required);
      batch = loadLearners(db, `id IN (SELECT value FROM json_each(?)) ORDER BY rank`, JSON.stringify(due.map((w) => w.id)));
    }
    for (const phase of PHASES) {
      const candidates = batch.filter(
        (w) => ready(w) && phaseApplicable(phase, w, rules.games) && level(w, phase) < rules.required[phase]
      );
      if (candidates.length === 0) continue;
      return {
        state: {
          mode: 'review',
          block: null,
          phase,
          batch: null,
          batchWords: batch.map(toBatchWord),
          newBatch: false,
          frontier,
        },
        batchWords: batch,
        candidates,
        notice: null,
      };
    }
    // Nothing left to practise in this batch (e.g. games were disabled).
    for (const word of batch) completeReview(db, word, now);
  }
  throw new HttpError(500, 'Could not determine the next review batch');
}

// ---------------------------------------------------------------------------
// Choosing the next question

function chooseTarget(
  candidates: Learner[],
  batchWords: Learner[],
  phase: Phase,
  recent: number[],
  rules: Rules
): { word: Learner; filler: boolean } | null {
  if (candidates.length === 0) return null;
  // Space repetitions inside the session: avoid the words just asked.
  const avoid = new Set(recent.slice(0, Math.min(2, candidates.length - 1)));
  let pool = candidates.filter((w) => !avoid.has(w.id));
  if (candidates.length === 1 && recent[0] === candidates[0].id) {
    const fillers = batchWords.filter(
      (w) => w.id !== candidates[0].id && ready(w) && phaseApplicable(phase, w, rules.games)
    );
    const filler = pickRandom(fillers);
    if (filler) return { word: filler, filler: true };
  }
  if (pool.length === 0) pool = candidates;
  const word = pickWeighted(pool, (w) => Math.max(1, rules.required[phase] - level(w, phase) + 1));
  return word ? { word, filler: false } : null;
}

function makeQuestion(
  phase: Phase,
  target: Learner,
  games: GameDef[],
  ctx: BuildContext,
  lastGameId: GameId | null
): NextResponse['question'] {
  let options = games.filter((game) => game.phase === phase && gameApplicable(game, target));
  if (options.length > 1 && lastGameId) {
    const varied = options.filter((game) => game.id !== lastGameId);
    if (varied.length) options = varied;
  }
  for (const game of shuffle(options)) {
    const question = buildQuestion(game, target, ctx);
    if (question) return question;
  }
  return null;
}

export interface NextRequest {
  mode: 'learn' | 'review';
  recent: number[];
  lastGameId: GameId | null;
}

export function sessionNext(langId: string, request: NextRequest): NextResponse {
  const db = languageDb(langId);
  const config = getLanguageConfig(db);
  const settings = getSettings();
  const rules = progressRules(settings);
  const games = rules.games;
  if (games.length === 0) throw new HttpError(400, 'Every minigame is disabled in Configuration → Learning.');
  const engine = request.mode === 'review' ? reviewState(db, rules) : learnState(db, rules);
  if (!engine.state.phase || engine.candidates.length === 0) {
    return { state: engine.state, question: null, notice: engine.notice };
  }
  const ctx: BuildContext = {
    db,
    langId,
    config,
    settings,
    frontier: engine.state.frontier,
    batchWords: engine.batchWords,
  };
  const tried = new Set<number>();
  let recent = request.recent;
  for (let attempt = 0; attempt < 8; attempt++) {
    const choice = chooseTarget(
      engine.candidates.filter((w) => !tried.has(w.id)),
      engine.batchWords.filter((w) => !tried.has(w.id)),
      engine.state.phase,
      recent,
      rules
    );
    if (!choice) break;
    const question = makeQuestion(engine.state.phase, choice.word, games, ctx, request.lastGameId);
    if (question) {
      question.filler = choice.filler;
      return { state: engine.state, question, notice: engine.notice };
    }
    tried.add(choice.word.id);
    recent = [];
  }
  return {
    state: engine.state,
    question: null,
    notice: engine.notice ?? {
      kind: 'noQuestion',
      message: 'No question could be built for this batch. Check that the words have translations and sentences.',
    },
  };
}

// Free play from the main menu: one minigame on one batch (or every batch up
// to it), weighted towards the words that are known least.
export function freePlayNext(
  langId: string,
  request: { gameId: GameId; batch: number; cumulative: boolean; recent: number[] }
): NextResponse {
  const game = GAMES_BY_ID[request.gameId];
  if (!game) throw new HttpError(400, 'Unknown minigame');
  const db = languageDb(langId);
  const config = getLanguageConfig(db);
  const settings = getSettings();
  const batch = Math.max(1, Math.floor(request.batch) || 1);
  const [low, high] = batchRankRange(batch);
  const batchWords = loadLearners(db, `active = 1 AND rank BETWEEN ? AND ? ORDER BY rank`, low, high);
  const pool = request.cumulative ? loadLearners(db, `active = 1 AND rank BETWEEN 1 AND ? ORDER BY rank`, high) : batchWords;
  const state: SessionState = {
    mode: 'free',
    block: blockOfBatch(batch),
    phase: game.phase,
    batch,
    batchWords: batchWords.map(toBatchWord),
    newBatch: false,
    frontier: high,
  };
  if (pool.length === 0) {
    return { state, question: null, notice: { kind: 'empty', message: `There are no words in batch ${batch}.` } };
  }
  const candidates = pool.filter((w) => gameApplicable(game, w));
  if (candidates.length === 0) {
    const reason =
      game.prompt.mode === 'image'
        ? 'None of these words has a labelled image yet (Configuration → Images).'
        : game.unit === 'sentence'
          ? needsSentenceTranslation(game)
            ? 'None of these words has a translated sentence yet (Configuration → Services → Translate sentences).'
            : 'None of these words appears in a sentence yet (add a book in Configuration → Sources).'
          : 'These words have no English translations yet (Configuration → Services → Fetch definitions).';
    return { state, question: null, notice: { kind: 'noQuestion', message: reason } };
  }
  const ctx: BuildContext = { db, langId, config, settings, frontier: high, batchWords: pool };
  const required = requiredLevels(settings.learning);
  const avoid = new Set(request.recent.slice(0, Math.min(2, candidates.length - 1)));
  const ordered = [
    pickWeighted(
      candidates.filter((w) => !avoid.has(w.id)),
      (w) => Math.max(1, required[game.phase] - level(w, game.phase) + 1)
    ),
    ...shuffle(candidates),
  ].filter((w): w is Learner => Boolean(w));
  for (const target of ordered.slice(0, 8)) {
    const question = buildQuestion(game, target, ctx);
    if (question) return { state, question, notice: null };
  }
  return { state, question: null, notice: { kind: 'noQuestion', message: 'No question could be built for these words.' } };
}

// ---------------------------------------------------------------------------
// Recording answers

// ---------------------------------------------------------------------------
// Taking results back: a question reported as bad (wrong translation, bad
// audio...) must not count. The progress of the words an answer changed is
// kept for a while so it can be restored.

const UNDO_COLUMNS = [
  'recognition_level',
  'recall_level',
  'recite_level',
  'translate_level',
  'recognition_correct',
  'recognition_wrong',
  'recall_correct',
  'recall_wrong',
  'recite_correct',
  'recite_wrong',
  'translate_correct',
  'translate_wrong',
  'first_seen_at',
  'last_seen_at',
  'srs_stage',
  'learned_at',
  'next_review_at',
  'review_started_at',
  'review_errors',
];

interface UndoEntry {
  langId: string;
  day: string;
  correct: number;
  wrong: number;
  rows: Record<string, number | null>[];
}

const undoEntries = new Map<string, UndoEntry>();
const MAX_UNDO_ENTRIES = 100;

// Restores the words an answer changed. False when it is too old to undo.
export function undoResults(langId: string, undoId: string): boolean {
  const entry = undoEntries.get(undoId);
  if (!entry || entry.langId !== langId) return false;
  undoEntries.delete(undoId);
  const db = languageDb(langId);
  const restore = db.prepare(`UPDATE words SET ${UNDO_COLUMNS.map((column) => `${column} = @${column}`).join(', ')} WHERE id = @id`);
  db.transaction(() => {
    for (const row of entry.rows) restore.run(row);
    db.prepare(`UPDATE activity SET correct = MAX(0, correct - ?), wrong = MAX(0, wrong - ?) WHERE day = ?`).run(
      entry.correct,
      entry.wrong,
      entry.day
    );
  })();
  return true;
}

export function applyResults(langId: string, results: WordResult[]): ResultsResponse {
  const db = languageDb(langId);
  const rules = progressRules(getSettings());
  const now = Date.now();
  const learned: number[] = [];
  const reviewed: number[] = [];
  const levels: Record<number, WordLevels> = {};
  let correct = 0;
  let wrong = 0;
  let before: Record<string, number | null>[] = [];
  db.transaction(() => {
    before = db
      .prepare(`SELECT id, ${UNDO_COLUMNS.join(', ')} FROM words WHERE id IN (SELECT value FROM json_each(?))`)
      .all(JSON.stringify([...new Set(results.map((result) => result.wordId))])) as Record<string, number | null>[];
    const touched = new Set<number>();
    for (const result of results) {
      if (!PHASES.includes(result.phase)) continue;
      const row = db.prepare(`SELECT ${WORD_COLUMNS} FROM words WHERE id = ?`).get(result.wordId) as WordDbRow | undefined;
      if (!row) continue;
      const column = result.phase;
      const updated = nextLevel(result.phase, levelsOf(row)[column], result.correct, rules.required[result.phase]);
      db.prepare(
        `UPDATE words SET ${column}_level = ?, ${column}_${result.correct ? 'correct' : 'wrong'} = ${column}_${result.correct ? 'correct' : 'wrong'} + 1,
           first_seen_at = COALESCE(first_seen_at, ?), last_seen_at = ?,
           review_errors = review_errors + ?
         WHERE id = ?`
      ).run(updated, now, now, !result.correct && row.review_started_at !== null ? 1 : 0, row.id);
      touched.add(row.id);
      if (result.correct) correct++;
      else wrong++;
    }
    db.prepare(
      `INSERT INTO activity (day, correct, wrong) VALUES (?, ?, ?)
       ON CONFLICT(day) DO UPDATE SET correct = correct + excluded.correct, wrong = wrong + excluded.wrong`
    ).run(localDay(now), correct, wrong);

    for (const id of touched) {
      const word = toLearner(db.prepare(`SELECT ${WORD_COLUMNS} FROM words WHERE id = ?`).get(id) as WordDbRow);
      levels[id] = levelsOf(word);
      if (!word.active || !wordComplete(word, rules)) continue;
      if (word.srs_stage === 0) {
        markLearned(db, [id], now);
        learned.push(id);
      } else if (word.review_started_at !== null) {
        completeReview(db, word, now);
        reviewed.push(id);
      }
    }
  })();
  const undoId = randomUUID();
  undoEntries.set(undoId, { langId, day: localDay(now), correct, wrong, rows: before });
  while (undoEntries.size > MAX_UNDO_ENTRIES) undoEntries.delete(undoEntries.keys().next().value as string);
  return { learned, reviewed, levels, undoId };
}

// ---------------------------------------------------------------------------
// Personal progress dashboard

export function progressSummary(langId: string): ProgressSummary {
  const db = languageDb(langId);
  const rules = progressRules(getSettings());
  const games = rules.games;
  const now = Date.now();
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);
  const totals = db
    .prepare(
      `SELECT
         COUNT(*) FILTER (WHERE active = 1 AND rank IS NOT NULL) AS totalWords,
         COUNT(*) FILTER (WHERE active = 1 AND rank IS NOT NULL AND english IS NOT NULL) AS readyWords,
         COUNT(*) FILTER (WHERE active = 1 AND srs_stage > 0) AS learnedWords,
         COUNT(*) FILTER (WHERE active = 1 AND review_started_at IS NOT NULL) AS reviewingWords,
         COUNT(*) FILTER (WHERE active = 1 AND srs_stage > 0 AND (next_review_at <= ? OR review_started_at IS NOT NULL)) AS dueNow,
         COUNT(*) FILTER (WHERE active = 1 AND srs_stage > 0 AND next_review_at <= ?) AS dueToday,
         MIN(next_review_at) FILTER (WHERE active = 1 AND srs_stage > 0 AND next_review_at > ?) AS nextDueAt
       FROM words`
    )
    .get(now, endOfToday.getTime(), now) as Omit<
    ProgressSummary,
    'learn' | 'learnNotice' | 'phaseLevels' | 'srsStages' | 'upcoming' | 'activity' | 'streak' | 'blocks'
  >;

  const learn = learnState(db, rules);
  const currentBlock = learn.state.block ?? 1;
  const [, scopeEnd] = blockRankRange(currentBlock + 1);
  const scope = loadLearners(db, `active = 1 AND rank BETWEEN 1 AND ? ORDER BY rank`, scopeEnd);

  const phaseLevels = Object.fromEntries(PHASES.map((phase) => [phase, new Array<number>(rules.required[phase] + 1).fill(0)])) as Record<
    Phase,
    number[]
  >;
  const blocks = new Map<number, ProgressSummary['blocks'][number]>();
  for (const word of scope) {
    const block = blockOfBatch(batchOfRank(word.rank!));
    let entry = blocks.get(block);
    if (!entry) {
      entry = {
        block,
        words: 0,
        learned: 0,
        complete: { recognition: 0, recall: 0, recite: 0, translate: 0 },
        applicable: { recognition: 0, recall: 0, recite: 0, translate: 0 },
      };
      blocks.set(block, entry);
    }
    entry.words++;
    if (word.srs_stage > 0) entry.learned++;
    for (const phase of PHASES) {
      // Words a phase does not apply to (e.g. no translated sentence yet) are not counted.
      if (ready(word) && !phaseApplicable(phase, word, games)) continue;
      entry.applicable[phase]++;
      if (word.srs_stage > 0 || (ready(word) && level(word, phase) >= rules.required[phase])) entry.complete[phase]++;
      if (block <= currentBlock) phaseLevels[phase][Math.min(level(word, phase), rules.required[phase])]++;
    }
  }

  const srsStages = new Array<number>(MAX_SRS_STAGE + 1).fill(0);
  for (const row of db
    .prepare(`SELECT srs_stage AS stage, COUNT(*) AS n FROM words WHERE active = 1 AND first_seen_at IS NOT NULL GROUP BY srs_stage`)
    .all() as { stage: number; n: number }[]) {
    srsStages[Math.min(row.stage, MAX_SRS_STAGE)] += row.n;
  }

  const upcomingRows = db
    .prepare(`SELECT next_review_at AS at FROM words WHERE active = 1 AND srs_stage > 0 AND next_review_at < ?`)
    .all(now + 14 * DAY_MS) as { at: number }[];
  const upcomingCounts = new Map<string, number>();
  for (const row of upcomingRows) {
    const day = localDay(Math.max(row.at, now));
    upcomingCounts.set(day, (upcomingCounts.get(day) ?? 0) + 1);
  }
  const upcoming = Array.from({ length: 14 }, (_, i) => {
    const day = localDay(now + i * DAY_MS);
    return { day, count: upcomingCounts.get(day) ?? 0 };
  });

  const activityRows = new Map(
    (db.prepare(`SELECT day, correct, wrong FROM activity WHERE day >= ?`).all(localDay(now - 60 * DAY_MS)) as {
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
    const row = activityRows.get(localDay(now - i * DAY_MS)) ??
      (db.prepare(`SELECT day, correct, wrong FROM activity WHERE day = ?`).get(localDay(now - i * DAY_MS)) as
        | { correct: number; wrong: number }
        | undefined);
    const active = row && row.correct + row.wrong > 0;
    if (active) streak++;
    else if (i > 0) break;
  }

  return {
    ...totals,
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

// Words of the current learning block (for automatic preparation).
export function currentBlockWordIds(langId: string): number[] {
  const db = languageDb(langId);
  const { state } = learnState(db, progressRules(getSettings()));
  if (!state.block) return [];
  const [low, high] = blockRankRange(state.block);
  return (db.prepare(`SELECT id FROM words WHERE active = 1 AND rank BETWEEN ? AND ? ORDER BY rank`).all(low, high) as {
    id: number;
  }[]).map((row) => row.id);
}

export function resetProgress(langId: string): void {
  languageDb(langId).exec(`
    UPDATE words SET recognition_level = 0, recall_level = 0, recite_level = 0, translate_level = 0,
      recognition_correct = 0, recognition_wrong = 0, recall_correct = 0, recall_wrong = 0,
      recite_correct = 0, recite_wrong = 0, translate_correct = 0, translate_wrong = 0,
      first_seen_at = NULL, last_seen_at = NULL, srs_stage = 0, learned_at = NULL,
      next_review_at = NULL, review_started_at = NULL, review_errors = 0;
    DELETE FROM activity;
  `);
}

export function wordLevelsFor(db: DB, id: number): WordLevels {
  return levelsOf(db.prepare(`SELECT ${WORD_COLUMNS} FROM words WHERE id = ?`).get(id) as WordDbRow);
}

export { toLearner };
