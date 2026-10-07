import { useEffect, useState } from 'react';
import { BookOpen, Download, FileText, Link2, ListOrdered, RefreshCw, Search, Trash2 } from 'lucide-react';
import { api } from '../../api';
import { useAction, useApp } from '../../state/AppContext';
import JobsPanel from '../../components/JobsPanel';
import { Field, NumberInput, Section, TextInput } from './fields';
import type { GutenbergBook, LanguageSummary, SourceRow } from '../../../../shared/types';

function GutenbergSearch({ language, onImport }: { language: LanguageSummary; onImport: (url: string, title: string) => void }) {
  const run = useAction();
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [books, setBooks] = useState<GutenbergBook[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);

  async function search(nextPage: number) {
    setLoading(true);
    const result = await run(() => api.searchGutenberg(language.id, query, nextPage));
    setLoading(false);
    if (result) {
      setBooks(result.books);
      setHasMore(result.hasMore);
      setPage(nextPage);
    }
  }

  return (
    <div>
      <form
        className="row"
        onSubmit={(event) => {
          event.preventDefault();
          void search(1);
        }}
      >
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Title or author (empty = most popular ${language.name} books)`} />
        <button className="button" disabled={loading}>
          <Search size={16} /> Search Project Gutenberg
        </button>
      </form>
      {books && (
        <>
          {books.length === 0 && <p className="muted">No public-domain books found.</p>}
          <table className="table">
            <tbody>
              {books.map((book) => (
                <tr key={book.id}>
                  <td>
                    <strong>{book.title}</strong>
                    <div className="muted">
                      {book.authors.join(', ')} · {book.downloads.toLocaleString()} downloads
                    </div>
                  </td>
                  <td className="right">
                    {book.imported ? (
                      <span className="muted">added</span>
                    ) : book.textUrl ? (
                      <button className="button small" onClick={() => onImport(book.textUrl!, book.title)}>
                        Add
                      </button>
                    ) : (
                      <span className="muted">no text version</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="row">
            <button className="button small" disabled={page <= 1 || loading} onClick={() => void search(page - 1)}>
              Previous
            </button>
            <button className="button small" disabled={!hasMore || loading} onClick={() => void search(page + 1)}>
              Next
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default function SourcesTab({ language }: { language: LanguageSummary }) {
  const { trackJob, jobs, refreshLanguages } = useApp();
  const run = useAction();
  const [sources, setSources] = useState<SourceRow[]>([]);
  const [topCount, setTopCount] = useState(3);
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [textTitle, setTextTitle] = useState('');

  const load = () =>
    api
      .sources(language.id)
      .then(setSources)
      .catch(() => undefined);
  const runningImports = jobs.filter((job) => job.langId === language.id && job.status === 'running').length;

  useEffect(() => {
    void load();
  }, [language.id, runningImports]);

  const startJob = async (action: () => Promise<Parameters<typeof trackJob>[0]>) => {
    const job = await run(action);
    trackJob(job);
  };

  async function readFiles(files: FileList | null, kind: 'text' | 'wordlist') {
    for (const file of Array.from(files ?? [])) {
      const content = await file.text();
      const name = file.name.replace(/\.[a-z0-9]+$/i, '');
      await startJob(() => (kind === 'text' ? api.addText(language.id, name, content) : api.addWordList(language.id, name, content)));
    }
  }

  return (
    <>
      <Section
        title="One click: popular public-domain books"
        description={`Downloads the most read ${language.name} books from Project Gutenberg, counts every word to rank the vocabulary by frequency, and saves every clean sentence.`}
      >
        <div className="row">
          <Field label="Books">
            <NumberInput value={topCount} min={1} max={20} onChange={setTopCount} />
          </Field>
          <button className="button primary" onClick={() => void startJob(() => api.addGutenbergTop(language.id, topCount))}>
            <BookOpen size={16} /> Import {topCount} popular {language.name} books
          </button>
        </div>
        <JobsPanel langId={language.id} types={['gutenberg', 'import', 'text', 'wordlist']} />
      </Section>

      <Section title="Find a specific book">
        <GutenbergSearch language={language} onImport={(bookUrl, bookTitle) => void startJob(() => api.addUrl(language.id, bookUrl, bookTitle))} />
      </Section>

      <Section
        title="Add from a URL"
        description="Any public-domain text or web page (e.g. https://www.gutenberg.org/ebooks/2000 for Don Quijote). Gutenberg book pages are resolved to their plain text automatically."
      >
        <form
          className="form-grid"
          onSubmit={(event) => {
            event.preventDefault();
            void startJob(() => api.addUrl(language.id, url, title || undefined)).then(() => {
              setUrl('');
              setTitle('');
            });
          }}
        >
          <Field label="URL">
            <TextInput value={url} onChange={setUrl} placeholder="https://www.gutenberg.org/ebooks/2000" />
          </Field>
          <Field label="Title (optional)">
            <TextInput value={title} onChange={setTitle} />
          </Field>
          <div>
            <button className="button primary" disabled={!url}>
              <Link2 size={16} /> Add book
            </button>
          </div>
        </form>
      </Section>

      <Section title="Add text or files">
        <div className="two-columns">
          <div>
            <Field label="Title">
              <TextInput value={textTitle} onChange={setTextTitle} placeholder="e.g. News article" />
            </Field>
            <Field label="Text">
              <textarea rows={6} value={text} onChange={(event) => setText(event.target.value)} lang={language.code} />
            </Field>
            <button
              className="button"
              disabled={!text.trim()}
              onClick={() =>
                void startJob(() => api.addText(language.id, textTitle || 'Pasted text', text)).then(() => {
                  setText('');
                  setTextTitle('');
                })
              }
            >
              <FileText size={16} /> Add text
            </button>
          </div>
          <div className="stack">
            <Field label="Text files (.txt, .html)" hint="Each file becomes a source">
              <input type="file" accept=".txt,.text,.html,.htm,.md" multiple onChange={(event) => void readFiles(event.target.files, 'text')} />
            </Field>
            <Field
              label="Word list (.csv)"
              hint="Columns: word, english, and optionally count/rank, pronunciation, pos. Rows in frequency order if there is no count. Example: langData/spanish/1000Words/1000Words.csv"
            >
              <input type="file" accept=".csv,.tsv,.txt" multiple onChange={(event) => void readFiles(event.target.files, 'wordlist')} />
            </Field>
          </div>
        </div>
      </Section>

      <Section
        title="Sources"
        description="Each source counts equally towards word frequencies (per million words). Raise or lower its weight to change its influence."
      >
        {sources.length === 0 ? (
          <p className="muted">No sources yet.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Source</th>
                <th>Words</th>
                <th>Unique</th>
                <th>Sentences</th>
                <th>Weight</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {sources.map((source) => (
                <tr key={source.id}>
                  <td>
                    {source.kind === 'wordlist' ? <ListOrdered size={14} /> : <BookOpen size={14} />} {source.title}
                    {source.url && (
                      <a className="muted small-link" href={source.url} target="_blank" rel="noreferrer">
                        {' '}
                        <Download size={12} />
                      </a>
                    )}
                  </td>
                  <td>{source.tokenCount.toLocaleString()}</td>
                  <td>{source.wordCount.toLocaleString()}</td>
                  <td>{source.sentenceCount.toLocaleString()}</td>
                  <td className="narrow-input">
                    <NumberInput
                      value={source.weight}
                      min={0}
                      max={100}
                      step={0.5}
                      onChange={async (weight) => {
                        const updated = await run(() => api.updateSource(language.id, source.id, { weight }));
                        if (updated) setSources(updated);
                      }}
                    />
                  </td>
                  <td>
                    <button
                      className="icon-button danger"
                      title="Remove source"
                      onClick={async () => {
                        if (!window.confirm(`Remove "${source.title}" and its sentences? Progress on words is kept.`)) return;
                        const updated = await run(() => api.deleteSource(language.id, source.id), 'Source removed');
                        if (updated) setSources(updated);
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
        )}
        <button
          className="button small"
          onClick={async () => {
            await run(() => api.rebuild(language.id), 'Frequencies and sentence statistics rebuilt');
            await refreshLanguages();
          }}
        >
          <RefreshCw size={14} /> Rebuild statistics
        </button>
      </Section>
    </>
  );
}
