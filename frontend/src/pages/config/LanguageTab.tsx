import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Trash2 } from 'lucide-react';
import { api } from '../../api';
import { useAction, useApp } from '../../state/AppContext';
import { browserVoices } from '../../lib/audio';
import { Field, NumberInput, Section, TextInput, Toggle } from './fields';
import { LANGUAGE_CATALOG, findCatalogLanguage } from '../../../../shared/languages';
import type { LanguageConfig, LanguageSummary } from '../../../../shared/types';

function AddLanguage() {
  const { languages, refreshLanguages, selectLanguage } = useApp();
  const run = useAction();
  const navigate = useNavigate();
  const existing = new Set(languages.map((language) => language.name.toLowerCase()));
  const [choice, setChoice] = useState(
    () => ['Spanish', ...LANGUAGE_CATALOG.map((language) => language.name)].find((name) => !existing.has(name.toLowerCase())) ?? '__other'
  );
  const [custom, setCustom] = useState({ name: '', code: '', locale: '' });
  const catalog = choice === '__other' ? null : findCatalogLanguage(choice);

  async function create() {
    const input = catalog ? { name: catalog.name } : custom;
    const created = await run(() => api.createLanguage(input), `${input.name} added`);
    if (created) {
      await refreshLanguages();
      selectLanguage(created.id);
      navigate('/config/sources');
    }
  }

  return (
    <Section title="Add a language" description="Any language works. Pick one from the list or enter its codes yourself.">
      <div className="form-grid">
        <Field label="Language">
          <select value={choice} onChange={(event) => setChoice(event.target.value)}>
            {LANGUAGE_CATALOG.map((language) => (
              <option key={language.code} value={language.name} disabled={existing.has(language.name.toLowerCase())}>
                {language.name} ({language.code})
              </option>
            ))}
            <option value="__other">Other language…</option>
          </select>
        </Field>
        {!catalog && (
          <>
            <Field label="Name (in English)">
              <TextInput value={custom.name} onChange={(name) => setCustom({ ...custom, name })} placeholder="e.g. Basque" />
            </Field>
            <Field label="ISO 639-1 code" hint="Two letters, used by Gutenberg, Wiktionary and translation APIs">
              <TextInput value={custom.code} onChange={(code) => setCustom({ ...custom, code })} placeholder="eu" />
            </Field>
            <Field label="Locale" hint="BCP-47, used for voices and speech recognition">
              <TextInput value={custom.locale} onChange={(locale) => setCustom({ ...custom, locale })} placeholder="eu-ES" />
            </Field>
          </>
        )}
      </div>
      <button className="button primary" onClick={() => void create()} disabled={!catalog && (!custom.name || !custom.code)}>
        Add language
      </button>
    </Section>
  );
}

function EditLanguage({ language }: { language: LanguageSummary }) {
  const { refreshLanguages, settings } = useApp();
  const run = useAction();
  const [draft, setDraft] = useState<LanguageConfig>(language);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  useEffect(() => setDraft(language), [language.id]);
  useEffect(() => {
    const load = () => setVoices(browserVoices().filter((voice) => voice.lang.toLowerCase().startsWith(language.code.toLowerCase())));
    load();
    if ('speechSynthesis' in window) window.speechSynthesis.addEventListener('voiceschanged', load);
    return () => {
      if ('speechSynthesis' in window) window.speechSynthesis.removeEventListener('voiceschanged', load);
    };
  }, [language.code]);

  const set = <K extends keyof LanguageConfig>(key: K, value: LanguageConfig[K]) => setDraft({ ...draft, [key]: value });

  async function save() {
    const saved = await run(() => api.updateLanguage(language.id, draft), 'Language settings saved');
    if (saved) await refreshLanguages();
  }

  const browserTts = settings?.tts.provider === 'browser';
  return (
    <Section title={`${language.name} settings`}>
      <div className="form-grid">
        <Field label="Name">
          <TextInput value={draft.name} onChange={(value) => set('name', value)} />
        </Field>
        <Field label="ISO 639-1 code">
          <TextInput value={draft.code} onChange={(value) => set('code', value)} />
        </Field>
        <Field label="Locale (voices, speech recognition)">
          <TextInput value={draft.locale} onChange={(value) => set('locale', value)} />
        </Field>
        <Field
          label="Voice"
          hint={browserTts ? 'On-device voices of this computer' : 'Voice name for the selected text-to-speech service (empty = default)'}
        >
          {browserTts ? (
            <select value={draft.ttsVoice} onChange={(event) => set('ttsVoice', event.target.value)}>
              <option value="">Automatic</option>
              {voices.map((voice) => (
                <option key={voice.name} value={voice.name}>
                  {voice.name} ({voice.lang})
                </option>
              ))}
            </select>
          ) : (
            <TextInput value={draft.ttsVoice} onChange={(value) => set('ttsVoice', value)} placeholder="e.g. es-ES-ElviraNeural or alloy" />
          )}
        </Field>
        <Field label="Shortest sentence (words)">
          <NumberInput value={draft.minSentenceWords} min={1} max={50} onChange={(value) => set('minSentenceWords', value)} />
        </Field>
        <Field label="Longest sentence (words)" hint="Applies to books added from now on">
          <NumberInput value={draft.maxSentenceWords} min={2} max={80} onChange={(value) => set('maxSentenceWords', value)} />
        </Field>
        <Field label="Special letters for typing" hint={`Automatic: ${language.autoCharacters.join(' ') || 'none'}`}>
          <TextInput
            value={draft.extraCharacters.join(' ')}
            onChange={(value) => set('extraCharacters', value.split(/\s+/).filter(Boolean))}
            placeholder="Leave empty for automatic"
          />
        </Field>
      </div>
      <div className="row">
        <Toggle checked={draft.detectProperNouns} onChange={(value) => set('detectProperNouns', value)}>
          Skip names automatically (words almost always capitalised mid-sentence)
        </Toggle>
        <Toggle checked={draft.rtl} onChange={(value) => set('rtl', value)}>
          Right-to-left script
        </Toggle>
      </div>
      <button className="button primary" onClick={() => void save()}>
        <Check size={16} /> Save
      </button>
    </Section>
  );
}

export default function LanguageTab() {
  const { languages, language, selectLanguage, refreshLanguages } = useApp();
  const run = useAction();
  return (
    <>
      {languages.length > 0 && (
        <Section title="Your languages" description="Each language has its own words, sentences, audio and progress.">
          <table className="table">
            <thead>
              <tr>
                <th>Language</th>
                <th>Words</th>
                <th>Translated</th>
                <th>Sentences</th>
                <th>Learned</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {languages.map((entry) => (
                <tr key={entry.id} className={entry.id === language?.id ? 'current' : ''}>
                  <td>
                    <button className="link-button" onClick={() => selectLanguage(entry.id)}>
                      {entry.name}
                    </button>{' '}
                    <span className="muted">
                      {entry.code} · {entry.locale}
                    </span>
                  </td>
                  <td>{entry.wordCount.toLocaleString()}</td>
                  <td>{entry.definedWordCount.toLocaleString()}</td>
                  <td>
                    {entry.translatedSentenceCount.toLocaleString()} / {entry.sentenceCount.toLocaleString()}
                  </td>
                  <td>{entry.learnedCount.toLocaleString()}</td>
                  <td>
                    <button
                      className="icon-button danger"
                      title={`Delete ${entry.name}`}
                      onClick={async () => {
                        if (!window.confirm(`Delete ${entry.name} with all its words, sentences, audio and progress? Download a backup first if unsure.`)) return;
                        await run(() => api.deleteLanguage(entry.id), `${entry.name} deleted`);
                        await refreshLanguages();
                      }}
                    >
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}
      {language && <EditLanguage key={language.id} language={language} />}
      <AddLanguage />
    </>
  );
}
