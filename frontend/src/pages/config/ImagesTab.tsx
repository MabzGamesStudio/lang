import { useCallback, useEffect, useState } from 'react';
import { Check, ImagePlus, Search, SkipForward, Trash2, Wand2 } from 'lucide-react';
import { api } from '../../api';
import { useAction, useApp } from '../../state/AppContext';
import { useDebounced, useKey } from '../../lib/hooks';
import LabelEditor from '../../components/LabelEditor';
import JobsPanel from '../../components/JobsPanel';
import Modal from '../../components/Modal';
import { Field, NumberInput, Section, Toggle } from './fields';
import type { ImageRow } from '../../../../shared/types';

// Labelling queue: one picture at a time, confirm or edit the English words it
// stands for. An image may mean several words; image minigames accept them all.
function LabelQueue({ onChanged }: { onChanged: () => void }) {
  const run = useAction();
  const [queue, setQueue] = useState<ImageRow[]>([]);
  const [total, setTotal] = useState(0);
  const [labels, setLabels] = useState<string[]>([]);
  const [skipped, setSkipped] = useState<number[]>([]);

  const load = useCallback(async () => {
    const page = await api.images({ status: 'pending', offset: 0, limit: 30 }).catch(() => null);
    if (page) {
      setQueue(page.rows);
      setTotal(page.total);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const current = queue.find((image) => !skipped.includes(image.id)) ?? null;
  useEffect(() => setLabels(current?.labels ?? []), [current?.id]);

  const advance = async () => {
    setQueue((items) => items.filter((image) => image.id !== current?.id));
    setTotal((n) => n - 1);
    onChanged();
    if (queue.length <= 2) await load();
  };
  const approve = async () => {
    if (!current || labels.length === 0) return;
    if (await run(() => api.updateImage(current.id, { labels, status: 'labeled' }))) await advance();
  };
  const reject = async () => {
    if (!current) return;
    if (await run(() => api.deleteImage(current.id))) await advance();
  };

  // Enter approves; while typing a new label, Enter adds the label instead (handled by the editor).
  useKey(
    'Enter',
    (event) => {
      event.preventDefault();
      void approve();
    },
    { enabled: Boolean(current), inInputs: true }
  );
  useKey('Delete', () => void reject(), { enabled: Boolean(current) });

  if (!current) return <p className="muted">The labelling queue is empty.</p>;
  return (
    <div className="label-queue">
      <img src={api.imageUrl(current.id)} alt="Image to label" />
      <div className="stack">
        <p className="muted">
          {total} waiting. Which English words does this picture show? Remove wrong ones, add others (Enter in the box adds a word).
        </p>
        <LabelEditor labels={labels} onChange={setLabels} autoFocus />
        {(current.license || current.attribution) && (
          <p className="muted small">
            {current.attribution} {current.license && `· ${current.license}`}{' '}
            {current.sourceUrl && (
              <a href={current.sourceUrl} target="_blank" rel="noreferrer">
                source
              </a>
            )}
          </p>
        )}
        <div className="row">
          <button className="button primary" onClick={() => void approve()} disabled={labels.length === 0}>
            <Check size={16} /> Approve (Enter)
          </button>
          <button className="button danger" onClick={() => void reject()}>
            <Trash2 size={16} /> Delete (Del)
          </button>
          <button className="button" onClick={() => setSkipped([...skipped, current.id])}>
            <SkipForward size={16} /> Skip
          </button>
        </div>
      </div>
    </div>
  );
}

function Gallery({ refresh }: { refresh: number }) {
  const run = useAction();
  const [query, setQuery] = useState('');
  const [images, setImages] = useState<ImageRow[]>([]);
  const [total, setTotal] = useState(0);
  const [limit, setLimit] = useState(48);
  const [editing, setEditing] = useState<ImageRow | null>(null);
  const q = useDebounced(query, 250);

  useEffect(() => {
    api
      .images({ status: 'labeled', q, offset: 0, limit })
      .then((page) => {
        setImages(page.rows);
        setTotal(page.total);
      })
      .catch(() => undefined);
  }, [q, limit, refresh]);

  return (
    <>
      <div className="toolbar">
        <Search size={16} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find images by English word" />
        <span className="muted">{total} labelled images</span>
      </div>
      <div className="gallery">
        {images.map((image) => (
          <button key={image.id} className="thumb" onClick={() => setEditing(image)} title={image.labels.join(', ')}>
            <img src={api.imageUrl(image.id)} alt={image.labels.join(', ')} loading="lazy" />
            <span>{image.labels.join(', ')}</span>
          </button>
        ))}
      </div>
      {images.length < total && (
        <button className="button small" onClick={() => setLimit(limit + 48)}>
          Show more
        </button>
      )}
      {editing && (
        <Modal title="Image labels" onClose={() => setEditing(null)}>
          <img className="modal-image" src={api.imageUrl(editing.id)} alt="" />
          <LabelEditor
            labels={editing.labels}
            onChange={async (labels) => {
              const saved = await run(() => api.updateImage(editing.id, { labels }));
              if (saved) {
                setEditing(saved);
                setImages((list) => list.map((image) => (image.id === saved.id ? saved : image)));
              }
            }}
          />
          <div className="row end">
            <button
              className="button danger"
              onClick={async () => {
                if (await run(() => api.deleteImage(editing.id))) {
                  setImages((list) => list.filter((image) => image.id !== editing.id));
                  setEditing(null);
                }
              }}
            >
              <Trash2 size={16} /> Delete image
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

export default function ImagesTab() {
  const { language, trackJob, notify } = useApp();
  const run = useAction();
  const [stats, setStats] = useState<{ labeled: number; pending: number; englishWords: number } | null>(null);
  const [words, setWords] = useState(30);
  const [perWord, setPerWord] = useState(3);
  const [review, setReview] = useState(false);
  const [refresh, setRefresh] = useState(0);

  const loadStats = () =>
    api
      .englishStats()
      .then(setStats)
      .catch(() => undefined);
  useEffect(() => {
    void loadStats();
  }, [refresh]);

  async function upload(files: FileList | null) {
    let added = 0;
    for (const file of Array.from(files ?? [])) {
      const result = await run(() => api.uploadImage(file, { review }));
      if (result?.id) added++;
    }
    notify(`${added} image${added === 1 ? '' : 's'} added`, 'success');
    setRefresh((n) => n + 1);
  }

  return (
    <>
      <Section
        title="Images (shared by all languages)"
        description="Pictures are labelled with English words, so they work for every language: an image of a dog is used for perro, chien, Hund…"
      >
        {stats && (
          <p>
            <strong>{stats.labeled}</strong> labelled images · <strong>{stats.pending}</strong> waiting for labels · <strong>{stats.englishWords}</strong> English
            words known
          </p>
        )}
        <div className="two-columns">
          <div className="stack">
            <h3>Find pictures automatically</h3>
            <p className="muted">Searches openly licensed pictures (Openverse) for the most frequent nouns, verbs and adjectives without one. They go to the labelling queue below.</p>
            <div className="row">
              <Field label="Words">
                <NumberInput value={words} min={1} max={1000} onChange={setWords} />
              </Field>
              <Field label="Pictures per word">
                <NumberInput value={perWord} min={1} max={10} onChange={setPerWord} />
              </Field>
            </div>
            <button
              className="button primary"
              disabled={!language}
              onClick={async () => trackJob(await run(() => api.suggestImages(language!.id, words, perWord)))}
            >
              <Wand2 size={16} /> Find pictures{language ? ` for ${language.name} words` : ''}
            </button>
            <JobsPanel types={['images']} />
          </div>
          <div className="stack">
            <h3>Upload your own</h3>
            <p className="muted">File names become labels: “dog,puppy.jpg” is labelled dog and puppy.</p>
            <Toggle checked={review} onChange={setReview}>
              Send to the labelling queue instead
            </Toggle>
            <label className="button">
              <ImagePlus size={16} /> Choose images
              <input type="file" accept="image/*" multiple hidden onChange={(event) => void upload(event.target.files)} />
            </label>
          </div>
        </div>
      </Section>
      <Section title="Labelling queue">
        <LabelQueue key={refresh} onChanged={() => void loadStats()} />
      </Section>
      <Section title="Labelled images" description="Click an image to edit its labels. Labels can also be edited during any image minigame.">
        <Gallery refresh={refresh} />
      </Section>
    </>
  );
}
