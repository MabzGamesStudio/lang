import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Flame, GraduationCap, Loader2, Repeat, Target } from 'lucide-react';
import { api, errorMessage } from '../api';
import { useApp } from '../state/AppContext';
import { formatRelative } from '../lib/hooks';
import LevelDots from '../components/LevelDots';
import { SessionHeader } from './SessionPage';
import { PHASES, PHASE_LABELS } from '../../../shared/games';
import { BLOCK_SIZE, LEVEL_NAMES, REVIEW_INTERVALS_DAYS, describeInterval } from '../../../shared/scoring';
import type { ProgressSummary } from '../../../shared/types';

function Bars({ values, labels, className }: { values: number[]; labels: string[]; className?: string }) {
  const max = Math.max(1, ...values);
  return (
    <div className={`bars ${className ?? ''}`}>
      {values.map((value, index) => (
        <div key={labels[index]} className="bar-col" title={`${labels[index]}: ${value}`}>
          <span className="value">{value || ''}</span>
          <span className="fill" style={{ height: `${(value / max) * 100}%` }} />
          <span className="label">{labels[index]}</span>
        </div>
      ))}
    </div>
  );
}

function percent(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

export default function ProgressPage() {
  const { language, settings, saveSettings } = useApp();
  const [summary, setSummary] = useState<ProgressSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!language) return;
    setSummary(null);
    api
      .progress(language.id)
      .then(setSummary)
      .catch((err) => setError(errorMessage(err)));
  }, [language?.id]);

  if (!language) {
    return (
      <div className="page narrow">
        <p>
          <Link to="/config/language">Add a language</Link> to start learning.
        </p>
      </div>
    );
  }
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
  const accuracy = today && today.correct + today.wrong > 0 ? Math.round((today.correct / (today.correct + today.wrong)) * 100) : null;

  return (
    <div className="page progress">
      <header className="play-header">
        <h1 className="page-title">Personal progress — {language.name}</h1>
        <label className="toggle">
          <input
            type="checkbox"
            checked={!settings.learning.disableSpeaking}
            onChange={(event) => void saveSettings({ ...settings, learning: { ...settings.learning, disableSpeaking: !event.target.checked } })}
          />
          speaking minigames
        </label>
      </header>

      <div className="stat-cards">
        <div className="stat">
          <GraduationCap />
          <strong>{summary.learnedWords.toLocaleString()}</strong>
          <span>of {summary.totalWords.toLocaleString()} words learned</span>
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
          <strong>{today ? today.correct + today.wrong : 0}</strong>
          <span>answers today{accuracy !== null ? ` · ${accuracy}% correct` : ''}</span>
        </div>
      </div>

      <div className="continue-cards">
        <div className="card">
          <h2>Learn</h2>
          {learn ? (
            <>
              <SessionHeader state={learn} />
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
                Each block is {BLOCK_SIZE} words (14 batches of 7). All batches go through recognition, then recall, then
                recite, then translate. Words without sentences skip the sentence phases until sentences are added.
              </p>
            </>
          ) : (
            <p className="muted">{summary.learnNotice?.message}</p>
          )}
          <Link className="button primary big" to="/progress/session?mode=learn">
            Continue learning
          </Link>
        </div>
        <div className="card">
          <h2>Repetition</h2>
          <p>
            {summary.dueNow > 0
              ? `${summary.dueNow} word${summary.dueNow === 1 ? ' is' : 's are'} due. At every milestone the word is practised again from level 1.`
              : `Nothing is due. ${summary.nextDueAt ? `Next review ${formatRelative(summary.nextDueAt)}.` : ''}`}
          </p>
          <p className="muted">
            Milestones: {REVIEW_INTERVALS_DAYS.map((days) => describeInterval(days)).join(' → ')}
          </p>
          <Link className={`button big ${summary.dueNow > 0 ? 'primary' : ''}`} to="/progress/session?mode=review">
            Review due words ({summary.dueNow})
          </Link>
          <h3>Next 14 days</h3>
          <Bars values={summary.upcoming.map((d) => d.count)} labels={summary.upcoming.map((d) => d.day.slice(5))} />
        </div>
      </div>

      <div className="card">
        <h2>Knowledge levels (words introduced so far)</h2>
        <div className="level-grid">
          {PHASES.map((phase) => (
            <div key={phase} className={`phase-${phase}`}>
              <h3>{PHASE_LABELS[phase]}</h3>
              <Bars values={summary.phaseLevels[phase]} labels={LEVEL_NAMES[phase].map((name) => name.replace(/ (recognition|recall|sentence integration|translation)$/, ''))} />
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
              <th>Words</th>
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
                <td>{block.words}</td>
                {PHASES.map((phase) => (
                  <td key={phase}>{block.applicable[phase] ? `${percent(block.complete[phase], block.applicable[phase])}%` : '—'}</td>
                ))}
                <td>{block.learned}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Activity (30 days)</h2>
        <Bars className="activity" values={summary.activity.map((d) => d.correct + d.wrong)} labels={summary.activity.map((d) => d.day.slice(5))} />
      </div>

      {learn && learn.batchWords.length > 0 && (
        <div className="card">
          <h2>Current batch</h2>
          <table className="table">
            <tbody>
              {learn.batchWords.map((word) => (
                <tr key={word.id}>
                  <td>{word.rank}</td>
                  <td>
                    <strong>{word.display}</strong>
                  </td>
                  <td>{word.english.join('; ') || <span className="muted">no translation</span>}</td>
                  <td>
                    <LevelDots levels={word.levels} />
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
