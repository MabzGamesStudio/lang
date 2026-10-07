import { Play, Volume2 } from 'lucide-react';
import { playText } from '../../lib/audio';
import { useKey } from '../../lib/hooks';
import { voiceFor } from './PromptView';
import type { AppSettings, BatchWord, LanguageSummary } from '../../../../shared/types';

// Shown when a new batch of 7 words starts: see and hear them once before
// being tested.
export default function BatchPreview({
  words,
  batch,
  language,
  settings,
  onStart,
}: {
  words: BatchWord[];
  batch: number | null;
  language: LanguageSummary;
  settings: AppSettings;
  onStart: () => void;
}) {
  const voice = voiceFor('foreign', language, settings);
  useKey('Enter', (event) => {
    event.preventDefault();
    onStart();
  });

  async function playAll() {
    for (const word of words) {
      await playText(voice.target, word.display, voice.options);
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
  }

  return (
    <div className="batch-preview">
      <h2>New batch{batch ? ` ${batch}` : ''}: {words.length} words</h2>
      <p className="muted">Look and listen once, then the questions start.</p>
      <ul>
        {words.map((word) => (
          <li key={word.id}>
            <button className="icon-button" onClick={() => void playText(voice.target, word.display, voice.options)} title="Listen">
              <Volume2 size={18} />
            </button>
            <strong lang={language.code}>{word.display}</strong>
            {word.pronunciation && <span className="ipa">/{word.pronunciation}/</span>}
            <span className="gloss">{word.english.join('; ') || '—'}</span>
          </li>
        ))}
      </ul>
      <div className="row">
        <button className="button" onClick={() => void playAll()}>
          <Volume2 size={16} /> Play all
        </button>
        <button className="button primary" onClick={onStart} autoFocus>
          <Play size={16} /> Start (Enter)
        </button>
      </div>
    </div>
  );
}
