import type { ConnectionStatus as Status } from '../../state/types.ts';
import { type Component, el } from '../component.ts';
import './connection-status.css';

const TEXT: Record<Status, string> = {
  connecting: 'Conectando…',
  connected: 'En línea',
  reconnecting: 'Reconectando…',
  disconnected: 'Sin conexión',
};

export function createConnectionStatus(): Component {
  const root = el('p', 'pill connection-status');
  const dot = el('span', 'connection-status__dot');
  dot.setAttribute('aria-hidden', 'true');
  const text = el('span');
  root.append(dot, text);
  // Screen readers announce changes politely.
  root.setAttribute('role', 'status');

  let last: Status | null = null;

  return {
    mount(parent) {
      parent.append(root);
    },
    update(state) {
      if (state.connection === last) {
        return;
      }
      last = state.connection;
      root.dataset.status = state.connection;
      text.textContent = TEXT[state.connection];
    },
    destroy() {
      root.remove();
    },
  };
}
