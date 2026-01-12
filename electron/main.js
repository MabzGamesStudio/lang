import { app, BrowserWindow } from "electron";
import path from "path";
import express from "express";
import { createServer } from "../backend/server.js";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isHeadless = process.argv.includes("--headless") || process.env.BACKEND_ONLY === "true";

process.on("unhandledRejection", (reason) => {
    console.error("UNHANDLED PROMISE REJECTION:", reason);
});

async function startApp() {
    try {

        const backend = createServer();

        backend.use(express.static(path.join(__dirname, "../frontend/dist")));

        backend.listen(3000, () => {
            console.log("Backend running on http://localhost:3000");
            if (isHeadless) {
                console.log("Headless mode: UI window will not be created.");
            }
        });

        if (!isHeadless) {
            await app.whenReady();

            const win = new BrowserWindow({
                width: 1000,
                height: 700,
                show: false,
                webPreferences: {
                    nodeIntegration: false,
                    contextIsolation: true,
                }
            });

            win.once("ready-to-show", () => {
                win.show();
                win.setFullScreen(true);
            });

            await win.loadURL("http://localhost:3000");
        }
    } catch (error) {
        console.error("Startup failed:");
        console.error(error);
        if (!isHeadless) app.quit();
    }
}

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
});

startApp();