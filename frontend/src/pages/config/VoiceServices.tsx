import { Field, useSettingsDraft } from './fields';
import type { AppSettings, TtsProvider } from '../../../../shared/types';

// Where audio for words and sentences can come from.

export const VOICE_SERVICE_OPTIONS: { value: TtsProvider; label: string }[] = [
  { value: 'browser', label: 'On this device (browser voices)' },
  { value: 'colab', label: 'Google Colab (free: Microsoft voices, or open-source Kokoro / Chatterbox)' },
  { value: 'azure', label: 'Azure Speech (Microsoft neural voices)' },
  { value: 'elevenlabs', label: 'ElevenLabs (most natural, paid)' },
  { value: 'google', label: 'Google Cloud Text-to-Speech' },
  { value: 'openai', label: 'OpenAI-compatible speech API (OpenAI or a self-hosted open-source server)' },
];

const COMPARISON: { value: TtsProvider; name: string; languages: string; quality: string; cost: string; notes: string }[] = [
  {
    value: 'browser',
    name: 'On this device',
    languages: 'The voices installed on the computer',
    quality: 'Varies, often robotic',
    cost: 'Free',
    notes: 'Works offline. Nothing is stored, so it cannot be regenerated.',
  },
  {
    value: 'colab',
    name: 'Colab: Microsoft voices',
    languages: 'Most languages (100+ locales)',
    quality: 'Natural neural voices',
    cost: 'Free',
    notes: 'The notebook’s default engine (edge-tts). Needs the notebook running.',
  },
  {
    value: 'colab',
    name: 'Colab: Kokoro',
    languages: 'English, Spanish, French, Hindi, Italian, Japanese, Brazilian Portuguese, Mandarin',
    quality: 'Very natural for its size',
    cost: 'Free, open source (Apache-2.0)',
    notes: 'TTS_ENGINE = "kokoro". Small; runs without a GPU. Other languages fall back to Microsoft voices.',
  },
  {
    value: 'colab',
    name: 'Colab: Chatterbox',
    languages: '23: Arabic, Chinese, Danish, Dutch, English, Finnish, French, German, Greek, Hebrew, Hindi, Italian, Japanese, Korean, Malay, Norwegian, Polish, Portuguese, Russian, Spanish, Swahili, Swedish, Turkish',
    quality: 'Very natural',
    cost: 'Free, open source (MIT)',
    notes: 'TTS_ENGINE = "chatterbox". Needs a GPU runtime. Other languages fall back to Microsoft voices.',
  },
  {
    value: 'azure',
    name: 'Azure Speech',
    languages: '140+ languages and variants',
    quality: 'Natural neural voices (the same family as Colab’s Microsoft voices)',
    cost: 'Free monthly allowance, then per character',
    notes: 'Official API with a key; the widest language choice.',
  },
  {
    value: 'google',
    name: 'Google Cloud',
    languages: '50+ languages',
    quality: 'Standard to very natural (WaveNet, Neural2, Chirp)',
    cost: 'Free monthly allowance, then per character',
    notes: '',
  },
  {
    value: 'elevenlabs',
    name: 'ElevenLabs',
    languages: 'About 30 (multilingual v2) to 70+ (v3)',
    quality: 'The most natural and expressive',
    cost: 'Paid plans, small free tier',
    notes: 'Every voice speaks every language.',
  },
  {
    value: 'openai',
    name: 'OpenAI-compatible',
    languages: 'OpenAI: about 50; self-hosted: depends on the model',
    quality: 'Natural',
    cost: 'OpenAI: paid. Self-hosted: free',
    notes: 'OpenAI itself, or your own open-source server with the same API (e.g. Kokoro-FastAPI, or openedai-speech for Piper and XTTS).',
  },
];

// Choice of voice service with a comparison of the options.
export default function VoiceServices() {
  const [draft, update] = useSettingsDraft();
  if (!draft) return null;
  return (
    <>
      <div className="form-grid">
        <Field label="Voice service for words and sentences">
          <select value={draft.tts.provider} onChange={(event) => update((s) => void (s.tts.provider = event.target.value as AppSettings['tts']['provider']))}>
            {VOICE_SERVICE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <table className="table voice-options">
        <thead>
          <tr>
            <th>Option</th>
            <th>Languages</th>
            <th>Quality</th>
            <th>Cost</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          {COMPARISON.map((row) => (
            <tr key={row.name} className={row.value === draft.tts.provider ? 'current' : ''}>
              <td>
                <strong>{row.name}</strong>
              </td>
              <td>{row.languages}</td>
              <td>{row.quality}</td>
              <td>{row.cost}</td>
              <td className="muted">{row.notes}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted">
        Keys, voices and the speed are set in Configuration → Services, each language’s voice in Configuration → Language. Configuration → Sentences
        shows where the audio of each sentence came from, and regenerates it.
      </p>
    </>
  );
}
