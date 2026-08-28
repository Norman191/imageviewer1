import { el, clear, initials, colorForId } from '../utils/dom.js';
import { resolveAvatarUrl } from '../utils/avatar.js';
import { showConfirm } from './modals.js';

const modalRoot = () => document.getElementById('modal-root');

export function createCharacterManager(ctx) {
  let backdrop = null;
  let listEl = null;

  function avatarButton(character) {
    const url = resolveAvatarUrl(character.avatar, ctx.getProjectDir());
    const btn = el('button', {
      className: 'avatar-btn',
      style: url ? '' : `background:${colorForId(character.id)}`,
      title: 'Change avatar',
      onclick: () => ctx.actions.changeAvatar(character.id).then(renderList)
    });
    if (url) {
      btn.appendChild(el('img', { src: url }));
    } else {
      btn.textContent = initials(character.name);
    }
    return btn;
  }

  function characterRow(character) {
    const nameInput = el('input', {
      className: 'character-name-input',
      value: character.name
    });
    nameInput.addEventListener('change', () => {
      const value = nameInput.value.trim();
      if (value && value !== character.name) ctx.actions.renameCharacter(character.id, value);
      else nameInput.value = character.name;
    });
    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') nameInput.blur();
    });

    return el('div', { className: 'character-row', dataset: { id: character.id } }, [
      avatarButton(character),
      nameInput,
      el('div', { className: 'row-actions' }, [
        el('button', { title: 'Duplicate', text: '⧉', onclick: () => ctx.actions.duplicateCharacter(character.id).then(renderList) }),
        el('button', {
          className: 'danger', title: 'Delete', text: '🗑', onclick: async () => {
            const ok = await showConfirm({ title: 'Delete Character', message: `Delete ${character.name}? Their existing messages will remain but show as "Unknown".`, confirmLabel: 'Delete', danger: true });
            if (ok) { ctx.actions.deleteCharacter(character.id); renderList(); }
          }
        })
      ])
    ]);
  }

  function renderList() {
    if (!listEl) return;
    clear(listEl);
    const state = ctx.getState();
    if (!state.characters.length) {
      listEl.appendChild(el('div', { className: 'member-panel-empty', text: 'No characters yet. Add one below.' }));
    }
    state.characters.forEach((c) => listEl.appendChild(characterRow(c)));
  }

  function close() {
    clear(modalRoot());
    backdrop = null;
    listEl = null;
  }

  function open() {
    listEl = el('div', { className: 'character-list' });

    backdrop = el('div', { className: 'modal-backdrop', onclick: (e) => { if (e.target === backdrop) close(); } }, [
      el('div', { className: 'modal-box wide' }, [
        el('div', { className: 'modal-header' }, [
          el('span', { text: 'Manage Characters' }),
          el('button', { text: '✕', onclick: close })
        ]),
        el('div', { className: 'modal-body' }, [
          listEl,
          el('button', {
            className: 'btn btn-primary', text: '+ Add Character', onclick: async () => {
              await ctx.actions.addCharacterFlow();
              renderList();
            }
          })
        ]),
        el('div', { className: 'modal-footer' }, [
          el('button', { className: 'btn btn-secondary', text: 'Done', onclick: close })
        ])
      ])
    ]);

    clear(modalRoot());
    modalRoot().appendChild(backdrop);
    renderList();
  }

  return { open, renderList };
}
