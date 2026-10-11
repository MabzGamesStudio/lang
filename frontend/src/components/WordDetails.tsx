import { useEffect, useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { api, type DefinitionService } from '../api';
import { useAction, useApp } from '../state/AppContext';
import { ORIGIN_KINDS, definitionSourceLabel, pronunciationSourceLabel } from '../lib/sourceLabels';
import SourcedValues from './SourcedValues';
import Recordings from './Recordings';
import type { ValueChange, WordDetails as Details, WordRow } from '../../../shared/types';

// What a word's pronunciation is written in.
export function pronunciationName(code: string): string {
  switch (code.toLowerCase().split('-')[0]) {
    case 'zh':
      return 'Pinyin';
    case 'ja':
      return 'Reading (kana)';
    case 'ko':
      return 'Romanization';
    default:
      return 'Pronunciation (IPA)';
  }
}

// Meanings or pronunciations of the word again, from a chosen service.
function FetchAgain({
  langId,
  wordId,
  what,
  chinese,
  onFetched,
}: {
  langId: string;
  wordId: number;
  what: 'meanings' | 'pronunciations';
  chinese: boolean;
  onFetched: (details: Details) => void;
}) {
  const { settings, notify } = useApp();
  const run = useAction();
  const llmReady = Boolean(settings && settings.llm.provider !== 'none');
  const [provider, setProvider] = useState<DefinitionService>(() => (settings?.definitions.provider === 'llm' && llmReady ? 'llm' : 'wiktionary'));
  const [replace, setReplace] = useState(false);
  const [busy, setBusy] = useState(false);
  const offline = chinese && what === 'pronunciations';

  async function fetchAgain() {
    setBusy(true);
    const result = await run(() => api.fetchWord(langId, wordId, { what, provider, replace }));
    setBusy(false);
    if (!result) return;
    onFetched(result.details);
    notify(result.message, 'info');
  }

  return (
    <div className="fetch-again">
      <span className="muted">Get {what === 'meanings' ? 'meanings (and pronunciation)' : 'the pronunciation'} again from</span>
      {offline ? (
        <span>pinyin made offline</span>
      ) : (
        <select value={provider} onChange={(event) => setProvider(event.target.value as DefinitionService)}>
          <option value="wiktionary">Wiktionary</option>
          <option value="llm" disabled={!llmReady}>
            Language model{llmReady ? '' : ' (not set up)'}
          </option>
        </select>
      )}
      <label className="toggle" title="Values typed by you and pinned ones always stay">
        <input type="checkbox" checked={replace} onChange={(event) => setReplace(event.target.checked)} />
        replacing the other automatic ones
      </label>
      <button type="button" className="button small" disabled={busy} onClick={() => void fetchAgain()}>
        {busy ? <Loader2 size={14} className="spin" /> : <Download size={14} />} Get
      </button>
    </div>
  );
}

// Everything about a word, each part with where it came from: the texts it
// was found in, its meanings, pronunciations and recordings (several of
// each, from different sources), part of speech and whether it is learned.
export default function WordDetails({ langId, wordId, onChanged }: { langId: string; wordId: number; onChanged?: (word: WordRow) => void }) {
  const { languages } = useApp();
  const run = useAction();
  const language = languages.find((entry) => entry.id === langId);
  const [details, setDetails] = useState<Details | null>(null);
  const [pos, setPos] = useState('');

  useEffect(() => {
    api
      .wordDetails(langId, wordId)
      .then((loaded) => {
        setDetails(loaded);
        setPos(loaded.word.pos ?? '');
      })
      .catch(() => undefined);
  }, [langId, wordId]);

  if (!details) return <div className="word-details muted">…</div>;
  const { word } = details;

  const apply = (next: Details) => {
    setDetails(next);
    onChanged?.(next.word);
  };
  const change = (kind: 'meanings' | 'pronunciations') => async (value: ValueChange) => {
    const next = await run(() => (kind === 'meanings' ? api.changeMeaning(langId, wordId, value) : api.changePronunciation(langId, wordId, value)));
    if (next) apply(next);
    return Boolean(next);
  };
  const updateWord = async (patch: { pos?: string | null; excluded?: boolean | null }) => {
    const saved = await run(() => api.updateWord(langId, wordId, patch));
    if (saved) apply({ ...details, word: saved });
  };
  const chinese = (language?.code ?? '').toLowerCase().split('-')[0] === 'zh';

  return (
    <div className="word-details">
      <section className="found-in">
        <h4>Found in</h4>
        {details.origins.length === 0 ? (
          <p className="muted">No text or word list (yet).</p>
        ) : (
          <ul className="origins">
            {details.origins.map((origin) => (
              <li key={origin.id}>
                {origin.title} <span className="muted">· {ORIGIN_KINDS[origin.kind] ?? origin.kind} · {origin.count.toLocaleString()}×</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="meanings">
        <h4>
          English meanings <span className="muted">— all are accepted as answers; the first is shown in questions</span>
        </h4>
        <SourcedValues
          values={details.meanings}
          label={definitionSourceLabel}
          usedLabel="shown in questions"
          addPlaceholder="Add a meaning"
          onChange={change('meanings')}
        />
        <FetchAgain langId={langId} wordId={wordId} what="meanings" chinese={chinese} onFetched={apply} />
      </section>
      <section className="pronunciations">
        <h4>
          {pronunciationName(language?.code ?? '')} <span className="muted">— the first is used</span>
        </h4>
        <SourcedValues
          values={details.pronunciations}
          label={pronunciationSourceLabel}
          usedLabel="used"
          addPlaceholder="Add a pronunciation"
          valueClass="ipa"
          onChange={change('pronunciations')}
        />
        <FetchAgain langId={langId} wordId={wordId} what="pronunciations" chinese={chinese} onFetched={apply} />
      </section>
      <section className="audio">
        <h4>
          Recordings <span className="muted">— a pinned one is always played, else one of a preferred voice, else one at random</span>
        </h4>
        <Recordings target={langId} text={word.display} initial={details.audio} />
      </section>
      <section className="word-settings">
        <label>
          Part of speech
          <input
            value={pos}
            onChange={(event) => setPos(event.target.value)}
            onBlur={() => {
              if (pos.trim() !== (word.pos ?? '')) void updateWord({ pos: pos.trim() || null });
            }}
          />
        </label>
        <label>
          Learning
          <select
            value={word.userExcluded === null || word.userExcluded === undefined ? 'auto' : word.userExcluded ? 'exclude' : 'include'}
            onChange={(event) => void updateWord({ excluded: event.target.value === 'auto' ? null : event.target.value === 'exclude' })}
          >
            <option value="auto">Automatic (names are excluded)</option>
            <option value="include">Always learn this word</option>
            <option value="exclude">Never learn this word</option>
          </select>
        </label>
      </section>
    </div>
  );
}
