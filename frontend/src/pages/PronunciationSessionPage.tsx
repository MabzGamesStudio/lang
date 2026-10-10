import { useCallback, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { api } from '../api';
import { useApp } from '../state/AppContext';
import { formatRelative } from '../lib/hooks';
import { playIpa } from '../lib/audio';
import { useIpaScope } from '../lib/ipaScope';
import IpaRunner from '../components/ipa/IpaRunner';
import { soundRef } from '../components/ipa/IpaFeedback';
import LevelDots from '../components/LevelDots';
import Pomodoro from '../components/Pomodoro';
import { SessionHeader } from './SessionPage';
import { IPA_BLOCK_BATCHES, type IpaGameId, type IpaNextResponse, type IpaNotice, type IpaResultsResponse, type IpaSessionState } from '../../../shared/ipa/games';

// Personal progress of the pronunciation mode: learn new sounds batch by
// batch, or review the sounds that are due.
export default function PronunciationSessionPage() {
  const { settings } = useApp();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const mode = params.get('mode') === 'review' ? 'review' : 'learn';
  const { scope, language } = useIpaScope();
  const [state, setState] = useState<IpaSessionState | null>(null);
  const [onBreak, setOnBreak] = useState(false);

  const fetchNext = useCallback(
    (recent: string[], lastGameId: IpaGameId | null) => api.ipaSessionNext({ mode, recent, lastGameId, ...scope }),
    [mode, scope]
  );
  const onUpdate = useCallback((response: IpaNextResponse) => setState(response.state ?? null), []);
  const onResults = useCallback(
    (results: IpaResultsResponse) =>
      setState((current) =>
        current
          ? { ...current, batchSounds: current.batchSounds.map((sound) => (results.levels[sound.symbol] ? { ...sound, levels: results.levels[sound.symbol] } : sound)) }
          : current
      ),
    []
  );

  const renderNotice = useCallback(
    (notice: IpaNotice, retry: () => void) => {
      if (notice.kind === 'reviewsDone') {
        return (
          <div className="notice">
            <h2>All reviews done 🎉</h2>
            <p>{notice.nextDueAt ? `Next review ${formatRelative(notice.nextDueAt)}.` : 'No sound is learned yet.'}</p>
            <button className="button primary" onClick={() => navigate('/pronunciation/session?mode=learn')}>
              Continue learning new sounds
            </button>
          </div>
        );
      }
      return (
        <div className="notice">
          <p>{notice.message}</p>
          <div className="row">
            <Link className="button primary" to="/pronunciation/progress">
              Dashboard
            </Link>
            <button className="button" onClick={retry}>
              Try again
            </button>
          </div>
        </div>
      );
    },
    [navigate]
  );

  if (!settings) {
    return (
      <div className="page narrow">
        <Loader2 className="spin" />
      </div>
    );
  }

  return (
    <div className="page session">
      <header className="play-header">
        <div>
          <Link to="/pronunciation" className="back-link">
            <ArrowLeft size={14} /> Pronunciation
          </Link>
          <h1 className="page-title">{mode === 'review' ? 'Review due sounds' : 'Learn new sounds'}</h1>
        </div>
        <div className="row">
          {settings.learning.pomodoro && (
            <Pomodoro workMinutes={settings.learning.pomodoroWorkMinutes} breakMinutes={settings.learning.pomodoroBreakMinutes} onBreakChange={setOnBreak} />
          )}
          <span className="muted">
            {scope.sounds === 'all' ? 'All sounds' : 'English sounds'} · {language ? `${language.name} words` : 'example words'}
          </span>
          <Link to="/pronunciation/progress" className="button small">
            Dashboard
          </Link>
        </div>
      </header>
      {state && <SessionHeader state={state} blockBatches={IPA_BLOCK_BATCHES} />}
      {state && state.batchSounds.length > 0 && (
        <div className="batch-words">
          {state.batchSounds.map((sound) => (
            <button
              key={sound.symbol}
              type="button"
              className="batch-word batch-sound"
              title={`${sound.name} — click to listen`}
              onClick={() => void playIpa(soundRef(sound.symbol), settings.tts.rate || 1)}
            >
              <span className="ipa">{sound.symbol}</span>
              <LevelDots levels={sound.levels} />
            </button>
          ))}
        </div>
      )}
      <IpaRunner
        fetchNext={fetchNext}
        scope={scope}
        settings={settings}
        language={language}
        resetKey={`${mode}:${scope.sounds}:${scope.words}`}
        showPreview={mode === 'learn'}
        onUpdate={onUpdate}
        onResults={onResults}
        renderNotice={renderNotice}
        paused={onBreak}
      />
    </div>
  );
}
