import { useState } from 'react';
import Modal from './Modal';
import { api } from '../api';
import { useAction } from '../state/AppContext';
import { splitGlossList } from '../../../shared/text';
import type { WordRow } from '../../../shared/types';

export interface EditableWord {
  id: number;
  display: string;
  english: string[];
  pronunciation: string | null;
  pos?: string | null;
  userExcluded?: boolean | null;
}

// Fix a translation or pronunciation on the spot (also reachable from feedback).
export default function WordEditor({
  langId,
  word,
  onClose,
  onSaved,
}: {
  langId: string;
  word: EditableWord;
  onClose: () => void;
  onSaved?: (word: WordRow) => void;
}) {
  const run = useAction();
  const [english, setEnglish] = useState(word.english.join('; '));
  const [pronunciation, setPronunciation] = useState(word.pronunciation ?? '');
  const [pos, setPos] = useState(word.pos ?? '');
  const [excluded, setExcluded] = useState<boolean | null>(word.userExcluded ?? null);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    const saved = await run(
      () =>
        api.updateWord(langId, word.id, {
          english: splitGlossList(english),
          pronunciation: pronunciation || null,
          pos: pos || null,
          excluded,
        }),
      'Word saved'
    );
    setSaving(false);
    if (saved) {
      onSaved?.(saved);
      onClose();
    }
  }

  return (
    <Modal title={`Edit “${word.display}”`} onClose={onClose}>
      <form
        className="form"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <label>
          English translations <span className="muted">(separate with ; — the first one is shown in questions)</span>
          <input autoFocus value={english} onChange={(event) => setEnglish(event.target.value)} />
        </label>
        <label>
          Pronunciation (IPA)
          <input value={pronunciation} onChange={(event) => setPronunciation(event.target.value)} />
        </label>
        <label>
          Part of speech
          <input value={pos} onChange={(event) => setPos(event.target.value)} />
        </label>
        <label>
          Learning
          <select
            value={excluded === null ? 'auto' : excluded ? 'exclude' : 'include'}
            onChange={(event) => setExcluded(event.target.value === 'auto' ? null : event.target.value === 'exclude')}
          >
            <option value="auto">Automatic (names are excluded)</option>
            <option value="include">Always learn this word</option>
            <option value="exclude">Never learn this word</option>
          </select>
        </label>
        <div className="row end">
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" disabled={saving}>
            Save
          </button>
        </div>
      </form>
    </Modal>
  );
}
