import { useCallback, useEffect, useState } from 'react';
import { Eye, Pencil, Volume2 } from 'lucide-react';
import { api } from '../../api';
import { playText } from '../../lib/audio';
import { useKey } from '../../lib/hooks';
import { useAction } from '../../state/AppContext';
import LabelEditor from '../LabelEditor';
import type { AppSettings, LanguageSummary, Question } from '../../../../shared/types';

export function voiceFor(side: 'foreign' | 'english', language: LanguageSummary, settings: AppSettings) {
  return side === 'foreign'
    ? { target: language.id, options: { locale: language.locale || language.code, voice: language.ttsVoice, rate: settings.tts.rate } }
    : { target: 'english', options: { locale: 'en-US', voice: settings.tts.englishVoice, rate: settings.tts.rate } };
}

export default function PromptView({
  question,
  language,
  settings,
  revealed,
  onReveal,
  active,
}: {
  question: Question;
  language: LanguageSummary;
  settings: AppSettings;
  revealed: boolean;
  onReveal: () => void;
  active: boolean;
}) {
  const run = useAction();
  const { prompt } = question;
  const [playing, setPlaying] = useState(false);
  const [labels, setLabels] = useState<string[]>(question.imageLabels ?? []);
  const [editingLabels, setEditingLabels] = useState(false);

  const play = useCallback(async () => {
    const voice = voiceFor(prompt.side, language, settings);
    setPlaying(true);
    try {
      await playText(voice.target, prompt.text, voice.options);
    } finally {
      setPlaying(false);
    }
  }, [prompt.side, prompt.text, language, settings]);

  useEffect(() => {
    setLabels(question.imageLabels ?? []);
    setEditingLabels(false);
    if (prompt.mode === 'audio') void play();
    // Play once per question.
  }, [question.key]);

  // Replay with Ctrl+Space; plain Space also works in multiple choice (no typing, no microphone).
  const plainSpace = question.response.mode === 'choice';
  useKey(
    ' ',
    (event) => {
      if (prompt.mode !== 'audio' || !active) return;
      if (event.ctrlKey || (plainSpace && !(event.target instanceof HTMLInputElement))) {
        event.preventDefault();
        void play();
      }
    },
    { inInputs: true }
  );

  async function saveLabels(next: string[]) {
    setLabels(next);
    if (prompt.imageId) await run(() => api.updateImage(prompt.imageId!, { labels: next }));
  }

  const isForeign = prompt.side === 'foreign';
  const textProps = isForeign ? { lang: language.code, dir: language.rtl ? 'rtl' : 'ltr' } : { lang: 'en' };

  return (
    <div className={`prompt prompt-${prompt.mode} side-${prompt.side} ${question.sentence ? 'sentence' : 'word'}`}>
      <div className="prompt-kind">{isForeign ? language.name : 'English'}</div>
      {prompt.mode === 'text' &&
        (prompt.memorize && revealed ? (
          <div className="memorize-hidden">
            <Eye size={18} /> Hidden — now type it from memory
          </div>
        ) : (
          <div className="prompt-text" {...textProps}>
            {prompt.text}
          </div>
        ))}
      {prompt.mode === 'text' && prompt.memorize && !revealed && (
        <button className="button primary" onClick={onReveal}>
          I memorised it — hide (Enter)
        </button>
      )}
      {prompt.mode === 'audio' && (
        <button className="play-button" onClick={() => void play()} aria-label="Play audio" disabled={playing}>
          <Volume2 size={40} />
          <span>{playing ? 'Playing…' : `Play again (${plainSpace ? 'Space' : 'Ctrl+Space'})`}</span>
        </button>
      )}
      {prompt.mode === 'image' && prompt.imageId && (
        <div className="prompt-image">
          <img src={api.imageUrl(prompt.imageId)} alt="What is this?" />
          <button className="link-button" onClick={() => setEditingLabels(!editingLabels)}>
            <Pencil size={14} /> {editingLabels ? 'Done' : 'Edit what this image means'}
          </button>
          {editingLabels && <LabelEditor labels={labels} onChange={(next) => void saveLabels(next)} autoFocus />}
        </div>
      )}
    </div>
  );
}
