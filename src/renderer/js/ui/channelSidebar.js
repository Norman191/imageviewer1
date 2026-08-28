import { el, clear } from '../utils/dom.js';
import { showPrompt, showConfirm } from './modals.js';
import { showContextMenu } from './contextMenu.js';
import { createResizeHandle } from '../utils/resizePanel.js';

export function createChannelSidebar(ctx) {
  const container = document.getElementById('channel-sidebar');

  function currentServer(state) {
    return state.servers.find((s) => s.id === state.ui.currentServerId) || state.servers[0];
  }

  function channelRow(channel, server, state) {
    const isActive = channel.id === state.ui.currentChannelId;
    const isVoice = channel.type === 'voice';

    const row = el('div', {
      className: `channel-item${isActive ? ' active' : ''}${isVoice ? ' voice' : ''}`,
      onclick: () => { if (!isVoice) ctx.actions.selectChannel(channel.id); }
    }, [
      el('span', { className: 'hash', text: isVoice ? '🔊' : '#' }),
      el('span', { text: channel.name })
    ]);

    if (!isVoice) {
      const actions = el('div', { className: 'channel-actions' }, [
        el('button', {
          title: 'Rename', text: '✏️', onclick: async (e) => {
            e.stopPropagation();
            const name = await showPrompt({ title: 'Rename Channel', label: 'Channel name', defaultValue: channel.name });
            if (name) ctx.actions.renameChannel(channel.id, name);
          }
        }),
        el('button', {
          title: 'Delete', text: '🗑', onclick: async (e) => {
            e.stopPropagation();
            const ok = await showConfirm({ title: 'Delete Channel', message: `Delete #${channel.name}? Messages in this channel will also be removed.`, confirmLabel: 'Delete', danger: true });
            if (ok) ctx.actions.deleteChannel(channel.id);
          }
        })
      ]);
      row.appendChild(actions);

      row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showContextMenu(e.clientX, e.clientY, [
          {
            label: 'Rename Channel', icon: '✏️', onClick: async () => {
              const name = await showPrompt({ title: 'Rename Channel', label: 'Channel name', defaultValue: channel.name });
              if (name) ctx.actions.renameChannel(channel.id, name);
            }
          },
          {
            label: 'Delete Channel', icon: '🗑', danger: true, onClick: async () => {
              const ok = await showConfirm({ title: 'Delete Channel', message: `Delete #${channel.name}? Messages in this channel will also be removed.`, confirmLabel: 'Delete', danger: true });
              if (ok) ctx.actions.deleteChannel(channel.id);
            }
          }
        ]);
      });
    }

    return row;
  }

  function render() {
    const state = ctx.getState();
    clear(container);

    container.classList.toggle('hidden', state.ui.channelSidebarVisible === false);
    if (state.ui.channelSidebarVisible === false) return;

    const server = currentServer(state);
    if (!server) return;

    container.appendChild(el('div', { className: 'server-header' }, [
      el('span', { text: server.name }),
      el('span', { className: 'caret', text: '▾' })
    ]));

    const list = el('div', { className: 'channel-list' });

    const textChannels = server.channels.filter((c) => c.type === 'text');
    const voiceChannels = server.channels.filter((c) => c.type === 'voice');

    list.appendChild(el('div', { className: 'channel-section' }, [
      el('span', { text: 'Text Channels' }),
      el('button', {
        className: 'add-btn', text: '+', title: 'Add channel', onclick: async (e) => {
          e.stopPropagation();
          const name = await showPrompt({ title: 'Add Text Channel', label: 'Channel name', defaultValue: 'new-channel' });
          if (name) ctx.actions.addChannel(server.id, name, 'text');
        }
      })
    ]));
    textChannels.forEach((c) => list.appendChild(channelRow(c, server, state)));

    list.appendChild(el('div', { className: 'channel-section' }, [
      el('span', { text: 'Voice Channels' })
    ]));
    voiceChannels.forEach((c) => list.appendChild(channelRow(c, server, state)));

    container.appendChild(list);
    container.appendChild(createResizeHandle(container, { side: 'right', min: 180, max: 480 }));
  }

  return { render };
}
