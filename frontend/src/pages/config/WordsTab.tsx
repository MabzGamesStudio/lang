import { Fragment, useEffect, useState } from 'react';
import { Ban, Check, ChevronDown, ChevronRight, RotateCcw } from 'lucide-react';
import { api } from '../../api';
import { useAction, useApp } from '../../state/AppContext';
import { useDebounced, formatRelative } from '../../lib/hooks';
import LevelDots from '../../components/LevelDots';
import WordDetails from '../../components/WordDetails';
import SourcePreferences from './SourcePreferences';
import { definitionSourceLabel, pronunciationSourceLabel, voiceLabel } from '../../lib/sourceLabels';
import { batchOfRank } from '../../../../shared/scoring';
import type { LanguageSummary, Paged, WordRow } from '../../../../shared/types';

const PAGE = 50;

export function Pager({ offset, total, onChange }: { offset: number; total: number; onChange: (offset: number) => void }) {
  return (
    <div className="pager">
      <button className="button small" disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - PAGE))}>
        Previous
      </button>
      <span className="muted">
        {total === 0 ? 0 : offset + 1}–{Math.min(total, offset + PAGE)} of {total.toLocaleString()}
      </span>
      <button className="button small" disabled={offset + PAGE >= total} onClick={() => onChange(offset + PAGE)}>
        Next
      </button>
    </div>
  );
}

const COLUMNS = 11;

export default function WordsTab({ language }: { language: LanguageSummary }) {
  const { refreshLanguages } = useApp();
  const run = useAction();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('active');
  const [sort, setSort] = useState('rank');
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<Paged<WordRow>>({ rows: [], total: 0 });
  const [open, setOpen] = useState<Set<number>>(new Set());
  // Changes to values (counts of the sources) and to the preferred sources (order of the values).
  const [edits, setEdits] = useState(0);
  const [preferences, setPreferences] = useState(0);
  const toggle = (id: number) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const q = useDebounced(query, 250);

  const load = () =>
    api
      .words(language.id, { offset, limit: PAGE, q, filter, sort })
      .then(setData)
      .catch(() => undefined);

  useEffect(() => {
    void load();
  }, [language.id, offset, q, filter, sort, preferences]);
  useEffect(() => setOffset(0), [q, filter, sort]);

  const replace = (row: WordRow) => setData((current) => ({ ...current, rows: current.rows.map((r) => (r.id === row.id ? row : r)) }));

  return (
    <>
      <SourcePreferences
        language={language}
        kinds={['meanings', 'pronunciations', 'audio']}
        refreshKey={edits}
        onSaved={() => setPreferences((n) => n + 1)}
      />
      <div className="card">
        <p className="muted">
          Open a word (<ChevronRight size={12} />) to see where each of its meanings, pronunciations and recordings comes from: pin the one to use
          (★), edit, add or delete them, or get them again from a service. Values typed by you and pinned ones are never replaced by the
          generation jobs.
        </p>
        <div className="toolbar">
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search a word or translation" />
          <select value={filter} onChange={(event) => setFilter(event.target.value)}>
            <option value="active">Words to learn</option>
            <option value="undefined">Missing translation</option>
            <option value="studying">Being learned</option>
            <option value="learned">Learned</option>
            <option value="due">Due for review</option>
            <option value="excluded">Excluded (names…)</option>
            <option value="all">All</option>
          </select>
          <select value={sort} onChange={(event) => setSort(event.target.value)}>
            <option value="rank">By frequency</option>
            <option value="alpha">Alphabetical</option>
            <option value="recent">Recently practised</option>
          </select>
        </div>
        <table className="table words">
          <thead>
            <tr>
              <th />
              <th>Rank</th>
              <th>Batch</th>
              <th>Word</th>
              <th>English</th>
              <th>Pronunciation</th>
              <th>Count</th>
              <th>Sentences</th>
              <th>Knowledge</th>
              <th>Review</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.rows.map((word) => {
              const expanded = open.has(word.id);
              const pronunciations = word.pronunciations ?? [];
              return (
                <Fragment key={word.id}>
                  <tr className={`${word.active ? '' : 'inactive'} ${expanded ? 'expanded' : ''}`}>
                    <td>
                      <button
                        className={`icon-button ${expanded ? 'active' : ''}`}
                        title={expanded ? 'Close' : 'Sources, meanings, pronunciations and recordings'}
                        aria-expanded={expanded}
                        onClick={() => toggle(word.id)}
                      >
                        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </button>
                    </td>
                    <td>{word.rank ?? '—'}</td>
                    <td>{word.rank ? batchOfRank(word.rank) : '—'}</td>
                    <td lang={language.code}>
                      <button className="link-button word-link" onClick={() => toggle(word.id)}>
                        <strong>{word.display}</strong>
                      </button>
                      {word.properNoun && <span className="tag">name</span>}
                      {word.origins && word.origins.length > 0 && (
                        <div className="origin muted" title="Books, texts and word lists the word was found in (and how often)">
                          From: {word.origins.map((origin) => `${origin.title} (${origin.count})`).join(', ')}
                        </div>
                      )}
                    </td>
                    <td>
                      {word.english.length === 0 ? (
                        <span className="muted">—</span>
                      ) : (
                        word.english.map((gloss, index) => (
                          <span key={gloss} className="gloss-chip" title={`Source: ${definitionSourceLabel(word.englishSources[index] ?? null)}`}>
                            {gloss}
                            <small>{definitionSourceLabel(word.englishSources[index] ?? null)}</small>
                          </span>
                        ))
                      )}
                      {word.audio && word.audio.length > 0 && (
                        <div className="origin muted">
                          Audio: {word.audio.map((recording) => `${voiceLabel(recording.voice)}${recording.pinned ? ' ★' : ''}`).join(', ')}
                        </div>
                      )}
                    </td>
                    <td>
                      {pronunciations.length > 0 ? (
                        <span
                          className="gloss-chip"
                          title={pronunciations.map((value) => `${value.text} — ${pronunciationSourceLabel(value.source)}`).join('\n')}
                        >
                          <span className="ipa">{pronunciations[0].text}</span>
                          <small>{pronunciationSourceLabel(pronunciations[0].source)}</small>
                          {pronunciations.length > 1 && <span className="muted">+{pronunciations.length - 1}</span>}
                        </span>
                      ) : (
                        <span className="ipa">{word.pronunciation ?? ''}</span>
                      )}
                    </td>
                    <td>{word.count.toLocaleString()}</td>
                    <td title={`${word.translatedSentenceCount} of them translated`}>{word.sentenceCount}</td>
                    <td>
                      <LevelDots levels={word.levels} />
                    </td>
                    <td className="muted">{word.srsStage > 0 ? (word.reviewing ? 'reviewing' : formatRelative(word.nextReviewAt)) : ''}</td>
                    <td className="actions">
                      <button
                        className="icon-button"
                        title={word.active ? 'Exclude from learning' : 'Include in learning'}
                        onClick={async () => {
                          const saved = await run(() => api.updateWord(language.id, word.id, { excluded: word.active }));
                          if (saved) {
                            replace(saved);
                            void refreshLanguages();
                          }
                        }}
                      >
                        {word.active ? <Ban size={14} /> : <Check size={14} />}
                      </button>
                      <button
                        className="icon-button"
                        title="Reset progress"
                        onClick={async () => {
                          const saved = await run(() => api.resetWord(language.id, word.id));
                          if (saved) replace(saved);
                        }}
                      >
                        <RotateCcw size={14} />
                      </button>
                    </td>
                  </tr>
                  {expanded && (
                    <tr className="details-row">
                      <td colSpan={COLUMNS}>
                        <WordDetails
                          key={preferences}
                          langId={language.id}
                          wordId={word.id}
                          onChanged={(row) => {
                            replace(row);
                            setEdits((n) => n + 1);
                          }}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        <Pager offset={offset} total={data.total} onChange={setOffset} />
      </div>
    </>
  );
}
