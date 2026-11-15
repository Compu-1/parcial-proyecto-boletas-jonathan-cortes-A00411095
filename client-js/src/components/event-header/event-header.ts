import type { EventView } from '../../state/types.ts';
import { type Component, el } from '../component.ts';
import { createConnectionStatus } from '../connection-status/connection-status.ts';
import { formatEventDate } from '../format.ts';
import './event-header.css';

type CounterKey = 'availableSeats' | 'lockedSeats' | 'bookedSeats';

const COUNTERS: { key: CounterKey; label: string }[] = [
  { key: 'availableSeats', label: 'Disponibles' },
  { key: 'lockedSeats', label: 'Retenidas' },
  { key: 'bookedSeats', label: 'Vendidas' },
];

export function createEventHeader(): Component {
  const root = el('header', 'event-header');

  const info = el('div', 'event-header__info');
  const eyebrow = el('p', 'event-header__eyebrow', 'Icesi Live Arena');
  const title = el('h1', 'event-header__title', 'Cargando evento…');
  const meta = el('p', 'event-header__meta');
  info.append(eyebrow, title, meta);

  const side = el('div', 'event-header__side');
  const counters = el('ul', 'event-header__counters');
  const values = new Map<CounterKey, HTMLElement>();
  for (const { key, label } of COUNTERS) {
    const item = el('li', 'event-header__counter');
    item.dataset.counter = key;
    const value = el('span', 'event-header__value numeric', '–');
    item.append(el('span', 'event-header__label', label), value);
    counters.append(item);
    values.set(key, value);
  }
  const status = createConnectionStatus();
  status.mount(side);
  side.prepend(counters);

  root.append(info, side);

  // Flash a counter once when its value changes.
  const onAnimationEnd = (event: AnimationEvent) => {
    (event.target as HTMLElement).classList.remove('is-changed');
  };
  root.addEventListener('animationend', onAnimationEnd);

  let lastEvent: EventView | null = null;

  return {
    mount(parent) {
      parent.append(root);
    },
    update(state) {
      status.update(state);
      const event = state.event;
      if (!event || event === lastEvent) {
        return;
      }
      title.textContent = event.name;
      meta.textContent = `${event.venue} · ${formatEventDate(event.date)} · Aforo: ${event.totalSeats} sillas`;
      for (const { key } of COUNTERS) {
        const value = values.get(key);
        const text = String(event[key]);
        if (value && value.textContent !== text) {
          value.textContent = text;
          if (lastEvent) {
            value.classList.add('is-changed');
          }
        }
      }
      lastEvent = event;
    },
    destroy() {
      root.removeEventListener('animationend', onAnimationEnd);
      status.destroy();
      root.remove();
    },
  };
}
