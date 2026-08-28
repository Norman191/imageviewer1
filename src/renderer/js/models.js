// Central data model for a Discord Video Maker project.
//
//   Project
//    |- meta        { name }
//    |- servers[]    { id, name, channels[] }
//    |    channel:   { id, name, type: 'text' | 'voice' }
//    |- characters[] { id, name, avatar, color, status }
//    |- messages[]   { id, channelId, characterId, text, timestamp, order, edited,
//    |                 reactions[]: { emoji, userIds[], count }, attachments[]: { id, kind, filename, file },
//    |                 mentions[]: { type, characterId?, raw }, effect }
//    |- script       { events[]: { id, time, characterId, action, payload } }
//    |- ui           { currentServerId, currentChannelId, currentSpeakerId, membersVisible,
//    |                 storyboardVisible, speakerSelectorVisible, fakeTypingEnabled,
//    |                 typingCharacterId, storyboardMode }
//
// NOTE: intentionally no video-rendering/export fields yet (that's a later phase).
// All fields added after the initial release are optional/backwards-compatible —
// see normalizeProject() in app.js, which backfills them for older saved projects.

let idCounter = 0;
export function localId(prefix = 'id') {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${idCounter}_${Math.random().toString(36).slice(2, 7)}`;
}

export function createChannel(name, type = 'text') {
  return { id: localId('ch'), name, type };
}

export function createServer(name) {
  return {
    id: localId('srv'),
    name,
    channels: [
      createChannel('general', 'text'),
      createChannel('memes', 'text'),
      createChannel('gaming', 'text'),
      createChannel('General', 'voice')
    ]
  };
}

export function createCharacter(name) {
  return {
    id: localId('char'),
    name,
    avatar: null, // { type: 'temp'|'project', path }
    color: null,
    status: 'online' // 'online' | 'offline'
  };
}

export function createMessage({ channelId, characterId, text, order, attachments, mentions }) {
  return {
    id: localId('msg'),
    channelId,
    characterId,
    text,
    timestamp: new Date().toISOString(),
    order,
    edited: false,
    reactions: [], // [{ emoji, userIds: [characterId,...], count }]
    attachments: Array.isArray(attachments) ? attachments : [],
    mentions: Array.isArray(mentions) ? mentions : [], // [{ type:'character', characterId, raw } | { type:'everyone', raw }]
    effect: null // null | 'highlight'|'shake'|'pop'|'flash'|'emphasis'
  };
}

// A pending/saved attachment reference. `file` follows the same shape as a
// character avatar reference ({ type: 'temp'|'project', path }) so the
// existing avatar-resolving/copy-on-save logic can be reused as-is.
export function createAttachment({ kind, filename, file, token }) {
  return {
    id: localId('att'),
    kind, // 'image' | 'gif' | 'file'
    filename,
    file,
    // Optional — links this attachment to an inline [IMGn]-style
    // placeholder in a message's text (see the Auto Script inline
    // picker). Attachments without a token render below the text as
    // before; the main composer never sets one.
    token: token || null
  };
}

// A script/storyboard event, driving scripted playback into the real chat.
// action: 'message' | 'typing' | 'reaction' | 'wait'
//   message  -> payload: { text, attachments }
//   typing   -> payload: {} (characterId shown as "typing")
//   reaction -> payload: { targetEventId, emoji }
//   wait     -> payload: { seconds }
export function createScriptEvent({ time, characterId, action, payload }) {
  return {
    id: localId('evt'),
    time, // seconds from script start
    characterId: characterId || null,
    action,
    payload: payload || {}
  };
}

export function createEmptyProject() {
  const server = createServer('My Server');
  return {
    version: 1,
    meta: { name: 'Untitled Project' },
    servers: [server],
    characters: [],
    messages: [],
    script: { events: [] },
    ui: {
      currentServerId: server.id,
      currentChannelId: server.channels[0].id,
      currentSpeakerId: null,
      membersVisible: true,
      storyboardVisible: false,
      speakerSelectorVisible: true,
      fakeTypingEnabled: false,
      typingCharacterId: null,
      storyboardMode: 'reorder', // 'reorder' | 'script'
      scriptVisible: false,
      channelSidebarVisible: true,
      reactionCountPanel: null, // { messageId, emoji } | null
      reactionHighlightEnabled: true,
      messageHoverHighlightEnabled: true,
      selectedHighlightEnabled: true
    }
  };
}
