import { el, clear, initials, colorForId } from '../utils/dom.js';
import { resolveAvatarUrl, resolveAssetUrl } from '../utils/avatar.js';
import { showContextMenu, closeContextMenu } from './contextMenu.js';
import { createAttachment } from '../models.js';
import { classifyAttachmentKind, iconFor } from '../utils/fileIcon.js';
import { PICKER_EMOJIS } from '../utils/emojis.js';

function basename(filePath) {
  const normalized = filePath.replace(/\\/g, '/');
  const parts = normalized.split('/');
  return parts[parts.length - 1];
}

// Inserts an emoji into the composer textarea at the current cursor
// position (or replaces the current selection), then restores focus so the
// user can keep typing immediately. This is a distinct system from message
// reactions — it edits the text itself.
function insertEmojiAtCursor(textarea, emoji, afterInsert) {
  const start = textarea.selectionStart ?? textarea.value.length;
  const end = textarea.selectionEnd ?? textarea.value.length;
  const value = textarea.value;
  textarea.value = value.slice(0, start) + emoji + value.slice(end);
  const newPos = start + emoji.length;
  textarea.focus();
  textarea.setSelectionRange(newPos, newPos);
  if (afterInsert) afterInsert();
}

// Finds the "@partial-name" token the cursor is currently sitting inside of
// (if any) — must start at the beginning of the text or right after
// whitespace, and contain no whitespace of its own.
function findActiveMentionToken(text, cursor) {
  let start = -1;
  for (let i = cursor - 1; i >= 0; i -= 1) {
    const ch = text[i];
    if (ch === '@') { start = i; break; }
    if (/\s/.test(ch)) return null;
  }
  if (start === -1) return null;
  if (start > 0 && !/\s/.test(text[start - 1])) return null;
  const filter = text.slice(start + 1, cursor);
  if (/\s/.test(filter)) return null;
  return { start, end: cursor, filter };
}

export function createComposer(ctx) {
  const container = document.getElementById('composer-container');

  // Attachments queued for the NEXT message. Kept outside render() so
  // picking a file doesn't force a full composer re-render (which would
  // otherwise steal focus from the textarea while typing).
  let pendingAttachments = [];
  // Mentions inserted into the CURRENT unsent text, sent alongside it so
  // the message renderer can distinguish them from plain "@word" text.
  let pendingMentions = [];

  function currentChannelName() {
    const state = ctx.getState();
    for (const server of state.servers) {
      const ch = server.channels.find((c) => c.id === state.ui.currentChannelId);
      if (ch) return ch.name;
    }
    return 'general';
  }

  function speakerButton() {
    const state = ctx.getState();
    const speaker = state.characters.find((c) => c.id === state.ui.currentSpeakerId);

    const avatarEl = speaker
      ? (resolveAvatarUrl(speaker.avatar, ctx.getProjectDir())
        ? el('img', { className: 'mini-avatar', src: resolveAvatarUrl(speaker.avatar, ctx.getProjectDir()) })
        : el('div', { className: 'mini-avatar', style: `background:${colorForId(speaker.id)}`, text: initials(speaker.name) }))
      : el('div', { className: 'mini-avatar', style: 'background:#4b4d53;', text: '?' });

    const btn = el('div', { className: 'speaker-select' }, [
      avatarEl,
      el('span', { text: speaker ? speaker.name : 'Select speaker' }),
      el('span', { className: 'caret', text: '▾' })
    ]);

    btn.addEventListener('click', (e) => {
      const state2 = ctx.getState();
      const rect = btn.getBoundingClientRect();
      const items = state2.characters.map((c) => ({
        label: c.name,
        icon: c.id === state2.ui.currentSpeakerId ? '●' : '',
        onClick: () => { ctx.actions.selectSpeaker(c.id); render(); }
      }));
      if (!items.length) {
        items.push({ label: 'No characters yet — add one first', onClick: () => ctx.actions.openCharacterManager() });
      } else {
        items.push({ type: 'separator' });
        items.push({ label: 'Manage Characters...', icon: '⚙', onClick: () => ctx.actions.openCharacterManager() });
      }
      showContextMenu(rect.left, rect.top - 8 - items.length * 34, items);
    });

    return btn;
  }

  function buildPreviewChip(attachment, previewList) {
    let chip;
    const removeBtn = el('button', {
      title: 'Remove attachment',
      text: '✕',
      onclick: () => {
        pendingAttachments = pendingAttachments.filter((a) => a.id !== attachment.id);
        chip.remove();
        previewList.classList.toggle('hidden', pendingAttachments.length === 0);
      }
    });

    let thumb;
    if (attachment.kind === 'image' || attachment.kind === 'gif') {
      const url = resolveAssetUrl(attachment.file, ctx.getProjectDir());
      thumb = el('img', { className: 'pending-attachment-thumb', src: url });
    } else {
      thumb = el('span', { className: 'pending-attachment-file-icon', text: iconFor(attachment.filename) });
    }

    chip = el('div', { className: 'pending-attachment-chip' }, [
      thumb,
      el('span', { className: 'pending-attachment-name', text: attachment.filename }),
      removeBtn
    ]);
    return chip;
  }

  function render() {
    clear(container);
    const state = ctx.getState();

    const speakerRow = state.ui.speakerSelectorVisible !== false
      ? el('div', { className: 'speaker-row' }, [
        el('span', { text: 'Speaking as:' }),
        speakerButton()
      ])
      : null;

    const previewList = el('div', { className: `pending-attachments${pendingAttachments.length ? '' : ' hidden'}` });
    pendingAttachments.forEach((attachment) => previewList.appendChild(buildPreviewChip(attachment, previewList)));

    const textarea = el('textarea', {
      className: 'composer-textarea',
      rows: '1',
      placeholder: `Message #${currentChannelName()}`
    });

    function autoResize() {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 220)}px`;
    }

    let activeMentionToken = null;

    function insertMention(mention) {
      if (!activeMentionToken) return;
      const { start, end } = activeMentionToken;
      const value = textarea.value;
      const insertText = `${mention.raw} `;
      textarea.value = value.slice(0, start) + insertText + value.slice(end);
      pendingMentions.push(mention);
      const newPos = start + insertText.length;
      textarea.focus();
      textarea.setSelectionRange(newPos, newPos);
      autoResize();
      activeMentionToken = null;
    }

    function checkMentionTrigger() {
      const cursor = textarea.selectionStart;
      const token = findActiveMentionToken(textarea.value, cursor);
      if (!token) {
        if (activeMentionToken) closeContextMenu();
        activeMentionToken = null;
        return;
      }
      activeMentionToken = token;
      const state = ctx.getState();
      const filterLower = token.filter.toLowerCase();
      const items = [];
      if (!filterLower || 'everyone'.startsWith(filterLower)) {
        items.push({ label: '@everyone', onClick: () => insertMention({ type: 'everyone', raw: '@everyone' }) });
      }
      state.characters
        .filter((c) => c.name.toLowerCase().includes(filterLower))
        .forEach((c) => items.push({ label: c.name, onClick: () => insertMention({ type: 'character', characterId: c.id, raw: `@${c.name}` }) }));

      if (!items.length) {
        closeContextMenu();
        return;
      }
      const rect = textarea.getBoundingClientRect();
      showContextMenu(rect.left, rect.top - 8 - items.length * 34, items);
    }

    function send() {
      const text = textarea.value.trim();
      if (!text && pendingAttachments.length === 0) return;
      const currentState = ctx.getState();
      if (!currentState.ui.currentSpeakerId) {
        ctx.notify('Pick a speaker before sending a message.', 'error');
        return;
      }
      closeContextMenu();
      activeMentionToken = null;
      ctx.actions.sendMessage(text, pendingAttachments.length ? pendingAttachments : undefined, pendingMentions.length ? pendingMentions : undefined);
      pendingAttachments = [];
      pendingMentions = [];
      clear(previewList);
      previewList.classList.add('hidden');
      textarea.value = '';
      autoResize();
    }

    textarea.addEventListener('input', () => { autoResize(); checkMentionTrigger(); });
    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        send();
      }
      // Shift+Enter falls through to default (newline)
    });

    async function pickAttachments() {
      if (!window.dvm || !window.dvm.selectAttachments) return;
      const filePaths = await window.dvm.selectAttachments();
      if (!filePaths || !filePaths.length) return;
      for (const filePath of filePaths) {
        const filename = basename(filePath);
        const attachment = createAttachment({
          kind: classifyAttachmentKind(filename),
          filename,
          file: { type: 'temp', path: filePath }
        });
        pendingAttachments.push(attachment);
        previewList.appendChild(buildPreviewChip(attachment, previewList));
      }
      previewList.classList.remove('hidden');
    }

    const box = el('div', { className: 'composer-box' }, [
      el('button', { className: 'composer-icon-btn', title: 'Add character', text: '+', onclick: () => ctx.actions.openCharacterManager() }),
      el('button', { className: 'composer-icon-btn', title: 'Attach a file', text: '📎', onclick: pickAttachments }),
      textarea,
      el('button', {
        className: 'composer-icon-btn',
        title: 'Insert emoji',
        text: '🙂',
        onclick: (e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const items = PICKER_EMOJIS.map((emoji) => ({
            label: emoji,
            onClick: () => insertEmojiAtCursor(textarea, emoji, autoResize)
          }));
          // Same "open upward from a bottom-anchored button" approach already used by speakerButton() above.
          showContextMenu(rect.left, rect.top - 8 - items.length * 34, items);
        }
      })
    ]);

    if (speakerRow) container.appendChild(speakerRow);
    container.appendChild(previewList);
    container.appendChild(box);

    setTimeout(autoResize, 0);
  }

  return { render };
}
