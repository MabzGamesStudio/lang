import fs from 'node:fs';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import { apiRouter } from './routes/api.js';
import { HttpError, listLanguageIds } from './db/connection.js';
import { ensureDataDirs } from './config.js';
import { importLegacy, legacyAlreadyImported, legacyAvailable } from './services/legacy.js';

export function createServer(frontendDir?: string): express.Express {
  ensureDataDirs();
  const app = express();
  app.disable('x-powered-by');

  app.use('/api', apiRouter());
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  if (frontendDir && fs.existsSync(frontendDir)) {
    app.use(express.static(frontendDir));
    // Client-side routes (React Router) all serve index.html.
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.sendFile(path.join(frontendDir, 'index.html'));
    });
  }

  app.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    void next;
    const status =
      error instanceof HttpError ? error.status : (error as { status?: number; type?: string }).status === 413 ? 413 : 500;
    const message = (error as Error).message || 'Unexpected error';
    if (status >= 500) console.error(error);
    res.status(status).json({ error: message });
  });

  return app;
}

// First start after upgrading: bring over the data of the previous version.
export async function importLegacyOnFirstRun(): Promise<void> {
  try {
    if (listLanguageIds().length === 0 && !legacyAlreadyImported() && legacyAvailable()) {
      console.log('Importing data from the previous version (langData/app.db)…');
      console.log(await importLegacy());
    }
  } catch (error) {
    console.error('Importing the previous version failed:', (error as Error).message);
  }
}
