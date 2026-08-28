const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dvm', {
  // Project persistence
  saveProjectAs: (projectData) => ipcRenderer.invoke('project:saveAs', projectData),
  saveProject: (projectDir, projectData) => ipcRenderer.invoke('project:save', { projectDir, projectData }),
  openProject: () => ipcRenderer.invoke('project:open'),

  // Avatars
  selectAvatar: () => ipcRenderer.invoke('avatar:select'),

  // Attachments
  selectAttachments: () => ipcRenderer.invoke('attachment:select'),
  selectAndReadTextFile: () => ipcRenderer.invoke('file:selectAndReadText'),

  // Misc
  generateId: () => ipcRenderer.invoke('app:generateId'),
  confirmClose: () => ipcRenderer.send('app:confirm-close'),
  syncUiState: (uiState) => ipcRenderer.send('app:sync-ui-state', uiState),

  // Menu -> renderer events
  onMenu: (channel, callback) => {
    const validChannels = [
      'menu:new-project',
      'menu:open-project',
      'menu:save',
      'menu:save-as',
      'menu:undo',
      'menu:redo',
      'menu:manage-characters',
      'menu:toggle-members',
      'menu:toggle-storyboard',
      'menu:toggle-script',
      'menu:toggle-speaker-selector',
      'menu:toggle-fake-typing',
      'menu:toggle-reaction-highlight',
      'menu:toggle-hover-highlight',
      'menu:toggle-selected-highlight',
      'menu:about',
      'app:request-close'
    ];
    if (!validChannels.includes(channel)) return;
    const listener = (event, ...args) => callback(...args);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  }
});
