import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lang-hf-'));
process.env.LANG_DATA_DIR = dataDir;

const { createLanguage, languageSummary } = await import('../backend/src/services/languages.js');
const { importText } = await import('../backend/src/services/corpus.js');
const { saveSettings } = await import('../backend/src/services/settings.js');
const { uploadToHub, listHubBackups, restoreFromHub, repoName } = await import('../backend/src/services/huggingface.js');
const { languageDb } = await import('../backend/src/db/connection.js');

// A minimal Hugging Face Hub: whoami, repo creation, preupload, LFS batch +
// upload, NDJSON commit, tree listing and ranged downloads.
function mockHub() {
  const repos = new Set<string>();
  const blobs = new Map<string, Buffer>();
  const files = new Map<string, { data: Buffer; date: string }>();
  const log: string[] = [];
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks);
    const url = new URL(req.url ?? '/', 'http://hub');
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const json = (status: number, value: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
      res.end(JSON.stringify(value));
    };
    log.push(`${req.method} ${url.pathname}`);
    if (req.headers.authorization !== 'Bearer hf_test' && !url.pathname.startsWith('/lfs-upload/')) {
      return json(401, { error: 'Invalid credentials' });
    }
    let match: RegExpMatchArray | null;
    if (url.pathname === '/api/whoami-v2') return json(200, { name: 'tester', type: 'user', auth: { type: 'access_token' } });
    if (url.pathname === '/api/repos/create') {
      const { name, organization, type } = JSON.parse(body.toString());
      const id = `${organization ?? 'tester'}/${name}`;
      assert.equal(type, 'dataset');
      if (repos.has(id)) return json(409, { error: 'You already created this dataset repo' });
      repos.add(id);
      return json(200, { url: `${base}/datasets/${id}` });
    }
    if ((match = url.pathname.match(/^\/api\/datasets\/([^/]+\/[^/]+)\/preupload\/main$/))) {
      const { files: requested } = JSON.parse(body.toString());
      return json(200, { files: requested.map((file: { path: string }) => ({ path: file.path, uploadMode: 'lfs' })) });
    }
    if ((match = url.pathname.match(/^\/datasets\/([^/]+\/[^/]+)\.git\/info\/lfs\/objects\/batch$/))) {
      const { objects } = JSON.parse(body.toString());
      return json(200, {
        transfer: 'basic',
        objects: objects.map((object: { oid: string; size: number }) => ({
          ...object,
          actions: { upload: { href: `${base}/lfs-upload/${object.oid}` } },
        })),
      });
    }
    if ((match = url.pathname.match(/^\/lfs-upload\/(\w+)$/))) {
      blobs.set(match[1], body);
      res.writeHead(200);
      return res.end();
    }
    if ((match = url.pathname.match(/^\/api\/datasets\/([^/]+\/[^/]+)\/commit\/main$/))) {
      for (const line of body.toString().split('\n')) {
        const entry = JSON.parse(line);
        if (entry.key === 'lfsFile') files.set(entry.value.path, { data: blobs.get(entry.value.oid)!, date: new Date().toISOString() });
        if (entry.key === 'file') files.set(entry.value.path, { data: Buffer.from(entry.value.content, 'base64'), date: new Date().toISOString() });
      }
      return json(200, { commitOid: 'c0ffee', commitUrl: `${base}/datasets/${match[1]}/commit/c0ffee` });
    }
    if ((match = url.pathname.match(/^\/api\/datasets\/([^/]+\/[^/]+)\/tree\/main$/))) {
      if (!repos.has(match[1])) return json(404, { error: 'Repository not found' });
      return json(
        200,
        [...files.entries()].map(([filePath, file]) => ({
          type: 'file',
          path: filePath,
          size: 134,
          oid: 'x',
          lfs: { oid: 'y', size: file.data.length, pointerSize: 134 },
          lastCommit: { id: 'c0ffee', title: 'upload', date: file.date },
        }))
      );
    }
    if ((match = url.pathname.match(/^\/datasets\/([^/]+\/[^/]+)\/resolve\/main\/(.+)$/))) {
      const file = files.get(decodeURIComponent(match[2]));
      if (!file) {
        res.writeHead(404, { 'X-Error-Code': 'EntryNotFound' });
        return res.end();
      }
      const range = /bytes=(\d+)-(\d*)/.exec(String(req.headers.range ?? ''));
      const start = range ? Number(range[1]) : 0;
      const end = range && range[2] ? Number(range[2]) : file.data.length - 1;
      res.writeHead(range ? 206 : 200, {
        'Content-Type': 'application/zip',
        'Content-Range': `bytes ${start}-${end}/${file.data.length}`,
        ETag: '"etag"',
        'Accept-Ranges': 'bytes',
      });
      return res.end(file.data.subarray(start, end + 1));
    }
    json(404, { error: `No mock for ${req.method} ${url.pathname}` });
  });
  return { server, files, repos, log };
}

const progress = { progress() {}, message() {}, checkCancelled() {}, cancelled: false };

test('repository names accept full URLs', () => {
  assert.equal(repoName('https://huggingface.co/datasets/me/lang-data'), 'me/lang-data');
  assert.equal(repoName('me/lang-data/'), 'me/lang-data');
  assert.equal(repoName('lang-data'), 'lang-data');
});

test('language and English backups go to a Hugging Face dataset and come back', async () => {
  const hub = mockHub();
  hub.server.listen(0, '127.0.0.1');
  await new Promise((resolve) => hub.server.once('listening', resolve));
  const hubUrl = `http://127.0.0.1:${(hub.server.address() as AddressInfo).port}`;
  try {
    await assert.rejects(uploadToHub({ kind: 'english' }, progress), /access token/);
    saveSettings({ huggingface: { token: 'hf_test', repo: 'lang-data', private: true, hubUrl } });

    createLanguage({ name: 'Spanish' });
    await importText('spanish', { kind: 'text', title: 't', text: 'El perro come pan. El gato duerme en la casa.' });
    const message = await uploadToHub({ kind: 'language', langId: 'spanish' }, progress);
    assert.match(message, /languages\/spanish\.zip/);
    assert.ok(hub.repos.has('tester/lang-data'), 'repository created under the token owner');
    await uploadToHub({ kind: 'english' }, progress);
    // Uploading again updates the files (the repo already exists).
    await uploadToHub({ kind: 'language', langId: 'spanish' }, progress);

    const listing = await listHubBackups();
    assert.equal(listing.repo, 'tester/lang-data');
    assert.deepEqual(listing.backups.map((b) => b.path), ['english-images.zip', 'languages/spanish.zip']);
    assert.ok(listing.backups[1].size > 1000, 'LFS size is reported');

    languageDb('spanish').exec(`DELETE FROM sentences`);
    assert.equal(languageSummary('spanish').sentenceCount, 0);
    const restored = await restoreFromHub('languages/spanish.zip', progress);
    assert.match(restored, /Restored Spanish/);
    assert.equal(languageSummary('spanish').sentenceCount, 2);
    await restoreFromHub('english-images.zip', progress);
    await assert.rejects(restoreFromHub('../../etc/passwd', progress), /Not a backup/);
  } finally {
    hub.server.close();
  }
});
