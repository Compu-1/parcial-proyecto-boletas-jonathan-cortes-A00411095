// Entry point: builds the page, wires components to the store and actions.
import './styles/tokens.css';
import './styles/base.css';
import './styles/layout.css';

import { createCart } from './components/cart/cart.ts';
import { createCheckoutModal } from './components/checkout-modal/checkout-modal.ts';
import { type Component, el } from './components/component.ts';
import { createEventHeader } from './components/event-header/event-header.ts';
import { createLegend } from './components/legend/legend.ts';
import { createMyBookings } from './components/my-bookings/my-bookings.ts';
import { createNotifications } from './components/notifications/notifications.ts';
import { createSeatMap } from './components/seat-map/seat-map.ts';
import { createActions } from './state/actions.ts';
import { createStore, initialState } from './state/store.ts';

const store = createStore(initialState);
const actions = createActions(store);

// Page skeleton (DESIGN.md section 3).
const app = document.querySelector<HTMLDivElement>('#app');
if (!app) {
  throw new Error('Missing #app element in index.html');
}
app.className = 'app';
const headerSlot = el('div');
const main = el('main', 'app__main');
const mapColumn = el('div', 'app__map panel');
const cartColumn = el('div', 'app__cart');
main.append(mapColumn, cartColumn);
const bookingsSlot = el('div');
app.append(headerSlot, main, bookingsSlot);

// Components only receive intents; they never see Ice.
const mounts: [Component, HTMLElement][] = [
  [createEventHeader(), headerSlot],
  [
    createSeatMap({ onToggleSeat: id => void actions.toggleSeat(id) }),
    mapColumn,
  ],
  [createLegend(), mapColumn],
  [
    createCart({
      onCheckout: actions.openCheckout,
      onReleaseSeat: id => void actions.toggleSeat(id),
      onReleaseAll: () => void actions.releaseAll(),
      onExpired: () => void actions.refresh(),
    }),
    cartColumn,
  ],
  [createMyBookings(), bookingsSlot],
  [
    createCheckoutModal({
      onConfirm: (name, email) => void actions.confirmBooking(name, email),
      onClose: actions.closeCheckout,
    }),
    document.body,
  ],
  [createNotifications({ onDismiss: actions.dismissNotice }), document.body],
];

const components = mounts.map(([component, parent]) => {
  component.mount(parent);
  return component;
});

const render = () => {
  const state = store.getState();
  for (const component of components) {
    component.update(state);
  }
};
store.subscribe(render);
render();

// Coming back to the tab: resync in case others booked meanwhile.
document.addEventListener('visibilitychange', () => {
  if (
    document.visibilityState === 'visible' &&
    store.getState().connection === 'connected'
  ) {
    void actions.refresh();
  }
});

void actions.start();
