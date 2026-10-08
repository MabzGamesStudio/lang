import { useEffect, useState } from 'react';
import { Ban, Check, Pencil, RotateCcw } from 'lucide-react';
import { api } from '../../api';
import { useAction, useApp } from '../../state/AppContext';
import { useDebounced, formatRelative } from '../../lib/hooks';
import LevelDots from '../../components/LevelDots';
import WordEditor, { type EditableWord } from '../../components/WordEditor';
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

export default function WordsTab({ language }: { language: LanguageSummary }) {
  const { refreshLanguages } = useApp();
  const run = useAction();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('active');
  const [sort, setSort] = useState('rank');
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<Paged<WordRow>>({ rows: [], total: 0 });
  const [editing, setEditing] = useState<EditableWord | null>(null);
  const q = useDebounced(query, 250);

  const load = () =>
    api
      .words(language.id, { offset, limit: PAGE, q, filter, sort })
      .then(setData)
      .catch(() => undefined);

  useEffect(() => {
    void load();
  }, [language.id, offset, q, filter, sort]);
  useEffect(() => setOffset(0), [q, filter, sort]);

  const replace = (row: WordRow) => setData((current) => ({ ...current, rows: current.rows.map((r) => (r.id === row.id ? row : r)) }));

  return (
    <div className="card">
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
          {data.rows.map((word) => (
            <tr key={word.id} className={word.active ? '' : 'inactive'}>
              <td>{word.rank ?? '—'}</td>
              <td>{word.rank ? batchOfRank(word.rank) : '—'}</td>
              <td lang={language.code}>
                <strong>{word.display}</strong>
                {word.properNoun && <span className="tag">name</span>}
              </td>
              <td>{word.english.join('; ') || <span className="muted">—</span>}</td>
              <td className="ipa">{word.pronunciation ?? ''}</td>
              <td>{word.count.toLocaleString()}</td>
              <td>
                {word.translatedSentenceCount}/{word.sentenceCount}
              </td>
              <td>
                <LevelDots levels={word.levels} />
              </td>
              <td className="muted">{word.srsStage > 0 ? (word.reviewing ? 'reviewing' : formatRelative(word.nextReviewAt)) : ''}</td>
              <td className="actions">
                <button className="icon-button" title="Edit" onClick={() => setEditing({ ...word })}>
                  <Pencil size={14} />
                </button>
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
          ))}
        </tbody>
      </table>
      <Pager offset={offset} total={data.total} onChange={setOffset} />
      {editing && <WordEditor langId={language.id} word={editing} onClose={() => setEditing(null)} onSaved={(row) => { replace(row); void load(); }} />}
    </div>
  );
}
