import { useEffect, useState } from 'react';
import { Languages, Mic, RefreshCw, Trash2, Volume2 } from 'lucide-react';
import { api } from '../../api';
import { useAction, useApp } from '../../state/AppContext';
import { useDebounced } from '../../lib/hooks';
import { playText } from '../../lib/audio';
import { TRANSLATION_SERVICES, VOICE_SERVICES, translationSourceLabel, voiceLabel } from '../../lib/sourceLabels';
import { EXCLUSION_LABELS } from '../../components/minigame/ReportMenu';
import { voiceFor } from '../../components/minigame/PromptView';
import JobsPanel from '../../components/JobsPanel';
import Recordings from '../../components/Recordings';
import { Pager } from './WordsTab';
import { Field, Section, TextInput } from './fields';
import type { LanguageSummary, Paged, SentenceExclusion, SentenceRow, TranslationProvider, TtsProvider } from '../../../../shared/types';

const REASONS = Object.keys(EXCLUSION_LABELS) as SentenceExclusion[];

// All translations of a sentence, separated by semicolons (the first is the
// main one). Each keeps its source; new or edited ones are "typed by you".
function TranslationCell({ langId, sentence, onSaved }: { langId: string; sentence: SentenceRow; onSaved: () => void }) {
  const run = useAction();
  const joined = sentence.translations.map((translation) => translation.english).join('; ');
  const [value, setValue] = useState(joined);
  useEffect(() => setValue(joined), [joined]);
  return (
    <>
      <textarea
        rows={1}
        value={value}
        placeholder="Add a translation (several: separate them with ;)"
        title="Several translations: separate them with semicolons. The first one is shown in questions."
        onChange={(event) => setValue(event.target.value)}
        onBlur={async () => {
          if (joined === value.trim()) return;
          const ok = await run(() => api.updateSentence(langId, sentence.id, value.trim() || null));
          if (ok) onSaved();
        }}
      />
      {sentence.translations.length > 0 && (
        <div className="origin muted">
          {sentence.translations.map((translation, index) => (
            <span key={translation.id} className="sourced" title={translation.english}>
              {sentence.translations.length > 1 ? `${index + 1}: ` : 'Translation: '}
              {translationSourceLabel(translation.source)}
            </span>
          ))}
        </div>
      )}
    </>
  );
}

// Services chosen for fixing sentences (shared by the bulk and per-sentence buttons).
interface FixOptions {
  translator: TranslationProvider;
  voiceService: Exclude<TtsProvider, 'browser'>;
  voice: string;
}

function ReportedSentences({
  language,
  options,
  setOptions,
  refreshKey,
}: {
  language: LanguageSummary;
  options: FixOptions;
  setOptions: (options: FixOptions) => void;
  refreshKey: string;
}) {
  const { settings, trackJob } = useApp();
  const run = useAction();
  const [counts, setCounts] = useState<Record<SentenceExclusion, number> | null>(null);

  useEffect(() => {
    Promise.all(REASONS.map((reason) => api.sentences(language.id, { offset: 0, limit: 1, filter: reason }).then((page) => [reason, page.total] as const)))
      .then((entries) => setCounts(Object.fromEntries(entries) as Record<SentenceExclusion, number>))
      .catch(() => undefined);
  }, [language.id, refreshKey]);

  if (!settings) return null;
  const configuredVoice = VOICE_SERVICES.find((service) => service.value === settings.tts.provider);

  return (
    <Section
      title="Reported sentences"
      description="Sentences excluded during practice (Exclude, next to the minigame name) are left out of the questions. Fix them here: these jobs only redo the reported sentences — translating new sentences and generating missing audio are in Configuration → Services."
    >
      <div className="reported-grid">
        <div className="reported-card">
          <h3>
            {EXCLUSION_LABELS.translation}: {counts?.translation ?? '…'}
          </h3>
          <p className="muted">Translates them again (a language model is told which translation was wrong). Sentences that come back with the same translation stay excluded.</p>
          <div className="row">
            <Field label="Translate with">
              <select value={options.translator} onChange={(event) => setOptions({ ...options, translator: event.target.value as TranslationProvider })}>
                {TRANSLATION_SERVICES.map((service) => (
                  <option key={service.value} value={service.value} disabled={!service.ready(settings)}>
                    {service.label}
                    {service.ready(settings) ? '' : ' (not set up)'}
                  </option>
                ))}
              </select>
            </Field>
            <button
              className="button primary"
              disabled={!counts?.translation}
              onClick={async () => trackJob(await run(() => api.retranslateSentences(language.id, { provider: options.translator })))}
            >
              <Languages size={16} /> Translate them again
            </button>
          </div>
        </div>
        <div className="reported-card">
          <h3>
            {EXCLUSION_LABELS.audio}: {counts?.audio ?? '…'}
          </h3>
          <p className="muted">
            Replaces their recordings (and the English one, if any). The same service and voice usually give the same result, so another voice or
            service is often better.
          </p>
          <div className="row">
            <Field label="Voice service">
              <select
                value={options.voiceService}
                onChange={(event) => setOptions({ ...options, voiceService: event.target.value as FixOptions['voiceService'] })}
              >
                {VOICE_SERVICES.map((service) => (
                  <option key={service.value} value={service.value} disabled={!service.ready(settings)}>
                    {service.label}
                    {service.value === configuredVoice?.value ? ' (current)' : ''}
                    {service.ready(settings) ? '' : ' (not set up)'}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Voice" hint={options.voiceService === settings.tts.provider ? `Empty: ${language.ttsVoice || 'default voice'}` : 'Empty: the service’s default voice'}>
              <TextInput value={options.voice} onChange={(voice) => setOptions({ ...options, voice })} placeholder="e.g. es-ES-AlvaroNeural" />
            </Field>
            <button
              className="button primary"
              disabled={!counts?.audio}
              onClick={async () =>
                trackJob(await run(() => api.regenerateSentenceAudio(language.id, { provider: options.voiceService, voice: options.voice || undefined })))
              }
            >
              <RefreshCw size={16} /> Regenerate their audio
            </button>
          </div>
        </div>
        <div className="reported-card">
          <h3>
            {EXCLUSION_LABELS.nonsense}: {counts?.nonsense ?? '…'} · {EXCLUSION_LABELS.other}: {counts?.other ?? '…'}
          </h3>
          <p className="muted">Correct the text or translation by hand and put them back, or delete them. Filter the list below by reason.</p>
        </div>
      </div>
      <JobsPanel langId={language.id} types={['fix-']} />
    </Section>
  );
}

export default function SentencesTab({ language }: { language: LanguageSummary }) {
  const { settings, jobs, trackJob, refreshLanguages } = useApp();
  const run = useAction();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<Paged<SentenceRow>>({ rows: [], total: 0 });
  const [changes, setChanges] = useState(0);
  // The configured services, or the first one that is set up.
  const [options, setOptions] = useState<FixOptions>(() => ({
    translator: settings?.translation.provider ?? 'llm',
    voiceService:
      (settings &&
        (VOICE_SERVICES.find((service) => service.value === settings.tts.provider && service.ready(settings)) ??
          VOICE_SERVICES.find((service) => service.ready(settings)))?.value) ||
      'colab',
    voice: '',
  }));
  const q = useDebounced(query, 250);
  // Reload when a fixing job finishes.
  const fixing = jobs.filter((job) => job.langId === language.id && job.type.startsWith('fix-') && job.status === 'running').length;

  useEffect(() => {
    api
      .sentences(language.id, { offset, limit: 50, q, filter })
      .then(setData)
      .catch(() => undefined);
  }, [language.id, offset, q, filter, fixing, changes]);
  useEffect(() => setOffset(0), [q, filter]);

  const [open, setOpen] = useState<Set<number>>(new Set());
  const toggle = (id: number) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const updateRow = (id: number, patch: Partial<SentenceRow>) =>
    setData((current) => ({ ...current, rows: current.rows.map((row) => (row.id === id ? { ...row, ...patch } : row)) }));
  const voice = settings ? voiceFor('foreign', language, settings) : null;

  async function setStatus(sentence: SentenceRow, value: string) {
    const reason = (value || null) as SentenceExclusion | null;
    const ok = await run(() => (reason ? api.excludeSentence(language.id, sentence.id, reason) : api.restoreSentence(language.id, sentence.id)));
    if (!ok) return;
    updateRow(sentence.id, { excludedReason: reason, excludedAt: reason ? Date.now() : null });
    setChanges((n) => n + 1);
    await refreshLanguages();
  }

  return (
    <>
      <ReportedSentences language={language} options={options} setOptions={setOptions} refreshKey={`${changes}:${fixing}`} />
      <div className="card">
        <p className="muted">
          Sentences are ordered by difficulty: the rank of their rarest word. Edit a translation by clicking on it. Under each sentence: where its
          audio and translation came from.
        </p>
        <div className="toolbar">
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search sentences" />
          <select value={filter} onChange={(event) => setFilter(event.target.value)}>
            <option value="all">All</option>
            <option value="untranslated">Not translated</option>
            <option value="translated">Translated</option>
            <option value="excluded">Excluded (any reason)</option>
            {REASONS.map((reason) => (
              <option key={reason} value={reason}>
                Excluded: {EXCLUSION_LABELS[reason].toLowerCase()}
              </option>
            ))}
          </select>
          <span className="muted">{data.total.toLocaleString()} sentences</span>
        </div>
        <table className="table sentences">
          <thead>
            <tr>
              <th>Difficulty</th>
              <th>{language.name}</th>
              <th>English</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.rows.map((sentence) => (
              <tr key={sentence.id} className={sentence.excludedReason ? 'excluded' : ''}>
                <td>{sentence.maxRank ?? '—'}</td>
                <td>
                  <div className="sentence-text" lang={language.code} dir={language.rtl ? 'rtl' : 'ltr'}>
                    <button
                      className="icon-button"
                      title="Listen"
                      onClick={() => voice && void playText(voice.target, sentence.text, voice.options)}
                    >
                      <Volume2 size={14} />
                    </button>
                    {sentence.text}
                  </div>
                  <div className="origin muted">
                    From: {sentence.sourceTitle ?? 'unknown'} · Audio:{' '}
                    {sentence.audio.length
                      ? sentence.audio.map((recording) => voiceLabel(recording.voice)).join(', ')
                      : settings?.tts.provider === 'browser'
                        ? 'voice of this device (not stored)'
                        : 'not generated yet'}
                  </div>
                  {open.has(sentence.id) && (
                    <div className="sentence-details">
                      <div>
                        <span className="muted">Recordings of the sentence</span>
                        <Recordings target={language.id} text={sentence.text} initial={sentence.audio} />
                      </div>
                      {sentence.english && (
                        <div>
                          <span className="muted">Recordings of the translation “{sentence.english}”</span>
                          <Recordings target="english" text={sentence.english} initial={sentence.englishAudio} />
                        </div>
                      )}
                    </div>
                  )}
                </td>
                <td>
                  <TranslationCell langId={language.id} sentence={sentence} onSaved={() => setChanges((n) => n + 1)} />
                </td>
                <td>
                  <select className={sentence.excludedReason ? 'status-excluded' : ''} value={sentence.excludedReason ?? ''} onChange={(event) => void setStatus(sentence, event.target.value)}>
                    <option value="">In use</option>
                    {REASONS.map((reason) => (
                      <option key={reason} value={reason}>
                        Excluded: {EXCLUSION_LABELS[reason].toLowerCase()}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="actions">
                  <button
                    className={`icon-button ${open.has(sentence.id) ? 'active' : ''}`}
                    title="Recordings and their sources"
                    onClick={() => toggle(sentence.id)}
                  >
                    <Mic size={14} />
                  </button>
                  <button
                    className="icon-button"
                    title="Translate again (keeps the current translation as another one)"
                    onClick={async () => trackJob(await run(() => api.retranslateSentences(language.id, { ids: [sentence.id], provider: options.translator })))}
                  >
                    <Languages size={14} />
                  </button>
                  <button
                    className="icon-button"
                    title="Regenerate the audio"
                    onClick={async () =>
                      trackJob(
                        await run(() =>
                          api.regenerateSentenceAudio(language.id, { ids: [sentence.id], provider: options.voiceService, voice: options.voice || undefined })
                        )
                      )
                    }
                  >
                    <RefreshCw size={14} />
                  </button>
                  <button
                    className="icon-button danger"
                    title="Delete sentence"
                    onClick={async () => {
                      const ok = await run(() => api.deleteSentence(language.id, sentence.id));
                      if (ok) setData((current) => ({ rows: current.rows.filter((row) => row.id !== sentence.id), total: current.total - 1 }));
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <Pager offset={offset} total={data.total} onChange={setOffset} />
      </div>
    </>
  );
}
