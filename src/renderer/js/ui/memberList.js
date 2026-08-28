import { el, clear, initials, colorForId } from '../utils/dom.js';
import { resolveAvatarUrl } from '../utils/avatar.js';
import { showContextMenu } from './contextMenu.js';
import { createResizeHandle } from '../utils/resizePanel.js';

export function createMemberList(ctx) {
  const container = document.getElementById('member-panel');

  function buildMemberListScroll(state) {
    const scroll = el('div', { className: 'member-list-scroll' });
    scroll.appendChild(el('div', { className: 'member-section-title', text: `Online — ${state.characters.length}` }));

    if (!state.characters.length) {
      scroll.appendChild(el('div', { className: 'member-panel-empty', text: 'No characters yet. Use the + button near the message box to add one.' }));
      return scroll;
    }

    state.characters.forEach((character) => {
      const url = resolveAvatarUrl(character.avatar, ctx.getProjectDir());
      const avatar = url
        ? el('img', { className: 'member-avatar', src: url })
        : el('div', { className: 'member-avatar', style: `background:${colorForId(character.id)}`, text: initials(character.name) });

      const isOffline = character.status === 'offline';

      const menuBtn = el('button', {
        className: 'member-menu-btn',
        title: 'Set status',
        text: '⋮',
        onclick: (e) => {
          e.stopPropagation();
          const rect = e.currentTarget.getBoundingClientRect();
          showContextMenu(rect.right - 160, rect.bottom + 4, [
            { label: 'Online', icon: '🟢', onClick: () => ctx.actions.setCharacterStatus(character.id, 'online') },
            { label: 'Offline', icon: '🔴', onClick: () => ctx.actions.setCharacterStatus(character.id, 'offline') }
          ]);
        }
      });

      const item = el('div', {
        className: `member-item${character.id === state.ui.currentSpeakerId ? ' active-speaker' : ''}`,
        title: 'Click to speak as this character',
        onclick: () => ctx.actions.selectSpeaker(character.id)
      }, [
        el('div', { className: 'member-avatar-wrap' }, [avatar, el('div', { className: `status-dot${isOffline ? ' offline' : ''}` })]),
        el('span', { className: 'member-name', text: character.name }),
        menuBtn
      ]);
      scroll.appendChild(item);
    });

    return scroll;
  }

  // Reaction Count configuration panel (Features from the reaction-count
  // automation request) — a persistent, all-settings-visible panel pinned
  // below the (independently scrolling) member list, not a popup/wizard.
  function buildReactionCountPanel(state) {
    const panelState = state.ui.reactionCountPanel;
    if (!panelState) return null;

    const message = state.messages.find((m) => m.id === panelState.messageId);
    if (!message) return null;
    const existing = (message.reactions || []).find((r) => r.emoji === panelState.emoji);

    const targetInput = el('input', { className: 'form-input', type: 'text', value: String(existing ? existing.count : 0) });
    const durationInput = el('input', { className: 'form-input', type: 'text', value: '5' });
    const durationRow = el('div', { className: 'rc-row' }, [el('label', { text: 'Duration (seconds)' }), durationInput]);
    const randomizeCheckbox = el('input', { type: 'checkbox' });

    let growthMode = 'instant';
    const instantRadio = el('input', { type: 'radio', name: 'rc-growth', checked: 'checked' });
    const gradualRadio = el('input', { type: 'radio', name: 'rc-growth' });
    function updateGrowthMode() {
      growthMode = gradualRadio.checked ? 'gradual' : 'instant';
      durationRow.classList.toggle('hidden', growthMode !== 'gradual');
    }
    instantRadio.addEventListener('change', updateGrowthMode);
    gradualRadio.addEventListener('change', updateGrowthMode);
    durationRow.classList.add('hidden');

    return el('div', { className: 'reaction-count-panel' }, [
      el('div', { className: 'rc-title', text: 'Reaction Count' }),
      el('div', { className: 'rc-row' }, [el('label', { text: 'Reaction' }), el('span', { className: 'rc-emoji', text: panelState.emoji })]),
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
            const durationSeconds = parseFloat(durationInput.value) || 5;
            ctx.actions.startReactionAutomation(panelState.messageId, panelState.emoji, {
              targetCount, mode: growthMode, durationSeconds, randomize: randomizeCheckbox.checked
            });
            ctx.actions.closeReactionCountPanel();
          }
        }),
        el('button', { className: 'btn btn-secondary', text: 'Cancel', onclick: () => ctx.actions.closeReactionCountPanel() })
      ])
    ]);
  }

  function render() {
    const state = ctx.getState();
    clear(container);

    container.classList.toggle('hidden', !state.ui.membersVisible);
    if (!state.ui.membersVisible) return;

    container.appendChild(buildMemberListScroll(state));

    const panel = buildReactionCountPanel(state);
    if (panel) container.appendChild(panel);

    container.appendChild(createResizeHandle(container, { side: 'left', min: 180, max: 480 }));
  }

  return { render };
}
