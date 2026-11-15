import type { Notice, NoticeKind } from '../../state/types.ts';
import { type Component, el } from '../component.ts';
import './notifications.css';

export interface NotificationIntents {
  onDismiss(id: number): void;
}

const ICON: Record<NoticeKind, string> = {
  success: '✓',
  info: 'i',
  warning: '!',
  error: '✕',
};

const LIFETIME_MS: Record<NoticeKind, number> = {
  success: 5000,
  info: 5000,
  warning: 8000,
  error: 8000,
};

interface Toast {
  element: HTMLElement;
  timer: number | undefined;
  remaining: number;
  startedAt: number;
}

export function createNotifications(intents: NotificationIntents): Component {
  const root = el('section', 'notifications');
  root.setAttribute('aria-label', 'Notificaciones');
  const toasts = new Map<number, Toast>();

  function schedule(id: number, toast: Toast) {
    toast.startedAt = Date.now();
    toast.timer = window.setTimeout(
      () => intents.onDismiss(id),
      toast.remaining,
    );
  }

  /** Pause while the pointer or focus is on the toast, so it can be read. */
  function pause(toast: Toast) {
    if (toast.timer === undefined) {
      return;
    }
    window.clearTimeout(toast.timer);
    toast.timer = undefined;
    toast.remaining -= Date.now() - toast.startedAt;
  }

  function create(notice: Notice): Toast {
    const element = el('div', 'toast');
    element.dataset.kind = notice.kind;
    // Errors interrupt the screen reader; everything else waits its turn.
    element.setAttribute('role', notice.kind === 'error' ? 'alert' : 'status');
    const icon = el('span', 'toast__icon', ICON[notice.kind]);
    icon.setAttribute('aria-hidden', 'true');
    const message = el('p', 'toast__message', notice.message);
    const close = el('button', 'icon-button toast__close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', 'Cerrar notificación');
    element.append(icon, message, close);

    const toast: Toast = {
      element,
      timer: undefined,
      remaining: LIFETIME_MS[notice.kind],
      startedAt: 0,
    };
    close.addEventListener('click', () => intents.onDismiss(notice.id));
    const stop = () => pause(toast);
    const resume = () => {
      if (toast.timer === undefined) {
        schedule(notice.id, toast);
      }
    };
    element.addEventListener('mouseenter', stop);
    element.addEventListener('focusin', stop);
    element.addEventListener('mouseleave', resume);
    element.addEventListener('focusout', resume);

    schedule(notice.id, toast);
    return toast;
  }

  function remove(id: number) {
    const toast = toasts.get(id);
    if (toast) {
      window.clearTimeout(toast.timer);
      // Removing the element also drops its listeners.
      toast.element.remove();
      toasts.delete(id);
    }
  }

  return {
    mount(parent) {
      parent.append(root);
    },
    update(state) {
      const ids = new Set(state.notices.map(notice => notice.id));
      for (const id of [...toasts.keys()]) {
        if (!ids.has(id)) {
          remove(id);
        }
      }
      for (const notice of state.notices) {
        if (!toasts.has(notice.id)) {
          const toast = create(notice);
          toasts.set(notice.id, toast);
          root.prepend(toast.element); // newest on top
        }
      }
    },
    destroy() {
      for (const id of [...toasts.keys()]) {
        remove(id);
      }
      root.remove();
    },
  };
}
