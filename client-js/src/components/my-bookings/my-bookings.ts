import type { BookingView } from '../../state/types.ts';
import { type Component, el } from '../component.ts';
import { buildTicket } from '../receipt/receipt.ts';
import './my-bookings.css';

export function createMyBookings(): Component {
  const root = el('section', 'my-bookings panel');
  root.setAttribute('aria-labelledby', 'my-bookings-title');
  const title = el('h2', 'panel-title', 'Mis reservas');
  title.id = 'my-bookings-title';
  const empty = el(
    'p',
    'my-bookings__empty',
    'Aún no tienes reservas en esta pestaña.',
  );
  const list = el('ul', 'my-bookings__list');
  root.append(title, empty, list);

  let shown: BookingView[] | null = null;

  return {
    mount(parent) {
      parent.append(root);
    },
    update(state) {
      // The store replaces the array on every reload, so a reference check
      // is enough to know whether to redraw.
      if (state.bookings === shown) {
        return;
      }
      shown = state.bookings;
      empty.hidden = shown.length > 0;
      list.replaceChildren(
        ...shown.map(booking => {
          const item = el('li');
          item.append(buildTicket(booking, true));
          return item;
        }),
      );
    },
    destroy() {
      root.remove();
    },
  };
}
