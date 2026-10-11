import { useEffect, useState } from 'react';
import { api } from '../../api';
import { sourceLabel } from '../../lib/sourceLabels';
import type { RegeneratePolicy, SourceCount, SourcedKind } from '../../../../shared/types';

export const ONLY_MISSING: RegeneratePolicy = { mode: 'missing', keep: [], replace: false };

const TEXT: Record<SourcedKind, { item: string; items: string; value: string; values: string; kept: string }> = {
  meanings: { item: 'word', items: 'words', value: 'meaning', values: 'meanings', kept: 'meanings typed by you and pinned ones always stay' },
  pronunciations: {
    item: 'word',
    items: 'words',
    value: 'pronunciation',
    values: 'pronunciations',
    kept: 'pronunciations typed by you and pinned ones always stay',
  },
  translations: {
    item: 'sentence',
    items: 'sentences',
    value: 'translation',
    values: 'translations',
    kept: 'translations typed by you and pinned ones always stay',
  },
  audio: { item: 'word or sentence', items: 'words and sentences', value: 'recording', values: 'recordings', kept: 'pinned recordings always stay' },
};

// Which words or sentences a generation job works on, judged by the sources
// of what they already have, and whether their other automatic values are
// replaced by the new ones. Shows how many words or sentences match.
export default function RegenerateOptions({
  langId,
  kind,
  sources,
  policy,
  onChange,
  refreshKey,
}: {
  langId: string;
  kind: SourcedKind;
  sources: SourceCount[];
  policy: RegeneratePolicy;
  onChange: (policy: RegeneratePolicy) => void;
  refreshKey?: string | number;
}) {
  const text = TEXT[kind];
  const [count, setCount] = useState<number | null>(null);
  const keepKey = policy.keep.join('\n');

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      api
        .regenerateCount(langId, kind, policy)
        .then((result) => !cancelled && setCount(result.count))
        .catch(() => undefined);
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [langId, kind, policy.mode, keepKey, refreshKey]);

  const toggle = (source: string) =>
    onChange({ ...policy, keep: policy.keep.includes(source) ? policy.keep.filter((item) => item !== source) : [...policy.keep, source] });
  // Kept sources that have no values any more are still shown (and can be unticked).
  const listed = [...sources, ...policy.keep.filter((source) => !sources.some((entry) => entry.source === source)).map((source) => ({ source, count: 0 }))];

  return (
    <div className="regenerate-options">
      <span className="field-label">Which {text.items}</span>
      <label className="radio">
        <input type="radio" checked={policy.mode === 'missing'} onChange={() => onChange({ ...policy, mode: 'missing' })} />
        Only those without any {text.value}
      </label>
      <label className="radio">
        <input type="radio" checked={policy.mode === 'unless'} onChange={() => onChange({ ...policy, mode: 'unless' })} />
        Also those without a {text.value} from the sources ticked here (none ticked: all of them)
      </label>
      {policy.mode === 'unless' && (
        <div className="source-chips">
          {listed.length === 0 && <span className="muted">No {text.values} stored yet.</span>}
          {listed.map((entry) => (
            <label key={entry.source} className={`source-option ${policy.keep.includes(entry.source) ? 'on' : ''}`}>
              <input type="checkbox" checked={policy.keep.includes(entry.source)} onChange={() => toggle(entry.source)} />
              {sourceLabel(kind, entry.source)} <span className="muted">{entry.count.toLocaleString()}</span>
            </label>
          ))}
        </div>
      )}
      <label className="toggle">
        <input type="checkbox" checked={policy.replace} onChange={(event) => onChange({ ...policy, replace: event.target.checked })} />
        Replace their other automatic {text.values} with the new ones ({text.kept})
      </label>
      <span className="match-count">
        <strong>{count === null ? '…' : count.toLocaleString()}</strong> {count === 1 ? `${text.item} matches` : `${text.items} match`}; the job takes{' '}
        {kind === 'audio' ? 'the most frequent words and the easiest sentences first (their English translations get a recording when they have none)' : kind === 'translations' ? 'the easiest first' : 'the most frequent first'}.
      </span>
    </div>
  );
}
