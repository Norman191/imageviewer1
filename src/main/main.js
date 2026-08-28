const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { buildMenu } = require('./menu');

let mainWindow = null;

// Last-known renderer UI-visibility flags, used to keep the native menu's
// dynamic "Show X"/"Hide X" labels (see menu.js) in sync. Electron menus
// have no live data-binding, so the menu is rebuilt+reassigned whenever the
// renderer reports a change via 'app:sync-ui-state'.
let lastUiState = {
  membersVisible: true,
  storyboardVisible: false,
  scriptVisible: false,
  speakerSelectorVisible: true,
  fakeTypingEnabled: false,
  reactionHighlightEnabled: true,
  messageHoverHighlightEnabled: true,
  selectedHighlightEnabled: true
};

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 650,
    backgroundColor: '#313338',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  // Message text can contain URLs rendered as real <a> links (see
  // utils/messageText.js). Electron blocks window.open()/target=_blank by
  // default; this hands any such click to the OS's real default browser
  // instead of letting Electron spawn an embedded window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('close', (e) => {
    // Ask the renderer if it is safe to close (unsaved changes check).
    if (mainWindow && !mainWindow.forceClose) {
      e.preventDefault();
      mainWindow.webContents.send('app:request-close');
    }
  });

  const menu = buildMenu(mainWindow, lastUiState);
  Menu.setApplicationMenu(menu);
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Renderer confirms it is safe to actually close the window now.
ipcMain.on('app:confirm-close', () => {
  if (mainWindow) {
    mainWindow.forceClose = true;
    mainWindow.close();
  }
});

// Renderer reports its current View-menu-relevant visibility flags so the
// native menu's "Show X"/"Hide X" labels can be rebuilt to match.
ipcMain.on('app:sync-ui-state', (event, uiState) => {
  lastUiState = { ...lastUiState, ...uiState };
  if (mainWindow && !mainWindow.isDestroyed()) {
    Menu.setApplicationMenu(buildMenu(mainWindow, lastUiState));
  }
});

// ---------------------------------------------------------------------------
// Avatar file picker
// ---------------------------------------------------------------------------
ipcMain.handle('avatar:select', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Avatar Image',
    properties: ['openFile'],
    filters: [
      { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }
    ]
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

// ---------------------------------------------------------------------------
// Attachment file picker (images, GIFs, or any other file)
// ---------------------------------------------------------------------------
ipcMain.handle('attachment:select', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Files to Attach',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Images & GIFs', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths;
});

// ---------------------------------------------------------------------------
// Generic "pick and read a small text file" — used by the Auto Script
// CSV/Excel-compatible import (item 2).
// ---------------------------------------------------------------------------
ipcMain.handle('file:selectAndReadText', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select a CSV File',
    properties: ['openFile'],
    filters: [
      { name: 'CSV (Excel-compatible)', extensions: ['csv'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });
  if (result.canceled || !result.filePaths.length) return null;
  try {
    const content = await fs.promises.readFile(result.filePaths[0], 'utf-8');
    return { path: result.filePaths[0], content };
  } catch (err) {
    return { error: err.message };
  }
});

// ---------------------------------------------------------------------------
// Project persistence
//
// A project is a FOLDER containing:
//   project.json
//   assets/  (copied avatar images live here)
//
// Character avatars are stored in project state as either:
//   { type: 'temp', path: '<absolute path on this machine>' }   -- not yet saved into the project
//   { type: 'project', path: 'assets/<file>' }                  -- relative to the project folder
// ---------------------------------------------------------------------------

function uniqueAssetName(destDir, originalPath) {
  const ext = path.extname(originalPath) || '.png';
  const base = path.basename(originalPath, ext).replace(/[^a-z0-9_-]/gi, '_').slice(0, 40) || 'avatar';
  let candidate = `${base}${ext}`;
  let i = 1;
  while (fs.existsSync(path.join(destDir, candidate))) {
    candidate = `${base}_${i}${ext}`;
    i += 1;
  }
  return candidate;
}

// Copies a { type: 'temp', path } reference (an avatar or a message
// attachment) into the project's assets/ folder and returns the
// project-relative reference. Returns null if the source file is missing.
async function copyIfTemp(assetsDir, ref) {
  if (!ref || ref.type !== 'temp' || !ref.path) return ref;
  try {
    if (!fs.existsSync(ref.path)) return null;
    const filename = uniqueAssetName(assetsDir, ref.path);
    await fs.promises.copyFile(ref.path, path.join(assetsDir, filename));
    return { type: 'project', path: `assets/${filename}` };
  } catch (err) {
    return null;
  }
}

async function persistProject(projectDir, projectData) {
  const assetsDir = path.join(projectDir, 'assets');
  await fs.promises.mkdir(assetsDir, { recursive: true });

  const clone = JSON.parse(JSON.stringify(projectData));

  for (const character of clone.characters || []) {
    if (character.avatar && character.avatar.type === 'temp') {
      character.avatar = await copyIfTemp(assetsDir, character.avatar);
    }
  }

  for (const message of clone.messages || []) {
    if (!Array.isArray(message.attachments) || !message.attachments.length) continue;
    const resolved = [];
    for (const attachment of message.attachments) {
      if (attachment.file && attachment.file.type === 'temp') {
        const file = await copyIfTemp(assetsDir, attachment.file);
        if (file) resolved.push({ ...attachment, file });
        // if the source file is missing, the attachment is dropped rather
        // than saved with a broken reference.
      } else {
        resolved.push(attachment);
      }
    }
    message.attachments = resolved;
  }

  clone.savedAt = new Date().toISOString();

  await fs.promises.writeFile(
    path.join(projectDir, 'project.json'),
    JSON.stringify(clone, null, 2),
    'utf-8'
  );

  return clone;
}

ipcMain.handle('project:saveAs', async (event, projectData) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Save Project As',
    defaultPath: (projectData && projectData.meta && projectData.meta.name) || 'MyProject',
    properties: ['createDirectory'],
    buttonLabel: 'Save Project'
  });
  if (result.canceled || !result.filePath) return null;

  // Treat the chosen path as the project folder. Strip any extension the
  // OS dialog may have appended (e.g. on some platforms) so we always end
  // up with a clean directory name.
  const projectDir = result.filePath.replace(/\.[a-zA-Z0-9]+$/, '') || result.filePath;

  await fs.promises.mkdir(projectDir, { recursive: true });
  const data = await persistProject(projectDir, projectData);
  return { projectDir, data };
});

ipcMain.handle('project:save', async (event, { projectDir, projectData }) => {
  if (!projectDir) return null;
  const data = await persistProject(projectDir, projectData);
  return { projectDir, data };
});

ipcMain.handle('project:open', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Open Project Folder',
    properties: ['openDirectory']
  });
  if (result.canceled || !result.filePaths.length) return null;

  const projectDir = result.filePaths[0];
  const jsonPath = path.join(projectDir, 'project.json');

  if (!fs.existsSync(jsonPath)) {
    return { error: 'No project.json was found in that folder. Please select a valid Discord Video Maker project folder.' };
  }

  try {
    const raw = await fs.promises.readFile(jsonPath, 'utf-8');
    const data = JSON.parse(raw);
    return { projectDir, data };
  } catch (err) {
    return { error: `Could not read project.json: ${err.message}` };
  }
});

ipcMain.handle('app:generateId', () => crypto.randomUUID());
