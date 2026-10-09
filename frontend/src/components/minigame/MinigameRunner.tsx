import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { api, errorMessage } from '../../api';
import { useApp } from '../../state/AppContext';
import { playText, prefetchAudio, stopAudio } from '../../lib/audio';
import { useKey } from '../../lib/hooks';
import { acceptedByJudge, type Outcome } from '../../lib/evaluate';
import PromptView, { voiceFor } from './PromptView';
import { ChoiceAnswer, SpokenAnswer, TypedAnswer } from './Answers';
import Feedback from './Feedback';
import BatchPreview from './BatchPreview';
import ReportMenu, { EXCLUSION_LABELS } from './ReportMenu';
import WordEditor, { type EditableWord } from '../WordEditor';
import { GAMES_BY_ID, PHASE_LABELS, type GameId } from '../../../../shared/games';
import type { AppSettings, LanguageSummary, NextResponse, Notice, Question, ResultsResponse, SentenceExclusion } from '../../../../shared/types';

type Stage = 'loading' | 'preview' | 'answering' | 'checking' | 'feedback' | 'notice' | 'error';

export interface RunnerProps {
  language: LanguageSummary;
  settings: AppSettings;
  fetchNext: (recent: number[], lastGameId: GameId | null) => Promise<NextResponse>;
  // Changing the key restarts the runner (e.g. another batch was chosen).
  resetKey?: string;
  showPreview?: boolean;
  onUpdate?: (response: NextResponse) => void;
  onResults?: (results: ResultsResponse) => void;
  // inline: shown above a question (e.g. words of the batch that are skipped).
  renderNotice?: (notice: Notice, retry: () => void, inline: boolean) => ReactNode;
  paused?: boolean;
}

function prefetchQuestionAudio(question: Question, language: LanguageSummary): void {
  const target = (side: 'foreign' | 'english') => (side === 'foreign' ? language.id : 'english');
  if (question.prompt.mode === 'audio') prefetchAudio(target(question.prompt.side), question.prompt.text);
  if (question.sentence) prefetchAudio(language.id, question.sentence.text);
  else if (question.words[0]) prefetchAudio(language.id, question.words[0].display);
}

// Drives any minigame: fetch a question, collect an answer, give immediate
// feedback, record the result, move on.
export default function MinigameRunner({
  language,
  settings,
  fetchNext,
  resetKey,
  showPreview = false,
  onUpdate,
  onResults,
  renderNotice,
  paused = false,
}: RunnerProps) {
  const { notify } = useApp();
  const [stage, setStage] = useState<Stage>('loading');
  const [response, setResponse] = useState<NextResponse | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [editing, setEditing] = useState<EditableWord | null>(null);
  const recent = useRef<number[]>([]);
  const lastGame = useRef<GameId | null>(null);
  const previewed = useRef(new Set<string>());
  const advanceTimer = useRef<number | undefined>(undefined);
  // Results of the current question, so they can be taken back when it is reported.
  const resultsRef = useRef<Promise<ResultsResponse | null> | null>(null);
  const fetchRef = useRef(fetchNext);
  fetchRef.current = fetchNext;
  const callbacks = useRef({ onUpdate, onResults });
  callbacks.current = { onUpdate, onResults };

  const load = useCallback(async () => {
    window.clearTimeout(advanceTimer.current);
    stopAudio();
    resultsRef.current = null;
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
      prefetchQuestionAudio(next.question, language);
      // Before quizzing a batch, show its words once (per batch and phase,
      // or per batch in batch-by-batch order).
      const state = next.state;
      const previewMode = settings.learning.batchPreview;
      const key =
        settings.learning.progressionOrder === 'batch'
          ? `${state.mode}:${state.block}:${state.batch}`
          : `${state.mode}:${state.block}:${state.phase}:${state.batch}`;
      const wanted = previewMode === 'every' || (previewMode === 'new' && state.newBatch);
      if (showPreview && wanted && state.batchWords.length > 0 && !previewed.current.has(key)) {
        previewed.current.add(key);
        setStage('preview');
      } else {
        setStage('answering');
      }
    } catch (err) {
      setError(errorMessage(err));
      setStage('error');
    }
  }, [language, showPreview, settings.learning.batchPreview, settings.learning.progressionOrder]);

  useEffect(() => {
    recent.current = [];
    lastGame.current = null;
    void load();
    return () => {
      window.clearTimeout(advanceTimer.current);
      stopAudio();
    };
    // Restart only when the language or the reset key changes.
  }, [language.id, resetKey]);

  useEffect(() => {
    if (paused) window.clearTimeout(advanceTimer.current);
  }, [paused]);

  const question = response?.question ?? null;

  const submit = useCallback(
    async (result: Outcome) => {
      if (!question) return;
      setStage('checking');
      let final = result;
      if (!result.correct && question.sentence && question.phase === 'translate' && settings.learning.llmJudge && result.response.trim()) {
        try {
          const verdict = await api.judge(language.id, {
            direction: question.response.side === 'english' ? 'toEnglish' : 'toForeign',
            source: question.prompt.side === 'foreign' ? question.sentence.text : question.sentence.english ?? '',
            reference: question.answer,
            answer: result.response,
          });
          final = verdict.correct ? acceptedByJudge(question, result, verdict.feedback) : { ...result, note: verdict.feedback };
        } catch {
          // Judge unavailable: keep the word-level verdict.
        }
      }
      setOutcome(final);
      setStage('feedback');
      recent.current = [question.targetWordId, ...recent.current.filter((id) => id !== question.targetWordId)].slice(0, 6);
      lastGame.current = question.gameId;
      if (final.results.length) {
        const pending = api.results(language.id, final.results);
        resultsRef.current = pending.catch(() => null);
        pending.then((res) => callbacks.current.onResults?.(res)).catch((err) => notify(`Result not saved: ${errorMessage(err)}`, 'error'));
      }
      if (!final.correct && settings.learning.playAudioOnFeedback && question.answerSide === 'foreign') {
        const voice = voiceFor('foreign', language, settings);
        void playText(voice.target, question.sentence ? question.sentence.text : question.words[0].display, voice.options);
      }
      const delay = settings.learning.autoAdvanceMs;
      // Accepted but not spelled exactly: stay so the correct spelling can be seen.
      const hold = settings.learning.pauseOnInexact && question.response.mode === 'type' && final.quality !== 'exact';
      if (final.correct && delay > 0 && !paused && !hold) {
        advanceTimer.current = window.setTimeout(() => void load(), question.sentence ? delay + 1500 : delay);
      }
    },
    [question, language, settings, notify, load, paused]
  );

  // Takes the sentence out of the questions; an answer already given does not count.
  const report = useCallback(
    async (reason: SentenceExclusion) => {
      if (!question?.sentence) return;
      window.clearTimeout(advanceTimer.current);
      const undoId = (await resultsRef.current)?.undoId;
      try {
        const result = await api.excludeSentence(language.id, question.sentence.id, reason, undoId);
        notify(
          `Sentence excluded (${EXCLUSION_LABELS[reason].toLowerCase()}).${result.undone ? ' Your answer to it does not count.' : ''} Fix it in Configuration → Sentences.`,
          'success'
        );
      } catch (err) {
        notify(`Not excluded: ${errorMessage(err)}`, 'error');
        return;
      }
      lastGame.current = question.gameId;
      void load();
    },
    [question, language.id, notify, load]
  );

  const skip = useCallback(() => {
    if (question) {
      recent.current = [question.targetWordId, ...recent.current].slice(0, 6);
      lastGame.current = question.gameId;
    }
    void load();
  }, [question, load]);

  useKey(
    'Enter',
    (event) => {
      event.preventDefault();
      setRevealed(true);
    },
    { enabled: stage === 'answering' && Boolean(question?.prompt.memorize) && !revealed, inInputs: true }
  );

  if (stage === 'loading' && !response) {
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
          renderNotice(response.notice, () => void load(), false)
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
  if (stage === 'preview' && response) {
    return (
      <BatchPreview
        words={response.state.batchWords}
        batch={response.state.batch}
        phase={response.state.phase}
        language={language}
        settings={settings}
        onStart={() => setStage('answering')}
      />
    );
  }
  if (!question || !response) return null;

  const game = GAMES_BY_ID[question.gameId];
  const answering = stage === 'answering';
  const waitingForMemorize = question.prompt.memorize && !revealed;
  const answerProps = {
    question,
    language,
    settings,
    disabled: !answering || waitingForMemorize,
    outcome,
    onAnswer: (result: Outcome) => void submit(result),
  };

  return (
    <div className={`runner stage-${stage}`}>
      {response.notice && response.notice.kind === 'missingDefinitions' && renderNotice && (
        <div className="inline-notice">{renderNotice(response.notice, () => void load(), true)}</div>
      )}
      <div className="game-label">
        <span className={`phase-tag phase-${question.phase}`}>{PHASE_LABELS[question.phase]}</span>
        <span>{game.title}</span>
        {stage === 'loading' && <Loader2 size={16} className="spin" />}
        {question.sentence && <ReportMenu onReport={(reason) => void report(reason)} disabled={stage !== 'answering' && stage !== 'feedback'} />}
      </div>
      <PromptView
        question={question}
        language={language}
        settings={settings}
        revealed={revealed}
        onReveal={() => setRevealed(true)}
        active={stage === 'answering' || stage === 'feedback'}
      />
      {!waitingForMemorize && (
        <div className="answer-area">
          {question.response.mode === 'choice' && <ChoiceAnswer {...answerProps} />}
          {question.response.mode === 'type' && <TypedAnswer {...answerProps} />}
          {question.response.mode === 'speak' && <SpokenAnswer {...answerProps} onSkip={skip} />}
        </div>
      )}
      {stage === 'checking' && (
        <div className="muted checking">
          <Loader2 size={16} className="spin" /> Checking…
        </div>
      )}
      {stage === 'feedback' && outcome && (
        <Feedback
          question={question}
          outcome={outcome}
          language={language}
          settings={settings}
          onContinue={() => void load()}
          onEditWord={(word) => {
            window.clearTimeout(advanceTimer.current);
            setEditing({ id: word.id, display: word.display, english: word.english, pronunciation: word.pronunciation, pos: word.pos });
          }}
        />
      )}
      {editing && <WordEditor langId={language.id} word={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
