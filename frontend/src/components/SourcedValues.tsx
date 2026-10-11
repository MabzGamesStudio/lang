import { useState } from 'react';
import { Check, Pencil, Plus, Star, Trash2, X } from 'lucide-react';
import type { SourcedValue, ValueChange } from '../../../shared/types';

// The meanings, pronunciations or translations of a word or sentence, each
// with where it came from. The first one is used; pin one (★) to always use
// it, otherwise the preferred sources decide. Edited or added values are
// "typed by you" and are never removed by generation jobs.
export default function SourcedValues({
  values,
  label,
  onChange,
  usedLabel,
  addPlaceholder,
  valueClass = '',
  lang,
}: {
  values: SourcedValue[];
  label: (source: string) => string;
  onChange: (change: ValueChange) => Promise<boolean>;
  usedLabel: string;
  addPlaceholder: string;
  valueClass?: string;
  lang?: string;
}) {
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const [adding, setAdding] = useState('');
  const [busy, setBusy] = useState(false);

  async function apply(change: ValueChange): Promise<boolean> {
    setBusy(true);
    try {
      return await onChange(change);
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit(value: SourcedValue) {
    const text = draft.trim();
    setEditing(null);
    if (text && text !== value.text) await apply({ edit: value.id, text });
  }

  async function add() {
    const text = adding.trim();
    if (!text) return;
    if (await apply({ add: text })) setAdding('');
  }

  return (
    <ul className="sourced-values">
      {values.map((value, index) => (
        <li key={value.id} className={value.pinned ? 'pinned' : ''}>
          <button
            type="button"
            className={`icon-button pin ${value.pinned ? 'active' : ''}`}
            title={value.pinned ? 'Pinned: always used. Click to unpin (the preferred sources decide again).' : 'Pin: always use this one'}
            disabled={busy}
            onClick={() => void apply({ pin: value.id, pinned: !value.pinned })}
          >
            <Star size={13} fill={value.pinned ? 'currentColor' : 'none'} />
          </button>
          {editing === value.id ? (
            <span className="edit">
              <input
                autoFocus
                value={draft}
                lang={lang}
                className={valueClass}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void saveEdit(value);
                  if (event.key === 'Escape') {
                    // Cancels the edit only (not the dialog around it).
                    event.stopPropagation();
                    setEditing(null);
                  }
                }}
              />
              <button type="button" className="icon-button" title="Save (it becomes yours)" onClick={() => void saveEdit(value)}>
                <Check size={13} />
              </button>
              <button type="button" className="icon-button" title="Cancel" onClick={() => setEditing(null)}>
                <X size={13} />
              </button>
            </span>
          ) : (
            <span className={`value ${valueClass}`} lang={lang}>
              {value.text}
            </span>
          )}
          <span className="source-chip" title={`Added ${new Date(value.createdAt).toLocaleString()}`}>
            {label(value.source)}
          </span>
          {index === 0 && <span className="used-tag">{usedLabel}</span>}
          {editing !== value.id && (
            <span className="value-actions">
              <button
                type="button"
                className="icon-button"
                title="Edit (it becomes yours)"
                disabled={busy}
                onClick={() => {
                  setDraft(value.text);
                  setEditing(value.id);
                }}
              >
                <Pencil size={12} />
              </button>
              <button type="button" className="icon-button danger" title="Delete" disabled={busy} onClick={() => void apply({ remove: value.id })}>
                <Trash2 size={12} />
              </button>
            </span>
          )}
        </li>
      ))}
      <li className="add">
        <input
          value={adding}
          lang={lang}
          className={valueClass}
          placeholder={addPlaceholder}
          onChange={(event) => setAdding(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void add();
          }}
        />
        <button type="button" className="icon-button" title="Add (typed by you)" disabled={busy || !adding.trim()} onClick={() => void add()}>
          <Plus size={13} />
        </button>
      </li>
    </ul>
  );
}
