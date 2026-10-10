import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Flame, GraduationCap, Loader2, Repeat, Target, Volume2 } from 'lucide-react';
import { api, errorMessage } from '../api';
import { useApp } from '../state/AppContext';
import { formatRelative } from '../lib/hooks';
import { playIpa } from '../lib/audio';
import { useIpaScope } from '../lib/ipaScope';
import Bars from '../components/Bars';
import LevelDots from '../components/LevelDots';
import { soundRef } from '../components/ipa/IpaFeedback';
import { SessionHeader } from './SessionPage';
import { percent } from './ProgressPage';
import { PHASES, PHASE_LABELS } from '../../../shared/games';
import { BATCH_SIZE, REVIEW_INTERVALS_DAYS, describeInterval, levelNames } from '../../../shared/scoring';
import { IPA_BLOCK_BATCHES, type IpaProgressSummary, type IpaSoundSet } from '../../../shared/ipa/games';

// Personal progress of the pronunciation mode: what is learned, what is due,
// and where the learning of new sounds stands.
export default function PronunciationProgressPage() {
  const { settings } = useApp();
  const { scope, language, setSounds, setWords } = useIpaScope();
  const [summary, setSummary] = useState<IpaProgressSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSummary(null);
    setError(null);
    api
      .ipaProgress(scope)
      .then(setSummary)
      .catch((err) => setError(errorMessage(err)));
  }, [scope]);

  if (error) return <div className="page narrow banner error">{error}</div>;
  if (!summary || !settings) {
    return (
      <div className="page narrow">
        <Loader2 className="spin" />
      </div>
    );
  }

  const learn = summary.learn;
  const currentBlock = summary.blocks.find((block) => block.block === learn?.block);
  const today = summary.activity[summary.activity.length - 1];
  const answers = today ? today.correct + today.wrong : 0;
  const accuracy = answers > 0 ? Math.round((today.correct / answers) * 100) : null;
  const rate = settings.tts.rate || 1;

  return (
    <div className="page progress pronunciation-progress">
      <header className="play-header">
        <div>
          <Link to="/pronunciation" className="back-link">
            <ArrowLeft size={14} /> Pronunciation
          </Link>
          <h1 className="page-title">Personal progress — Pronunciation</h1>
        </div>
        <div className="batch-picker">
          <label>
            Sounds
            <select value={scope.sounds} onChange={(event) => setSounds(event.target.value as IpaSoundSet)}>
              <option value="english">English sounds</option>
              <option value="all">All sounds</option>
            </select>
          </label>
          <label>
            Words
            <select value={scope.words} onChange={(event) => setWords(event.target.value)}>
              <option value="examples">Example words</option>
              {summary.languages.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name} words ({entry.words})
                </option>
              ))}
              {language && !summary.languages.some((entry) => entry.id === language.id) && <option value={language.id}>{language.name} words</option>}
            </select>
          </label>
        </div>
      </header>

      <div className="stat-cards">
        <div className="stat">
          <GraduationCap />
          <strong>{summary.learnedSounds}</strong>
          <span>of {summary.totalSounds} sounds learned</span>
        </div>
        <div className="stat">
          <Repeat />
          <strong>{summary.dueNow}</strong>
          <span>due for review{summary.nextDueAt && summary.dueNow === 0 ? ` · next ${formatRelative(summary.nextDueAt)}` : ''}</span>
        </div>
        <div className="stat">
          <Flame />
          <strong>{summary.streak}</strong>
          <span>day streak</span>
        </div>
        <div className="stat">
          <Target />
          <strong>{answers}</strong>
          <span>answers today{accuracy !== null ? ` · ${accuracy}% correct` : ''}</span>
        </div>
      </div>

      <div className="continue-cards">
        <div className="card">
          <h2>Learn</h2>
          {learn ? (
            <>
              <SessionHeader state={learn} blockBatches={IPA_BLOCK_BATCHES} />
              {currentBlock && (
                <div className="phase-progress">
                  {PHASES.map((phase) => (
                    <div key={phase} className={`phase-row phase-${phase}`}>
                      <span>{PHASE_LABELS[phase]}</span>
                      <div className="bar">
                        <span style={{ width: `${percent(currentBlock.complete[phase], currentBlock.applicable[phase])}%` }} />
                      </div>
                      <span className="muted">
                        {currentBlock.complete[phase]}/{currentBlock.applicable[phase]}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <p className="muted">
                {settings.learning.progressionOrder === 'batch'
                  ? `Each batch of ${BATCH_SIZE} sounds goes through recognition, recall, recite and translate before the next batch starts.`
                  : `Each block is ${BATCH_SIZE * IPA_BLOCK_BATCHES} sounds (${IPA_BLOCK_BATCHES} batches of ${BATCH_SIZE}). All batches go through recognition, then recall, then recite, then translate.`}{' '}
                A batch is only left once every sound in it is mastered. English sounds come first.
              </p>
            </>
          ) : (
            <p className="muted">{summary.learnNotice?.message}</p>
          )}
          <Link className="button primary big" to="/pronunciation/session?mode=learn">
            Continue learning
          </Link>
        </div>
        <div className="card">
          <h2>Repetition</h2>
          <p>
            {summary.dueNow > 0
              ? `${summary.dueNow} sound${summary.dueNow === 1 ? ' is' : 's are'} due. At every milestone the sound is practised again from level 1.`
              : `Nothing is due. ${summary.nextDueAt ? `Next review ${formatRelative(summary.nextDueAt)}.` : ''}`}
          </p>
          <p className="muted">Milestones: {REVIEW_INTERVALS_DAYS.map((days) => describeInterval(days)).join(' → ')}</p>
          <Link className={`button big ${summary.dueNow > 0 ? 'primary' : ''}`} to="/pronunciation/session?mode=review">
            Review due sounds ({summary.dueNow})
          </Link>
          <h3>Next 14 days</h3>
          <Bars values={summary.upcoming.map((day) => day.count)} labels={summary.upcoming.map((day) => day.day.slice(5))} />
        </div>
      </div>

      <div className="card">
        <h2>Knowledge levels (sounds introduced so far)</h2>
        <div className="level-grid">
          {PHASES.map((phase) => (
            <div key={phase} className={`phase-${phase}`}>
              <h3>{PHASE_LABELS[phase]}</h3>
              <Bars
                values={summary.phaseLevels[phase]}
                labels={levelNames(phase, summary.phaseLevels[phase].length - 1).map((name) =>
                  name.replace(/ (recognition|recall|sentence integration|translation)$/, '')
                )}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <h2>Blocks</h2>
        <table className="table">
          <thead>
            <tr>
              <th>Block</th>
              <th>Sounds</th>
              {PHASES.map((phase) => (
                <th key={phase}>{PHASE_LABELS[phase]}</th>
              ))}
              <th>Learned</th>
            </tr>
          </thead>
          <tbody>
            {summary.blocks.map((block) => (
              <tr key={block.block} className={block.block === learn?.block ? 'current' : ''}>
                <td>{block.block}</td>
                <td className="ipa block-sounds">{block.sounds.join(' ')}</td>
                {PHASES.map((phase) => (
                  <td key={phase}>{block.applicable[phase] ? `${percent(block.complete[phase], block.applicable[phase])}%` : '—'}</td>
                ))}
                <td>
                  {block.learned}/{block.sounds.length}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {summary.unavailable.length > 0 && (
          <p className="muted">
            Not practised with these words (no word contains them, and their recordings are not downloaded):{' '}
            <span className="ipa">{summary.unavailable.join(' ')}</span>
          </p>
        )}
      </div>

      <div className="card">
        <h2>Activity (30 days)</h2>
        <Bars className="activity" values={summary.activity.map((day) => day.correct + day.wrong)} labels={summary.activity.map((day) => day.day.slice(5))} />
      </div>

      {learn && learn.batchSounds.length > 0 && (
        <div className="card">
          <h2>Current batch</h2>
          <table className="table">
            <tbody>
              {learn.batchSounds.map((sound) => (
                <tr key={sound.symbol}>
                  <td>
                    <button className="icon-button" title="Listen" onClick={() => void playIpa(soundRef(sound.symbol), rate)}>
                      <Volume2 size={16} />
                    </button>
                  </td>
                  <td>
                    <strong className="ipa batch-symbol">{sound.symbol}</strong>
                  </td>
                  <td>{sound.name}</td>
                  <td>
                    <LevelDots levels={sound.levels} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
