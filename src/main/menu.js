const { Menu, app } = require('electron');

function send(win, channel) {
  return () => {
    if (win && !win.isDestroyed()) win.webContents.send(channel);
  };
}

// Electron's native menu labels are static once built, so "Show X"/"Hide X"
// requires rebuilding and reassigning the menu whenever the relevant state
// changes (see main.js's 'app:sync-ui-state' handler). `uiState` carries
// the last-known visibility flags from the renderer.
function toggleLabel(base, isVisible) {
  return `${isVisible ? 'Hide' : 'Show'} ${base}`;
}

function enableLabel(base, isEnabled) {
  return `${isEnabled ? 'Disable' : 'Enable'} ${base}`;
}

function buildMenu(win, uiState) {
  const state = uiState || {};
  const template = [
    {
      label: 'File',
      submenu: [
        { label: 'New Project', accelerator: 'CmdOrCtrl+N', click: send(win, 'menu:new-project') },
        { label: 'Open Project...', accelerator: 'CmdOrCtrl+O', click: send(win, 'menu:open-project') },
        { type: 'separator' },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: send(win, 'menu:save') },
        { label: 'Save As...', accelerator: 'CmdOrCtrl+Shift+S', click: send(win, 'menu:save-as') },
        { type: 'separator' },
        { label: 'Exit', role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: send(win, 'menu:undo') },
        { label: 'Redo', accelerator: 'CmdOrCtrl+Shift+Z', click: send(win, 'menu:redo') },
        { type: 'separator' },
        { label: 'Manage Characters...', click: send(win, 'menu:manage-characters') }
      ]
    },
    {
      label: 'View',
      submenu: [
        { label: toggleLabel('Member List', state.membersVisible), click: send(win, 'menu:toggle-members') },
        { label: toggleLabel('Storyboard', state.storyboardVisible), click: send(win, 'menu:toggle-storyboard') },
        { label: toggleLabel('Auto Chat Script', state.scriptVisible), click: send(win, 'menu:toggle-script') },
        { label: toggleLabel('Speaker Selector', state.speakerSelectorVisible), click: send(win, 'menu:toggle-speaker-selector') },
        { label: toggleLabel('Fake Typing Indicator', state.fakeTypingEnabled), click: send(win, 'menu:toggle-fake-typing') },
        { label: enableLabel('Selected User Reaction Highlight', state.reactionHighlightEnabled), click: send(win, 'menu:toggle-reaction-highlight') },
        { label: enableLabel('Message Hover Highlight', state.messageHoverHighlightEnabled), click: send(win, 'menu:toggle-hover-highlight') },
        { label: enableLabel('Selected Message Highlight', state.selectedHighlightEnabled), click: send(win, 'menu:toggle-selected-highlight') },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Help',
      submenu: [
        { label: 'About Discord Video Maker', click: send(win, 'menu:about') }
      ]
    }
  ];

  return Menu.buildFromTemplate(template);
}

module.exports = { buildMenu };
