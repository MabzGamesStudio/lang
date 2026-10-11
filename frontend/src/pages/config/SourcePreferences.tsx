import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Star, X } from 'lucide-react';
import { api } from '../../api';
import { useAction, useApp } from '../../state/AppContext';
import { ORIGIN_KINDS, sourceLabel } from '../../lib/sourceLabels';
import { Section } from './fields';
import type { LanguageSummary, SourceInventory, SourcePreferences as Preferences, SourcedKind } from '../../../../shared/types';

export type PreferenceKind = SourcedKind | 'sentences';

const KINDS: Record<PreferenceKind, { title: string; unit: string; note: string; others: string }> = {
  meanings: {
    title: 'Meanings of words',
    unit: 'meanings',
    note: 'The first meaning of a word is the one shown in questions.',
    others: 'in the order they were added',
  },
  pronunciations: { title: 'Pronunciations', unit: 'pronunciations', note: 'The first pronunciation of a word is used.', others: 'in the order they were added' },
  translations: {
    title: 'Sentence translations',
    unit: 'translations',
    note: 'The first translation of a sentence is shown in questions.',
    others: 'in the order they were added',
  },
  audio: {
    title: 'Voices',
    unit: 'recordings',
    note: 'Played when a word or sentence has recordings of several voices.',
    others: 'any of them, at random',
  },
  sentences: { title: 'Texts', unit: 'sentences', note: 'Sentences found in these texts are asked first.', others: 'sentences of any text' },
};

const EMPTY: Preferences = { meanings: [], pronunciations: [], translations: [], audio: [], sentences: [] };

interface Entry {
  key: string | number;
  label: string;
  detail?: string;
  count: number;
}

function PreferenceList({
  kind,
  preferred,
  available,
  disabled,
  onSave,
}: {
  kind: PreferenceKind;
  preferred: (string | number)[];
  available: Entry[];
  disabled: boolean;
  onSave: (list: (string | number)[]) => void;
}) {
  const text = KINDS[kind];
  const byKey = new Map(available.map((entry) => [entry.key, entry]));
  const ranked = preferred.map(
    (key) => byKey.get(key) ?? { key, label: kind === 'sentences' ? `Text ${key}` : sourceLabel(kind, String(key)), count: 0 }
  );
  const others = available.filter((entry) => !preferred.includes(entry.key));
  const move = (index: number, delta: number) => {
    const next = [...preferred];
    const [item] = next.splice(index, 1);
    next.splice(index + delta, 0, item);
    onSave(next);
  };

  return (
    <div className="preference-list">
      <h3>{text.title}</h3>
      <p className="muted">{text.note}</p>
      {ranked.length > 0 && (
        <ol>
          {ranked.map((entry, index) => (
            <li key={entry.key} className="preferred">
              <span className="rank">{index + 1}</span>
              <span className="name" title={entry.detail ? `${entry.label} (${entry.detail})` : entry.label}>
                {entry.label}
              </span>
              <span className="count muted" title={`${entry.count.toLocaleString()} ${text.unit}`}>
                {entry.count.toLocaleString()}
              </span>
              <button type="button" className="icon-button" title="Prefer more" disabled={disabled || index === 0} onClick={() => move(index, -1)}>
                <ArrowUp size={13} />
              </button>
              <button
                type="button"
                className="icon-button"
                title="Prefer less"
                disabled={disabled || index === ranked.length - 1}
                onClick={() => move(index, 1)}
              >
                <ArrowDown size={13} />
              </button>
              <button
                type="button"
                className="icon-button"
                title="No longer preferred"
                disabled={disabled}
                onClick={() => onSave(preferred.filter((key) => key !== entry.key))}
              >
                <X size={13} />
              </button>
            </li>
          ))}
        </ol>
      )}
      {others.length > 0 && (
        <>
          <p className="then muted">{ranked.length ? `Then the others, ${text.others}:` : `No preference yet: ${text.others}.`}</p>
          <ul>
            {others.map((entry) => (
              <li key={entry.key}>
                <span className="name" title={entry.detail ? `${entry.label} (${entry.detail})` : entry.label}>
                  {entry.label}
                </span>
                <span className="count muted" title={`${entry.count.toLocaleString()} ${text.unit}`}>
                  {entry.count.toLocaleString()}
                </span>
                <button type="button" className="button small" disabled={disabled} onClick={() => onSave([...preferred, entry.key])}>
                  <Star size={12} /> Prefer
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {ranked.length === 0 && others.length === 0 && <p className="muted">Nothing stored yet.</p>}
    </div>
  );
}

// Which source is used when a word or sentence has values from several:
// a pinned value first, then the preferred sources in this order, then the
// others. Saving re-sorts the values of every word and sentence at once.
export default function SourcePreferences({
  language,
  kinds,
  refreshKey,
  onSaved,
}: {
  language: LanguageSummary;
  kinds: PreferenceKind[];
  refreshKey?: string | number;
  onSaved?: () => void;
}) {
  const { refreshLanguages } = useApp();
  const run = useAction();
  const [inventory, setInventory] = useState<SourceInventory | null>(null);
  const [preferences, setPreferences] = useState<Preferences>(language.sourcePreferences ?? EMPTY);
  const [saving, setSaving] = useState(false);

  useEffect(() => setPreferences(language.sourcePreferences ?? EMPTY), [language.id, language.sourcePreferences]);
  useEffect(() => {
    api
      .sourceInventory(language.id)
      .then(setInventory)
      .catch(() => undefined);
  }, [language.id, refreshKey]);

  async function save(kind: PreferenceKind, list: (string | number)[]) {
    const before = preferences;
    setPreferences({ ...preferences, [kind]: list } as Preferences);
    setSaving(true);
    const saved = await run(() => api.saveSourcePreferences(language.id, { [kind]: list } as Partial<Preferences>));
    setSaving(false);
    if (!saved) {
      setPreferences(before);
      return;
    }
    await refreshLanguages();
    onSaved?.();
  }

  const entries = (kind: PreferenceKind): Entry[] => {
    if (!inventory) return [];
    if (kind === 'sentences') {
      return inventory.sentences.map((text) => ({ key: text.id, label: text.title, detail: ORIGIN_KINDS[text.kind] ?? text.kind, count: text.count }));
    }
    return inventory[kind].map((entry) => ({ key: entry.source, label: sourceLabel(kind, entry.source), count: entry.count }));
  };

  return (
    <Section
      title="Preferred sources"
      description="When a word or sentence has several meanings, pronunciations, translations or recordings, the pinned one (★, in the list below) is used; otherwise the one from the source highest in these lists. The number is how many come from each source."
    >
      <div className="preference-grid">
        {kinds.map((kind) => (
          <PreferenceList
            key={kind}
            kind={kind}
            preferred={preferences[kind]}
            available={entries(kind)}
            disabled={saving || !inventory}
            onSave={(list) => void save(kind, list)}
          />
        ))}
      </div>
    </Section>
  );
}
