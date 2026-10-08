// Runs the backend with plain Node (no Electron window):
//   npm run server   then open http://localhost:3000
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, importLegacyOnFirstRun } from './server.js';
import { HOST, PORT } from './config.js';
import { closeAll } from './db/connection.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.resolve(here, '../../../frontend/dist');

await importLegacyOnFirstRun();
const server = createServer(frontendDir).listen(PORT, HOST, () => {
  console.log(`Lang backend running on http://${HOST === '127.0.0.1' ? 'localhost' : HOST}:${PORT}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close();
    closeAll();
    process.exit(0);
  });
}
