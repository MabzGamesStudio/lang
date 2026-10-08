import { useEffect, useRef, useState } from 'react';

// Global keyboard shortcut. Ignored while typing in inputs unless `inInputs`.
export function useKey(
  keys: string | string[],
  handler: (event: KeyboardEvent) => void,
  options: { enabled?: boolean; inInputs?: boolean } = {}
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  const list = Array.isArray(keys) ? keys : [keys];
  const signature = list.join('|');
  const enabled = options.enabled ?? true;
  const inInputs = options.inInputs ?? false;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable);
      if (typing && !inInputs) return;
      if (!signature.split('|').includes(event.key)) return;
      handlerRef.current(event);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [signature, enabled, inInputs]);
}

export function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export function useStoredState<T>(key: string, initial: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(key);
      return stored === null ? initial : (JSON.parse(stored) as T);
    } catch {
      return initial;
    }
  });
  const update = (next: T) => {
    setValue(next);
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      // storage unavailable
    }
  };
  return [value, update];
}

export function formatDate(time: number | null | undefined): string {
  if (!time) return '—';
  return new Date(time).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function formatRelative(time: number | null | undefined): string {
  if (!time) return '—';
  const diff = time - Date.now();
  const minutes = Math.round(diff / 60000);
  if (Math.abs(minutes) < 1) return 'now';
  if (Math.abs(minutes) < 60) return minutes > 0 ? `in ${minutes} min` : `${-minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 48) return hours > 0 ? `in ${hours} h` : `${-hours} h ago`;
  const days = Math.round(hours / 24);
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
}

export function readFileText(file: File): Promise<string> {
  return file.text();
}
