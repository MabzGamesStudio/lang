import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Download, ExternalLink, Loader2, Play, Plus, RotateCcw, Trash2, Volume2, X } from 'lucide-react';
import { api, errorMessage } from '../api';
import { useApp } from '../state/AppContext';
import { useStoredState } from '../lib/hooks';
import { clearAudioCache, playIpa, playRecording } from '../lib/audio';
import { ipaRecordingLabel, VOICE_SERVICES } from '../lib/sourceLabels';
import LevelDots from '../components/LevelDots';
import JobsPanel from '../components/JobsPanel';
import IpaGameIcons from '../components/ipa/IpaGameIcons';
import { soundRef } from '../components/ipa/IpaFeedback';
import { PHASES, PHASE_LABELS, type Phase } from '../../../shared/games';
import { EXAMPLE_LOCALES } from '../../../shared/ipa/inventory';
import { IPA_GAMES, type IpaRecording, type IpaSoundSet, type IpaSoundSummary, type IpaSummary } from '../../../shared/ipa/games';
import type { TtsProvider } from '../../../shared/types';

export const IPA_PHASE_DESCRIPTIONS: Record<Phase, string> = {
  recognition: 'Pick the sound, symbol or transcription.',
  recall: 'Type the symbol of a sound.',
  recite: 'Write down whole words in IPA.',
  translate: 'From spelling to IPA and back.',
};

// The stored recordings of a sound or word, each with where it came from
// (Commons file with its licence and author, or a voice service).
function RecordingList({ recordings, onDelete }: { recordings: IpaRecording[]; onDelete: (id: number) => void }) {
  return (
    <>
      {recordings.map((recording) => (
        <span key={recording.id} className="recording" title={`Added ${new Date(recording.createdAt).toLocaleString()}`}>
          <button type="button" className="icon-button" title="Play this recording" onClick={() => playRecording(api.ipaRecordingUrl(recording.id))}>
            <Play size={12} />
          </button>
          <span>
            {ipaRecordingLabel(recording.source)}
            {recording.license && <span className="muted"> · {recording.license}</span>}
            {recording.author && <span className="muted"> · {recording.author}</span>}
          </span>
          {recording.url && (
            <a href={recording.url} target="_blank" rel="noreferrer" title="File page (licence and author)">
              <ExternalLink size={12} />
            </a>
          )}
          <button type="button" className="icon-button danger" title="Delete this recording" onClick={() => onDelete(recording.id)}>
            <Trash2 size={12} />
          </button>
        </span>
      ))}
    </>
  );
}

function SoundDetails({ sound, onChanged, onClose }: { sound: IpaSoundSummary; onChanged: () => void; onClose: () => void }) {
  const { settings, notify } = useApp();
  const [service, setService] = useState<Exclude<TtsProvider, 'browser'> | ''>('');
  const [busy, setBusy] = useState<string | null>(null);
  const ready = settings ? VOICE_SERVICES.filter((option) => option.ready(settings)) : [];
  const chosen = service || ready.find((option) => option.value === settings?.tts.provider)?.value || ready[0]?.value;
  const rate = settings?.tts.rate || 1;

  const remove = async (id: number) => {
    try {
      await api.deleteIpaRecording(id);
      clearAudioCache();
      onChanged();
    } catch (err) {
      notify(errorMessage(err), 'error');
    }
  };
  const add = async (lang: string, word: string) => {
    if (!chosen) return;
    setBusy(`${lang}:${word}`);
    try {
      await api.addIpaRecording(lang, word, chosen);
      clearAudioCache();
      onChanged();
    } catch (err) {
      notify(errorMessage(err), 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="card sound-details side-ipa">
      <header>
        <button className="icon-button" title="Listen to the sound" onClick={async () => !(await playIpa(soundRef(sound.symbol), rate)) && notify('No recording of this sound yet.', 'info')}>
          <Volume2 size={20} />
        </button>
        <span className="ipa big">{sound.symbol}</span>
        <div>
          <strong>{sound.name}</strong>
          <div className="muted">
            {sound.kind === 'vowel' ? 'Vowel' : 'Consonant'} · {sound.english ? 'heard in English' : 'not in English: examples from other languages'}
          </div>
        </div>
        <LevelDots levels={sound.levels} />
        <span className="muted">
          {sound.correct} right · {sound.wrong} wrong
        </span>
        <button className="icon-button" title="Close" onClick={onClose}>
          <X size={16} />
        </button>
      </header>
      <div className="recordings">
        <span className="muted">The sound on its own:</span>
        {sound.recordings.length > 0 ? (
          <RecordingList recordings={sound.recordings} onDelete={(id) => void remove(id)} />
        ) : (
          <span className="muted">
            {sound.file ? `not downloaded yet (Wikimedia Commons: ${sound.file})` : 'no recording of it alone — hear it in the example words'}
          </span>
        )}
      </div>
      <ul className="sound-examples">
        {sound.examples.map((example) => (
          <li key={`${example.lang}:${example.word}`} className={example.lang === 'en' || example.lang === 'en-GB' ? 'side-english' : 'side-foreign'}>
            <button
              className="icon-button"
              title="Listen"
              onClick={() => void playIpa({ kind: 'example', text: example.word, lang: example.lang, locale: EXAMPLE_LOCALES[example.lang] ?? example.lang }, rate)}
            >
              <Volume2 size={16} />
            </button>
            <strong lang={example.lang}>{example.word}</strong>
            <span className="ipa">/{example.ipa}/</span>
            <span className="muted">
              {example.langName}
              {example.gloss ? ` · “${example.gloss}”` : ''}
            </span>
            <div className="recordings">
              {example.recordings.length > 0 ? (
                <RecordingList recordings={example.recordings} onDelete={(id) => void remove(id)} />
              ) : (
                <span className="muted">{settings?.tts.provider === 'browser' ? 'no recording: spoken by this device' : 'no recording yet: made by your voice service when played'}</span>
              )}
              {ready.length > 0 && (
                <span className="recording-add">
                  <select value={chosen} onChange={(event) => setService(event.target.value as Exclude<TtsProvider, 'browser'>)} title="Voice service for a new recording">
                    {ready.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="icon-button"
                    title="Add a recording with this voice service"
                    disabled={busy !== null}
                    onClick={() => void add(example.lang, example.word)}
                  >
                    {busy === `${example.lang}:${example.word}` ? <Loader2 size={12} className="spin" /> : <Plus size={12} />}
                  </button>
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// The pronunciation mode: the sounds of the IPA, games in four phases, and
// where every recording comes from.
export default function PronunciationPage() {
  const { settings, jobs, trackJob, notify } = useApp();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [summary, setSummary] = useState<IpaSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sounds, setSounds] = useStoredState<IpaSoundSet>('lang.ipa.sounds', 'english');
  const [words, setWords] = useStoredState<string>('lang.ipa.words', 'examples');
  const selected = params.get('sound');

  const reload = useCallback(() => {
    api
      .ipaSummary()
      .then((result) => {
        setSummary(result);
        setError(null);
      })
      .catch((err) => setError(errorMessage(err)));
  }, []);
  useEffect(reload, [reload]);

  // Reload when a download finishes.
  const downloading = jobs.some((job) => job.type === 'ipa-download' && job.status === 'running');
  const wasDownloading = useRef(false);
  useEffect(() => {
    if (wasDownloading.current && !downloading) reload();
    wasDownloading.current = downloading;
  }, [downloading, reload]);

  // A language chosen for the words that has gone (or has no IPA words) falls back to the examples.
  useEffect(() => {
    if (summary && words !== 'examples' && !summary.languages.some((language) => language.id === words)) setWords('examples');
  }, [summary, words]);

  if (error) {
    return (
      <div className="page narrow">
        <div className="banner error">{error}</div>
      </div>
    );
  }
  if (!summary || !settings) {
    return (
      <div className="page narrow">
        <Loader2 className="spin" />
      </div>
    );
  }

  const inSet = summary.sounds.filter((sound) => sounds === 'all' || sound.english);
  const mastered = (phase: Phase) => inSet.filter((sound) => sound.levels[phase] >= summary.required[phase]).length;
  const select = (symbol: string | null) => {
    const next = new URLSearchParams(params);
    if (symbol) next.set('sound', symbol);
    else next.delete('sound');
    setParams(next, { replace: true });
  };
  const current = summary.sounds.find((sound) => sound.symbol === selected) ?? null;
  const rate = settings.tts.rate || 1;
  const { download } = summary;

  return (
    <div className="page pronunciation">
      <header className="menu-header">
        <h1 className="page-title">Pronunciation (IPA)</h1>
      </header>
      <p className="muted intro">
        Learn the sounds of the International Phonetic Alphabet: hear each sound, link it to its symbol, and read and write words in IPA.
        English sounds come first; sounds English does not have are taught with words of other languages.
      </p>

      <div className="card ipa-options">
        <div className="field-row">
          <span className="label">Sounds</span>
          <label className="radio">
            <input type="radio" checked={sounds === 'english'} onChange={() => setSounds('english')} /> English sounds (
            {summary.sounds.filter((sound) => sound.english).length})
          </label>
          <label className="radio">
            <input type="radio" checked={sounds === 'all'} onChange={() => setSounds('all')} /> All sounds ({summary.sounds.length})
          </label>
        </div>
        <label className="field-row">
          <span className="label">Words</span>
          <select value={words} onChange={(event) => setWords(event.target.value)}>
            <option value="examples">Example words of each sound</option>
            {summary.languages.map((language) => (
              <option key={language.id} value={language.id}>
                {language.name} words with an IPA pronunciation ({language.words})
              </option>
            ))}
          </select>
        </label>
        <div className="field-row">
          <span className="label">Recordings</span>
          <span>
            {download.sounds} of {download.soundFiles} sounds and {download.words} of {download.wordTotal} example words stored
          </span>
          <button
            className="button"
            disabled={downloading}
            onClick={async () => {
              try {
                trackJob(await api.ipaDownload());
              } catch (err) {
                notify(errorMessage(err), 'error');
              }
            }}
          >
            {downloading ? <Loader2 size={16} className="spin" /> : <Download size={16} />} Download from Wikimedia Commons
          </button>
        </div>
        <JobsPanel langId={null} types={['ipa-download']} />
      </div>

      {PHASES.map((phase) => (
        <section key={phase} className="menu-section">
          <h2>
            {PHASE_LABELS[phase]} <span className="muted">{IPA_PHASE_DESCRIPTIONS[phase]}</span>
            <span className="muted mastery">
              {mastered(phase)} of {inSet.length} sounds mastered
            </span>
          </h2>
          <div className="games-grid">
            {IPA_GAMES.filter((game) => game.phase === phase).map((game) => (
              <button key={game.id} className={`game-card phase-${phase}`} onClick={() => navigate(`/pronunciation/${game.id}`)}>
                <IpaGameIcons game={game} />
                <span>{game.title}</span>
              </button>
            ))}
          </div>
        </section>
      ))}

      <section className="menu-section">
        <h2>
          Sounds <span className="muted">click one to hear it and see its examples and recordings</span>
        </h2>
        {(['vowel', 'consonant'] as const).map((kind) => (
          <div key={kind} className="ipa-chart">
            <h3>{kind === 'vowel' ? 'Vowels' : 'Consonants'}</h3>
            <div className="ipa-cells">
              {summary.sounds
                .filter((sound) => sound.kind === kind)
                .map((sound) => (
                  <button
                    key={sound.symbol}
                    className={`ipa-cell ${sound.symbol === selected ? 'selected' : ''} ${sounds === 'english' && !sound.english ? 'outside' : ''}`}
                    title={sound.name}
                    onClick={() => {
                      select(sound.symbol === selected ? null : sound.symbol);
                      if (sound.recordings.length) void playIpa(soundRef(sound.symbol), rate);
                    }}
                  >
                    <span className="ipa">{sound.symbol}</span>
                    <LevelDots levels={sound.levels} />
                  </button>
                ))}
            </div>
          </div>
        ))}
        {current && <SoundDetails sound={current} onChanged={reload} onClose={() => select(null)} />}
      </section>

      <section className="menu-section sources">
        <h2>Where the recordings come from</h2>
        <ul>
          <li>
            The sounds on their own: the recordings of Wikipedia’s{' '}
            <a href="https://en.wikipedia.org/wiki/IPA_vowel_chart_with_audio" target="_blank" rel="noreferrer">
              IPA charts with audio
            </a>
            , kept on Wikimedia Commons (public domain or Creative Commons licences; each file’s licence and author are stored with it).
          </li>
          <li>
            Example words: native speakers’ recordings from Wiktionary and{' '}
            <a href="https://lingualibre.org" target="_blank" rel="noreferrer">
              Lingua Libre
            </a>{' '}
            on Wikimedia Commons; English words only with recordings of the accent of their transcription (General American, or British
            where marked). Words without one are spoken by your voice service (Configuration → Services), or by this device.
          </li>
          <li>The English, French, German and Spanish transcriptions were checked against the open pronunciation dictionary ipa-dict.</li>
        </ul>
        <button
          className="button danger"
          onClick={async () => {
            if (!window.confirm('Reset your progress in the pronunciation mode?')) return;
            try {
              await api.ipaReset();
              reload();
            } catch (err) {
              notify(errorMessage(err), 'error');
            }
          }}
        >
          <RotateCcw size={16} /> Reset pronunciation progress
        </button>
      </section>
    </div>
  );
}
