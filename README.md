# lang

An intense, efficient platform for learning the words of any language, from the most common to the least common:

- **Frequency order** – words are counted in public-domain books (e.g. *Don Quijote*) and learnt from most to least frequent.
- **Batches of 7** – a working-memory sized batch at a time; 14 batches (98 words) form a block.
- **Modality variation** – 23 minigames: read, listen, look at pictures, pick, type, speak, recite and translate.
- **Immediate feedback** – every answer is checked on the spot, with the correct form, pronunciation and audio. Optionally, you must retype the correct answer after a mistake.
- **Spaced repetition** – learnt words come back after 1 day, 2 days, 4 days, 1 week, 2 weeks, 1, 2, 4 and 6 months, 1 year and 2 years.
- **Forgiving checking** – synonyms, homographs, every word an image can stand for, missing accents, small typos, word-level closeness for sentences and a similarity score for speech.

## Quick start

```bash
nvm use                 # Node 22
npm install             # root: backend + Electron
npm --prefix frontend install
npm run rebuild         # compiles better-sqlite3 for Electron (once after installing)
npm start               # builds everything and opens the desktop app
```

Then, in the app:

1. **Configuration → Language**: add a language (e.g. Spanish).
2. **Configuration → Sources**: click *Import 3 popular Spanish books* (Project Gutenberg), or paste a URL, a text, or upload a word list such as `langData/spanish/1000Words/1000Words.csv`.
3. **Configuration → Services**: pick where translations, pronunciations and audio come from (see below), then use **Autopilot** to prepare the top N words in one click.
4. **Personal progress → Continue learning**.

### Development

| Command | What it does |
|---|---|
| `npm run backend` | Builds the backend and runs it headless in Electron on http://localhost:3000 |
| `npm run server` | Same with plain Node (needs `better-sqlite3` built for Node: `npm rebuild better-sqlite3`) |
| `npm --prefix frontend run dev` | Vite dev server on http://localhost:5173, proxying `/api` to the backend |
| `npm run typecheck` | TypeScript checks for backend, shared code and frontend |
| `npm test` | Unit and integration tests (`tests/`) |
| `npm run package` | Packages the desktop app with electron-packager |

`npm run rebuild` compiles `better-sqlite3` for Electron, and `npm rebuild better-sqlite3` compiles it back for plain Node.

## How learning works

**Personal progress** guides you through the vocabulary:

1. The current *block* is the first 98 words (in frequency order) that are not learnt yet.
2. Every batch of 7 words of the block goes through **recognition**, then every batch through **recall**, then **recite**, then **translate**. Each phase rotates through all of its enabled minigames, so each word is seen, heard, typed and spoken.
3. Each word has a knowledge level per category (from `TODO.txt`):

   | Category | Levels | Correct | Wrong |
   |---|---|---|---|
   | Recognition | 0 not encountered, 1 bad, 2 good | +1 | −1 |
   | Recall | 0, 1 bad, 2 okay, 3 good | +1 | −2 |
   | Recite (sentence integration) | 0, 1 bad, 2 good | +1 | −1 |
   | Translate | 0, 1 bad, 2 okay, 3 good | +1 | −2 |

4. When every category of a word is at its maximum, the word is *learnt* and scheduled for its first review in 1 day. Then the next block starts.
5. **Review due words** brings back words whose milestone has passed, 7 at a time. Each category is reset to 1 and must be mastered again. A review without mistakes moves the word to the next, longer interval; a review with mistakes moves it back one step.

Within a session, the same word is never asked twice in a row, wrongly answered words come back after a couple of other questions, and new batches start with a short preview of the 7 words. An optional pomodoro timer (25 min / 5 min) runs during sessions.

In sentence exercises, every word of the sentence that you were already introduced to is scored. Words you have not reached yet are shown but not evaluated. Speaking minigames can be switched off for Personal progress (*Configuration → Learning*, or the toggle on the progress page).

The **main menu** also lists every minigame for free practice on any batch (or every batch up to it). It updates the same knowledge levels and shows a ★ when a batch is mastered.

## Configuration

Everything is saved as you go and can be added to or changed at any time.

### Sources
- **Project Gutenberg** – one-click import of the most popular public-domain books of the language, or search for a specific book. Book pages such as `https://www.gutenberg.org/ebooks/2000` are resolved to plain text, and Gutenberg headers and licence text are removed.
- **Any URL, pasted text or text files.**
- **Word lists (CSV)** – columns `word, english` plus optional `count`/`rank`, `pronunciation`, `pos`. Without counts, the row order is taken as frequency order.

Words are tokenised with `Intl.Segmenter`, so languages without spaces (Japanese, Chinese, Thai) work too. Each source contributes its frequencies per million words, so every book counts equally; source weights are adjustable. Names (words almost always capitalised mid-sentence) are skipped automatically, except in languages that capitalise nouns, such as German. Clean sentences of 3–20 words go into the sentence database, ranked by difficulty (the rank of their rarest word).

### Services
| Need | Options |
|---|---|
| English translations, part of speech, IPA | **Wiktionary** (free, no key) or an **LLM** |
| Sentence translation (batched, saved to the database) | **LLM**, **DeepL**, **Google Cloud Translation**, **LibreTranslate** |
| Extra example sentences | **LLM** (for words with too few sentences) |
| Text to speech (cached in the database) | **On device** (browser voices), **Google Colab** (neural voices), **OpenAI-compatible** speech API, **Google Cloud TTS** |
| Speech recognition | **Browser** (Chrome/Edge), **Google Colab** (Whisper), any **Whisper-compatible API** |

The LLM can be an open-source model in Google Colab, any OpenAI-compatible API (OpenAI, OpenRouter, Groq, local Ollama…) or Anthropic Claude.

**Google Colab (free):** open `ipynb/LangColabServer.ipynb` in Colab, select a GPU runtime and *Run all*. It starts Ollama (default `qwen2.5:7b`), faster-whisper and edge-tts behind one Cloudflare tunnel, and prints a URL to paste into *Configuration → Services → Colab URL*. If tunnels are blocked, use **offline batches** instead: download a job file from the app, run it in the notebook, and upload the results.

While you learn, the app prepares the current block in the background (definitions, sentence translations, example sentences, audio) with whatever services are configured. Words still missing a translation can be typed in directly from the session.

### Images
Images are labelled with **English words** and shared by every language. One picture can mean several words, and the image minigames accept all of them.
- **Find pictures** searches openly licensed images (Openverse) for the most frequent nouns, verbs and adjectives and puts them in a **labelling queue**: confirm, edit or delete each one (Enter / Del).
- **Upload** your own images; file names become labels (`dog,puppy.jpg`).
- Labels can be edited at any time, including from inside any image minigame.

### Save & transfer
- **Language zip** – one per language with everything about it: words, frequencies, translations, pronunciations, sentences, sources, audio and progress.
- **English & images zip** – the shared English vocabulary, all labelled images and English audio.

Upload either zip on another computer to continue where you left off. Data from the previous version of the app (`langData/app.db`) is imported automatically on first start.

## Architecture

```
shared/            TypeScript used by both sides: minigame catalogue, scoring rules, forgiving text matching, types
backend/src/       Express API (TypeScript) on 127.0.0.1:3000
  db/              SQLite (better-sqlite3): one database per language + one shared English database
  services/        corpus import & ranking, progression engine, question builders, backups, jobs
  providers/       LLM, definitions, translation, speech, images
electron/main.ts   Desktop shell: starts the backend and opens the window
frontend/src/      React + SCSS (Vite): menu, minigames, personal progress, configuration
ipynb/             Google Colab notebook with free open-source services
tests/             node:test suites (run with tsx)
```

Data lives in `langData/` (or the Electron user-data folder when packaged):

```
langData/languages/<language>.sqlite   words, sentences, sources, progress, audio
langData/english.sqlite                English words, images + labels, English audio
langData/settings.json                 service settings and API keys (never exported)
```
