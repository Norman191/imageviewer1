import { el, clear, initials } from '../utils/dom.js';
import { showPrompt } from './modals.js';

export function createServerRail(ctx) {
  const container = document.getElementById('server-rail');

  function render() {
    const state = ctx.getState();
    clear(container);

    state.servers.forEach((server, i) => {
      if (i > 0) container.appendChild(el('div', { className: 'rail-sep' }));
      const icon = el('div', {
        className: `server-icon${server.id === state.ui.currentServerId ? ' active' : ''}`,
        title: server.name,
        text: initials(server.name),
        onclick: () => ctx.actions.selectServer(server.id)
      });
      container.appendChild(icon);
    });

    container.appendChild(el('div', { className: 'rail-sep' }));
    container.appendChild(el('div', {
      className: 'server-icon add',
      title: 'Add a server',
      text: '+',
      onclick: async () => {
        const name = await showPrompt({ title: 'Add Server', label: 'Server name', defaultValue: 'New Server' });
        if (name) ctx.actions.addServer(name);
      }
    }));
  }

  return { render };
}
