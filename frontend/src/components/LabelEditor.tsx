import { useEffect, useId, useState } from 'react';
import { X } from 'lucide-react';
import { api } from '../api';
import { useDebounced } from '../lib/hooks';

// Edits the list of English words an image stands for.
export default function LabelEditor({
  labels,
  onChange,
  autoFocus = false,
}: {
  labels: string[];
  onChange: (labels: string[]) => void;
  autoFocus?: boolean;
}) {
  const [draft, setDraft] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const listId = useId();
  const query = useDebounced(draft.trim(), 200);

  useEffect(() => {
    if (!query) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    api
      .englishWords(query)
      .then((words) => !cancelled && setSuggestions(words))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [query]);

  function add(value: string) {
    const parts = value
      .split(/[,;]/)
      .map((part) => part.trim())
      .filter(Boolean);
    const next = [...labels];
    for (const part of parts) if (!next.some((label) => label.toLowerCase() === part.toLowerCase())) next.push(part);
    onChange(next);
    setDraft('');
  }

  return (
    <div className="label-editor">
      <div className="chips">
        {labels.map((label) => (
          <span key={label} className="chip">
            {label}
            <button type="button" aria-label={`Remove ${label}`} onClick={() => onChange(labels.filter((l) => l !== label))}>
              <X size={12} />
            </button>
          </span>
        ))}
        {labels.length === 0 && <span className="muted">No labels yet</span>}
      </div>
      <input
        list={listId}
        value={draft}
        autoFocus={autoFocus}
        placeholder="Add an English word and press Enter"
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if ((event.key === 'Enter' || event.key === ',') && draft.trim()) {
            event.preventDefault();
            event.stopPropagation();
            add(draft);
          } else if (event.key === 'Backspace' && !draft && labels.length) {
            onChange(labels.slice(0, -1));
          }
        }}
      />
      <datalist id={listId}>
        {suggestions.map((word) => (
          <option key={word} value={word} />
        ))}
      </datalist>
    </div>
  );
}
