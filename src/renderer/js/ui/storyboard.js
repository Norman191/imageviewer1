import { el, clear } from '../utils/dom.js';

export function createStoryboard(ctx) {
  const container = document.getElementById('storyboard-panel');
  let dragId = null;

  function currentChannelMessages(state) {
    return state.messages
      .filter((m) => m.channelId === state.ui.currentChannelId)
      .sort((a, b) => a.order - b.order);
  }

  function render() {
    const state = ctx.getState();
    clear(container);
    container.classList.toggle('hidden', !state.ui.storyboardVisible);
    if (!state.ui.storyboardVisible) return;

    container.appendChild(el('div', { className: 'storyboard-header' }, [
      el('span', { text: 'Storyboard — drag to reorder' }),
      el('button', { text: '✕', onclick: () => ctx.actions.toggleStoryboard() })
    ]));

    const list = el('div', { className: 'storyboard-list' });
    const messages = currentChannelMessages(state);

    if (!messages.length) {
      list.appendChild(el('div', { className: 'member-panel-empty', text: 'No messages in this channel yet.' }));
    }

    messages.forEach((message, idx) => {
      const character = state.characters.find((c) => c.id === message.characterId);
      const item = el('div', {
        className: 'storyboard-item',
        draggable: 'true',
        dataset: { id: message.id }
      }, [
        el('span', { className: 'sb-index', text: String(idx + 1).padStart(2, '0') }),
        el('span', { className: 'sb-char', text: character ? character.name : 'Unknown' }),
        el('span', { className: 'sb-text', text: message.text })
      ]);

      item.addEventListener('dragstart', (e) => {
        dragId = message.id;
        item.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
      });
      item.addEventListener('dragend', () => {
        item.classList.remove('dragging');
        Array.from(list.children).forEach((c) => c.classList.remove('drag-over'));
      });
      item.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (dragId && dragId !== message.id) item.classList.add('drag-over');
      });
      item.addEventListener('dragleave', () => item.classList.remove('drag-over'));
      item.addEventListener('drop', (e) => {
        e.preventDefault();
        item.classList.remove('drag-over');
        if (!dragId || dragId === message.id) return;
        ctx.actions.moveMessageBefore(dragId, message.id);
        dragId = null;
      });

      list.appendChild(item);
    });

    container.appendChild(list);
  }

  return { render };
}
