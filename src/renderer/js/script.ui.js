import { el, clear } from './utils/dom.js';
import { showContextMenu } from './ui/contextMenu.js';
import { showConfirm, showPrompt } from './ui/modals.js';
import { PICKER_EMOJIS } from './utils/emojis.js';
import { createAttachment } from './models.js';
import { classifyAttachmentKind, iconFor } from './utils/fileIcon.js';
import { buildTemplateCsv, parseScriptCsv } from './utils/scriptCsv.js';

function basename(filePath) {
  const normalized = filePath.replace(/\\/g, '/');
  const parts = normalized.split('/');
  return parts[parts.length - 1];
}

function insertAtCursor(inputEl, text) {
  const start = inputEl.selectionStart ?? inputEl.value.length;
  const end = inputEl.selectionEnd ?? inputEl.value.length;
  const value = inputEl.value;
  inputEl.value = value.slice(0, start) + text + value.slice(end);
  const newPos = start + text.length;
  inputEl.focus();
  inputEl.setSelectionRange(newPos, newPos);
}

// The Auto Chat Script panel — separate from the Storyboard (which is
// visual/message reordering). This is the timed conversation script:
// structured Time/User/Action/Content events, played back into the real
// chat via playback.js. Reuses the existing emoji picker list and the
// existing per-user reaction system (via ctx.actions.toggleReaction,
// called from playback.js) rather than any separate reaction logic.
export function createScriptPanel(ctx) {
  const container = document.getElementById('script-panel');
  let selectedEventIds = new Set();
  let pendingReactionEmoji = '👍';
  let pendingReactionAutomation = null; // { targetCount, mode, durationSeconds, randomize } | null
  let reactionCounterConfigEmoji = null; // emoji currently being configured, or null if panel closed
  // Persisted across a render() triggered by opening the counter config
  // panel above, so the in-progress event form isn't lost mid-configuration.
  let pendingAction = 'message';
  let pendingTimeStr = '00:00';
  let pendingCharacterId = null;
  let pendingTargetEventId = null;
  let importErrors = [];

  function formatTime(seconds) {
    const s = Math.max(0, Math.round(seconds || 0));
    const mm = String(Math.floor(s / 60)).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    return `${mm}:${ss}`;
  }

  function parseTime(str) {
    const trimmed = (str || '').trim();
    if (/^\d+:\d{1,2}$/.test(trimmed)) {
      const [mm, ss] = trimmed.split(':').map(Number);
      return mm * 60 + ss;
    }
    const n = parseFloat(trimmed);
    return Number.isFinite(n) ? n : 0;
  }

  function targetTextFor(event, events) {
    if (event.action !== 'reaction' || !event.payload.targetEventId) return '';
    const target = events.find((e) => e.id === event.payload.targetEventId);
    if (!target) return '';
    if (target.action === 'message' || target.action === 'file') return target.payload.text || '';
    return '';
  }

  function renderHeader() {
    return el('div', { className: 'storyboard-header' }, [
      el('span', { text: 'Auto Chat Script' }),
      el('button', { text: '✕', onclick: () => ctx.actions.toggleScript() })
    ]);
  }

  function downloadTemplate() {
    const csv = buildTemplateCsv();
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = el('a', { href: url, download: 'auto-script-template.csv' });
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function uploadCsv() {
    if (!window.dvm || !window.dvm.selectAndReadTextFile) return;
    const result = await window.dvm.selectAndReadTextFile();
    if (!result) return;
    if (result.error) {
      ctx.notify(`Could not read file: ${result.error}`, 'error');
      return;
    }
    const state = ctx.getState();
    const { events, errors } = parseScriptCsv(result.content, state.characters);
    if (events.length) ctx.actions.importScriptEvents(events);
    importErrors = errors;
    if (errors.length) {
      ctx.notify(`Imported ${events.length} event(s) with ${errors.length} row error(s) — see details below.`, errors.length && !events.length ? 'error' : undefined);
    } else if (events.length) {
      ctx.notify(`Imported ${events.length} script event(s).`);
    } else {
      ctx.notify('No valid rows found in that file.', 'error');
    }
    render();
  }

  function renderImportErrors() {
    if (!importErrors.length) return null;
    return el('div', { className: 'script-import-errors' }, [
      el('div', { className: 'script-import-errors-header' }, [
        el('span', { text: `${importErrors.length} row error(s) from the last import` }),
        el('button', { text: '✕', title: 'Dismiss', onclick: () => { importErrors = []; render(); } })
      ]),
      el('ul', {}, importErrors.map((msg) => el('li', { text: msg })))
    ]);
  }

  function renderControls() {
    return el('div', { className: 'script-controls' }, [
      el('button', { className: 'btn btn-primary', text: '▶ Play', onclick: () => ctx.actions.playScript() }),
      el('button', { className: 'btn btn-secondary', text: '⏸ Pause', onclick: () => ctx.actions.pauseScript() }),
      el('button', { className: 'btn btn-secondary', text: '⏹ Stop', onclick: () => ctx.actions.stopScript() }),
      el('button', { className: 'btn btn-secondary', text: '⬇ Excel Template', title: 'Download a CSV template (opens/edits fine in Excel)', onclick: downloadTemplate }),
      el('button', { className: 'btn btn-secondary', text: '⬆ Upload Excel', title: 'Upload a filled-in CSV (exported/saved from Excel)', onclick: uploadCsv })
    ]);
  }

  // Builds the Select All / Deselect All / Edit / Delete toolbar. Returns
  // both the element and an `update()` function so checkbox toggles in the
  // table (see renderTable) can refresh the Edit/Delete labels immediately
  // without a full panel re-render.
  function buildSelectionToolbar(events) {
    const deleteBtn = el('button', {
      className: 'btn btn-danger',
      text: 'Delete',
      onclick: async () => {
        if (!selectedEventIds.size) return;
        const ok = await showConfirm({ title: 'Delete Selected Events', message: `Delete ${selectedEventIds.size} selected script event(s)?`, confirmLabel: 'Delete', danger: true });
        if (ok) {
          ctx.actions.deleteScriptEvents(Array.from(selectedEventIds));
          selectedEventIds = new Set();
          render();
        }
      }
    });

    const editBtn = el('button', {
      className: 'btn btn-secondary',
      text: 'Edit',
      onclick: async () => {
        if (selectedEventIds.size !== 1) return;
        const [eventId] = Array.from(selectedEventIds);
        const event = events.find((e) => e.id === eventId);
        if (!event || (event.action !== 'message' && event.action !== 'file')) return;
        const newText = await showPrompt({ title: 'Edit Scripted Message', label: 'Message text', defaultValue: event.payload.text || '' });
        if (newText === null) return;
        ctx.actions.updateScriptEvent(event.id, { payload: { ...event.payload, text: newText } });
      }
    });

    function update() {
      const count = selectedEventIds.size;
      deleteBtn.textContent = count ? `Delete (${count})` : 'Delete';
      deleteBtn.disabled = count === 0;

      const singleEvent = count === 1 ? events.find((e) => e.id === Array.from(selectedEventIds)[0]) : null;
      const canEdit = !!(singleEvent && (singleEvent.action === 'message' || singleEvent.action === 'file'));
      editBtn.disabled = !canEdit;
    }
    update();

    const toolbar = el('div', { className: 'script-controls' }, [
      el('button', { className: 'btn btn-secondary', text: 'Select All', onclick: () => { selectedEventIds = new Set(events.map((e) => e.id)); render(); } }),
      el('button', { className: 'btn btn-secondary', text: 'Deselect All', onclick: () => { selectedEventIds = new Set(); render(); } }),
      editBtn,
      deleteBtn
    ]);

    return { toolbar, update };
  }

  function renderTable(state, events, onSelectionChange) {
    const scroll = el('div', { className: 'script-table-scroll' });
    const table = el('div', { className: 'script-table' });
    table.appendChild(el('div', { className: 'script-row script-row-header' }, [
      el('span', { className: 'script-col-check', text: '' }),
      el('span', { className: 'script-col-time', text: 'Time' }),
      el('span', { className: 'script-col-user', text: 'User' }),
      el('span', { className: 'script-col-action', text: 'Action' }),
      el('span', { className: 'script-col-content', text: 'Content' }),
      el('span', { className: 'script-col-target', text: 'Target' }),
      el('span', { className: 'script-col-del', text: '' })
    ]));

    if (!events.length) {
      table.appendChild(el('div', { className: 'member-panel-empty', text: 'No script events yet. Add one below.' }));
    }

    events.forEach((event) => {
      const character = state.characters.find((c) => c.id === event.characterId);
      let contentText = '';
      if (event.action === 'message' || event.action === 'file') contentText = event.payload.text || '';
      else if (event.action === 'reaction') contentText = event.payload.emoji || '';
      else if (event.action === 'wait') contentText = `${event.payload.seconds || 0}s`;

      const checkbox = el('input', { type: 'checkbox' });
      checkbox.checked = selectedEventIds.has(event.id);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) selectedEventIds.add(event.id);
        else selectedEventIds.delete(event.id);
        onSelectionChange();
      });

      table.appendChild(el('div', { className: 'script-row' }, [
        el('span', { className: 'script-col-check' }, [checkbox]),
        el('span', { className: 'script-col-time', text: formatTime(event.time) }),
        el('span', { className: 'script-col-user', text: character ? character.name : '—' }),
        el('span', { className: 'script-col-action', text: event.action }),
        el('span', { className: 'script-col-content', text: contentText }),
        el('span', { className: 'script-col-target', text: targetTextFor(event, events) }),
        el('button', {
          className: 'script-col-del',
          title: 'Delete event',
          text: '🗑',
          onclick: async () => {
            const ok = await showConfirm({ title: 'Delete Event', message: 'Delete this script event?', confirmLabel: 'Delete', danger: true });
            if (ok) {
              ctx.actions.deleteScriptEvent(event.id);
              selectedEventIds.delete(event.id);
              render();
            }
          }
        })
      ]));
    });

    scroll.appendChild(table);
    return scroll;
  }

  // The Reaction Counter configuration for a SCRIPTED reaction — right-click
  // an emoji in the Auto Reaction picker to open this instead of selecting
  // it immediately. All settings visible at once (no wizard), same shape as
  // the live per-message panel, but stored on the event itself: on Apply,
  // ctx.actions.startReactionAutomation() runs automatically once the
  // scripted reaction actually fires during playback (see playback.js).
  function buildReactionCounterConfigPanel() {
    if (!reactionCounterConfigEmoji) return el('div', { className: 'hidden' });
    const emoji = reactionCounterConfigEmoji;

    const targetInput = el('input', { className: 'form-input', type: 'text', value: String((pendingReactionAutomation && pendingReactionAutomation.targetCount) || 0) });
    const durationInput = el('input', { className: 'form-input', type: 'text', value: String((pendingReactionAutomation && pendingReactionAutomation.durationSeconds) || 5) });
    const durationRow = el('div', { className: 'rc-row' }, [el('label', { text: 'Duration (seconds)' }), durationInput]);
    const randomizeCheckbox = el('input', { type: 'checkbox' });
    randomizeCheckbox.checked = !!(pendingReactionAutomation && pendingReactionAutomation.randomize);

    let growthMode = (pendingReactionAutomation && pendingReactionAutomation.mode) || 'instant';
    const instantRadio = el('input', { type: 'radio', name: 'script-rc-growth' });
    const gradualRadio = el('input', { type: 'radio', name: 'script-rc-growth' });
    if (growthMode === 'gradual') gradualRadio.checked = true; else instantRadio.checked = true;
    durationRow.classList.toggle('hidden', growthMode !== 'gradual');
    function updateGrowthMode() {
      growthMode = gradualRadio.checked ? 'gradual' : 'instant';
      durationRow.classList.toggle('hidden', growthMode !== 'gradual');
    }
    instantRadio.addEventListener('change', updateGrowthMode);
    gradualRadio.addEventListener('change', updateGrowthMode);

    return el('div', { className: 'reaction-count-panel script-reaction-count-panel' }, [
      el('div', { className: 'rc-title', text: 'Reaction Counter' }),
      el('div', { className: 'rc-row' }, [el('label', { text: 'Reaction' }), el('span', { className: 'rc-emoji', text: emoji })]),
      el('div', { className: 'rc-row' }, [el('label', { text: 'Target count' }), targetInput]),
      el('div', { className: 'rc-row' }, [
        el('label', { text: 'Growth' }),
        el('div', { className: 'rc-growth-options' }, [
          el('label', { className: 'rc-radio-label' }, [instantRadio, el('span', { text: 'Instant' })]),
          el('label', { className: 'rc-radio-label' }, [gradualRadio, el('span', { text: 'Gradual' })])
        ])
      ]),
      durationRow,
      el('div', { className: 'rc-row' }, [el('label', { text: 'Randomize' }), randomizeCheckbox]),
      el('div', { className: 'rc-actions' }, [
        el('button', {
          className: 'btn btn-primary', text: 'Apply', onclick: () => {
            const targetCount = parseInt(targetInput.value, 10);
            if (!Number.isFinite(targetCount) || targetCount < 0) {
              ctx.notify('Enter a valid non-negative target count.', 'error');
              return;
            }
            pendingReactionEmoji = emoji;
            pendingReactionAutomation = {
              targetCount,
              mode: growthMode,
              durationSeconds: parseFloat(durationInput.value) || 5,
              randomize: randomizeCheckbox.checked
            };
            reactionCounterConfigEmoji = null;
            render();
          }
        }),
        el('button', { className: 'btn btn-secondary', text: 'Cancel', onclick: () => { reactionCounterConfigEmoji = null; render(); } })
      ])
    ]);
  }

  function buildAddEventForm(state, events) {
    const form = el('div', { className: 'script-add-form' });

    const timeInput = el('input', { className: 'form-input script-input-time', placeholder: '00:00', value: pendingTimeStr });
    timeInput.addEventListener('change', () => { pendingTimeStr = timeInput.value; });
    const userSelect = el('select', { className: 'form-input script-input-user' },
      state.characters.map((c) => el('option', { value: c.id, text: c.name })));
    if (pendingCharacterId) userSelect.value = pendingCharacterId;
    userSelect.addEventListener('change', () => { pendingCharacterId = userSelect.value; });
    const actionSelect = el('select', { className: 'form-input script-input-action' }, [
      el('option', { value: 'message', text: 'Message' }),
      el('option', { value: 'file', text: 'File' }),
      el('option', { value: 'typing', text: 'Typing' }),
      el('option', { value: 'reaction', text: 'Reaction' }),
      el('option', { value: 'wait', text: 'Wait/Delay' })
    ]);
    actionSelect.value = pendingAction;

    // "Auto Message" / "File" panel — shared by both, since a scripted
    // message can optionally carry inline attachments (referenced by
    // [IMG1]/[IMG2].. tokens in the text, in insertion order) and a File
    // event is really the same thing with the picker as the main entry
    // point rather than typing.
    let pendingScriptAttachments = []; // [{ token, attachment }]
    let scriptAttachmentCounter = 0;

    const messageContentInput = el('input', { className: 'form-input script-input-content', placeholder: 'message text' });
    const attachmentChips = el('div', { className: 'pending-attachments' });

    function renderAttachmentChips() {
      clear(attachmentChips);
      attachmentChips.classList.toggle('hidden', pendingScriptAttachments.length === 0);
      pendingScriptAttachments.forEach(({ token, attachment }) => {
        const removeBtn = el('button', {
          title: 'Remove attachment',
          text: '✕',
          onclick: () => {
            pendingScriptAttachments = pendingScriptAttachments.filter((a) => a.token !== token);
            messageContentInput.value = messageContentInput.value.split(token).join('');
            renderAttachmentChips();
          }
        });
        attachmentChips.appendChild(el('div', { className: 'pending-attachment-chip' }, [
          el('span', { className: 'pending-attachment-file-icon', text: iconFor(attachment.filename) }),
          el('span', { className: 'pending-attachment-name', text: `${token} ${attachment.filename}` }),
          removeBtn
        ]));
      });
    }

    const attachBtn = el('button', {
      className: 'btn btn-secondary script-input-emoji',
      title: 'Attach a file/image — inserts a placeholder like [IMG1] at the cursor',
      text: '📎',
      onclick: async () => {
        if (!window.dvm || !window.dvm.selectAttachments) return;
        const filePaths = await window.dvm.selectAttachments();
        if (!filePaths || !filePaths.length) return;
        filePaths.forEach((filePath) => {
          scriptAttachmentCounter += 1;
          const filename = basename(filePath);
          const token = `[IMG${scriptAttachmentCounter}]`;
          const attachment = createAttachment({
            kind: classifyAttachmentKind(filename),
            filename,
            file: { type: 'temp', path: filePath },
            token
          });
          pendingScriptAttachments.push({ token, attachment });
          insertAtCursor(messageContentInput, token);
        });
        renderAttachmentChips();
      }
    });

    const autoMessagePanel = el('div', { className: 'script-sub-panel hidden script-sub-panel-column' }, [
      el('div', { className: 'script-sub-panel' }, [messageContentInput, attachBtn]),
      attachmentChips
    ]);

    // "Auto Reaction" panel — only visible for the Reaction action.
    const targetSelect = el('select', { className: 'form-input script-input-target' },
      events.filter((e) => e.action === 'message' || e.action === 'file').map((e) => el('option', { value: e.id, text: `${formatTime(e.time)} - ${(e.payload.text || '').slice(0, 20)}` })));
    if (pendingTargetEventId) targetSelect.value = pendingTargetEventId;
    targetSelect.addEventListener('change', () => { pendingTargetEventId = targetSelect.value; });
    const emojiBtn = el('button', { className: 'btn btn-secondary script-input-emoji', text: `Emoji: ${pendingReactionEmoji}` });
    emojiBtn.addEventListener('click', () => {
      const rect = emojiBtn.getBoundingClientRect();
      const items = PICKER_EMOJIS.map((emoji) => ({
        label: emoji,
        onClick: () => { pendingReactionEmoji = emoji; emojiBtn.textContent = `Emoji: ${emoji}`; },
        // Opens the Reaction Counter configuration for this emoji instead
        // of selecting it — selecting only happens if the config panel is
        // Applied (see buildReactionCounterConfigPanel below).
        onContextMenu: () => {
          reactionCounterConfigEmoji = emoji;
          render();
        }
      }));
      showContextMenu(rect.left, rect.top - 8 - items.length * 34, items);
    });

    const reactionCounterConfigPanel = buildReactionCounterConfigPanel();

    const autoReactionPanel = el('div', { className: 'script-sub-panel hidden script-sub-panel-column' }, [
      el('div', { className: 'script-sub-panel' }, [
        el('span', { className: 'script-sub-panel-label', text: 'Target message:' }),
        targetSelect,
        emojiBtn
      ]),
      reactionCounterConfigPanel
    ]);

    // "Auto Wait" — a single seconds input, no dedicated sub-panel needed.
    const waitContentInput = el('input', { className: 'form-input script-input-content', placeholder: 'seconds' });
    const autoWaitPanel = el('div', { className: 'script-sub-panel hidden' }, [waitContentInput]);

    function updateVisibility() {
      const action = actionSelect.value;
      pendingAction = action;
      autoMessagePanel.classList.toggle('hidden', action !== 'message' && action !== 'file');
      autoReactionPanel.classList.toggle('hidden', action !== 'reaction');
      autoWaitPanel.classList.toggle('hidden', action !== 'wait');
      messageContentInput.placeholder = action === 'file' ? 'optional caption' : 'message text';
    }
    actionSelect.addEventListener('change', updateVisibility);
    updateVisibility();

    const addBtn = el('button', {
      className: 'btn btn-primary',
      text: '+ Add Event',
      onclick: () => {
        if (!state.characters.length) {
          ctx.notify('Add a character first.', 'error');
          return;
        }
        const time = parseTime(timeInput.value);
        const characterId = userSelect.value || null;
        const action = actionSelect.value;
        let payload = {};
        if (action === 'message' || action === 'file') {
          payload = {
            text: messageContentInput.value || '',
            attachments: pendingScriptAttachments.length ? pendingScriptAttachments.map((a) => a.attachment) : undefined
          };
        } else if (action === 'reaction') {
          if (!targetSelect.value) {
            ctx.notify('Add a Message event first so this reaction has a target.', 'error');
            return;
          }
          const targetEvent = events.find((e) => e.id === targetSelect.value);
          if (targetEvent && time <= targetEvent.time) {
            ctx.notify('Reaction time should be after its target message\u2019s time, or it may not trigger during playback.', 'error');
          }
          payload = { targetEventId: targetSelect.value, emoji: pendingReactionEmoji, automation: pendingReactionAutomation || null };
        } else if (action === 'wait') {
          payload = { seconds: parseFloat(waitContentInput.value) || 0 };
        }
        ctx.actions.addScriptEvent({ time, characterId, action, payload });
        messageContentInput.value = '';
        waitContentInput.value = '';
        pendingScriptAttachments = [];
        scriptAttachmentCounter = 0;
        pendingReactionAutomation = null;
        renderAttachmentChips();
      }
    });

    form.appendChild(timeInput);
    form.appendChild(userSelect);
    form.appendChild(actionSelect);
    form.appendChild(autoMessagePanel);
    form.appendChild(autoReactionPanel);
    form.appendChild(autoWaitPanel);
    form.appendChild(addBtn);
    return form;
  }

  function render() {
    const state = ctx.getState();
    clear(container);
    container.classList.toggle('hidden', !state.ui.scriptVisible);
    if (!state.ui.scriptVisible) return;

    const events = (state.script && state.script.events ? state.script.events : []).slice().sort((a, b) => a.time - b.time);
    const validIds = new Set(events.map((e) => e.id));
    selectedEventIds.forEach((id) => { if (!validIds.has(id)) selectedEventIds.delete(id); });

    const { toolbar, update: updateToolbar } = buildSelectionToolbar(events);
    const table = renderTable(state, events, updateToolbar);

    container.appendChild(renderHeader());
    const wrap = el('div', { className: 'script-wrap' }, [
      renderControls(),
      renderImportErrors(),
      toolbar,
      table,
      buildAddEventForm(state, events)
    ]);
    container.appendChild(wrap);
  }

  return { render };
}
