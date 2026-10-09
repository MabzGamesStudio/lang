import type { AppSettings, TranslationProvider, TtsProvider } from '../../../shared/types';

// Readable names for where stored audio and translations came from.

const COLAB_ENGINES: Record<string, string> = { kokoro: 'Kokoro (open source)', chatterbox: 'Chatterbox (open source)' };

// Audio voice keys: "colab:es-ES-ElviraNeural", "colab:kokoro:ef_dora",
// "openai:tts-1:alloy", "google:es-ES:es-ES-Neural2-A", "azure:…", "elevenlabs:model:voice".
export function voiceLabel(key: string | null): string {
  if (!key) return 'not generated';
  const [service, ...rest] = key.split(':');
  switch (service) {
    case 'colab': {
      const engine = COLAB_ENGINES[rest[0]];
      return engine ? `Colab · ${engine} · ${rest.slice(1).join(':')}` : `Colab · Microsoft voice ${rest.join(':')}`;
    }
    case 'openai':
      return `OpenAI-compatible · ${rest.join(' · ')}`;
    case 'google':
      return `Google Cloud · ${rest.filter(Boolean).join(' · ')}`;
    case 'azure':
      return `Azure Speech · ${rest.join(':')}`;
    case 'elevenlabs':
      return `ElevenLabs · ${rest.join(' · ')}`;
    default:
      return key;
  }
}

export function translationSourceLabel(source: string | null): string {
  if (!source) return '';
  if (source === 'manual') return 'typed by you';
  if (source === 'deepl') return 'DeepL';
  if (source === 'google') return 'Google Translate';
  if (source === 'libretranslate') return 'LibreTranslate';
  if (source === 'legacy') return 'earlier version of the app';
  if (source.startsWith('llm:colab:')) return `Colab · ${source.slice('llm:colab:'.length)}`;
  if (source.startsWith('llm:')) return `LLM · ${source.slice(4)}`;
  if (source === 'llm') return 'language model';
  return source;
}

export const TRANSLATION_SERVICES: { value: TranslationProvider; label: string; ready: (settings: AppSettings) => boolean }[] = [
  { value: 'llm', label: 'Language model', ready: (s) => s.llm.provider !== 'none' },
  { value: 'deepl', label: 'DeepL', ready: (s) => Boolean(s.translation.deepl.apiKey) },
  { value: 'google', label: 'Google Translate', ready: (s) => Boolean(s.translation.google.apiKey) },
  { value: 'libretranslate', label: 'LibreTranslate', ready: (s) => Boolean(s.translation.libretranslate.url) },
];

// Voice services that store audio (on-device voices are not stored).
export const VOICE_SERVICES: { value: Exclude<TtsProvider, 'browser'>; label: string; ready: (settings: AppSettings) => boolean }[] = [
  { value: 'colab', label: 'Google Colab', ready: (s) => Boolean(s.colab.url) },
  { value: 'azure', label: 'Azure Speech', ready: (s) => Boolean(s.tts.azure.apiKey) },
  { value: 'elevenlabs', label: 'ElevenLabs', ready: (s) => Boolean(s.tts.elevenlabs.apiKey) },
  { value: 'google', label: 'Google Cloud', ready: (s) => Boolean(s.tts.google.apiKey) },
  { value: 'openai', label: 'OpenAI-compatible API', ready: (s) => Boolean(s.tts.openai.baseUrl) },
];
