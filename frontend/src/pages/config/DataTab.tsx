import { useEffect, useState } from 'react';
import { CloudDownload, CloudUpload, Download, History, RefreshCw, Upload } from 'lucide-react';
import { api } from '../../api';
import { useAction, useApp } from '../../state/AppContext';
import JobsPanel from '../../components/JobsPanel';
import { formatDate } from '../../lib/hooks';
import { Field, Section, TextInput, Toggle, useSettingsDraft } from './fields';
import type { HubBackup } from '../../../../shared/types';

function HuggingFace() {
  const { languages, trackJob } = useApp();
  const run = useAction();
  const [draft, update, flush] = useSettingsDraft();
  const [listing, setListing] = useState<{ repo: string; url: string; backups: HubBackup[] } | null>(null);
  const [loading, setLoading] = useState(false);
  if (!draft) return null;
  const configured = Boolean(draft.huggingface.token);

  async function refresh() {
    setLoading(true);
    await flush();
    const result = await run(() => api.hubBackups());
    setLoading(false);
    if (result) setListing(result);
  }

  return (
    <Section
      title="Hugging Face"
      description={
        <>
          Keep the same zips in a dataset repository on the Hugging Face Hub, to sync computers or share data. Create an access token
          with <em>write</em> permission at huggingface.co → Settings → Access Tokens.
        </>
      }
    >
      <div className="form-grid">
        <Field label="Access token">
          <TextInput type="password" value={draft.huggingface.token} onChange={(value) => update((s) => void (s.huggingface.token = value.trim()))} placeholder="hf_…" />
        </Field>
        <Field label="Dataset repository" hint="“lang-data” is created under your account; or “user/name”">
          <TextInput value={draft.huggingface.repo} onChange={(value) => update((s) => void (s.huggingface.repo = value))} placeholder="lang-data" />
        </Field>
      </div>
      <Toggle checked={draft.huggingface.private} onChange={(value) => update((s) => void (s.huggingface.private = value))}>
        Create the repository as private
      </Toggle>
      <div className="row">
        {languages.map((entry) => (
          <button
            key={entry.id}
            className="button"
            disabled={!configured}
            onClick={async () => {
              await flush();
              trackJob(await run(() => api.hubUpload({ kind: 'language', lang: entry.id })));
            }}
          >
            <CloudUpload size={16} /> Upload {entry.name}
          </button>
        ))}
        <button
          className="button"
          disabled={!configured}
          onClick={async () => {
            await flush();
            trackJob(await run(() => api.hubUpload({ kind: 'english' })));
          }}
        >
          <CloudUpload size={16} /> Upload English & images
        </button>
        <button className="button" disabled={!configured || loading} onClick={() => void refresh()}>
          <RefreshCw size={16} /> Show backups on Hugging Face
        </button>
      </div>
      <JobsPanel types={['hf-']} />
      {listing && (
        <>
          <p>
            <a href={listing.url} target="_blank" rel="noreferrer">
              {listing.repo}
            </a>
          </p>
          {listing.backups.length === 0 ? (
            <p className="muted">No backups in this repository yet.</p>
          ) : (
            <table className="table">
              <tbody>
                {listing.backups.map((backup) => (
                  <tr key={backup.path}>
                    <td>{backup.path}</td>
                    <td>{(backup.size / 1_000_000).toFixed(1)} MB</td>
                    <td className="muted">{backup.updatedAt ? formatDate(Date.parse(backup.updatedAt)) : ''}</td>
                    <td className="right">
                      <button
                        className="button small"
                        onClick={async () => {
                          const what = backup.path.startsWith('languages/') ? 'this language' : 'all images and English words';
                          if (!window.confirm(`Replace ${what} on this computer with ${backup.path} from Hugging Face?`)) return;
                          trackJob(await run(() => api.hubRestore(backup.path)));
                        }}
                      >
                        <CloudDownload size={14} /> Restore
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </Section>
  );
}

function UploadButton({ label, onFile }: { label: string; onFile: (file: File) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <label className={`button ${busy ? 'disabled' : ''}`}>
      <Upload size={16} /> {busy ? 'Uploading…' : label}
      <input
        type="file"
        accept=".zip,application/zip"
        hidden
        disabled={busy}
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (!file) return;
          setBusy(true);
          await onFile(file);
          setBusy(false);
        }}
      />
    </label>
  );
}

export default function DataTab() {
  const { language, languages, refreshLanguages, selectLanguage, notify } = useApp();
  const run = useAction();
  const [legacy, setLegacy] = useState<{ available: boolean; imported: boolean } | null>(null);

  useEffect(() => {
    api
      .legacy()
      .then(setLegacy)
      .catch(() => undefined);
  }, []);

  return (
    <>
      <Section
        title="Language data"
        description="One zip per language with everything about it: words and frequencies, translations, pronunciations, sentences, sources, audio and your progress. Use it as a save state or to move to another computer."
      >
        <div className="row">
          {languages.map((entry) => (
            <a key={entry.id} className={`button ${entry.id === language?.id ? 'primary' : ''}`} href={api.exportLanguageUrl(entry.id)}>
              <Download size={16} /> Download {entry.name}
            </a>
          ))}
          <UploadButton
            label="Upload a language zip"
            onFile={async (file) => {
              const restored = await run(() => api.importLanguage(file));
              if (restored) {
                await refreshLanguages();
                selectLanguage(restored.id);
                notify(`${restored.name} restored (${restored.wordCount.toLocaleString()} words)`, 'success');
              }
            }}
          />
        </div>
        <p className="muted">Uploading a language replaces the language with the same name on this computer.</p>
      </Section>

      <Section
        title="English words & images"
        description="Shared by every language: the English vocabulary, all images with their labels, and English audio. Saved and restored separately."
      >
        <div className="row">
          <a className="button primary" href={api.exportEnglishUrl()}>
            <Download size={16} /> Download English & images
          </a>
          <UploadButton
            label="Upload English & images zip"
            onFile={async (file) => {
              if (!window.confirm('Replace all images and English words on this computer with the uploaded ones?')) return;
              await run(() => api.importEnglish(file), 'English words and images restored');
            }}
          />
        </div>
      </Section>

      <HuggingFace />

      {legacy?.available && (
        <Section title="Previous version" description="Data from the old app (langData/app.db) was found.">
          <button
            className="button"
            onClick={async () => {
              const result = await run(() => api.importLegacy());
              if (result) {
                await refreshLanguages();
                notify(result.message, 'success');
              }
            }}
          >
            <History size={16} /> {legacy.imported ? 'Import it again' : 'Import words, progress, audio and images'}
          </button>
        </Section>
      )}
    </>
  );
}
