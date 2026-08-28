import { el } from './dom.js';

// Attaches a thin draggable strip to `panelEl`'s edge that resizes it by
// setting an explicit pixel width (clamped to min/max) while dragging. The
// panel's neighboring flex:1 area (chat) fills whatever space remains
// automatically — this only ever touches `panelEl.style.width`.
//
// side: 'right' -> handle sits on the panel's right edge, dragging right
//        grows the panel (used by the channel/server sidebar, which sits
//        to the LEFT of the chat area).
// side: 'left'  -> handle sits on the panel's left edge, dragging right
//        shrinks the panel (used by the member panel, which sits to the
//        RIGHT of the chat area).
export function createResizeHandle(panelEl, { side, min, max }) {
  const handle = el('div', { className: `resize-handle resize-handle-${side}`, title: 'Drag to resize' });

  let startX = 0;
  let startWidth = 0;

  function onMouseMove(e) {
    const delta = e.clientX - startX;
    const raw = side === 'right' ? startWidth + delta : startWidth - delta;
    const clamped = Math.max(min, Math.min(max, raw));
    panelEl.style.width = `${clamped}px`;
  }

  function onMouseUp() {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    document.body.classList.remove('panel-resizing');
  }

  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    startX = e.clientX;
    startWidth = panelEl.getBoundingClientRect().width;
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    document.body.classList.add('panel-resizing');
  });

  return handle;
}
