import type { SeatStatus } from '../../state/types.ts';
import { type Component, el } from '../component.ts';
import { paintSeat, STATUS_LABEL } from '../seat/seat.ts';
import './legend.css';

const ORDER: SeatStatus[] = ['available', 'mine', 'locked', 'booked'];

/** Static: it never changes with the state, so update() does nothing. */
export function createLegend(): Component {
  const root = el('section', 'legend');
  root.setAttribute('aria-label', 'Convenciones de estado');
  const list = el('ul', 'legend__list');

  for (const status of ORDER) {
    const item = el('li', 'legend__item');
    // Same element and CSS as a real seat, so the legend cannot drift.
    const sample = el('span', 'seat legend__sample');
    sample.setAttribute('aria-hidden', 'true');
    paintSeat(sample, status, 1);
    item.append(sample, el('span', undefined, STATUS_LABEL[status]));
    list.append(item);
  }
  root.append(list);

  return {
    mount(parent) {
      parent.append(root);
    },
    update() {},
    destroy() {
      root.remove();
    },
  };
}
