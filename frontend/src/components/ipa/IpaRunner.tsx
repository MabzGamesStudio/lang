import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Eye, Loader2, Volume2 } from 'lucide-react';
import { api, errorMessage } from '../../api';
import { useApp } from '../../state/AppContext';
import { useKey } from '../../lib/hooks';
import { playIpa, prefetchIpa, stopAudio } from '../../lib/audio';
import type { IpaOutcome } from '../../lib/ipaEvaluate';
import { AudioChoices, TextChoices, TypedIpaAnswer, wordLang, wordSide } from './IpaAnswers';
import IpaFeedback, { soundRef } from './IpaFeedback';
import IpaBatchPreview from './IpaBatchPreview';
import { PHASE_LABELS } from '../../../../shared/games';
import {
  IPA_GAMES_BY_ID,
  type IpaGameDef,
  type IpaGameId,
  type IpaNextResponse,
  type IpaNotice,
  type IpaQuestion,
  type IpaResultsResponse,
  type IpaScope,
} from '../../../../shared/ipa/games';
import type { AppSettings, LanguageSummary } from '../../../../shared/types';

type Stage = 'loading' | 'preview' | 'answering' | 'feedback' | 'notice' | 'error';

function IpaPrompt({
  question,
  game,
  settings,
  language,
  revealed,
  onReveal,
  active,
}: {
  question: IpaQuestion;
  game: IpaGameDef;
  settings: AppSettings;
  language: LanguageSummary | null;
  revealed: boolean;
  onReveal: () => void;
  active: boolean;
}) {
  const [playing, setPlaying] = useState(false);
  const [silent, setSilent] = useState(false);
  const word = question.word;

  const play = useCallback(async () => {
    if (!question.audio) return;
    setPlaying(true);
    try {
      setSilent(!(await playIpa(question.audio, settings.tts.rate || 1)));
    } finally {
      setPlaying(false);
    }
  }, [question.audio, settings.tts.rate]);

  useEffect(() => {
    setSilent(false);
    if (question.audio) void play();
    // Once per question.
  }, [question.key]);

  // Replay: Space in multiple choice, Ctrl+Space while typing.
  const listening = game.prompt === 'sound' || game.prompt === 'wordAudio';
  const plainSpace = game.response === 'symbolChoice' || game.response === 'ipaChoice';
  useKey(
    ' ',
    (event) => {
      if (!listening || !active) return;
      if (event.ctrlKey || (plainSpace && !(event.target instanceof HTMLInputElement))) {
        event.preventDefault();
        void play();
      }
    },
    { inInputs: true }
  );

  const side = game.prompt === 'word' || game.prompt === 'wordAudio' ? wordSide(word) : 'ipa';
  const kind =
    game.prompt === 'sound'
      ? 'A sound'
      : game.prompt === 'symbol'
        ? 'IPA symbol'
        : game.prompt === 'examples'
          ? 'Words with the sound left out'
          : game.prompt === 'ipa'
            ? `IPA · ${word?.langName ?? ''}`
            : `${word?.langName ?? ''} word`;

  return (
    <div className={`prompt ipa-prompt prompt-${game.prompt} side-${side}`}>
      <div className="prompt-kind">{kind}</div>
      {listening && (
        <button className="play-button" onClick={() => void play()} aria-label="Play audio" disabled={playing}>
          <Volume2 size={40} />
          <span>{playing ? 'Playing…' : `Play again (${plainSpace ? 'Space' : 'Ctrl+Space'})`}</span>
        </button>
      )}
      {listening && silent && game.prompt === 'sound' && <div className="banner warning">No recording of this sound yet.</div>}
      {game.prompt === 'symbol' && <div className="prompt-text ipa">{question.symbol}</div>}
      {game.prompt === 'examples' && (
        <ul className="ipa-examples">
          {question.examples?.map((example) => (
            <li key={`${example.lang}:${example.word}`} className={`side-${wordSide(example)}`}>
              <strong lang={wordLang(example, language)}>{example.word}</strong>
              <span className="ipa">/{example.blanked}/</span>
              {(example.gloss || wordSide(example) === 'foreign') && (
                <span className="muted">
                  {example.langName}
                  {example.gloss ? ` · “${example.gloss}”` : ''}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {game.prompt === 'ipa' && word &&
        (game.memorize && revealed ? (
          <div className="memorize-hidden">
            <Eye size={18} /> Hidden — now type it from memory
          </div>
        ) : (
          <div className="prompt-text ipa">/{word.ipa}/</div>
        ))}
      {game.prompt === 'ipa' && game.memorize && !revealed && (
        <>
          <button className="icon-button" onClick={() => void play()} title="Listen again" disabled={playing}>
            <Volume2 size={20} />
          </button>
          <button className="button primary" onClick={onReveal}>
            I memorised it — hide (Enter)
          </button>
        </>
      )}
      {game.prompt === 'word' && word && (
        <>
          <div className="prompt-text" lang={wordLang(word, language)}>
            {word.word}
          </div>
          {word.gloss && <div className="muted">“{word.gloss}”</div>}
        </>
      )}
    </div>
  );
}

export interface IpaRunnerProps {
  // The next question: of one game (free practice) or the one Personal progress chooses.
  fetchNext: (recent: string[], lastGameId: IpaGameId | null) => Promise<IpaNextResponse>;
  // Sounds and words practised (sent with the results).
  scope: IpaScope;
  settings: AppSettings;
  language: LanguageSummary | null;
  // Changing the key restarts the runner.
  resetKey?: string;
  // Personal progress: the sounds of a batch are shown before its questions.
  showPreview?: boolean;
  onUpdate?: (response: IpaNextResponse) => void;
  onResults?: (results: IpaResultsResponse) => void;
  renderNotice?: (notice: IpaNotice, retry: () => void) => ReactNode;
  paused?: boolean;
}

// Drives the pronunciation games: fetch a question, take the answer, give
// feedback, record the result per sound, move on.
export default function IpaRunner({
  fetchNext,
  scope,
  settings,
  language,
  resetKey,
  showPreview = false,
  onUpdate,
  onResults,
  renderNotice,
  paused = false,
}: IpaRunnerProps) {
  const { notify, saveSettings } = useApp();
  const [stage, setStage] = useState<Stage>('loading');
  const [response, setResponse] = useState<IpaNextResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<IpaOutcome | null>(null);
  const [revealed, setRevealed] = useState(false);
  const recent = useRef<string[]>([]);
  const lastGame = useRef<IpaGameId | null>(null);
  const previewed = useRef(new Set<string>());
  const advanceTimer = useRef<number | undefined>(undefined);
  const fetchRef = useRef(fetchNext);
  fetchRef.current = fetchNext;
  const callbacks = useRef({ onUpdate, onResults });
  callbacks.current = { onUpdate, onResults };

  const load = useCallback(async () => {
    window.clearTimeout(advanceTimer.current);
    stopAudio();
    setStage('loading');
    setOutcome(null);
    setRevealed(false);
    try {
      const next = await fetchRef.current(recent.current, lastGame.current);
      setResponse(next);
      callbacks.current.onUpdate?.(next);
      if (!next.question) {
        setStage('notice');
        return;
      }
      if (next.question.audio) prefetchIpa(next.question.audio);
      for (const option of next.question.options ?? []) if (option.audio) prefetchIpa(option.audio);
      // Before the questions of a batch, its sounds are shown once (per batch
      // and phase, or per batch in batch-by-batch order).
      const state = next.state;
      const previewMode = settings.learning.batchPreview;
      const wanted = previewMode === 'every' || (previewMode === 'new' && state?.newBatch);
      const key = state ? (settings.learning.progressionOrder === 'batch' ? `${state.batch}` : `${state.batch}:${state.phase}`) : '';
      if (showPreview && state?.mode === 'learn' && wanted && state.batchSounds.length > 0 && !previewed.current.has(key)) {
        previewed.current.add(key);
        setStage('preview');
      } else {
        setStage('answering');
      }
    } catch (err) {
      setError(errorMessage(err));
      setStage('error');
    }
  }, [showPreview, settings.learning.batchPreview, settings.learning.progressionOrder]);

  useEffect(() => {
    recent.current = [];
    lastGame.current = null;
    void load();
    return () => {
      window.clearTimeout(advanceTimer.current);
      stopAudio();
    };
    // Restart only when the reset key changes.
  }, [resetKey]);

  useEffect(() => {
    if (paused) window.clearTimeout(advanceTimer.current);
  }, [paused]);

  const question = response?.question ?? null;
  const game = question ? IPA_GAMES_BY_ID[question.gameId] : null;

  const submit = useCallback(
    (result: IpaOutcome) => {
      if (!question || !game) return;
      setOutcome(result);
      setStage('feedback');
      recent.current = [question.symbol, ...recent.current.filter((symbol) => symbol !== question.symbol)].slice(0, 6);
      lastGame.current = question.gameId;
      if (result.results.length) {
        api
          .ipaResults(result.results, scope)
          .then((saved) => callbacks.current.onResults?.(saved))
          .catch((err) => notify(`Result not saved: ${errorMessage(err)}`, 'error'));
      }
      if (!result.correct && settings.learning.playAudioOnFeedback) {
        void playIpa(question.word?.audio ?? soundRef(question.symbol), settings.tts.rate || 1);
      }
      const delay = settings.learning.autoAdvanceMs;
      const typed = game.response === 'symbolTyped' || game.response === 'ipaTyped' || game.response === 'wordTyped';
      // Accepted but not typed exactly: stay so the exact answer can be seen.
      const hold = settings.learning.pauseOnInexact && typed && result.quality !== 'exact';
      if (result.correct && delay > 0 && !hold && !paused) advanceTimer.current = window.setTimeout(() => void load(), delay);
    },
    [question, game, scope, settings, notify, load, paused]
  );

  useKey(
    'Enter',
    (event) => {
      event.preventDefault();
      setRevealed(true);
    },
    { enabled: stage === 'answering' && Boolean(game?.memorize) && !revealed, inInputs: true }
  );

  if (stage === 'loading' && !question) {
    return (
      <div className="runner loading">
        <Loader2 className="spin" /> Preparing…
      </div>
    );
  }
  if (stage === 'error') {
    return (
      <div className="runner">
        <div className="banner error">{error}</div>
        <button className="button" onClick={() => void load()}>
          Try again
        </button>
      </div>
    );
  }
  if (stage === 'notice' && response?.notice) {
    return (
      <div className="runner">
        {renderNotice ? (
          renderNotice(response.notice, () => void load())
        ) : (
          <div className="notice">
            <p>{response.notice.message}</p>
            <button className="button" onClick={() => void load()}>
              Try again
            </button>
          </div>
        )}
      </div>
    );
  }
  if (stage === 'preview' && response?.state) {
    return <IpaBatchPreview state={response.state} settings={settings} onStart={() => setStage('answering')} />;
  }
  if (!question || !game) return null;

  const textScale = settings.learning.questionTextScale || 100;
  const resize = (step: number) =>
    void saveSettings({ ...settings, learning: { ...settings.learning, questionTextScale: Math.max(70, Math.min(200, textScale + step)) } });
  const waiting = Boolean(game.memorize) && !revealed;
  const answerProps = {
    question,
    settings,
    language,
    disabled: stage !== 'answering' || waiting,
    outcome,
    onAnswer: submit,
  };

  return (
    <div className={`runner ipa-runner stage-${stage}`} style={{ '--q-scale': textScale / 100 } as CSSProperties}>
      <div className="game-label">
        <span className={`phase-tag phase-${question.phase}`}>{PHASE_LABELS[question.phase]}</span>
        <span>{game.title}</span>
        {stage === 'loading' && <Loader2 size={16} className="spin" />}
        <span className="text-size">
          <button type="button" title="Smaller text" onClick={() => resize(-10)} disabled={textScale <= 70}>
            A−
          </button>
          <button type="button" title="Larger text" onClick={() => resize(10)} disabled={textScale >= 200}>
            A+
          </button>
        </span>
      </div>
      <IpaPrompt
        question={question}
        game={game}
        settings={settings}
        language={language}
        revealed={revealed}
        onReveal={() => setRevealed(true)}
        active={stage === 'answering' || stage === 'feedback'}
      />
      {!waiting && (
        <div className="answer-area">
          {(game.response === 'symbolChoice' || game.response === 'ipaChoice') && <TextChoices {...answerProps} />}
          {(game.response === 'soundChoice' || game.response === 'wordAudioChoice') && <AudioChoices {...answerProps} />}
          {(game.response === 'symbolTyped' || game.response === 'ipaTyped' || game.response === 'wordTyped') && <TypedIpaAnswer {...answerProps} />}
        </div>
      )}
      {stage === 'feedback' && outcome && (
        <IpaFeedback question={question} outcome={outcome} settings={settings} language={language} onContinue={() => void load()} />
      )}
    </div>
  );
}
