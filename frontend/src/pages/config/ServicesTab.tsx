import { useState, type ReactNode } from 'react';
import { BookA, Bot, Download, Languages, Mic, Rocket, ScrollText, Upload, Volume2, Zap } from 'lucide-react';
import { api } from '../../api';
import { useAction, useApp } from '../../state/AppContext';
import { browserRecognitionAvailable } from '../../lib/speech';
import JobsPanel from '../../components/JobsPanel';
import { Field, NumberInput, Section, TextInput, Toggle, useSettingsDraft } from './fields';
import type { AppSettings, JobInfo, LanguageSummary } from '../../../../shared/types';

const NOTEBOOK_PATH = 'ipynb/LangColabServer.ipynb';

function TestButton({ service, langId }: { service: 'llm' | 'tts' | 'translation'; langId?: string }) {
  const run = useAction();
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <span className="test">
      <button
        className="button small"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setResult(null);
          const response = await run(() => api.testService(service, langId));
          setBusy(false);
          setResult(response ? response.message : 'Failed — see the error message');
        }}
      >
        <Zap size={14} /> {busy ? 'Testing…' : 'Test'}
      </button>
      {result && <span className="muted"> {result}</span>}
    </span>
  );
}

function JobButton({ label, icon, start, disabled }: { label: string; icon?: ReactNode; start: () => Promise<JobInfo | null>; disabled?: boolean }) {
  const { trackJob } = useApp();
  const run = useAction();
  return (
    <button className="button" disabled={disabled} onClick={async () => trackJob(await run(start))}>
      {icon} {label}
    </button>
  );
}

// How many words still wait for a definition (updates while jobs run).
function UndefinedCount({ language }: { language: LanguageSummary }) {
  const missing = language.wordCount - language.definedWordCount;
  return (
    <p className={missing > 0 ? 'undefined-count' : 'muted'}>
      {missing > 0 ? (
        <>
          <strong>{missing.toLocaleString()}</strong> of {language.wordCount.toLocaleString()} words have no definition yet.
        </>
      ) : (
        `All ${language.wordCount.toLocaleString()} words have a definition.`
      )}
    </p>
  );
}

function ColabFiles({ language }: { language: LanguageSummary }) {
  const run = useAction();
  const { refreshLanguages, notify } = useApp();
  const [limit, setLimit] = useState(500);
  return (
    <details>
      <summary>Offline batches (no tunnel): download a job file, run it in the notebook, upload the results</summary>
      <p className="muted">
        The notebook saves results to Google Drive after every batch and downloads a part file every 1,000 results, so a
        disconnect loses at most the batch in progress: <em>Runtime → Run all</em> again continues where it stopped. Upload all
        the part files at once here.
      </p>
      <div className="row">
        <Field label="Items per file">
          <NumberInput value={limit} min={1} max={100000} onChange={setLimit} />
        </Field>
        <a className="button" href={api.colabJobUrl(language.id, 'definitions', limit)}>
          <Download size={14} /> Definitions job
        </a>
        <a className="button" href={api.colabJobUrl(language.id, 'translations', limit)}>
          <Download size={14} /> Sentence translation job
        </a>
        <label className="button">
          <Upload size={14} /> Upload results
          <input
            type="file"
            accept=".json"
            multiple
            hidden
            onChange={async (event) => {
              // Part files from an interrupted run can be uploaded together.
              const selected = Array.from(event.target.files ?? []);
              event.target.value = '';
              let saved = 0;
              for (const file of selected) {
                const result = await run(async () => api.colabResults(language.id, JSON.parse(await file.text())));
                if (result) saved += result.saved;
              }
              if (selected.length) {
                await refreshLanguages();
                notify(`Saved ${saved.toLocaleString()} results from ${selected.length} file${selected.length === 1 ? '' : 's'}`, 'success');
              }
            }}
          />
        </label>
      </div>
    </details>
  );
}

function LlmFields({ draft, update }: { draft: AppSettings; update: (mutate: (draft: AppSettings) => void) => void }) {
  const provider = draft.llm.provider;
  return (
    <>
      <div className="form-grid">
        <Field label="Provider">
          <select value={provider} onChange={(event) => update((s) => void (s.llm.provider = event.target.value as AppSettings['llm']['provider']))}>
            <option value="none">None</option>
            <option value="colab">Open-source model in Google Colab (free)</option>
            <option value="openai">OpenAI-compatible API (OpenAI, OpenRouter, Groq, local Ollama…)</option>
            <option value="anthropic">Anthropic Claude API</option>
          </select>
        </Field>
        {provider === 'openai' && (
          <>
            <Field label="Base URL">
              <TextInput value={draft.llm.openai.baseUrl} onChange={(value) => update((s) => void (s.llm.openai.baseUrl = value))} />
            </Field>
            <Field label="API key">
              <TextInput type="password" value={draft.llm.openai.apiKey} onChange={(value) => update((s) => void (s.llm.openai.apiKey = value))} />
            </Field>
            <Field label="Model">
              <TextInput value={draft.llm.openai.model} onChange={(value) => update((s) => void (s.llm.openai.model = value))} />
            </Field>
          </>
        )}
        {provider === 'anthropic' && (
          <>
            <Field label="API key">
              <TextInput type="password" value={draft.llm.anthropic.apiKey} onChange={(value) => update((s) => void (s.llm.anthropic.apiKey = value))} />
            </Field>
            <Field label="Model" hint="claude-haiku-5-5 is cheaper for large batches">
              <TextInput value={draft.llm.anthropic.model} onChange={(value) => update((s) => void (s.llm.anthropic.model = value))} />
            </Field>
          </>
        )}
        {provider === 'colab' && <p className="muted">Uses the Colab URL and model above.</p>}
      </div>
      {provider !== 'none' && <TestButton service="llm" />}
    </>
  );
}

export default function ServicesTab() {
  const { language } = useApp();
  const [draft, update] = useSettingsDraft();
  const [counts, setCounts] = useState({ definitions: 300, translations: 300, generate: 100, minSentences: 3, audioWords: 300, audioSentences: 200, autopilot: 500 });
  if (!draft) return null;
  const langId = language?.id;
  const llmReady = draft.llm.provider !== 'none';

  return (
    <>
      <Section
        title="Autopilot"
        description="Takes the next most frequent words that have no definition yet and prepares them in one go: definitions and pronunciation, sentence translations, extra example sentences and audio — using whichever services are configured below. Run it again for the next batch. Personal progress also prepares each new block automatically in the background."
      >
        {language ? (
          <>
            <UndefinedCount language={language} />
            <div className="row">
              <Field label="Words">
                <NumberInput value={counts.autopilot} min={7} max={50000} onChange={(value) => setCounts({ ...counts, autopilot: value })} />
              </Field>
              <JobButton
                icon={<Rocket size={16} />}
                label={`Prepare the next ${counts.autopilot} words without a definition`}
                start={() => api.autopilot(language.id, counts.autopilot)}
              />
            </div>
          </>
        ) : (
          <p className="muted">Add a language first.</p>
        )}
        <JobsPanel langId={langId} types={['autopilot', 'prepare', 'definitions', 'translations', 'generate', 'audio']} />
      </Section>

      <Section
        title="Google Colab (free open-source models)"
        description={
          <>
            Open <code>{NOTEBOOK_PATH}</code> from this project in Google Colab (File → Upload notebook), choose a GPU runtime and run all
            cells. It starts an open-source LLM (Ollama), Whisper speech recognition and neural voices behind one public URL. Paste that URL
            here and select “Google Colab” for any service below.
          </>
        }
      >
        <div className="form-grid">
          <Field label="Colab URL" hint="Printed by the last cell, e.g. https://something.trycloudflare.com">
            <TextInput value={draft.colab.url} onChange={(value) => update((s) => void (s.colab.url = value.trim()))} placeholder="https://….trycloudflare.com" />
          </Field>
          <Field label="Model" hint="Must match MODEL in the notebook (qwen2.5:7b translates well)">
            <TextInput value={draft.colab.model} onChange={(value) => update((s) => void (s.colab.model = value.trim()))} />
          </Field>
        </div>
        {language && <ColabFiles language={language} />}
      </Section>

      <Section title="Language model (LLM)" description="Used for definitions, sentence translation, example sentences and (optionally) grading translations.">
        <LlmFields draft={draft} update={update} />
      </Section>

      <Section title="Definitions & pronunciation" description="English translations (several per word, so answers are forgiving), part of speech and IPA pronunciation for every word.">
        <div className="form-grid">
          <Field label="Source">
            <select value={draft.definitions.provider} onChange={(event) => update((s) => void (s.definitions.provider = event.target.value as AppSettings['definitions']['provider']))}>
              <option value="wiktionary">Wiktionary (free, no key)</option>
              <option value="llm">Language model (best for inflected forms)</option>
            </select>
          </Field>
          <Field label="Words per LLM request">
            <NumberInput value={draft.definitions.batchSize} min={5} max={200} onChange={(value) => update((s) => void (s.definitions.batchSize = value))} />
          </Field>
        </div>
        {language && <UndefinedCount language={language} />}
        {language && (
          <div className="row">
            <Field label="Next words">
              <NumberInput value={counts.definitions} min={1} max={50000} onChange={(value) => setCounts({ ...counts, definitions: value })} />
            </Field>
            <JobButton
              icon={<BookA size={16} />}
              label={`Fetch definitions for the next ${counts.definitions} words without one`}
              start={() => api.fetchDefinitions(language.id, counts.definitions)}
              disabled={draft.definitions.provider === 'llm' && !llmReady}
            />
          </div>
        )}
      </Section>

      <Section title="Sentence translation" description="Sentences are translated in batches, easiest first, and saved to the sentence database.">
        <div className="form-grid">
          <Field label="Service">
            <select value={draft.translation.provider} onChange={(event) => update((s) => void (s.translation.provider = event.target.value as AppSettings['translation']['provider']))}>
              <option value="llm">Language model (Colab or API, see above)</option>
              <option value="deepl">DeepL API</option>
              <option value="google">Google Cloud Translation API</option>
              <option value="libretranslate">LibreTranslate</option>
            </select>
          </Field>
          {draft.translation.provider === 'llm' && (
            <Field label="Sentences per request">
              <NumberInput value={draft.translation.batchSize} min={1} max={100} onChange={(value) => update((s) => void (s.translation.batchSize = value))} />
            </Field>
          )}
          {draft.translation.provider === 'deepl' && (
            <Field label="DeepL API key" hint="Free keys end in :fx">
              <TextInput type="password" value={draft.translation.deepl.apiKey} onChange={(value) => update((s) => void (s.translation.deepl.apiKey = value))} />
            </Field>
          )}
          {draft.translation.provider === 'google' && (
            <Field label="Google API key">
              <TextInput type="password" value={draft.translation.google.apiKey} onChange={(value) => update((s) => void (s.translation.google.apiKey = value))} />
            </Field>
          )}
          {draft.translation.provider === 'libretranslate' && (
            <>
              <Field label="LibreTranslate URL">
                <TextInput value={draft.translation.libretranslate.url} onChange={(value) => update((s) => void (s.translation.libretranslate.url = value))} />
              </Field>
              <Field label="API key (if required)">
                <TextInput type="password" value={draft.translation.libretranslate.apiKey} onChange={(value) => update((s) => void (s.translation.libretranslate.apiKey = value))} />
              </Field>
            </>
          )}
        </div>
        {language && (
          <div className="row">
            <TestButton service="translation" langId={language.id} />
            <Field label="Next sentences">
              <NumberInput value={counts.translations} min={1} max={100000} onChange={(value) => setCounts({ ...counts, translations: value })} />
            </Field>
            <JobButton icon={<Languages size={16} />} label={`Translate the next ${counts.translations} sentences`} start={() => api.translateSentences(language.id, counts.translations)} />
          </div>
        )}
      </Section>

      <Section title="Example sentences" description="Asks the language model for short sentences built from common words, for words that appear in too few translated sentences.">
        {language && (
          <div className="row">
            <Field label="Words">
              <NumberInput value={counts.generate} min={1} max={5000} onChange={(value) => setCounts({ ...counts, generate: value })} />
            </Field>
            <Field label="with fewer than … sentences">
              <NumberInput value={counts.minSentences} min={1} max={20} onChange={(value) => setCounts({ ...counts, minSentences: value })} />
            </Field>
            <JobButton
              icon={<ScrollText size={16} />}
              label="Generate sentences"
              disabled={!llmReady}
              start={() => api.generateSentences(language.id, counts.generate, counts.minSentences)}
            />
          </div>
        )}
      </Section>

      <Section title="Text to speech" description="Audio for words and sentences. Generated audio is stored in the database and reused.">
        <div className="form-grid">
          <Field label="Voice service">
            <select value={draft.tts.provider} onChange={(event) => update((s) => void (s.tts.provider = event.target.value as AppSettings['tts']['provider']))}>
              <option value="browser">On this device (browser voices)</option>
              <option value="colab">Google Colab (Microsoft neural voices)</option>
              <option value="openai">OpenAI-compatible speech API</option>
              <option value="google">Google Cloud Text-to-Speech</option>
            </select>
          </Field>
          {draft.tts.provider === 'openai' && (
            <>
              <Field label="Base URL">
                <TextInput value={draft.tts.openai.baseUrl} onChange={(value) => update((s) => void (s.tts.openai.baseUrl = value))} />
              </Field>
              <Field label="API key">
                <TextInput type="password" value={draft.tts.openai.apiKey} onChange={(value) => update((s) => void (s.tts.openai.apiKey = value))} />
              </Field>
              <Field label="Model">
                <TextInput value={draft.tts.openai.model} onChange={(value) => update((s) => void (s.tts.openai.model = value))} />
              </Field>
              <Field label="Default voice">
                <TextInput value={draft.tts.openai.voice} onChange={(value) => update((s) => void (s.tts.openai.voice = value))} />
              </Field>
            </>
          )}
          {draft.tts.provider === 'google' && (
            <Field label="Google API key">
              <TextInput type="password" value={draft.tts.google.apiKey} onChange={(value) => update((s) => void (s.tts.google.apiKey = value))} />
            </Field>
          )}
          <Field label="English voice" hint="Browser voice name or service voice (empty = automatic)">
            <TextInput value={draft.tts.englishVoice} onChange={(value) => update((s) => void (s.tts.englishVoice = value))} />
          </Field>
          <Field label="Speed">
            <NumberInput value={draft.tts.rate} min={0.5} max={1.5} step={0.05} onChange={(value) => update((s) => void (s.tts.rate = value))} />
          </Field>
        </div>
        <p className="muted">Each language's voice is set in the Language tab.</p>
        {language && draft.tts.provider !== 'browser' && (
          <div className="row">
            <TestButton service="tts" langId={language.id} />
            <Field label="Words">
              <NumberInput value={counts.audioWords} min={0} max={50000} onChange={(value) => setCounts({ ...counts, audioWords: value })} />
            </Field>
            <Field label="Sentences">
              <NumberInput value={counts.audioSentences} min={0} max={50000} onChange={(value) => setCounts({ ...counts, audioSentences: value })} />
            </Field>
            <JobButton icon={<Volume2 size={16} />} label="Pre-generate audio" start={() => api.generateAudio(language.id, counts.audioWords, counts.audioSentences)} />
          </div>
        )}
      </Section>

      <Section title="Speech recognition" description="Used by the speaking minigames. Answers are compared with a closeness score, so small recognition errors are forgiven.">
        <div className="form-grid">
          <Field label="Service">
            <select value={draft.stt.provider} onChange={(event) => update((s) => void (s.stt.provider = event.target.value as AppSettings['stt']['provider']))}>
              <option value="browser">Browser (Chrome / Edge)</option>
              <option value="colab">Google Colab (Whisper)</option>
              <option value="openai">Whisper-compatible API (OpenAI, Groq…)</option>
            </select>
          </Field>
          {draft.stt.provider === 'openai' && (
            <>
              <Field label="Base URL">
                <TextInput value={draft.stt.openai.baseUrl} onChange={(value) => update((s) => void (s.stt.openai.baseUrl = value))} />
              </Field>
              <Field label="API key">
                <TextInput type="password" value={draft.stt.openai.apiKey} onChange={(value) => update((s) => void (s.stt.openai.apiKey = value))} />
              </Field>
              <Field label="Model">
                <TextInput value={draft.stt.openai.model} onChange={(value) => update((s) => void (s.stt.openai.model = value))} />
              </Field>
            </>
          )}
        </div>
        {draft.stt.provider === 'browser' && !browserRecognitionAvailable() && (
          <p className="banner warning">
            <Mic size={14} /> Speech recognition is not available in this window. Use Colab or an API, or open http://localhost:3000 in Chrome.
          </p>
        )}
      </Section>

      <Section title="Grading" description="Translations are checked word by word. Optionally ask the language model when a translation looks wrong — it accepts correct answers with different wording.">
        <Toggle checked={draft.learning.llmJudge} onChange={(value) => update((s) => void (s.learning.llmJudge = value))}>
          <Bot size={14} /> Let the LLM double-check rejected sentence translations
        </Toggle>
      </Section>
    </>
  );
}
