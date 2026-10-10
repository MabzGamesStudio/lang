import { useEffect, useRef, useState } from 'react';
import { Flag } from 'lucide-react';
import type { SentenceExclusion } from '../../../../shared/types';

export const EXCLUSION_LABELS: Record<SentenceExclusion, string> = {
  translation: 'Bad translation',
  nonsense: 'Doesn’t make sense',
  audio: 'Bad audio',
  other: 'Other problem',
};

// What an exclusion does.
export const EXCLUSION_EFFECTS: Record<SentenceExclusion, string> = {
  translation: 'left out of the questions',
  nonsense: 'left out of the questions',
  audio: 'left out of listening questions only',
  other: 'left out of the questions',
};

// Takes the sentence of a question out of the question set, with a reason.
export default function ReportMenu({ onReport, disabled = false }: { onReport: (reason: SentenceExclusion) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !ref.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', close);
    };
  }, [open]);

  return (
    <div className="report-menu" ref={ref}>
      <button
        type="button"
        className="link-button"
        disabled={disabled}
        aria-expanded={open}
        title="Take this sentence out of the questions"
        onClick={() => setOpen(!open)}
      >
        <Flag size={14} /> Exclude
      </button>
      {open && (
        <div className="report-options" role="menu">
          <span className="muted">Exclude this sentence because of:</span>
          {(Object.keys(EXCLUSION_LABELS) as SentenceExclusion[]).map((reason) => (
            <button
              key={reason}
              type="button"
              role="menuitem"
              title={`The sentence is ${EXCLUSION_EFFECTS[reason]}`}
              onClick={() => {
                setOpen(false);
                onReport(reason);
              }}
            >
              {EXCLUSION_LABELS[reason]}
              {reason === 'audio' && <span className="muted"> (listening only)</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
