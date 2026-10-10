import { useMemo } from 'react';
import { useApp } from '../state/AppContext';
import { useStoredState } from './hooks';
import type { IpaScope, IpaSoundSet } from '../../../shared/ipa/games';

// The sounds (English or all) and words (the examples or one of your
// languages) of the pronunciation mode, remembered on this device.
export function useIpaScope() {
  const { languages } = useApp();
  const [sounds, setSounds] = useStoredState<IpaSoundSet>('lang.ipa.sounds', 'english');
  const [words, setWords] = useStoredState<string>('lang.ipa.words', 'examples');
  // A language that has gone falls back to the example words.
  const language = words === 'examples' ? null : languages.find((entry) => entry.id === words) ?? null;
  const scope = useMemo<IpaScope>(() => ({ sounds, words: language ? language.id : 'examples' }), [sounds, language]);
  return { scope, language, setSounds, setWords };
}
