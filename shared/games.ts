// Catalogue of every minigame. The progression engine, the free-play menu and
// the question builder all derive their behaviour from these definitions.

export type Phase = 'recognition' | 'recall' | 'recite' | 'translate';
export const PHASES: Phase[] = ['recognition', 'recall', 'recite', 'translate'];

export const PHASE_LABELS: Record<Phase, string> = {
  recognition: 'Recognition',
  recall: 'Recall',
  recite: 'Recite',
  translate: 'Translate',
};

export const PHASE_DESCRIPTIONS: Record<Phase, string> = {
  recognition: 'Pick the right answer from a list.',
  recall: 'Type the answer from memory.',
  recite: 'Reproduce foreign words and sentences exactly.',
  translate: 'Translate whole sentences between languages.',
};

export type Side = 'foreign' | 'english';
export type PromptMode = 'text' | 'audio' | 'image';
export type ResponseMode = 'choice' | 'type' | 'speak';
export type Unit = 'word' | 'sentence';

export type GameId =
  | 'foreignWordToEnglishChoice'
  | 'englishWordToForeignChoice'
  | 'imageToForeignChoice'
  | 'listenForeignWordToForeignChoice'
  | 'listenForeignWordToEnglishChoice'
  | 'listenEnglishWordToForeignChoice'
  | 'foreignWordToEnglishTyped'
  | 'englishWordToForeignTyped'
  | 'imageToForeignTyped'
  | 'listenForeignWordToForeignTyped'
  | 'listenForeignWordToEnglishTyped'
  | 'listenEnglishWordToForeignTyped'
  | 'listenForeignWordToForeignSpoken'
  | 'foreignSentenceToForeignTyped'
  | 'listenForeignSentenceToForeignTyped'
  | 'foreignSentenceToForeignSpoken'
  | 'listenForeignSentenceToForeignSpoken'
  | 'foreignSentenceToEnglishTyped'
  | 'englishSentenceToForeignTyped'
  | 'listenForeignSentenceToEnglishTyped'
  | 'listenEnglishSentenceToForeignTyped'
  | 'listenEnglishSentenceToForeignSpoken'
  | 'listenForeignSentenceToEnglishSpoken';

export interface GameDef {
  id: GameId;
  phase: Phase;
  unit: Unit;
  prompt: { mode: PromptMode; side: Side };
  response: { mode: ResponseMode; side: Side };
  title: string;
  // Recite games that show text first: the prompt is hidden before answering.
  memorize?: boolean;
}

function game(
  id: GameId,
  phase: Phase,
  unit: Unit,
  prompt: [PromptMode, Side],
  response: [ResponseMode, Side],
  title: string,
  memorize = false
): GameDef {
  return {
    id,
    phase,
    unit,
    prompt: { mode: prompt[0], side: prompt[1] },
    response: { mode: response[0], side: response[1] },
    title,
    memorize,
  };
}

export const GAMES: GameDef[] = [
  // Recognition
  game('foreignWordToEnglishChoice', 'recognition', 'word', ['text', 'foreign'], ['choice', 'english'], 'Foreign word → English word (multiple choice)'),
  game('englishWordToForeignChoice', 'recognition', 'word', ['text', 'english'], ['choice', 'foreign'], 'English word → foreign word (multiple choice)'),
  game('imageToForeignChoice', 'recognition', 'word', ['image', 'english'], ['choice', 'foreign'], 'Image → foreign word (multiple choice)'),
  game('listenForeignWordToForeignChoice', 'recognition', 'word', ['audio', 'foreign'], ['choice', 'foreign'], 'Listen to foreign word → foreign word (multiple choice)'),
  game('listenForeignWordToEnglishChoice', 'recognition', 'word', ['audio', 'foreign'], ['choice', 'english'], 'Listen to foreign word → English word (multiple choice)'),
  game('listenEnglishWordToForeignChoice', 'recognition', 'word', ['audio', 'english'], ['choice', 'foreign'], 'Listen to English word → foreign word (multiple choice)'),
  // Recall
  game('foreignWordToEnglishTyped', 'recall', 'word', ['text', 'foreign'], ['type', 'english'], 'Foreign word → type English word'),
  game('englishWordToForeignTyped', 'recall', 'word', ['text', 'english'], ['type', 'foreign'], 'English word → type foreign word'),
  game('imageToForeignTyped', 'recall', 'word', ['image', 'english'], ['type', 'foreign'], 'Image → type foreign word'),
  game('listenForeignWordToForeignTyped', 'recall', 'word', ['audio', 'foreign'], ['type', 'foreign'], 'Listen to foreign word → type foreign word'),
  game('listenForeignWordToEnglishTyped', 'recall', 'word', ['audio', 'foreign'], ['type', 'english'], 'Listen to foreign word → type English word'),
  game('listenEnglishWordToForeignTyped', 'recall', 'word', ['audio', 'english'], ['type', 'foreign'], 'Listen to English word → type foreign word'),
  // Recite
  game('listenForeignWordToForeignSpoken', 'recite', 'word', ['audio', 'foreign'], ['speak', 'foreign'], 'Listen to foreign word → speak foreign word'),
  game('foreignSentenceToForeignTyped', 'recite', 'sentence', ['text', 'foreign'], ['type', 'foreign'], 'Foreign sentence → type it from memory', true),
  game('listenForeignSentenceToForeignTyped', 'recite', 'sentence', ['audio', 'foreign'], ['type', 'foreign'], 'Listen to foreign sentence → type foreign sentence'),
  game('foreignSentenceToForeignSpoken', 'recite', 'sentence', ['text', 'foreign'], ['speak', 'foreign'], 'Foreign sentence → speak it from memory', true),
  game('listenForeignSentenceToForeignSpoken', 'recite', 'sentence', ['audio', 'foreign'], ['speak', 'foreign'], 'Listen to foreign sentence → speak foreign sentence'),
  // Translate
  game('foreignSentenceToEnglishTyped', 'translate', 'sentence', ['text', 'foreign'], ['type', 'english'], 'Foreign sentence → type English sentence'),
  game('englishSentenceToForeignTyped', 'translate', 'sentence', ['text', 'english'], ['type', 'foreign'], 'English sentence → type foreign sentence'),
  game('listenForeignSentenceToEnglishTyped', 'translate', 'sentence', ['audio', 'foreign'], ['type', 'english'], 'Listen to foreign sentence → type English sentence'),
  game('listenEnglishSentenceToForeignTyped', 'translate', 'sentence', ['audio', 'english'], ['type', 'foreign'], 'Listen to English sentence → type foreign sentence'),
  game('listenEnglishSentenceToForeignSpoken', 'translate', 'sentence', ['audio', 'english'], ['speak', 'foreign'], 'Listen to English sentence → speak foreign sentence'),
  game('listenForeignSentenceToEnglishSpoken', 'translate', 'sentence', ['audio', 'foreign'], ['speak', 'english'], 'Listen to foreign sentence → speak English sentence'),
];

export const GAMES_BY_ID: Record<GameId, GameDef> = Object.fromEntries(
  GAMES.map((g) => [g.id, g])
) as Record<GameId, GameDef>;

export function isGameId(value: unknown): value is GameId {
  return typeof value === 'string' && value in GAMES_BY_ID;
}

export function gamesForPhase(phase: Phase): GameDef[] {
  return GAMES.filter((g) => g.phase === phase);
}

export function isSpeakingGame(g: GameDef): boolean {
  return g.response.mode === 'speak';
}

export function isListeningGame(g: GameDef): boolean {
  return g.prompt.mode === 'audio';
}

// Does the game need the word's English translation to make sense?
export function needsEnglish(g: GameDef): boolean {
  if (g.unit === 'sentence') return false;
  return (
    g.prompt.side === 'english' ||
    g.response.side === 'english' ||
    g.prompt.mode === 'image'
  );
}

// Sentence games in the translate phase need an English translation of the sentence.
export function needsSentenceTranslation(g: GameDef): boolean {
  return g.unit === 'sentence' && (g.prompt.side === 'english' || g.response.side === 'english');
}
