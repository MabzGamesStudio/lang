import { useEffect, useState } from 'react';
import { Download, History, Upload } from 'lucide-react';
import { api } from '../../api';
import { useAction, useApp } from '../../state/AppContext';
import { Section } from './fields';

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
