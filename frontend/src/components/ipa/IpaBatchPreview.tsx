import { Play, Volume2 } from 'lucide-react';
import { playIpa } from '../../lib/audio';
import { useKey } from '../../lib/hooks';
import { soundRef } from './IpaFeedback';
import { PHASE_LABELS } from '../../../../shared/games';
import { EXAMPLE_LOCALES, IPA_BY_SYMBOL, LANGUAGE_NAMES, type IpaExample } from '../../../../shared/ipa/inventory';
import type { IpaAudioRef, IpaSessionState } from '../../../../shared/ipa/games';
import type { AppSettings } from '../../../../shared/types';

function exampleRef(example: IpaExample): IpaAudioRef {
  return { kind: 'example', text: example.word, lang: example.lang, locale: EXAMPLE_LOCALES[example.lang] ?? example.lang };
}

// Shown when a batch of 7 sounds starts: hear each sound and its example
// words once before being tested.
export default function IpaBatchPreview({ state, settings, onStart }: { state: IpaSessionState; settings: AppSettings; onStart: () => void }) {
  const rate = settings.tts.rate || 1;
  useKey('Enter', (event) => {
    event.preventDefault();
    onStart();
  });

  // The sound on its own, or (without a recording of it) its first example word.
  const playSound = async (symbol: string) => {
    if (await playIpa(soundRef(symbol), rate)) return;
    const first = IPA_BY_SYMBOL[symbol]?.examples[0];
    if (first) await playIpa(exampleRef(first), rate);
  };

  async function playAll() {
    for (const sound of state.batchSounds) {
      await playSound(sound.symbol);
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }

  return (
    <div className="batch-preview ipa-preview">
      <h2>
        Batch {state.batch}
        {state.phase ? ` — ${PHASE_LABELS[state.phase]}` : ''}: {state.batchSounds.length} sounds
      </h2>
      <p className="muted">
        Listen to each sound and its example words, then the questions start. The batch continues until every sound is mastered.
      </p>
      <ul>
        {state.batchSounds.map((sound) => (
          <li key={sound.symbol} className="side-ipa">
            <button className="icon-button" onClick={() => void playSound(sound.symbol)} title="Listen to the sound">
              <Volume2 size={18} />
            </button>
            <strong className="ipa">{sound.symbol}</strong>
            <span className="gloss">{sound.name}</span>
            <span className="preview-examples">
              {(IPA_BY_SYMBOL[sound.symbol]?.examples ?? []).slice(0, 3).map((example) => (
                <button
                  key={`${example.lang}:${example.word}`}
                  className={`example-chip side-${example.lang === 'en' || example.lang === 'en-GB' ? 'english' : 'foreign'}`}
                  onClick={() => void playIpa(exampleRef(example), rate)}
                  title={`${LANGUAGE_NAMES[example.lang] ?? example.lang}${example.gloss ? `: “${example.gloss}”` : ''}`}
                >
                  <Volume2 size={12} /> <span lang={example.lang}>{example.word}</span> <span className="ipa">/{example.ipa}/</span>
                </button>
              ))}
            </span>
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
