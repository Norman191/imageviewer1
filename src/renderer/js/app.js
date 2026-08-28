import { Store } from './state/store.js';
import { History } from './state/history.js';
import { createEmptyProject, createCharacter, createChannel, createServer, createMessage, createScriptEvent, createAttachment, localId } from './models.js';
import { classifyAttachmentKind } from './utils/fileIcon.js';
import { showPrompt, showConfirm, showAbout } from './ui/modals.js';
import { showToast } from './ui/toast.js';
import { createServerRail } from './ui/serverRail.js';
import { createChannelSidebar } from './ui/channelSidebar.js';
import { createChatView } from './ui/chatView.js';
import { createComposer } from './ui/composer.js';
import { createMemberList } from './ui/memberList.js';
import { createStoryboard } from './ui/storyboard.js';
import { createScriptPanel } from './script.ui.js';
import { createCharacterManager } from './ui/characterManager.js';
import { createPlayback } from './playback.js';

const store = new Store(createEmptyProject());
let selectedMessageId = null;

const history = new History((scope) => {
  store.markDirty();
  refresh(scope);
  updateTitle();
  syncMenuState();
});

// ---------------------------------------------------------------------------
// ctx: shared surface every UI module talks to
// ---------------------------------------------------------------------------
const ctx = {
  getState: () => store.getState(),
  getProjectDir: () => store.projectDir,
  getSelectedMessageId: () => selectedMessageId,
  setSelectedMessageId: (id) => { selectedMessageId = id; },
  notify: (msg, type) => showToast(msg, type),
  actions: {
    // -- messages (undoable) --
    sendMessage: (text, attachments, mentions) => runCommand(cmdSendMessage(text, attachments, mentions), 'messages-new'),
    editMessage: (id, text) => runCommand(cmdEditMessage(id, text), 'messages'),
    deleteMessage: (id) => runCommand(cmdDeleteMessage(id), 'messages'),
    duplicateMessage: (id) => runCommand(cmdDuplicateMessage(id), 'messages-new'),
    moveMessageBefore: (dragId, targetId) => runCommand(cmdMoveMessageBefore(dragId, targetId), 'messages'),
    setMessageEffect: (id, effect) => mutateProject((s) => {
      const message = s.messages.find((m) => m.id === id);
      if (message) message.effect = effect;
    }, 'messages'),

    // -- reactions (not undoable — toggles instantly, like a real chat app) --
    // Per-character active state (userIds) is independent per user; `count`
    // is the single universal displayed number. Manual toggles move `count`
    // by ±1; startReactionAutomation() below can also move `count`
    // independently (e.g. to simulate growth), and subsequent manual
    // toggles continue to adjust that same shared number.
    toggleReaction: (messageId, emoji, characterId) => mutateProject((s) => {
      const message = s.messages.find((m) => m.id === messageId);
      if (!message || !characterId) return;
      if (!Array.isArray(message.reactions)) message.reactions = [];
      let reaction = message.reactions.find((r) => r.emoji === emoji);
      if (!reaction) {
        reaction = { emoji, userIds: [], count: 0 };
        message.reactions.push(reaction);
      }
      const idx = reaction.userIds.indexOf(characterId);
      if (idx >= 0) {
        reaction.userIds.splice(idx, 1);
        reaction.count = Math.max(0, reaction.count - 1);
      } else {
        reaction.userIds.push(characterId);
        reaction.count += 1;
      }
      if (reaction.count <= 0 && reaction.userIds.length === 0) {
        const ridx = message.reactions.indexOf(reaction);
        if (ridx >= 0) message.reactions.splice(ridx, 1);
      }
    }, 'messages'),
    startReactionAutomation: (messageId, emoji, options) => startReactionAutomation(messageId, emoji, options),

    // -- characters (undoable) --
    addCharacterFlow,
    renameCharacter: (id, name) => runCommand(cmdRenameCharacter(id, name), 'characters'),
    deleteCharacter: (id) => runCommand(cmdDeleteCharacter(id), 'characters'),
    duplicateCharacter,
    changeAvatar,

    // -- channels / servers (not part of the required undo set) --
    addChannel: (serverId, name, type) => mutateProject((s) => {
      const server = s.servers.find((sv) => sv.id === serverId);
      if (!server) return;
      const channel = createChannel(name, type);
      server.channels.push(channel);
    }, 'channels'),
    renameChannel: (channelId, name) => mutateProject((s) => {
      for (const server of s.servers) {
        const channel = server.channels.find((c) => c.id === channelId);
        if (channel) channel.name = name;
      }
    }, 'channels'),
    deleteChannel: (channelId) => mutateProject((s) => {
      for (const server of s.servers) {
        const idx = server.channels.findIndex((c) => c.id === channelId);
        if (idx >= 0) server.channels.splice(idx, 1);
      }
      s.messages = s.messages.filter((m) => m.channelId !== channelId);
      if (s.ui.currentChannelId === channelId) {
        const server = s.servers.find((sv) => sv.id === s.ui.currentServerId);
        const nextChannel = server && server.channels.find((c) => c.type === 'text');
        s.ui.currentChannelId = nextChannel ? nextChannel.id : null;
      }
    }, 'channels'),
    selectChannel: (channelId) => mutateProject((s) => { s.ui.currentChannelId = channelId; }, 'channels'),

    addServer: (name) => mutateProject((s) => {
      const server = createServer(name);
      s.servers.push(server);
      s.ui.currentServerId = server.id;
      s.ui.currentChannelId = server.channels.find((c) => c.type === 'text').id;
    }, 'servers'),
    selectServer: (serverId) => mutateProject((s) => {
      s.ui.currentServerId = serverId;
      const server = s.servers.find((sv) => sv.id === serverId);
      const stillValid = server && server.channels.some((c) => c.id === s.ui.currentChannelId);
      if (server && !stillValid) {
        const firstText = server.channels.find((c) => c.type === 'text');
        s.ui.currentChannelId = firstText ? firstText.id : null;
      }
    }, 'servers'),

    // -- speaker / UI toggles (not undoable) --
    selectSpeaker: (characterId) => mutateProject((s) => { s.ui.currentSpeakerId = characterId; }, 'characters'),
    setCharacterStatus: (characterId, status) => mutateProject((s) => {
      const character = s.characters.find((c) => c.id === characterId);
      if (character) character.status = status;
    }, 'characters'),
    toggleMembers: () => mutateProject((s) => { s.ui.membersVisible = !s.ui.membersVisible; }, 'ui'),
    toggleStoryboard: () => mutateProject((s) => {
      s.ui.storyboardVisible = !s.ui.storyboardVisible;
      if (s.ui.storyboardVisible) s.ui.scriptVisible = false; // both are bottom-panel overlays; avoid stacking
    }, 'ui'),
    toggleSpeakerSelector: () => mutateProject((s) => { s.ui.speakerSelectorVisible = !s.ui.speakerSelectorVisible; }, 'ui'),

    // -- fake typing indicator (Feature 3) --
    toggleFakeTyping: () => mutateProject((s) => { s.ui.fakeTypingEnabled = !s.ui.fakeTypingEnabled; }, 'ui'),
    toggleReactionHighlight: () => mutateProject((s) => { s.ui.reactionHighlightEnabled = !s.ui.reactionHighlightEnabled; }, 'ui'),
    toggleMessageHoverHighlight: () => mutateProject((s) => { s.ui.messageHoverHighlightEnabled = !s.ui.messageHoverHighlightEnabled; }, 'ui'),
    toggleSelectedHighlight: () => mutateProject((s) => { s.ui.selectedHighlightEnabled = !s.ui.selectedHighlightEnabled; }, 'ui'),
    removeAttachment: (messageId, attachmentId) => mutateProject((s) => {
      const message = s.messages.find((m) => m.id === messageId);
      if (!message || !Array.isArray(message.attachments)) return;
      const attachment = message.attachments.find((a) => a.id === attachmentId);
      if (!attachment) return;
      message.attachments = message.attachments.filter((a) => a.id !== attachmentId);
      if (attachment.token && message.text) {
        message.text = message.text.split(attachment.token).join('');
      }
    }, 'messages'),
    setTypingCharacter: (characterId) => mutateProject((s) => { s.ui.typingCharacterId = characterId; }, 'ui'),

    // -- storyboard / scripted playback (Feature 4) --
    setStoryboardMode: (mode) => mutateProject((s) => { s.ui.storyboardMode = mode; }, 'ui'),
    toggleScript: () => mutateProject((s) => {
      s.ui.scriptVisible = !s.ui.scriptVisible;
      if (s.ui.scriptVisible) s.ui.storyboardVisible = false;
    }, 'ui'),
    toggleChannelSidebar: () => mutateProject((s) => { s.ui.channelSidebarVisible = !s.ui.channelSidebarVisible; }, 'channels'),
    addScriptEvent: (event) => mutateProject((s) => {
      if (!s.script) s.script = { events: [] };
      s.script.events.push(createScriptEvent(event));
    }, 'ui'),
    updateScriptEvent: (id, patch) => mutateProject((s) => {
      const event = s.script && s.script.events.find((e) => e.id === id);
      if (event) Object.assign(event, patch);
    }, 'ui'),
    deleteScriptEvent: (id) => mutateProject((s) => {
      if (!s.script) return;
      s.script.events = s.script.events.filter((e) => e.id !== id);
    }, 'ui'),
    deleteScriptEvents: (ids) => mutateProject((s) => {
      if (!s.script) return;
      const idSet = new Set(ids);
      s.script.events = s.script.events.filter((e) => !idSet.has(e.id));
    }, 'ui'),
    // Bulk-imports pre-validated CSV rows (see utils/scriptCsv.js) as real
    // script events in one atomic update — message/file rows are created
    // first so reaction rows can resolve their `targetTime` to the real
    // generated event id, exactly like a manually-built reaction does.
    importScriptEvents: (rawEvents) => mutateProject((s) => {
      if (!s.script) s.script = { events: [] };
      const timeToId = new Map();

      rawEvents.forEach((raw) => {
        if (raw.action !== 'message' && raw.action !== 'file') return;
        const attachments = (raw.payload.attachments || []).map((a) => {
          if (!a.imagePath) return a;
          const filename = basename(a.imagePath);
          return createAttachment({
            kind: classifyAttachmentKind(filename),
            filename,
            file: { type: 'temp', path: a.imagePath }
          });
        });
        const event = createScriptEvent({ time: raw.time, characterId: raw.characterId, action: raw.action, payload: { text: raw.payload.text, attachments } });
        s.script.events.push(event);
        timeToId.set(raw.time, event.id);
      });

      rawEvents.forEach((raw) => {
        if (raw.action === 'reaction') {
          const targetEventId = timeToId.get(raw.payload.targetTime);
          if (!targetEventId) return; // already validated against these same times at parse time
          s.script.events.push(createScriptEvent({
            time: raw.time,
            characterId: raw.characterId,
            action: 'reaction',
            payload: { targetEventId, emoji: raw.payload.emoji, automation: raw.payload.automation || null }
          }));
        } else if (raw.action === 'typing' || raw.action === 'wait') {
          s.script.events.push(createScriptEvent({ time: raw.time, characterId: raw.characterId, action: raw.action, payload: raw.payload }));
        }
      });
    }, 'ui'),
    // Sends a message as a specific character without changing the
    // currently selected speaker — used by playback, never by the manual
    // composer (which continues to use sendMessage() above unchanged).
    playbackSendMessage: (characterId, text, attachments) => mutateProject((s) => {
      const order = nextOrderForChannel(s, s.ui.currentChannelId);
      const message = createMessage({ channelId: s.ui.currentChannelId, characterId, text, order, attachments });
      s.messages.push(message);
    }, 'messages-new'),
    playScript: () => playback.play(),
    pauseScript: () => playback.pause(),
    stopScript: () => playback.stop(),
    isScriptPlaying: () => playback.isPlaying(),

    // -- reaction count panel (right sidebar, all-settings-visible) --
    openReactionCountPanel: (messageId, emoji) => mutateProject((s) => { s.ui.reactionCountPanel = { messageId, emoji }; }, 'ui'),
    closeReactionCountPanel: () => mutateProject((s) => { s.ui.reactionCountPanel = null; }, 'ui'),

    openCharacterManager: () => characterManager.open()
  }
};

// ---------------------------------------------------------------------------
// UI module instances
// ---------------------------------------------------------------------------
const serverRail = createServerRail(ctx);
const channelSidebar = createChannelSidebar(ctx);
const chatView = createChatView(ctx);
const composer = createComposer(ctx);
const memberList = createMemberList(ctx);
const storyboard = createStoryboard(ctx);
const scriptPanel = createScriptPanel(ctx);
const characterManager = createCharacterManager(ctx);
const playback = createPlayback(ctx);

function refresh(scope) {
  switch (scope) {
    case 'messages-new':
      // A genuinely new message (sent, duplicated, or scripted) — follow
      // the chat to the bottom.
      chatView.render({ preserveScroll: true, stickToBottom: true });
      storyboard.render();
      scriptPanel.render();
      break;
    case 'messages':
      // An EXISTING message changed (edited, deleted, reordered, a
      // reaction toggled/automated, an effect applied) — never force a
      // scroll; chatView's own wasAtBottom check still follows along if
      // the person already happened to be at the bottom, but otherwise
      // their scroll position is left exactly where it was.
      chatView.render({ preserveScroll: true, stickToBottom: false });
      storyboard.render();
      scriptPanel.render();
      break;
    case 'characters':
      memberList.render();
      composer.render();
      chatView.render({ preserveScroll: true });
      storyboard.render();
      scriptPanel.render();
      characterManager.renderList();
      break;
    case 'channels':
      channelSidebar.render();
      chatView.render({ preserveScroll: false, stickToBottom: true });
      composer.render();
      storyboard.render();
      scriptPanel.render();
      break;
    case 'servers':
      serverRail.render();
      channelSidebar.render();
      chatView.render({ preserveScroll: false, stickToBottom: true });
      composer.render();
      storyboard.render();
      scriptPanel.render();
      break;
    case 'ui':
      memberList.render();
      storyboard.render();
      scriptPanel.render();
      composer.render();
      chatView.render({ preserveScroll: true });
      break;
    default:
      refreshAll();
      syncMenuState();
  }
}

function refreshAll() {
  serverRail.render();
  channelSidebar.render();
  chatView.render({ preserveScroll: false, stickToBottom: true });
  composer.render();
  memberList.render();
  storyboard.render();
  scriptPanel.render();
}

function updateTitle() {
  const state = store.getState();
  const name = (state.meta && state.meta.name) || 'Untitled Project';
  document.title = `${name}${store.dirty ? ' •' : ''} — Discord Video Maker`;
}

// Keeps the native menu's dynamic "Show X"/"Hide X" labels in sync (see
// menu.js / main.js). Cheap to call on every refresh.
function syncMenuState() {
  const ui = store.getState().ui;

  // Message hover background highlight (Batch 2, item 3) is a pure CSS
  // toggle applied via a class on the app root — cheap enough to just
  // re-assert on every menu-state sync rather than adding a new call site.
  const appEl = document.getElementById('app');
  if (appEl) appEl.classList.toggle('hover-highlight-disabled', ui.messageHoverHighlightEnabled === false);
  if (appEl) appEl.classList.toggle('selected-highlight-disabled', ui.selectedHighlightEnabled === false);

  if (!window.dvm || !window.dvm.syncUiState) return;
  window.dvm.syncUiState({
    membersVisible: ui.membersVisible,
    storyboardVisible: ui.storyboardVisible,
    scriptVisible: ui.scriptVisible,
    speakerSelectorVisible: ui.speakerSelectorVisible,
    fakeTypingEnabled: ui.fakeTypingEnabled,
    reactionHighlightEnabled: ui.reactionHighlightEnabled,
    messageHoverHighlightEnabled: ui.messageHoverHighlightEnabled,
    selectedHighlightEnabled: ui.selectedHighlightEnabled
  });
}

// ---------------------------------------------------------------------------
// Undoable command factories
// ---------------------------------------------------------------------------
function basename(filePath) {
  const normalized = filePath.replace(/\\/g, '/');
  const parts = normalized.split('/');
  return parts[parts.length - 1];
}

function nextOrderForChannel(state, channelId) {
  const msgs = state.messages.filter((m) => m.channelId === channelId);
  if (!msgs.length) return 0;
  return Math.max(...msgs.map((m) => m.order)) + 1;
}

function runCommand(command, scope) {
  history.execute({ ...command, scope });
}

function cmdSendMessage(text, attachments, mentions) {
  const state = store.getState();
  const channelId = state.ui.currentChannelId;
  const characterId = state.ui.currentSpeakerId;
  const order = nextOrderForChannel(state, channelId);
  const message = createMessage({ channelId, characterId, text, order, attachments, mentions });
  return {
    do: () => { store.getState().messages.push(message); },
    undo: () => {
      const s = store.getState();
      s.messages = s.messages.filter((m) => m.id !== message.id);
      if (selectedMessageId === message.id) selectedMessageId = null;
    }
  };
}

function cmdEditMessage(id, newText) {
  const msg = store.getState().messages.find((m) => m.id === id);
  if (!msg) return { do: () => {}, undo: () => {} };
  const oldText = msg.text;
  const oldEdited = msg.edited;
  return {
    do: () => { msg.text = newText; msg.edited = true; },
    undo: () => { msg.text = oldText; msg.edited = oldEdited; }
  };
}

function cmdDeleteMessage(id) {
  const state = store.getState();
  const idx = state.messages.findIndex((m) => m.id === id);
  const removed = state.messages[idx];
  return {
    do: () => {
      const s = store.getState();
      const i = s.messages.findIndex((m) => m.id === id);
      if (i >= 0) s.messages.splice(i, 1);
      if (selectedMessageId === id) selectedMessageId = null;
    },
    undo: () => {
      const s = store.getState();
      const safeIdx = Math.min(idx, s.messages.length);
      s.messages.splice(safeIdx, 0, removed);
    }
  };
}

function cmdDuplicateMessage(id) {
  const state = store.getState();
  const original = state.messages.find((m) => m.id === id);
  if (!original) return { do: () => {}, undo: () => {} };
  const order = nextOrderForChannel(state, original.channelId);
  const copy = {
    ...original,
    id: localId('msg'),
    order,
    timestamp: new Date().toISOString(),
    edited: false,
    // Give the duplicate its own reactions/attachments/mentions data (deep
    // enough to cover nested arrays like userIds) so mutating one message
    // can never affect the other.
    reactions: (original.reactions || []).map((r) => ({ ...r, userIds: [...(r.userIds || [])] })),
    attachments: (original.attachments || []).map((a) => ({ ...a, file: a.file ? { ...a.file } : a.file })),
    mentions: (original.mentions || []).map((m) => ({ ...m }))
  };
  return {
    do: () => { store.getState().messages.push(copy); },
    undo: () => { const s = store.getState(); s.messages = s.messages.filter((m) => m.id !== copy.id); }
  };
}

function cmdMoveMessageBefore(dragId, targetId) {
  const state = store.getState();
  const dragged = state.messages.find((m) => m.id === dragId);
  if (!dragged) return { do: () => {}, undo: () => {} };
  const channelId = dragged.channelId;
  const before = {};
  state.messages.filter((m) => m.channelId === channelId).forEach((m) => { before[m.id] = m.order; });

  return {
    do: () => {
      const s = store.getState();
      const msgs = s.messages.filter((m) => m.channelId === channelId).sort((a, b) => a.order - b.order);
      const dragIdx = msgs.findIndex((m) => m.id === dragId);
      if (dragIdx < 0) return;
      const [moved] = msgs.splice(dragIdx, 1);
      const targetIdx = msgs.findIndex((m) => m.id === targetId);
      msgs.splice(targetIdx < 0 ? msgs.length : targetIdx, 0, moved);
      msgs.forEach((m, i) => { m.order = i; });
    },
    undo: () => {
      const s = store.getState();
      for (const m of s.messages) {
        if (Object.prototype.hasOwnProperty.call(before, m.id)) m.order = before[m.id];
      }
    }
  };
}

function cmdRenameCharacter(id, name) {
  const character = store.getState().characters.find((c) => c.id === id);
  if (!character) return { do: () => {}, undo: () => {} };
  const oldName = character.name;
  return {
    do: () => { character.name = name; },
    undo: () => { character.name = oldName; }
  };
}

function cmdDeleteCharacter(id) {
  const state = store.getState();
  const idx = state.characters.findIndex((c) => c.id === id);
  const removed = state.characters[idx];
  const wasSpeaker = state.ui.currentSpeakerId === id;
  return {
    do: () => {
      const s = store.getState();
      const i = s.characters.findIndex((c) => c.id === id);
      if (i >= 0) s.characters.splice(i, 1);
      if (s.ui.currentSpeakerId === id) s.ui.currentSpeakerId = null;
    },
    undo: () => {
      const s = store.getState();
      const safeIdx = Math.min(idx, s.characters.length);
      s.characters.splice(safeIdx, 0, removed);
      if (wasSpeaker) s.ui.currentSpeakerId = id;
    }
  };
}

async function addCharacterFlow() {
  const name = await showPrompt({ title: 'Add Character', label: 'Character name', defaultValue: '' , placeholder: 'e.g. Alex'});
  if (!name) return null;
  const character = createCharacter(name);
  const wasSpeakerless = !store.getState().ui.currentSpeakerId;

  runCommand({
    do: () => { store.getState().characters.push(character); },
    undo: () => {
      const s = store.getState();
      s.characters = s.characters.filter((c) => c.id !== character.id);
      if (s.ui.currentSpeakerId === character.id) s.ui.currentSpeakerId = null;
    }
  }, 'characters');

  if (wasSpeakerless) {
    mutateProject((s) => { s.ui.currentSpeakerId = character.id; }, 'characters');
  }

  const wantsAvatar = await showConfirm({
    title: 'Add an Avatar?',
    message: `Would you like to choose an avatar image for ${name} now? You can always change it later.`,
    confirmLabel: 'Choose Avatar...'
  });
  if (wantsAvatar) await changeAvatar(character.id);

  return character.id;
}

async function changeAvatar(characterId) {
  if (!window.dvm) return false;
  const filePath = await window.dvm.selectAvatar();
  if (!filePath) return false;
  const character = store.getState().characters.find((c) => c.id === characterId);
  if (!character) return false;
  const oldAvatar = character.avatar;
  const newAvatar = { type: 'temp', path: filePath };
  runCommand({
    do: () => { character.avatar = newAvatar; },
    undo: () => { character.avatar = oldAvatar; }
  }, 'characters');
  return true;
}

function duplicateCharacter(id) {
  const original = store.getState().characters.find((c) => c.id === id);
  if (!original) return Promise.resolve(false);
  const copy = { ...original, id: localId('char'), name: `${original.name} (copy)` };
  runCommand({
    do: () => { store.getState().characters.push(copy); },
    undo: () => { const s = store.getState(); s.characters = s.characters.filter((c) => c.id !== copy.id); }
  }, 'characters');
  return Promise.resolve(true);
}

// ---------------------------------------------------------------------------
// Reaction count automation (Feature 7) — moves a reaction's universal
// `count` toward a target, either instantly or gradually over a duration.
// Never touches `userIds` (per-user active state stays exactly as-is), so
// manual toggles before/during/after automation keep working on the same
// shared count via ctx.actions.toggleReaction above.
// ---------------------------------------------------------------------------
function setReactionCount(messageId, emoji, count) {
  mutateProject((s) => {
    const message = s.messages.find((m) => m.id === messageId);
    if (!message) return;
    if (!Array.isArray(message.reactions)) message.reactions = [];
    let reaction = message.reactions.find((r) => r.emoji === emoji);
    if (!reaction) {
      reaction = { emoji, userIds: [], count: 0 };
      message.reactions.push(reaction);
    }
    reaction.count = Math.max(0, count);
    if (reaction.count <= 0 && reaction.userIds.length === 0) {
      const ridx = message.reactions.indexOf(reaction);
      if (ridx >= 0) message.reactions.splice(ridx, 1);
    }
  }, 'messages');
}

function startReactionAutomation(messageId, emoji, { targetCount, mode, durationSeconds, randomize }) {
  const target = Math.max(0, Math.round(targetCount) || 0);

  if (mode !== 'gradual') {
    setReactionCount(messageId, emoji, target);
    return;
  }

  const durationMs = Math.max(1, durationSeconds || 5) * 1000;
  const steps = Math.min(8, Math.max(3, Math.round(durationMs / 1000)));
  const values = [];
  for (let i = 1; i <= steps; i += 1) {
    values.push(Math.round((target * i) / steps));
  }
  values[values.length - 1] = target; // always land exactly on target

  if (randomize) {
    for (let i = 0; i < values.length - 1; i += 1) {
      const jitter = Math.round((Math.random() - 0.5) * target * 0.15);
      values[i] = Math.max(0, values[i] + jitter);
    }
    for (let i = 1; i < values.length - 1; i += 1) {
      if (values[i] < values[i - 1]) values[i] = values[i - 1];
      if (values[i] > target) values[i] = Math.max(0, target - 1);
    }
  }

  const stepMs = durationMs / steps;
  values.forEach((value, i) => {
    setTimeout(() => setReactionCount(messageId, emoji, value), Math.round(stepMs * (i + 1)));
  });
}

// ---------------------------------------------------------------------------
// Non-undoable project-level mutation helper (channels, servers, ui toggles)
// ---------------------------------------------------------------------------
function mutateProject(fn, scope) {
  fn(store.getState());
  store.markDirty();
  refresh(scope || 'all');
  updateTitle();
  syncMenuState();
}

// ---------------------------------------------------------------------------
// Project data sanity check (defends against corrupted/older files)
// ---------------------------------------------------------------------------
function normalizeReactions(reactions) {
  if (!Array.isArray(reactions)) return [];
  return reactions.map((r) => {
    if (r && Array.isArray(r.userIds) && typeof r.count === 'number') return r; // already current shape
    // Legacy shape was just `{ emoji }` — presence with no per-user data.
    return { emoji: r.emoji, userIds: [], count: 1 };
  });
}

function normalizeProject(data) {
  const fallback = createEmptyProject();
  const project = {
    version: data.version || 1,
    meta: { name: (data.meta && data.meta.name) || 'Untitled Project' },
    servers: Array.isArray(data.servers) && data.servers.length ? data.servers : fallback.servers,
    characters: (Array.isArray(data.characters) ? data.characters : []).map((c) => ({
      status: 'online',
      ...c
    })),
    // Backfill reactions/attachments/mentions/effect for messages saved by
    // older versions of the app that didn't have these fields yet. Legacy
    // reactions (just `{emoji}`, no per-user data) become a universal
    // count of 1 with no attributed user — the pill stays visible, but
    // there's no way to know retroactively who reacted.
    messages: (Array.isArray(data.messages) ? data.messages : []).map((m) => {
      const withDefaults = { attachments: [], mentions: [], effect: null, ...m };
      withDefaults.reactions = normalizeReactions(m.reactions);
      return withDefaults;
    }),
    script: (data.script && Array.isArray(data.script.events)) ? data.script : { events: [] },
    ui: {
      currentServerId: null,
      currentChannelId: null,
      currentSpeakerId: null,
      membersVisible: true,
      storyboardVisible: false,
      speakerSelectorVisible: true,
      fakeTypingEnabled: false,
      typingCharacterId: null,
      storyboardMode: 'reorder',
      scriptVisible: false,
      channelSidebarVisible: true,
      reactionCountPanel: null,
      reactionHighlightEnabled: true,
      messageHoverHighlightEnabled: true,
      selectedHighlightEnabled: true,
      ...(data.ui || {})
    }
  };

  if (!project.servers.some((s) => s.id === project.ui.currentServerId)) {
    project.ui.currentServerId = project.servers[0].id;
  }
  const currentServer = project.servers.find((s) => s.id === project.ui.currentServerId);
  const channelIds = currentServer.channels.map((c) => c.id);
  if (!channelIds.includes(project.ui.currentChannelId)) {
    const firstText = currentServer.channels.find((c) => c.type === 'text');
    project.ui.currentChannelId = firstText ? firstText.id : null;
  }
  if (!project.characters.some((c) => c.id === project.ui.currentSpeakerId)) {
    project.ui.currentSpeakerId = project.characters.length ? project.characters[0].id : null;
  }

  return project;
}

// ---------------------------------------------------------------------------
// File operations
// ---------------------------------------------------------------------------
async function confirmDiscardIfDirty(actionLabel) {
  if (!store.dirty) return true;
  return showConfirm({
    title: 'Unsaved Changes',
    message: `You have unsaved changes. ${actionLabel} without saving?`,
    confirmLabel: 'Continue Without Saving',
    danger: true
  });
}

async function newProject() {
  const ok = await confirmDiscardIfDirty('Start a new project');
  if (!ok) return;
  store.replaceState(createEmptyProject(), { markDirty: false });
  store.projectDir = null;
  selectedMessageId = null;
  history.clear();
  refreshAll();
  syncMenuState();
  updateTitle();
  showToast('New project created.');
}

async function openProject() {
  const ok = await confirmDiscardIfDirty('Open a different project');
  if (!ok) return;
  if (!window.dvm) return;
  const result = await window.dvm.openProject();
  if (!result) return;
  if (result.error) {
    showToast(result.error, 'error');
    return;
  }
  const normalized = normalizeProject(result.data);
  store.replaceState(normalized, { markDirty: false });
  store.projectDir = result.projectDir;
  selectedMessageId = null;
  history.clear();
  refreshAll();
  syncMenuState();
  updateTitle();
  showToast('Project opened.');
}

async function saveProject() {
  if (!window.dvm) return;
  if (!store.projectDir) {
    await saveProjectAs();
    return;
  }
  try {
    const result = await window.dvm.saveProject(store.projectDir, store.getState());
    if (!result) return;
    store.replaceState(normalizeProject(result.data), { markDirty: false });
    refreshAll();
    syncMenuState();
    updateTitle();
    showToast('Project saved.');
  } catch (err) {
    showToast(`Save failed: ${err.message}`, 'error');
  }
}

async function saveProjectAs() {
  if (!window.dvm) return;
  const name = await showPrompt({
    title: 'Save Project As',
    label: 'Project name',
    defaultValue: store.getState().meta.name || 'MyProject'
  });
  if (!name) return;

  const state = store.getState();
  state.meta.name = name;

  try {
    const result = await window.dvm.saveProjectAs(state);
    if (!result) return;
    store.projectDir = result.projectDir;
    store.replaceState(normalizeProject(result.data), { markDirty: false });
    refreshAll();
    syncMenuState();
    updateTitle();
    showToast('Project saved.');
  } catch (err) {
    showToast(`Save failed: ${err.message}`, 'error');
  }
}

// ---------------------------------------------------------------------------
// Keyboard shortcuts handled in the renderer (not covered by the app menu)
// ---------------------------------------------------------------------------
document.addEventListener('keydown', (e) => {
  const tag = (document.activeElement && document.activeElement.tagName) || '';
  const isTyping = tag === 'INPUT' || tag === 'TEXTAREA';

  if (e.key === 'Delete' && !isTyping && selectedMessageId) {
    e.preventDefault();
    chatView.deleteSelected();
  }
});

// ---------------------------------------------------------------------------
// Menu (main process) wiring
// ---------------------------------------------------------------------------
if (window.dvm) {
  window.dvm.onMenu('menu:new-project', newProject);
  window.dvm.onMenu('menu:open-project', openProject);
  window.dvm.onMenu('menu:save', saveProject);
  window.dvm.onMenu('menu:save-as', saveProjectAs);
  window.dvm.onMenu('menu:undo', () => history.undo());
  window.dvm.onMenu('menu:redo', () => history.redo());
  window.dvm.onMenu('menu:manage-characters', () => characterManager.open());
  window.dvm.onMenu('menu:toggle-members', () => ctx.actions.toggleMembers());
  window.dvm.onMenu('menu:toggle-storyboard', () => ctx.actions.toggleStoryboard());
  window.dvm.onMenu('menu:toggle-script', () => ctx.actions.toggleScript());
  window.dvm.onMenu('menu:toggle-speaker-selector', () => ctx.actions.toggleSpeakerSelector());
  window.dvm.onMenu('menu:toggle-fake-typing', () => ctx.actions.toggleFakeTyping());
  window.dvm.onMenu('menu:toggle-reaction-highlight', () => ctx.actions.toggleReactionHighlight());
  window.dvm.onMenu('menu:toggle-hover-highlight', () => ctx.actions.toggleMessageHoverHighlight());
  window.dvm.onMenu('menu:toggle-selected-highlight', () => ctx.actions.toggleSelectedHighlight());
  window.dvm.onMenu('menu:about', () => showAbout());
  window.dvm.onMenu('app:request-close', async () => {
    if (!store.dirty) {
      window.dvm.confirmClose();
      return;
    }
    const ok = await showConfirm({
      title: 'Unsaved Changes',
      message: 'You have unsaved changes. Close Discord Video Maker without saving?',
      confirmLabel: 'Close Without Saving',
      danger: true
    });
    if (ok) window.dvm.confirmClose();
  });
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
refreshAll();
syncMenuState();
updateTitle();
