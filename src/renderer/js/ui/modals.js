import { el, clear } from '../utils/dom.js';

const root = () => document.getElementById('modal-root');

function closeModal() {
  clear(root());
}

export function showPrompt({ title, label, defaultValue = '', confirmLabel = 'Save', placeholder = '' }) {
  return new Promise((resolve) => {
    const input = el('input', {
      className: 'form-input',
      value: defaultValue,
      placeholder,
      onkeydown: (e) => {
        if (e.key === 'Enter') { e.preventDefault(); submit(); }
        if (e.key === 'Escape') { e.preventDefault(); cancel(); }
      }
    });

    function submit() {
      const value = input.value.trim();
      closeModal();
      resolve(value || null);
    }
    function cancel() {
      closeModal();
      resolve(null);
    }

    const backdrop = el('div', { className: 'modal-backdrop', onclick: (e) => { if (e.target === backdrop) cancel(); } }, [
      el('div', { className: 'modal-box' }, [
        el('div', { className: 'modal-header' }, [
          el('span', { text: title }),
          el('button', { text: '✕', onclick: cancel })
        ]),
        el('div', { className: 'modal-body' }, [
          label ? el('label', { className: 'form-label', text: label }) : null,
          input
        ]),
        el('div', { className: 'modal-footer' }, [
          el('button', { className: 'btn btn-secondary', text: 'Cancel', onclick: cancel }),
          el('button', { className: 'btn btn-primary', text: confirmLabel, onclick: submit })
        ])
      ])
    ]);

    clear(root());
    root().appendChild(backdrop);
    setTimeout(() => { input.focus(); input.select(); }, 0);
  });
}

export function showConfirm({ title, message, confirmLabel = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    function finish(result) {
      closeModal();
      resolve(result);
    }

    const backdrop = el('div', { className: 'modal-backdrop', onclick: (e) => { if (e.target === backdrop) finish(false); } }, [
      el('div', { className: 'modal-box' }, [
        el('div', { className: 'modal-header' }, [
          el('span', { text: title }),
          el('button', { text: '✕', onclick: () => finish(false) })
        ]),
        el('div', { className: 'modal-body' }, [
          el('p', { text: message, style: 'margin:0;color:var(--text-normal);line-height:1.5;' })
        ]),
        el('div', { className: 'modal-footer' }, [
          el('button', { className: 'btn btn-secondary', text: 'Cancel', onclick: () => finish(false) }),
          el('button', { className: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, text: confirmLabel, onclick: () => finish(true) })
        ])
      ])
    ]);

    clear(root());
    root().appendChild(backdrop);
  });
}

export function showAbout() {
  const backdrop = el('div', { className: 'modal-backdrop', onclick: (e) => { if (e.target === backdrop) closeModal(); } }, [
    el('div', { className: 'modal-box' }, [
      el('div', { className: 'modal-header' }, [
        el('span', { text: 'About Discord Video Maker' }),
        el('button', { text: '✕', onclick: closeModal })
      ]),
      el('div', { className: 'modal-body' }, [
        el('p', { text: 'Discord Video Maker — Phase 1: Chat Editor', style: 'margin:0 0 8px;font-weight:600;color:var(--text-header);' }),
        el('p', { text: 'Create fictional Discord-style conversations with custom characters and avatars. Video export (MP4, voices, effects) will be added in a later phase.', style: 'margin:0;color:var(--text-muted);line-height:1.5;' })
      ]),
      el('div', { className: 'modal-footer' }, [
        el('button', { className: 'btn btn-primary', text: 'Close', onclick: closeModal })
      ])
    ])
  ]);
  clear(root());
  root().appendChild(backdrop);
}

export function closeAnyModal() {
  closeModal();
}

export function isModalOpen() {
  return root().childElementCount > 0;
}
