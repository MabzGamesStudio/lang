import type { ReactNode } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { useStoredState } from '../lib/hooks';

// The words (or sounds) of the current batch above a minigame. They can be
// hidden; the choice is kept for every minigame.
export default function BatchWords({ count, noun = 'words', children }: { count: number; noun?: string; children: ReactNode }) {
  const [shown, setShown] = useStoredState<boolean>('lang.showBatch', true);
  if (count === 0) return null;
  return (
    <div className={`batch-words ${shown ? '' : 'collapsed'}`}>
      {shown && children}
      <button
        type="button"
        className="batch-toggle"
        title={shown ? `Hide the ${noun} of the batch` : `Show the ${noun} of the batch`}
        aria-pressed={!shown}
        onClick={() => setShown(!shown)}
      >
        {shown ? <EyeOff size={14} /> : <Eye size={14} />} {shown ? 'Hide' : `Show the ${count} ${noun}`}
      </button>
    </div>
  );
}
