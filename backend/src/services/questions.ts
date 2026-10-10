import { randomUUID } from 'node:crypto';
import type { DB } from '../db/connection.js';
import { imageLabels, imagesForGlosses } from './english.js';
import { wordsWithGlosses } from './glossIndex.js';
import { tokenize } from './textProcessing.js';
import { parseEnglish, pickRandom, shuffle } from './util.js';
import { WORD_COLUMNS, type WordDbRow } from './words.js';
import { translationsOf } from './sentenceTranslations.js';
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

// Met in a question before (or already learnt). Other words are never scored,
// so a word is never marked down before it has been taught.
function met(word: { last_seen_at: number | null; srs_stage: number }): boolean {
  return word.last_seen_at !== null || word.srs_stage > 0;
}

function metIds(db: DB, ids: number[]): Set<number> {
  if (ids.length === 0) return new Set();
  const rows = db
    .prepare(`SELECT id FROM words WHERE id IN (SELECT value FROM json_each(?)) AND (last_seen_at IS NOT NULL OR srs_stage > 0)`)
    .all(JSON.stringify(ids)) as { id: number }[];
  return new Set(rows.map((row) => row.id));
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
    return { text, wordId: w.id, correct, evaluate: introduced(w, ctx.frontier) && (w.id === target.id || met(w)) };
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
      const synonyms = wordsWithGlosses(ctx.langId, prompt.keys).filter((synonym) => synonym.id !== target.id);
      const seen = metIds(ctx.db, synonyms.map((synonym) => synonym.id));
      for (const synonym of synonyms) {
        accepted.push({ text: synonym.display, wordId: synonym.id, evaluate: introduced(synonym, ctx.frontier) && seen.has(synonym.id) });
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
// Sentences reported for bad audio are only left out of listening questions.
export function pickSentence(db: DB, wordId: number, needEnglish: boolean, frontier: number, listening = false): SentenceCandidate | null {
  const candidates = db
    .prepare(
      `SELECT s.id, s.text, s.english, s.word_count AS wordCount, s.last_used_at AS lastUsedAt
       FROM sentences s
       WHERE s.id IN (SELECT sentence_id FROM sentence_words WHERE word_id = ?)
         AND (s.excluded_reason IS NULL ${listening ? '' : "OR s.excluded_reason = 'audio'"})
         ${needEnglish ? 'AND s.english IS NOT NULL' : ''}
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

// The words of a sentence, which of them are scored, and where each is in the text.
function sentenceTokens(ctx: BuildContext, sentence: SentenceCandidate, targetId: number): { tokens: SentenceToken[]; spans: [number, number][] } {
  const rows = ctx.db
    .prepare(
      `SELECT sw.word_id AS wordId, w.word, w.rank, w.active, w.last_seen_at, w.srs_stage
       FROM sentence_words sw JOIN words w ON w.id = sw.word_id
       WHERE sw.sentence_id = ? ORDER BY sw.position`
    )
    .all(sentence.id) as { wordId: number; word: string; rank: number | null; active: number; last_seen_at: number | null; srs_stage: number }[];
  const tokens = tokenize(sentence.text, ctx.config.locale);
  const byWord = new Map(rows.map((row) => [row.word, row]));
  const spans = tokens.map((token) => [token.start, token.end] as [number, number]);
  const list = tokens.map((token, index): SentenceToken => {
    const row = rows.length === tokens.length && rows[index].word === token.word ? rows[index] : byWord.get(token.word);
    if (!row) return { text: token.surface, wordId: null, evaluate: false, target: false };
    const target = row.wordId === targetId;
    // Scored: the word asked about, and words already met. Names and other
    // excluded words, words not met yet and words further on are only shown.
    const evaluate = Boolean(row.active) && row.rank !== null && (target || (row.rank <= ctx.frontier && met(row)));
    const skip = evaluate
      ? undefined
      : !row.active
        ? ('excluded' as const)
        : row.rank === null || row.rank > ctx.frontier
          ? ('later' as const)
          : ('unseen' as const);
    return { text: token.surface, wordId: row.wordId, evaluate, target, ...(skip ? { skip } : {}) };
  });
  return { tokens: list, spans };
}

// Splits n words into parts of at most `max` words, as even as possible
// (14 words, at most 6 → 5 + 5 + 4).
export function partRanges(count: number, max: number): [number, number][] {
  if (max <= 0 || count <= max) return [[0, count]];
  const parts = Math.ceil(count / max);
  const ranges: [number, number][] = [];
  for (let i = 0, start = 0; i < parts; i++) {
    const size = Math.ceil((count - start) / (parts - i));
    ranges.push([start, start + size]);
    start += size;
  }
  return ranges;
}

// Words of a translate question that are not scored, with their meanings.
function hintsFor(ctx: BuildContext, tokens: SentenceToken[]): { text: string; english: string[] }[] {
  const ids = [...new Set(tokens.filter((token) => !token.evaluate && !token.target && token.wordId !== null).map((token) => token.wordId!))];
  if (ids.length === 0) return [];
  const rows = ctx.db
    .prepare(`SELECT id, display, english FROM words WHERE id IN (SELECT value FROM json_each(?))`)
    .all(JSON.stringify(ids)) as { id: number; display: string; english: string | null }[];
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids.map((id) => ({ text: byId.get(id)?.display ?? '', english: parseEnglish(byId.get(id)?.english ?? null) })).filter((hint) => hint.text);
}

function buildSentence(game: GameDef, target: Learner, ctx: BuildContext): Question | null {
  const needEnglish = game.prompt.side === 'english' || game.response.side === 'english';
  const sentence = pickSentence(ctx.db, target.id, needEnglish, ctx.frontier, game.prompt.mode === 'audio');
  if (!sentence) return null;
  ctx.db.prepare(`UPDATE sentences SET last_used_at = ? WHERE id = ?`).run(Date.now(), sentence.id);
  const translations = (translationsOf(ctx.db, [sentence.id]).get(sentence.id) ?? []).map((translation) => translation.english);
  if (sentence.english && !translations.includes(sentence.english)) translations.unshift(sentence.english);
  const { spans, tokens: allTokens } = sentenceTokens(ctx, sentence, target.id);
  let tokens = allTokens;
  let text = sentence.text;
  let part: { index: number; count: number } | undefined;
  // Recite questions ask a long sentence in parts: the part with the target word.
  const ranges = game.phase === 'recite' ? partRanges(tokens.length, ctx.settings.learning.reciteMaxWords) : [];
  if (ranges.length > 1) {
    const at = Math.max(0, tokens.findIndex((token) => token.target));
    const index = ranges.findIndex(([start, end]) => at >= start && at < end);
    const [start, end] = ranges[index];
    // The first part keeps any opening punctuation, the last one the closing one.
    text = sentence.text.slice(start === 0 ? 0 : spans[start][0], end === tokens.length ? sentence.text.length : spans[end - 1][1]).trim();
    tokens = tokens.slice(start, end);
    part = { index: index + 1, count: ranges.length };
  }
  const promptText = game.prompt.side === 'foreign' ? text : sentence.english ?? '';
  const answer = game.response.side === 'foreign' ? text : sentence.english ?? '';
  const accepted = game.response.side === 'foreign' ? [text] : translations.length ? translations : [answer];
  const hints = game.phase === 'translate' ? hintsFor(ctx, tokens) : [];
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
    accepted: accepted.map((text) => ({ text, wordId: null, evaluate: false })),
    sentence: {
      id: sentence.id,
      text,
      english: sentence.english,
      translations,
      tokens,
      ...(part ? { full: sentence.text, part } : {}),
    },
    ...(hints.length ? { hints } : {}),
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
