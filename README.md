# Discord Video Maker — Phase 1 (Chat Editor)

A polished, Discord-style conversation editor for building fictional chat scenes.
This is **Phase 1 only**: create characters, build a conversation, edit/reorder
messages, and save/load projects. Video/MP4 export, AI voices, and rendering
are intentionally **not** implemented yet — they will be a separate later phase.

Built with **Electron** so it packages into a self-contained Windows `.exe`
that end users can run without installing Node.js, Python, .NET, or any
developer tools.

---

## 1. What you get

- A dark, Discord-inspired desktop UI: server rail, channel sidebar, message
  area, member list, message composer, and a storyboard/reorder panel.
- A character manager (add / rename / duplicate / delete / change avatar).
- Channels (add / rename / delete) and a basic multi-server rail.
- Full undo/redo for message and character edits.
- Save/Open projects as a folder containing `project.json` + an `assets/`
  folder with copied avatar images, so projects are portable.
- A GitHub Actions workflow that builds a Windows installer **and** a
  portable `.exe` automatically — no local build tools required on your PC.

## 2. Project structure

```
discord-video-maker/
├── .github/workflows/build-windows.yml   # GitHub Actions Windows build
├── package.json                          # electron-builder config lives here
├── src/
│   ├── main/                             # Electron main process
│   │   ├── main.js                       # window, menu, file I/O, IPC
│   │   ├── menu.js                       # native File/Edit/View/Help menu
│   │   └── preload.js                    # safe IPC bridge to the UI
│   └── renderer/                         # the actual chat editor UI
│       ├── index.html
│       ├── styles/main.css
│       └── js/
│           ├── app.js                    # wires everything together
│           ├── models.js                 # Project/Character/Channel/Message
│           ├── state/                    # store + undo/redo history
│           └── ui/                       # server rail, sidebar, chat, etc.
└── README.md
```

Nothing here touches video rendering, FFmpeg, or audio — the data model
(`src/renderer/js/models.js`) is deliberately kept extensible so those can be
added later without a rewrite.

---

## 3. Running it locally (optional — only if you already have Node.js)

You do **not** need to do this. It's only useful if you want to test changes
on your own machine before pushing to GitHub.

```bash
npm install
npm start
```

## 4. Building the Windows .exe with GitHub Actions (recommended path)

You do not need to install any build tools locally. GitHub's own Windows
runner builds the app for you.

### Step 1 — Create a GitHub repository

1. Go to [github.com/new](https://github.com/new) and create a new repository
   (public or private both work), e.g. `discord-video-maker`.
2. Don't initialize it with a README (we already have one) — or if you do,
   you'll just merge it later.

### Step 2 — Push this project to GitHub

From inside this project folder:

```bash
git init
git add .
git commit -m "Phase 1: Discord-style chat editor"
git branch -M main
git remote add origin https://github.com/<your-username>/discord-video-maker.git
git push -u origin main
```

(No `git`/GitHub CLI? You can also drag-and-drop the whole folder into the
"Upload files" screen on your new GitHub repo page instead.)

### Step 3 — Run the build

1. Open your repository on GitHub.
2. Click the **Actions** tab.
3. Select **"Build Windows App"** in the left sidebar.
4. Click **"Run workflow"** (top right) → **Run workflow** again to confirm.
   - Pushing to `main` also triggers a build automatically.
5. Wait for the run to finish (a few minutes — it installs Electron and
   packages the app on a Windows runner).

### Step 4 — Download the .exe

1. Click into the finished workflow run.
2. Scroll down to **Artifacts**.
3. Download **`discord-video-maker-windows`** — it's a zip containing:
   - `Discord Video Maker Setup <version>.exe` — a normal installer (Start
     Menu shortcut, uninstaller, choice of install directory).
   - `Discord Video Maker-<version>-portable.exe` — a single portable exe,
     no installation needed, just double-click and run.
4. Unzip and run either `.exe` on a Windows 10/11 64-bit PC.

That's it — no Node.js, Python, or Visual Studio required on the machine
that runs the app, or on your own machine.

---

## 5. Using the app

### Basic workflow

1. **File → New Project** (or just launch — a blank project opens by default).
2. Click **+ Add Character** (composer's `+` button, or Edit → Manage
   Characters) → type a name → optionally pick an avatar image
   (PNG/JPG/JPEG/WEBP/GIF).
3. Pick who's speaking with the **"Speaking as"** selector above the message
   box, or click a character in the right-hand member list.
4. Type a message and press **Enter** to send. **Shift+Enter** adds a new
   line without sending.
5. Hover a message to **Edit / Duplicate / Delete** it (or right-click for
   the same options).
6. Open the **Storyboard** (🎞 icon in the chat header, or the sidebar
   button) to drag-and-drop reorder messages.
7. **File → Save** (`Ctrl+S`) the first time asks for a project name and a
   folder location; after that, `Ctrl+S` saves in place. `Ctrl+Shift+S` is
   "Save As" for a new copy.
8. **File → Open Project** (`Ctrl+O`) — select the *folder* that contains
   `project.json`.

### Keyboard shortcuts

| Shortcut          | Action                     |
|--------------------|-----------------------------|
| Ctrl+N             | New project                |
| Ctrl+O             | Open project                |
| Ctrl+S             | Save                        |
| Ctrl+Shift+S       | Save As                     |
| Ctrl+Z             | Undo                        |
| Ctrl+Shift+Z       | Redo                        |
| Enter              | Send message                |
| Shift+Enter        | New line in composer         |
| Delete             | Delete the selected message  |

### Project file format

Saving creates a folder like:

```
MyProject/
├── project.json      # characters, servers, channels, messages, settings
└── assets/
    ├── alex.png
    └── mike.png
```

Move the whole `MyProject` folder together and the project stays intact —
avatar references are stored relative to the project folder, not as absolute
paths on your PC.

---

## 6. What's intentionally NOT in Phase 1

Per the project scope, this build does **not** include: MP4/video export,
FFmpeg, audio rendering, AI voices, sound effects, typing animation, a video
timeline, transitions, zoom/shake effects, background music, or video
encoding. The architecture (a clean `Project → Servers/Channels/Characters/
Messages` model, separate from the UI) is built so those can be added in a
later phase without reworking the chat editor.

## 7. Stability notes

- The message list uses CSS `content-visibility` so it stays smooth with
  hundreds of messages.
- Undo/redo, sending, editing, and deleting messages only re-render the chat
  panel (not the whole app), which keeps things responsive.
- Before saving, avatar images picked from disk are copied into the
  project's `assets/` folder, so projects don't break if the original files
  are later moved or deleted.
