import { useEffect, useRef, useState } from 'react';
import { Flag } from 'lucide-react';
import type { SentenceExclusion } from '../../../../shared/types';

export const EXCLUSION_LABELS: Record<SentenceExclusion, string> = {
  translation: 'Bad translation',
  nonsense: 'Doesn’t make sense',
  audio: 'Bad audio',
  other: 'Other problem',
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
              onClick={() => {
                setOpen(false);
                onReport(reason);
              }}
            >
              {EXCLUSION_LABELS[reason]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
