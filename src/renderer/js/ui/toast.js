import { el } from '../utils/dom.js';

export function showToast(message, type = 'info') {
  const root = document.getElementById('toast-root');
  const toast = el('div', { className: `toast ${type === 'error' ? 'error' : ''}`.trim(), text: message });
  root.appendChild(toast);
  setTimeout(() => {
    toast.style.transition = 'opacity 0.2s ease';
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 200);
  }, 2600);
}
