import { useEffect, useState } from 'react';
import { Loader2, Play, Plus, Trash2 } from 'lucide-react';
import { api, errorMessage } from '../api';
import { useApp } from '../state/AppContext';
import { clearAudioCache } from '../lib/audio';
import { VOICE_SERVICES, voiceLabel } from '../lib/sourceLabels';
import type { Recording, TtsProvider } from '../../../shared/types';

let current: HTMLAudioElement | null = null;

function play(target: string, id: number) {
  current?.pause();
  current = new Audio(api.recordingUrl(target, id));
  void current.play().catch(() => undefined);
}

// The stored recordings of a word or sentence, each with the voice (source)
// that made it: play, delete, or add one with any voice service.
export default function Recordings({ target, text, initial }: { target: string; text: string; initial?: Recording[] }) {
  const { settings, notify } = useApp();
  const [recordings, setRecordings] = useState<Recording[] | null>(initial ?? null);
  const [service, setService] = useState<Exclude<TtsProvider, 'browser'> | ''>('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (initial) setRecordings(initial);
    else
      api
        .recordings(target, text)
        .then(setRecordings)
        .catch(() => setRecordings([]));
  }, [target, text, initial]);

  const ready = settings ? VOICE_SERVICES.filter((option) => option.ready(settings)) : [];
  const chosen = service || ready.find((option) => option.value === settings?.tts.provider)?.value || ready[0]?.value;

  async function add() {
    if (!chosen) return;
    setBusy(true);
    try {
      const made = await api.addRecording(target, text, { provider: chosen });
      setRecordings((list) => [made, ...(list ?? []).filter((recording) => recording.voice !== made.voice)]);
      clearAudioCache();
    } catch (err) {
      notify(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="recordings">
      {recordings === null ? (
        <span className="muted">…</span>
      ) : recordings.length === 0 ? (
        <span className="muted">{settings?.tts.provider === 'browser' ? 'none stored: spoken by this device’s voice' : 'none stored yet'}</span>
      ) : (
        recordings.map((recording) => (
          <span key={recording.id} className="recording" title={`Made ${new Date(recording.createdAt).toLocaleString()}`}>
            <button type="button" className="icon-button" title="Play this recording" onClick={() => play(target, recording.id)}>
              <Play size={12} />
            </button>
            {voiceLabel(recording.voice)}
            <button
              type="button"
              className="icon-button danger"
              title="Delete this recording"
              onClick={async () => {
                try {
                  await api.deleteRecording(target, recording.id);
                  setRecordings((list) => (list ?? []).filter((item) => item.id !== recording.id));
                  clearAudioCache();
                } catch (err) {
                  notify(errorMessage(err), 'error');
                }
              }}
            >
              <Trash2 size={12} />
            </button>
          </span>
        ))
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
          <button type="button" className="icon-button" title="Add a recording with this voice service" disabled={busy} onClick={() => void add()}>
            {busy ? <Loader2 size={12} className="spin" /> : <Plus size={12} />}
          </button>
        </span>
      )}
    </div>
  );
}
