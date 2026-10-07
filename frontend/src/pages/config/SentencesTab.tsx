import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { api } from '../../api';
import { useAction } from '../../state/AppContext';
import { useDebounced } from '../../lib/hooks';
import { Pager } from './WordsTab';
import type { LanguageSummary, Paged, SentenceRow } from '../../../../shared/types';

function TranslationCell({ langId, sentence, onSaved }: { langId: string; sentence: SentenceRow; onSaved: (english: string | null) => void }) {
  const run = useAction();
  const [value, setValue] = useState(sentence.english ?? '');
  useEffect(() => setValue(sentence.english ?? ''), [sentence.english]);
  return (
    <textarea
      rows={1}
      value={value}
      placeholder="Add a translation"
      onChange={(event) => setValue(event.target.value)}
      onBlur={async () => {
        if ((sentence.english ?? '') === value.trim()) return;
        const ok = await run(() => api.updateSentence(langId, sentence.id, value.trim() || null));
        if (ok) onSaved(value.trim() || null);
      }}
    />
  );
}

export default function SentencesTab({ language }: { language: LanguageSummary }) {
  const run = useAction();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<Paged<SentenceRow>>({ rows: [], total: 0 });
  const q = useDebounced(query, 250);

  useEffect(() => {
    api
      .sentences(language.id, { offset, limit: 50, q, filter })
      .then(setData)
      .catch(() => undefined);
  }, [language.id, offset, q, filter]);
  useEffect(() => setOffset(0), [q, filter]);

  return (
    <div className="card">
      <p className="muted">
        Sentences are ordered by difficulty: the rank of their rarest word. Edit a translation by clicking on it.
      </p>
      <div className="toolbar">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search sentences" />
        <select value={filter} onChange={(event) => setFilter(event.target.value)}>
          <option value="all">All</option>
          <option value="untranslated">Not translated</option>
          <option value="translated">Translated</option>
        </select>
      </div>
      <table className="table sentences">
        <thead>
          <tr>
            <th>Difficulty</th>
            <th>{language.name}</th>
            <th>English</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {data.rows.map((sentence) => (
            <tr key={sentence.id}>
              <td>{sentence.maxRank ?? '—'}</td>
              <td lang={language.code} dir={language.rtl ? 'rtl' : 'ltr'}>
                {sentence.text}
              </td>
              <td>
                <TranslationCell
                  langId={language.id}
                  sentence={sentence}
                  onSaved={(english) =>
                    setData((current) => ({ ...current, rows: current.rows.map((row) => (row.id === sentence.id ? { ...row, english } : row)) }))
                  }
                />
                {sentence.translationSource && <span className="muted small">{sentence.translationSource}</span>}
              </td>
              <td>
                <button
                  className="icon-button danger"
                  title="Delete sentence"
                  onClick={async () => {
                    const ok = await run(() => api.deleteSentence(language.id, sentence.id));
                    if (ok) setData((current) => ({ rows: current.rows.filter((row) => row.id !== sentence.id), total: current.total - 1 }));
                  }}
                >
                  <Trash2 size={14} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Pager offset={offset} total={data.total} onChange={setOffset} />
    </div>
  );
}
