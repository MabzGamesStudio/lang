import Modal from './Modal';
import WordDetails from './WordDetails';
import type { WordRow } from '../../../shared/types';

export interface EditableWord {
  id: number;
  display: string;
  english: string[];
  pronunciation: string | null;
  pos?: string | null;
  userExcluded?: boolean | null;
}

// Fix a meaning, pronunciation or recording on the spot (reachable from the
// feedback of a question): the same details as in Configuration → Words.
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
  return (
    <Modal title={`“${word.display}”`} onClose={onClose} wide>
      <WordDetails langId={langId} wordId={word.id} onChanged={onSaved} />
      <div className="row end">
        <button type="button" className="button primary" onClick={onClose}>
          Done
        </button>
      </div>
    </Modal>
  );
}
