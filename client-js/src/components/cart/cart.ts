import type { AppState, SeatView } from '../../state/types.ts';
import { type Component, el } from '../component.ts';
import {
  formatCountdown,
  formatMoney,
  secondsLeft,
  ZONE_LABEL,
} from '../format.ts';
import './cart.css';

export interface CartIntents {
  onCheckout(): void;
  onReleaseSeat(seatId: string): void;
  onReleaseAll(): void;
  /** The earliest lock reached zero: reload from the server. */
  onExpired(): void;
}

/** Only scales the progress bar; the time itself comes from the server. */
const LOCK_SECONDS = 90;
const ANNOUNCE_AT = [60, 30, 10];
const TICK_MS = 250;

export function createCart(intents: CartIntents): Component {
  const root = el('section', 'cart panel');
  root.setAttribute('aria-labelledby', 'cart-title');
  const title = el('h2', 'panel-title', 'Resumen de selección');
  title.id = 'cart-title';

  // Countdown
  const timer = el('div', 'cart__timer');
  const timerLabel = el('span', 'cart__timer-label', 'Tiempo de retención');
  const timerValue = el('span', 'cart__timer-value numeric', '00:00');
  const track = el('div', 'cart__track');
  const fill = el('div', 'cart__fill');
  track.append(fill);
  const live = el('p', 'visually-hidden');
  live.setAttribute('aria-live', 'polite');
  timer.append(timerLabel, timerValue, track, live);

  const empty = el(
    'p',
    'cart__empty',
    'Selecciona una silla en el mapa para empezar.',
  );
  const listTitle = el('p', 'cart__list-title');
  const list = el('ul', 'cart__list');

  const total = el('div', 'cart__total');
  const totalValue = el('span', 'cart__total-value numeric');
  total.append(el('span', undefined, 'Total a pagar'), totalValue);

  const actions = el('div', 'cart__actions');
  const confirm = el(
    'button',
    'button button--primary button--block',
    'Confirmar reserva',
  );
  confirm.type = 'button';
  const releaseAll = el(
    'button',
    'button button--secondary button--block',
    'Liberar sillas',
  );
  releaseAll.type = 'button';
  actions.append(confirm, releaseAll);

  // Sticky bar for screens narrower than 1024px (hidden by CSS on desktop).
  const bar = el('div', 'cart__bar');
  const barText = el('p', 'cart__bar-text numeric');
  const barButton = el('button', 'button button--primary', 'Continuar');
  barButton.type = 'button';
  bar.append(barText, barButton);

  root.append(title, timer, empty, listTitle, list, total, actions, bar);

  let mine: SeatView[] = [];
  let listSignature = '';
  let interval: number | undefined;
  let announced = new Set<number>();
  let expiredFor: number | null = null;

  function earliestExpiry(): number | null {
    const times = mine
      .map(seat => seat.expiresAt)
      .filter((t): t is number => t !== null);
    return times.length > 0 ? Math.min(...times) : null;
  }

  function tick() {
    const expiresAt = earliestExpiry();
    if (expiresAt === null) {
      return;
    }
    const left = secondsLeft(expiresAt);
    const text = formatCountdown(left);
    timerValue.textContent = text;
    barText.textContent = `${summaryText()} · ${text}`;
    fill.style.width = `${Math.min(100, (left / LOCK_SECONDS) * 100)}%`;
    timer.dataset.level = left <= 10 ? 'danger' : left <= 30 ? 'warning' : 'ok';

    for (const mark of ANNOUNCE_AT) {
      if (left <= mark && left > 0 && !announced.has(mark)) {
        announced.add(mark);
        live.textContent = `Quedan ${mark} segundos de retención.`;
      }
    }

    if (left === 0 && expiredFor !== expiresAt) {
      expiredFor = expiresAt;
      intents.onExpired();
    }
  }

  function summaryText(): string {
    const sum = mine.reduce((acc, seat) => acc + seat.price, 0);
    const count = mine.length === 1 ? '1 silla' : `${mine.length} sillas`;
    return `${count} · ${formatMoney(sum)}`;
  }

  function renderList() {
    list.replaceChildren(
      ...mine.map(seat => {
        const item = el('li', 'cart__item');
        const name = el(
          'span',
          'cart__item-name',
          `Silla ${seat.id} · ${ZONE_LABEL[seat.zone]}`,
        );
        const price = el(
          'span',
          'cart__item-price numeric',
          formatMoney(seat.price),
        );
        const remove = el('button', 'icon-button', '×');
        remove.type = 'button';
        remove.dataset.releaseId = seat.id;
        remove.setAttribute('aria-label', `Liberar silla ${seat.id}`);
        item.append(name, price, remove);
        return item;
      }),
    );
    listTitle.textContent = `Sillas retenidas (${mine.length})`;
    totalValue.textContent = formatMoney(
      mine.reduce((acc, seat) => acc + seat.price, 0),
    );
  }

  function startTimer() {
    if (interval === undefined) {
      interval = window.setInterval(tick, TICK_MS);
    }
    tick();
  }

  function stopTimer() {
    window.clearInterval(interval);
    interval = undefined;
  }

  function onClick(event: MouseEvent) {
    const target = event.target as HTMLElement;
    const releaseId =
      target.closest<HTMLElement>('[data-release-id]')?.dataset.releaseId;
    if (releaseId) {
      intents.onReleaseSeat(releaseId);
    } else if (target === confirm || target === barButton) {
      intents.onCheckout();
    } else if (target === releaseAll) {
      intents.onReleaseAll();
    }
  }
  root.addEventListener('click', onClick);

  return {
    mount(parent) {
      parent.append(root);
    },
    update(state: AppState) {
      mine = state.seats.filter(seat => seat.status === 'mine');
      const signature = mine.map(s => `${s.id}@${s.expiresAt}`).join();
      if (signature !== listSignature) {
        // A new earliest expiry restarts the announcements.
        announced = new Set();
        listSignature = signature;
        renderList();
      }

      const hasSeats = mine.length > 0;
      root.dataset.empty = String(!hasSeats);
      const offline = state.connection !== 'connected';
      confirm.disabled = !hasSeats || offline || state.checkout.open;
      barButton.disabled = confirm.disabled;
      releaseAll.disabled = !hasSeats || offline;

      if (hasSeats) {
        startTimer();
      } else {
        stopTimer();
      }
    },
    destroy() {
      stopTimer();
      root.removeEventListener('click', onClick);
      root.remove();
    },
  };
}
