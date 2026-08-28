import { el, clear, initials, formatTimestamp, colorForId } from '../utils/dom.js';
import { resolveAvatarUrl, resolveAssetUrl } from '../utils/avatar.js';
import { showContextMenu } from './contextMenu.js';
import { showConfirm } from './modals.js';
import { PICKER_EMOJIS } from '../utils/emojis.js';
import { classifyAttachmentKind, iconFor } from '../utils/fileIcon.js';
import { renderMessageText } from '../utils/messageText.js';

const GROUP_WINDOW_MS = 5 * 60 * 1000; // messages within 5 minutes group together

export function createChatView(ctx) {
  const headerEl = document.getElementById('chat-header');
  const listEl = document.getElementById('messages-list');
  const scrollEl = document.getElementById('messages-scroll');

  let editingMessageId = null;
  let stickyResizeObserver = null;
  let stickyResizeTimeout = null;

  // Forces the chat to the bottom, then keeps re-asserting that for a short
  // window afterward via ResizeObserver — catches ANY cause of late layout
  // growth (an attachment finishing decode, content-visibility promoting an
  // off-screen row to full layout, etc.), not just image `load` timing.
  // Stops watching after the window so a later, unrelated resize (e.g. the
  // user resizing the window) doesn't keep fighting a manual scroll-up.
  function armStickyScroll() {
    const scrollToBottom = () => { scrollEl.scrollTop = scrollEl.scrollHeight; };
    scrollToBottom();
    requestAnimationFrame(scrollToBottom);

    if (stickyResizeObserver) stickyResizeObserver.disconnect();
    if (stickyResizeTimeout) clearTimeout(stickyResizeTimeout);

    stickyResizeObserver = new ResizeObserver(() => scrollToBottom());
    stickyResizeObserver.observe(listEl);

    stickyResizeTimeout = setTimeout(() => {
      if (stickyResizeObserver) {
        stickyResizeObserver.disconnect();
        stickyResizeObserver = null;
      }
    }, 1500);
  }

  function getCharacter(id) {
    return ctx.getState().characters.find((c) => c.id === id) || null;
  }

  function avatarNode(character, size = 40) {
    const url = character ? resolveAvatarUrl(character.avatar, ctx.getProjectDir()) : null;
    if (url) {
      return el('img', { className: 'message-avatar', src: url, style: `width:${size}px;height:${size}px;` });
    }
    const bg = character ? colorForId(character.id) : '#5c6bc0';
    return el('div', {
      className: 'message-avatar',
      style: `width:${size}px;height:${size}px;background:${bg};`,
      text: initials(character ? character.name : '?')
    });
  }

  function renderHeader() {
    const state = ctx.getState();
    const channel = findCurrentChannel(state);
    clear(headerEl);
    headerEl.appendChild(el('span', { className: 'hash', text: '#' }));
    headerEl.appendChild(el('span', { className: 'channel-name', text: channel ? channel.name : 'no-channel' }));
    headerEl.appendChild(el('div', { className: 'divider' }));
    headerEl.appendChild(el('span', { className: 'app-title', text: 'Discord Video Maker' }));
    headerEl.appendChild(el('div', { className: 'spacer' }));
    headerEl.appendChild(el('button', {
      className: 'icon-btn',
      title: state.ui.channelSidebarVisible === false ? 'Show Server Panel' : 'Hide Server Panel',
      text: '🫠',
      onclick: () => ctx.actions.toggleChannelSidebar()
    }));
    headerEl.appendChild(el('button', {
      className: 'icon-btn',
      title: 'Toggle Storyboard',
      text: '🎞',
      onclick: () => ctx.actions.toggleStoryboard()
    }));
    headerEl.appendChild(el('button', {
      className: 'icon-btn',
      title: 'Toggle Auto Script',
      text: '🕶️',
      onclick: () => ctx.actions.toggleScript()
    }));
    headerEl.appendChild(el('button', {
      className: 'icon-btn',
      title: 'Toggle Member List',
      text: '👥',
      onclick: () => ctx.actions.toggleMembers()
    }));
  }

  function findCurrentChannel(state) {
    for (const server of state.servers) {
      const channel = server.channels.find((c) => c.id === state.ui.currentChannelId);
      if (channel) return channel;
    }
    return null;
  }

  function currentChannelMessages(state) {
    return state.messages
      .filter((m) => m.channelId === state.ui.currentChannelId)
      .sort((a, b) => a.order - b.order);
  }

  function currentSpeakerId() {
    return ctx.getState().ui.currentSpeakerId;
  }

  function hasReaction(message, emoji, characterId) {
    if (!characterId) return false;
    const reaction = Array.isArray(message.reactions) && message.reactions.find((r) => r.emoji === emoji);
    return !!(reaction && Array.isArray(reaction.userIds) && reaction.userIds.includes(characterId));
  }

  function reactionCount(message, emoji) {
    const reaction = Array.isArray(message.reactions) && message.reactions.find((r) => r.emoji === emoji);
    return reaction ? reaction.count : 0;
  }

  function toggleReactionAsCurrentSpeaker(messageId, emoji) {
    const characterId = currentSpeakerId();
    if (!characterId) {
      ctx.notify('Select a speaking character first.', 'error');
      return;
    }
    ctx.actions.toggleReaction(messageId, emoji, characterId);
  }

  async function openReactionAutomationFlow(message, emoji) {
    ctx.actions.openReactionCountPanel(message.id, emoji);
  }

  function reactionHighlightEnabled() {
    return ctx.getState().ui.reactionHighlightEnabled !== false;
  }

  function openReactionPicker(message, anchorRect) {
    const speakerId = currentSpeakerId();
    const items = PICKER_EMOJIS.map((emoji) => ({
      label: `${emoji}${reactionCount(message, emoji) ? ` (${reactionCount(message, emoji)})` : ''}`,
      icon: (reactionHighlightEnabled() && hasReaction(message, emoji, speakerId)) ? '●' : '',
      onClick: () => toggleReactionAsCurrentSpeaker(message.id, emoji),
      onContextMenu: () => ctx.actions.openReactionCountPanel(message.id, emoji)
    }));
    showContextMenu(anchorRect.left, anchorRect.bottom + 4, items);
  }

  function buildActions(message) {
    const speakerId = currentSpeakerId();
    return el('div', { className: 'message-actions' }, [
      el('button', {
        className: (reactionHighlightEnabled() && hasReaction(message, '👍', speakerId)) ? 'active' : '',
        title: 'Like',
        text: '👍',
        onclick: (e) => { e.stopPropagation(); toggleReactionAsCurrentSpeaker(message.id, '👍'); },
        oncontextmenu: (e) => { e.preventDefault(); e.stopPropagation(); ctx.actions.openReactionCountPanel(message.id, '👍'); }
      }),
      el('button', {
        className: (reactionHighlightEnabled() && hasReaction(message, '👎', speakerId)) ? 'active' : '',
        title: 'Dislike',
        text: '👎',
        onclick: (e) => { e.stopPropagation(); toggleReactionAsCurrentSpeaker(message.id, '👎'); },
        oncontextmenu: (e) => { e.preventDefault(); e.stopPropagation(); ctx.actions.openReactionCountPanel(message.id, '👎'); }
      }),
      el('button', {
        title: 'Add Reaction',
        text: '😊',
        onclick: (e) => { e.stopPropagation(); openReactionPicker(message, e.currentTarget.getBoundingClientRect()); }
      }),
      el('button', {
        title: 'Edit',
        text: '✏️',
        onclick: (e) => { e.stopPropagation(); startEdit(message.id); }
      }),
      el('button', {
        title: 'Duplicate',
        text: '⧉',
        onclick: (e) => { e.stopPropagation(); ctx.actions.duplicateMessage(message.id); }
      }),
      el('button', {
        className: 'danger',
        title: 'Delete',
        text: '🗑',
        onclick: async (e) => {
          e.stopPropagation();
          const ok = await showConfirm({ title: 'Delete Message', message: 'Delete this message? This can be undone with Ctrl+Z.', confirmLabel: 'Delete', danger: true });
          if (ok) ctx.actions.deleteMessage(message.id);
        }
      })
    ]);
  }

  function buildReactionsRow(message) {
    if (!Array.isArray(message.reactions) || !message.reactions.length) return null;
    const speakerId = currentSpeakerId();
    const row = el('div', { className: 'message-reactions' });
    message.reactions.forEach((reaction) => {
      const active = reactionHighlightEnabled() && hasReaction(message, reaction.emoji, speakerId);
      const pill = el('button', {
        className: `reaction-pill${active ? ' active' : ''}`,
        title: `${reaction.count} reacted with ${reaction.emoji}`,
        onclick: (e) => { e.stopPropagation(); toggleReactionAsCurrentSpeaker(message.id, reaction.emoji); },
        oncontextmenu: (e) => { e.preventDefault(); e.stopPropagation(); openReactionAutomationFlow(message, reaction.emoji); }
      }, [
        el('span', { text: reaction.emoji }),
        el('span', { className: 'reaction-count', text: String(reaction.count) })
      ]);
      row.appendChild(pill);
    });
    return row;
  }

  function buildAttachmentElement(message, attachment) {
    const url = resolveAssetUrl(attachment.file, ctx.getProjectDir());
    // Re-derived from the filename rather than trusting the stored
    // `kind`, so attachments saved before video/audio support existed
    // still get the right treatment.
    const kind = classifyAttachmentKind(attachment.filename);

    let inner;
    if (kind === 'image' || kind === 'gif') {
      inner = el('img', { className: 'attachment-image', src: url, alt: attachment.filename });
    } else if (kind === 'video') {
      inner = el('video', { className: 'attachment-video', src: url, controls: 'true', preload: 'metadata' });
    } else if (kind === 'audio') {
      inner = el('audio', { className: 'attachment-audio', src: url, controls: 'true', preload: 'metadata' });
    } else {
      inner = el('div', { className: 'attachment-file-chip' }, [
        el('span', { className: 'attachment-file-icon', text: iconFor(attachment.filename) }),
        el('div', {}, [
          el('div', { className: 'attachment-file-name', text: attachment.filename }),
          el('div', { className: 'attachment-file-sub', text: attachment.filename })
        ])
      ]);
    }

    const removeBtn = el('button', {
      className: 'attachment-remove-btn',
      title: 'Remove this attachment',
      text: '✕',
      onclick: (e) => {
        e.preventDefault();
        e.stopPropagation();
        ctx.actions.removeAttachment(message.id, attachment.id);
      }
    });

    return el('div', { className: 'attachment-wrap' }, [inner, removeBtn]);
  }

  // Finds every attachment whose `token` (e.g. "[IMG1]") literally occurs in
  // the message text, in text order — used to splice actual images/files
  // into the text flow in place of the placeholder instead of leaving the
  // literal token visible.
  function findInlineAttachmentMatches(text, attachments) {
    const withTokens = (attachments || []).filter((a) => a.token);
    const matches = [];
    withTokens.forEach((attachment) => {
      const idx = text.indexOf(attachment.token);
      if (idx !== -1) matches.push({ start: idx, end: idx + attachment.token.length, attachment });
    });
    matches.sort((a, b) => a.start - b.start);
    const clean = [];
    let cursor = 0;
    for (const m of matches) {
      if (m.start < cursor) continue; // overlapping token, skip defensively
      clean.push(m);
      cursor = m.end;
    }
    return clean;
  }

  // Renders message text with inline [IMGn]-style attachments spliced in at
  // their placeholder's position (real images/files, never the literal
  // token text), and returns the attachments that were NOT referenced by a
  // token in the text so they can still render below as before.
  function buildMessageContent(body, message) {
    const text = message.text || '';
    const inlineMatches = findInlineAttachmentMatches(text, message.attachments);

    if (text) {
      const textEl = el('div', { className: `message-text${message.edited ? ' edited' : ''}` });
      if (!inlineMatches.length) {
        renderMessageText(textEl, text, message.mentions);
      } else {
        let cursor = 0;
        inlineMatches.forEach((m) => {
          if (m.start > cursor) renderMessageText(textEl, text.slice(cursor, m.start), message.mentions);
          textEl.appendChild(el('span', { className: 'inline-attachment' }, [buildAttachmentElement(message, m.attachment)]));
          cursor = m.end;
        });
        if (cursor < text.length) renderMessageText(textEl, text.slice(cursor), message.mentions);
      }
      body.appendChild(textEl);
    }

    const usedIds = new Set(inlineMatches.map((m) => m.attachment.id));
    const remaining = (message.attachments || []).filter((a) => !usedIds.has(a.id));
    if (remaining.length) {
      const row = el('div', { className: 'message-attachments' });
      remaining.forEach((attachment) => row.appendChild(buildAttachmentElement(message, attachment)));
      body.appendChild(row);
    }
  }

  // Keeps the hover action toolbar fully visible: default is anchored just
  // above the row. If there isn't room above (row scrolled near the top of
  // the viewport), try placing it below — but ONLY when this is the last
  // message (nothing below it to overlap) and there's genuinely enough
  // clear space before the bottom of the scroll viewport. Otherwise it
  // stays above but clamps its offset so it never pokes past the visible
  // top edge of the chat area, which keeps it attached to (and only
  // lightly overlapping, as by design) THIS row without ever reaching
  // into the next message.
  function positionActionsToolbar(row, actionsEl, isLastMessage) {
    const scrollRect = scrollEl.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    const defaultPokeUp = 5;

    actionsEl.classList.remove('toolbar-below');
    actionsEl.style.top = '';
    actionsEl.style.bottom = '';

    const spaceAbove = rowRect.top - scrollRect.top;
    if (spaceAbove >= defaultPokeUp) {
      return; // default CSS (-5px) already fits, nothing to do
    }

    const toolbarHeight = actionsEl.getBoundingClientRect().height || 36;
    const spaceBelow = scrollRect.bottom - rowRect.bottom;
    if (isLastMessage && spaceBelow >= toolbarHeight + defaultPokeUp) {
      actionsEl.classList.add('toolbar-below');
      return;
    }

    // Neither direction has full room — clamp to whatever space actually
    // exists above so the toolbar stays fully within the visible viewport.
    const clamped = Math.max(0, spaceAbove);
    actionsEl.style.top = `-${clamped}px`;
  }

  function buildMessageRow(message, prevMessage, character, isLastMessage) {
    const isGrouped = !!(
      prevMessage &&
      prevMessage.characterId === message.characterId &&
      (new Date(message.timestamp) - new Date(prevMessage.timestamp)) < GROUP_WINDOW_MS
    );

    const row = el('div', {
      className: `message-row${isGrouped ? ' grouped' : ''}${ctx.getSelectedMessageId() === message.id ? ' selected' : ''}${message.effect ? ` effect-${message.effect}` : ''}`,
      dataset: { id: message.id }
    });

    const gutter = el('div', { className: 'message-gutter' });
    if (isGrouped) {
      gutter.appendChild(el('div', { className: 'hover-timestamp', text: formatTimestamp(message.timestamp).split(' at ')[1] || '' }));
    } else {
      gutter.appendChild(avatarNode(character, 40));
    }
    row.appendChild(gutter);

    const body = el('div', { className: 'message-body' });

    if (!isGrouped) {
      body.appendChild(el('div', { className: 'message-header-row' }, [
        el('span', { className: 'message-username', style: `color:${character ? colorForId(character.id) : '#dbdee1'}`, text: character ? character.name : 'Unknown', onclick: (e) => { e.stopPropagation(); if (character) ctx.actions.selectSpeaker(character.id); } }),
        el('span', { className: 'message-timestamp', text: formatTimestamp(message.timestamp) })
      ]));
    }

    if (editingMessageId === message.id) {
      body.appendChild(buildEditBox(message));
    } else {
      buildMessageContent(body, message);
    }

    const reactionsEl = buildReactionsRow(message);
    if (reactionsEl) body.appendChild(reactionsEl);

    row.appendChild(body);
    const actionsEl = buildActions(message);
    row.appendChild(actionsEl);

    row.addEventListener('mouseenter', () => positionActionsToolbar(row, actionsEl, isLastMessage));

    row.addEventListener('click', () => {
      ctx.setSelectedMessageId(message.id);
      renderMessages({ preserveScroll: true });
    });

    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showContextMenu(e.clientX, e.clientY, [
        { label: 'Edit', icon: '✏️', onClick: () => startEdit(message.id) },
        { label: 'Duplicate', icon: '⧉', onClick: () => ctx.actions.duplicateMessage(message.id) },
        { type: 'separator' },
        {
          label: 'Add Effect...', icon: '✨', onClick: (ev) => {
            const rect = { left: e.clientX, bottom: e.clientY };
            showContextMenu(rect.left, rect.bottom, [
              { label: 'Highlight', onClick: () => ctx.actions.setMessageEffect(message.id, 'highlight') },
              { label: 'Shake', onClick: () => ctx.actions.setMessageEffect(message.id, 'shake') },
              { label: 'Pop', onClick: () => ctx.actions.setMessageEffect(message.id, 'pop') },
              { label: 'Flash', onClick: () => ctx.actions.setMessageEffect(message.id, 'flash') },
              { label: 'Emphasis', onClick: () => ctx.actions.setMessageEffect(message.id, 'emphasis') },
              { type: 'separator' },
              { label: 'Clear Effect', onClick: () => ctx.actions.setMessageEffect(message.id, null) }
            ]);
          }
        },
        { type: 'separator' },
        {
          label: 'Delete', icon: '🗑', danger: true, onClick: async () => {
            const ok = await showConfirm({ title: 'Delete Message', message: 'Delete this message? This can be undone with Ctrl+Z.', confirmLabel: 'Delete', danger: true });
            if (ok) ctx.actions.deleteMessage(message.id);
          }
        }
      ]);
    });

    return row;
  }

  function buildEditBox(message) {
    const wrap = el('div', { className: 'message-edit-box' });
    const textarea = el('textarea', { rows: '1' });
    textarea.value = message.text;

    function autoResize() {
      textarea.style.height = 'auto';
      textarea.style.height = `${textarea.scrollHeight}px`;
    }

    function commit() {
      const value = textarea.value.trim();
      editingMessageId = null;
      if (value && value !== message.text) {
        ctx.actions.editMessage(message.id, value);
      } else {
        renderMessages({ preserveScroll: true });
      }
    }
    function cancel() {
      editingMessageId = null;
      renderMessages({ preserveScroll: true });
    }

    textarea.addEventListener('input', autoResize);
    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commit(); }
      if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    });
    textarea.addEventListener('blur', () => setTimeout(commit, 100));

    wrap.appendChild(textarea);
    wrap.appendChild(el('div', { className: 'message-edit-hint', html: 'escape to <span>cancel</span> &bull; enter to save' }));

    setTimeout(() => { textarea.focus(); textarea.setSelectionRange(textarea.value.length, textarea.value.length); autoResize(); }, 0);
    return wrap;
  }

  function startEdit(messageId) {
    editingMessageId = messageId;
    renderMessages({ preserveScroll: true });
  }

  function buildTypingIndicatorRow() {
    const state = ctx.getState();
    if (!state.ui.fakeTypingEnabled || !state.ui.typingCharacterId) return null;
    const character = getCharacter(state.ui.typingCharacterId);
    if (!character) return null;
    return el('div', { className: 'message-row typing-indicator-row' }, [
      el('div', { className: 'message-gutter' }, [avatarNode(character, 40)]),
      el('div', { className: 'message-body' }, [
        el('div', { className: 'typing-indicator-text' }, [
          el('span', { text: `${character.name} is typing` }),
          el('span', { className: 'typing-dots', text: '...' })
        ])
      ])
    ]);
  }

  function renderMessages({ preserveScroll = false, stickToBottom = false } = {}) {
    const state = ctx.getState();
    const wasAtBottom = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight < 60;
    const prevScrollTop = scrollEl.scrollTop;

    clear(listEl);
    const messages = currentChannelMessages(state);

    if (!messages.length) {
      listEl.appendChild(el('div', { className: 'empty-state' }, [
        el('h3', { text: 'No messages yet' }),
        el('p', { text: 'Pick a speaker below and send your first message.' })
      ]));
    } else {
      let prev = null;
      for (let i = 0; i < messages.length; i += 1) {
        const message = messages[i];
        const character = getCharacter(message.characterId);
        listEl.appendChild(buildMessageRow(message, prev, character, i === messages.length - 1));
        prev = message;
      }
    }

    const typingRow = buildTypingIndicatorRow();
    if (typingRow) listEl.appendChild(typingRow);

    renderHeader();

    if (!messages.length && !typingRow) return;

    if (stickToBottom || (!preserveScroll) || wasAtBottom) {
      armStickyScroll();
    } else {
      scrollEl.scrollTop = prevScrollTop;
    }
  }

  function deleteSelected() {
    const id = ctx.getSelectedMessageId();
    if (!id) return;
    if (editingMessageId) return; // don't delete while typing an edit
    ctx.actions.deleteMessage(id);
  }

  return {
    render: renderMessages,
    renderHeader,
    deleteSelected,
    isEditing: () => editingMessageId !== null
  };
}
