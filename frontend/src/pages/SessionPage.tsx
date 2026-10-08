import { useCallback, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Loader2, Wand2 } from 'lucide-react';
import { useAction, useApp } from '../state/AppContext';
import { api } from '../api';
import { formatRelative } from '../lib/hooks';
import MinigameRunner from '../components/minigame/MinigameRunner';
import LevelDots from '../components/LevelDots';
import Pomodoro from '../components/Pomodoro';
import { PHASES, PHASE_LABELS } from '../../../shared/games';
import { BLOCK_BATCHES } from '../../../shared/scoring';
import { splitGlossList } from '../../../shared/text';
import type { BatchWord, NextResponse, Notice, SessionState } from '../../../shared/types';

function MissingDefinitions({
  langId,
  message,
  words,
  inline,
  onDone,
}: {
  langId: string;
  message: string;
  words: BatchWord[];
  inline: boolean;
  onDone: () => void;
}) {
  const { trackJob } = useApp();
  const run = useAction();
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  // Above a question the notice stays one line until opened.
  const [open, setOpen] = useState(!inline);

  async function save() {
    setBusy(true);
    for (const word of words) {
      const english = splitGlossList(drafts[word.id] ?? '');
      if (english.length) await run(() => api.updateWord(langId, word.id, { english }));
    }
    setBusy(false);
    onDone();
  }

  if (!open) {
    return (
      <div className="notice missing compact">
        <span>{message}</span>
        <button className="button small" onClick={() => setOpen(true)}>
          Add translations
        </button>
      </div>
    );
  }
  return (
    <div className="notice missing">
      <p>{inline ? `${message} Type a translation, exclude the word, or fetch translations automatically.` : message}</p>
      {words.map((word) => (
        <div key={word.id} className="row">
          <strong className="word">{word.display}</strong>
          <input
            placeholder="English translation(s), separated by ;"
            value={drafts[word.id] ?? ''}
            onChange={(event) => setDrafts({ ...drafts, [word.id]: event.target.value })}
          />
          <button
            className="button small"
            onClick={async () => {
              await run(() => api.updateWord(langId, word.id, { excluded: true }), `"${word.display}" excluded`);
              onDone();
            }}
          >
            Exclude
          </button>
        </div>
      ))}
      <div className="row">
        <button className="button primary" onClick={() => void save()} disabled={busy}>
          Save and continue
        </button>
        <button
          className="button"
          onClick={async () => {
            const job = await run(() => api.fetchDefinitions(langId, 98));
            trackJob(job);
          }}
        >
          <Wand2 size={16} /> Fetch automatically
        </button>
        <button className="button" onClick={onDone}>
          Retry
        </button>
      </div>
    </div>
  );
}

export function SessionHeader({ state }: { state: SessionState }) {
  if (!state.phase) return null;
  return (
    <div className="session-header">
      {state.mode === 'review' ? (
        <span className="pill">Review</span>
      ) : (
        <>
          <span className="pill">Block {state.block}</span>
          <span className="pill">
            Batch {state.batch} ({(((state.batch ?? 1) - 1) % BLOCK_BATCHES) + 1}/{BLOCK_BATCHES})
          </span>
        </>
      )}
      <span className="phase-steps">
        {PHASES.map((phase) => (
          <span key={phase} className={`step ${phase === state.phase ? 'current' : ''} phase-${phase}`}>
            {PHASE_LABELS[phase]}
          </span>
        ))}
      </span>
    </div>
  );
}

export default function SessionPage() {
  const { language, settings, saveSettings } = useApp();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const mode = params.get('mode') === 'review' ? 'review' : 'learn';
  const [state, setState] = useState<SessionState | null>(null);
  const [onBreak, setOnBreak] = useState(false);
  const [restart, setRestart] = useState(0);

  const fetchNext = useCallback(
    (recent: number[], lastGameId: Parameters<typeof api.sessionNext>[1]['lastGameId']) =>
      api.sessionNext(language!.id, { mode, recent, lastGameId }),
    [language, mode]
  );
  const onUpdate = useCallback((response: NextResponse) => setState(response.state), []);

  const renderNotice = useCallback(
    (notice: Notice, retry: () => void, inline: boolean) => {
      if (notice.kind === 'missingDefinitions' && notice.words && language) {
        return <MissingDefinitions langId={language.id} message={notice.message} words={notice.words} inline={inline} onDone={retry} />;
      }
      if (notice.kind === 'reviewsDone') {
        return (
          <div className="notice">
            <h2>All reviews done 🎉</h2>
            <p>{notice.nextDueAt ? `Next review ${formatRelative(notice.nextDueAt)}.` : 'Nothing is scheduled yet.'}</p>
            <button className="button primary" onClick={() => navigate('/progress/session?mode=learn')}>
              Continue learning new words
            </button>
          </div>
        );
      }
      return (
        <div className="notice">
          <p>{notice.message}</p>
          <div className="row">
            {notice.kind === 'empty' && (
              <Link className="button primary" to="/config/sources">
                Add books or word lists
              </Link>
            )}
            <button className="button" onClick={retry}>
              Try again
            </button>
          </div>
        </div>
      );
    },
    [language, navigate]
  );

  if (!language || !settings) {
    return (
      <div className="page narrow">
        <Loader2 className="spin" />
      </div>
    );
  }

  return (
    <div className="page session">
      <header className="play-header">
        <h1 className="page-title">{mode === 'review' ? 'Review due words' : 'Learn new words'}</h1>
        <div className="row">
          {settings.learning.pomodoro && (
            <Pomodoro
              workMinutes={settings.learning.pomodoroWorkMinutes}
              breakMinutes={settings.learning.pomodoroBreakMinutes}
              onBreakChange={setOnBreak}
            />
          )}
          <label className="toggle" title="Speaking minigames in Personal progress">
            <input
              type="checkbox"
              checked={!settings.learning.disableSpeaking}
              onChange={async (event) => {
                await saveSettings({ ...settings, learning: { ...settings.learning, disableSpeaking: !event.target.checked } });
                setRestart((n) => n + 1);
              }}
            />
            speaking
          </label>
          <Link to="/progress" className="button small">
            Dashboard
          </Link>
        </div>
      </header>
      {state && <SessionHeader state={state} />}
      {state && state.batchWords.length > 0 && (
        <div className="batch-words">
          {state.batchWords.map((word) => (
            <span key={word.id} className={`batch-word ${word.ready ? '' : 'not-ready'}`} title={word.english.join('; ')}>
              {word.display}
              <LevelDots levels={word.levels} />
            </span>
          ))}
        </div>
      )}
      <MinigameRunner
        language={language}
        settings={settings}
        fetchNext={fetchNext}
        resetKey={`${mode}:${restart}`}
        showPreview={mode === 'learn'}
        onUpdate={onUpdate}
        onResults={(results) =>
          setState((current) =>
            current
              ? {
                  ...current,
                  batchWords: current.batchWords.map((word) => (results.levels[word.id] ? { ...word, levels: results.levels[word.id] } : word)),
                }
              : current
          )
        }
        renderNotice={renderNotice}
        paused={onBreak}
      />
    </div>
  );
}
