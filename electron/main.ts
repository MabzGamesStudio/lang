import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, session, shell } from 'electron';

const here = path.dirname(fileURLToPath(import.meta.url));
const isHeadless = process.argv.includes('--headless') || process.env.BACKEND_ONLY === 'true';

// Packaged apps keep their data in the user data folder; during development
// it stays in ./langData next to the project.
if (!process.env.LANG_DATA_DIR && app.isPackaged) {
  process.env.LANG_DATA_DIR = path.join(app.getPath('userData'), 'langData');
}

process.on('unhandledRejection', (reason) => {
  console.error('UNHANDLED PROMISE REJECTION:', reason);
});

async function startApp(): Promise<void> {
  // Imported after LANG_DATA_DIR is set so the backend picks it up.
  const { createServer, importLegacyOnFirstRun } = await import('../backend/src/server.js');
  const { HOST, PORT } = await import('../backend/src/config.js');
  const { closeAll } = await import('../backend/src/db/connection.js');

  await importLegacyOnFirstRun();
  const frontendDir = path.resolve(here, '../../frontend/dist');
  const server = createServer(frontendDir).listen(PORT, HOST, () => {
    console.log(`Backend running on http://localhost:${PORT}`);
    if (isHeadless) console.log('Headless mode: UI window will not be created.');
  });
  app.on('before-quit', () => {
    server.close();
    closeAll();
  });

  if (isHeadless) return;
  await app.whenReady();

  // Microphone access for the speaking minigames.
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const local = webContents.getURL().startsWith(`http://localhost:${PORT}`);
    callback(local && (permission === 'media' || permission === 'clipboard-sanitized-write'));
  });

  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    show: false,
    backgroundColor: '#0f1115',
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });
  win.once('ready-to-show', () => win.show());
  // Links to external sites (Gutenberg, Colab, licences) open in the browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });
  await win.loadURL(`http://localhost:${PORT}`);
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

startApp().catch((error) => {
  console.error('Startup failed:', error);
  if (!isHeadless) app.quit();
});
