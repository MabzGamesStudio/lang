import { randomUUID } from 'node:crypto';
import type { DB } from '../db/connection.js';
import { imageLabels, imagesForGlosses } from './english.js';
import { wordsWithGlosses } from './glossIndex.js';
import { tokenize } from './textProcessing.js';
import { parseEnglish, pickRandom, shuffle } from './util.js';
import { WORD_COLUMNS, type WordDbRow } from './words.js';
import { glossKey } from '../../../shared/text.js';
import type { GameDef } from '../../../shared/games.js';
import type {
  AcceptedAnswer,
  AppSettings,
  ChoiceOption,
  LanguageConfig,
  Question,
  QuestionWord,
  SentenceToken,
} from '../../../shared/types.js';

// A word loaded for the learning engine, with parsed glosses.
export interface Learner extends WordDbRow {
  glosses: string[];
  keys: Set<string>;
  hasImage: boolean;
}

export function toLearner(row: WordDbRow): Learner {
  const glosses = parseEnglish(row.english);
  return {
    ...row,
    glosses,
    keys: new Set(glosses.map(glossKey).filter(Boolean)),
    hasImage: glosses.length > 0 && imagesForGlosses(glosses).length > 0,
  };
}

export function loadLearners(db: DB, where: string, ...params: unknown[]): Learner[] {
  return (db.prepare(`SELECT ${WORD_COLUMNS} FROM words WHERE ${where}`).all(...params) as WordDbRow[]).map(toLearner);
}

export interface BuildContext {
  db: DB;
  langId: string;
  config: LanguageConfig;
  settings: AppSettings;
  // Highest frequency rank the learner has been introduced to. Words above it
  // are shown but never scored.
  frontier: number;
  batchWords: Learner[];
}

function info(word: Learner): QuestionWord {
  return { id: word.id, display: word.display, english: word.glosses, pronunciation: word.pronunciation, pos: word.pos };
}

function introduced(word: { rank: number | null; active: number | boolean }, frontier: number): boolean {
  return Boolean(word.active) && word.rank !== null && word.rank <= frontier;
}

function intersects(a: Set<string>, b: Iterable<string>): boolean {
  for (const value of b) if (a.has(value)) return true;
  return false;
}

interface WordPrompt {
  text: string;
  imageId?: number;
  labels?: string[];
  // Meanings the prompt stands for: answers matching any of them are accepted.
  keys: Set<string>;
}

function wordPrompt(game: GameDef, target: Learner): WordPrompt | null {
  if (game.prompt.mode === 'image') {
    const imageId = pickRandom(imagesForGlosses(target.glosses));
    if (imageId === undefined) return null;
    const labels = imageLabels(imageId);
    return { text: '', imageId, labels, keys: new Set(labels.map(glossKey)) };
  }
  if (game.prompt.side === 'english') {
    const gloss = target.glosses[0];
    if (!gloss) return null;
    return { text: gloss, keys: new Set([glossKey(gloss)]) };
  }
  return { text: target.display, keys: new Set() };
}

function nearbyWords(ctx: BuildContext, target: Learner): Learner[] {
  const rows = loadLearners(
    ctx.db,
    `active = 1 AND english IS NOT NULL AND rank IS NOT NULL AND id != ? ORDER BY ABS(rank - ?) LIMIT 80`,
    target.id,
    target.rank ?? 0
  );
  // Introduced words first, then the rest, each group shuffled for variety.
  const known = shuffle(rows.filter((w) => w.rank !== null && w.rank <= ctx.frontier).slice(0, 30));
  const unknown = rows.filter((w) => w.rank === null || w.rank > ctx.frontier).slice(0, 20);
  return [...known, ...shuffle(unknown)];
}

function buildChoice(game: GameDef, target: Learner, ctx: BuildContext, prompt: WordPrompt): Question | null {
  const optionCount = Math.max(2, Math.min(8, ctx.settings.learning.choiceCount));
  const englishOptions = game.response.side === 'english';
  const optionText = (w: Learner) => (englishOptions ? w.glosses[0] : w.display);
  const usedTexts = new Set([glossKey(optionText(target))]);

  // A distractor must never also be a right answer.
  const conflicts = (w: Learner): boolean => {
    if (!optionText(w) || usedTexts.has(glossKey(optionText(w)))) return true;
    if (englishOptions) return intersects(target.keys, w.keys);
    if (w.word === target.word) return true;
    return prompt.keys.size > 0 && intersects(prompt.keys, w.keys);
  };

  const distractors: Learner[] = [];
  const consider = (candidates: Learner[]) => {
    for (const candidate of candidates) {
      if (distractors.length >= optionCount - 1) return;
      if (candidate.id === target.id || conflicts(candidate)) continue;
      distractors.push(candidate);
      usedTexts.add(glossKey(optionText(candidate)));
    }
  };
  consider(shuffle(ctx.batchWords.filter((w) => w.glosses.length > 0)));
  if (distractors.length < optionCount - 1) consider(nearbyWords(ctx, target));
  if (distractors.length === 0) return null;

  const options: ChoiceOption[] = shuffle([target, ...distractors]).map((w) => {
    const text = optionText(w);
    const correct =
      w.id === target.id ||
      (englishOptions ? target.keys.has(glossKey(text)) : w.word === target.word || intersects(prompt.keys, w.keys));
    return { text, wordId: w.id, correct, evaluate: introduced(w, ctx.frontier) };
  });

  return {
    key: randomUUID(),
    gameId: game.id,
    phase: game.phase,
    targetWordId: target.id,
    prompt: { mode: game.prompt.mode, side: game.prompt.side, text: prompt.text, imageId: prompt.imageId, memorize: false },
    response: { ...game.response },
    options,
    answer: optionText(target),
    answerSide: game.response.side,
    words: [info(target), ...distractors.map(info)],
    imageLabels: prompt.labels,
  };
}

function buildTypedWord(game: GameDef, target: Learner, ctx: BuildContext, prompt: WordPrompt): Question | null {
  let accepted: AcceptedAnswer[];
  if (game.response.side === 'english') {
    if (target.glosses.length === 0) return null;
    accepted = target.glosses.map((text) => ({ text, wordId: target.id, evaluate: true }));
  } else {
    accepted = [{ text: target.display, wordId: target.id, evaluate: true }];
    // Synonyms: any word meaning what the prompt shows is a right answer.
    if (prompt.keys.size > 0) {
      for (const synonym of wordsWithGlosses(ctx.langId, prompt.keys)) {
        if (synonym.id === target.id) continue;
        accepted.push({ text: synonym.display, wordId: synonym.id, evaluate: introduced(synonym, ctx.frontier) });
      }
    }
  }
  return {
    key: randomUUID(),
    gameId: game.id,
    phase: game.phase,
    targetWordId: target.id,
    prompt: { mode: game.prompt.mode, side: game.prompt.side, text: prompt.text, imageId: prompt.imageId, memorize: false },
    response: { ...game.response },
    accepted,
    answer: accepted[0].text,
    answerSide: game.response.side,
    words: [info(target)],
    imageLabels: prompt.labels,
  };
}

interface SentenceCandidate {
  id: number;
  text: string;
  english: string | null;
  wordCount: number;
  lastUsedAt: number | null;
}

// Picks a sentence containing the word, preferring sentences made only of
// words the learner already knows, not used recently, of moderate length.
export function pickSentence(db: DB, wordId: number, needEnglish: boolean, frontier: number): SentenceCandidate | null {
  const candidates = db
    .prepare(
      `SELECT s.id, s.text, s.english, s.word_count AS wordCount, s.last_used_at AS lastUsedAt
       FROM sentences s
       WHERE s.id IN (SELECT sentence_id FROM sentence_words WHERE word_id = ?) ${needEnglish ? 'AND s.english IS NOT NULL' : ''}
       ORDER BY (s.max_rank <= ?) DESC, COALESCE(s.last_used_at, 0), s.max_rank
       LIMIT 40`
    )
    .all(wordId, frontier) as SentenceCandidate[];
  if (candidates.length === 0) return null;
  const unknown = new Map(
    (
      db
        .prepare(
          `SELECT sw.sentence_id AS id, COUNT(*) AS n FROM sentence_words sw JOIN words w ON w.id = sw.word_id
           WHERE sw.sentence_id IN (SELECT value FROM json_each(?)) AND w.active = 1 AND (w.rank IS NULL OR w.rank > ?)
           GROUP BY sw.sentence_id`
        )
        .all(JSON.stringify(candidates.map((c) => c.id)), frontier) as { id: number; n: number }[]
    ).map((row) => [row.id, row.n])
  );
  const now = Date.now();
  let best: SentenceCandidate | null = null;
  let bestScore = Infinity;
  for (const candidate of candidates) {
    const recent = candidate.lastUsedAt !== null && now - candidate.lastUsedAt < 15 * 60 * 1000;
    const score =
      (unknown.get(candidate.id) ?? 0) * 3 + (recent ? 4 : 0) + Math.abs(candidate.wordCount - 7) * 0.25 + Math.random() * 1.5;
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

function sentenceTokens(ctx: BuildContext, sentence: SentenceCandidate, targetId: number): SentenceToken[] {
  const rows = ctx.db
    .prepare(
      `SELECT sw.word_id AS wordId, w.word, w.rank, w.active FROM sentence_words sw JOIN words w ON w.id = sw.word_id
       WHERE sw.sentence_id = ? ORDER BY sw.position`
    )
    .all(sentence.id) as { wordId: number; word: string; rank: number | null; active: number }[];
  const tokens = tokenize(sentence.text, ctx.config.locale);
  const byWord = new Map(rows.map((row) => [row.word, row]));
  return tokens.map((token, index) => {
    const row = rows.length === tokens.length && rows[index].word === token.word ? rows[index] : byWord.get(token.word);
    return {
      text: token.surface,
      wordId: row?.wordId ?? null,
      evaluate: row ? introduced(row, ctx.frontier) : false,
      target: row?.wordId === targetId,
    };
  });
}

function buildSentence(game: GameDef, target: Learner, ctx: BuildContext): Question | null {
  const needEnglish = game.prompt.side === 'english' || game.response.side === 'english';
  const sentence = pickSentence(ctx.db, target.id, needEnglish, ctx.frontier);
  if (!sentence) return null;
  ctx.db.prepare(`UPDATE sentences SET last_used_at = ? WHERE id = ?`).run(Date.now(), sentence.id);
  const promptText = game.prompt.side === 'foreign' ? sentence.text : sentence.english ?? '';
  const answer = game.response.side === 'foreign' ? sentence.text : sentence.english ?? '';
  return {
    key: randomUUID(),
    gameId: game.id,
    phase: game.phase,
    targetWordId: target.id,
    prompt: {
      mode: game.prompt.mode,
      side: game.prompt.side,
      text: promptText,
      memorize: Boolean(game.memorize && ctx.settings.learning.memorizeHide),
    },
    response: { ...game.response },
    accepted: [{ text: answer, wordId: null, evaluate: false }],
    sentence: { id: sentence.id, text: sentence.text, english: sentence.english, tokens: sentenceTokens(ctx, sentence, target.id) },
    answer,
    answerSide: game.response.side,
    words: [info(target)],
  };
}

export function buildQuestion(game: GameDef, target: Learner, ctx: BuildContext): Question | null {
  if (game.unit === 'sentence') return buildSentence(game, target, ctx);
  const prompt = wordPrompt(game, target);
  if (!prompt) return null;
  if (game.response.mode === 'choice') return buildChoice(game, target, ctx, prompt);
  return buildTypedWord(game, target, ctx, prompt);
}
