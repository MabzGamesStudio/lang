import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useApp } from '../../state/AppContext';
import type { AppSettings } from '../../../../shared/types';

// Local copy of the settings that is saved automatically shortly after edits.
export function useSettingsDraft(): [AppSettings | null, (mutate: (draft: AppSettings) => void) => void, () => Promise<void>] {
  const { settings, saveSettings } = useApp();
  const [draft, setDraft] = useState<AppSettings | null>(settings);
  const timer = useRef<number | undefined>(undefined);
  const latest = useRef<AppSettings | null>(null);

  useEffect(() => {
    if (!draft && settings) setDraft(settings);
  }, [settings, draft]);

  // Flush pending edits when leaving the page.
  useEffect(
    () => () => {
      if (timer.current !== undefined && latest.current) {
        window.clearTimeout(timer.current);
        void saveSettings(latest.current);
      }
    },
    [saveSettings]
  );

  const update = (mutate: (draft: AppSettings) => void) => {
    setDraft((current) => {
      if (!current) return current;
      const next = structuredClone(current);
      mutate(next);
      latest.current = next;
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        timer.current = undefined;
        void saveSettings(next);
      }, 600);
      return next;
    });
  };
  // Saves pending edits now (before an action that needs them on the server).
  const flush = async () => {
    if (timer.current === undefined || !latest.current) return;
    window.clearTimeout(timer.current);
    timer.current = undefined;
    await saveSettings(latest.current);
  };
  return [draft, update, flush];
}

export function Field({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="hint muted">{hint}</span>}
    </label>
  );
}

export function TextInput({
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return <input type={type} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} autoComplete="off" />;
}

export function NumberInput({
  value,
  onChange,
  min,
  max,
  step = 1,
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return (
    <input
      type="number"
      value={text}
      min={min}
      max={max}
      step={step}
      onChange={(event) => {
        setText(event.target.value);
        const parsed = Number(event.target.value);
        if (event.target.value !== '' && Number.isFinite(parsed)) {
          onChange(Math.max(min ?? -Infinity, Math.min(max ?? Infinity, parsed)));
        }
      }}
    />
  );
}

export function Toggle({ checked, onChange, children }: { checked: boolean; onChange: (value: boolean) => void; children: ReactNode }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      {children}
    </label>
  );
}

export function Section({ title, children, description }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <section className="card config-section">
      <h2>{title}</h2>
      {description && <p className="muted">{description}</p>}
      {children}
    </section>
  );
}
