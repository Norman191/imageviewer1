import { el, clear } from '../utils/dom.js';

const root = () => document.getElementById('context-menu-root');

let closeCurrent = null;

export function showContextMenu(x, y, items) {
  closeContextMenu();

  const menu = el('div', {
    className: 'context-menu',
    style: `left:${x}px;top:${y}px;`
  });

  for (const item of items) {
    if (item.type === 'separator') {
      menu.appendChild(el('div', { className: 'context-menu-sep' }));
      continue;
    }
    menu.appendChild(el('div', {
      className: `context-menu-item ${item.danger ? 'danger' : ''}`,
      onclick: () => {
        closeContextMenu();
        item.onClick && item.onClick();
      },
      oncontextmenu: (e) => {
        // A popup menu should always swallow right-clicks on its own
        // items — never let them fall through to whatever's underneath
        // (e.g. a message row's own right-click menu).
        e.preventDefault();
        e.stopPropagation();
        if (item.onContextMenu) {
          closeContextMenu();
          item.onContextMenu();
        }
      }
    }, [
      el('span', { text: item.icon || '' }),
      el('span', { text: item.label })
    ]));
  }

  clear(root());
  root().appendChild(menu);

  // Keep menu on-screen
  requestAnimationFrame(() => {
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) menu.style.left = `${Math.max(4, window.innerWidth - rect.width - 8)}px`;
    if (rect.bottom > window.innerHeight) menu.style.top = `${Math.max(4, window.innerHeight - rect.height - 8)}px`;
  });

  const onDocClick = (e) => {
    if (!menu.contains(e.target)) closeContextMenu();
  };
  const onEsc = (e) => { if (e.key === 'Escape') closeContextMenu(); };

  setTimeout(() => {
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onEsc);
  }, 0);

  closeCurrent = () => {
    document.removeEventListener('mousedown', onDocClick);
    document.removeEventListener('keydown', onEsc);
    clear(root());
  };
}

export function closeContextMenu() {
  if (closeCurrent) {
    closeCurrent();
    closeCurrent = null;
  } else {
    clear(root());
  }
}
