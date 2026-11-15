import type { BookingView } from '../../state/types.ts';
import { type Component, el } from '../component.ts';
import { formatDateTime, formatMoney } from '../format.ts';
import './receipt.css';

/** A booking drawn as a ticket. Also used, compact, by MyBookings. */
export function buildTicket(booking: BookingView, compact = false) {
  const ticket = el('article', compact ? 'ticket ticket--compact' : 'ticket');

  const head = el('div', 'ticket__head');
  head.append(
    el('span', 'ticket__caption', 'Código de reserva'),
    el('span', 'ticket__code', booking.code),
  );

  const details = el('dl', 'ticket__details');
  const rows: [string, string][] = [
    ['Sillas', booking.seatIds.join(', ')],
    ['Total', formatMoney(booking.total)],
    ['Fecha', formatDateTime(booking.timestamp)],
  ];
  if (!compact) {
    rows.push(
      ['Comprador', booking.customerName],
      ['Correo', booking.customerEmail],
    );
  }
  for (const [term, value] of rows) {
    const row = el('div', 'ticket__row');
    row.append(el('dt', undefined, term), el('dd', 'numeric', value));
    details.append(row);
  }

  ticket.append(head, details);
  return ticket;
}

/** Success view shown inside the checkout dialog. */
export function createReceipt(): Component {
  const root = el('section', 'receipt');
  root.setAttribute('aria-labelledby', 'receipt-title');
  const title = el('h2', 'receipt__title');
  title.id = 'receipt-title';
  title.append(
    el('span', 'receipt__check', '✓'),
    el('span', undefined, '¡Reserva confirmada!'),
  );
  const ticketHost = el('div');
  const copy = el('button', 'button button--secondary', 'Copiar código');
  copy.type = 'button';
  root.append(title, ticketHost, copy);

  let shown: BookingView | null = null;

  async function onCopy() {
    if (!shown) {
      return;
    }
    try {
      await navigator.clipboard.writeText(shown.code);
      copy.textContent = 'Código copiado';
    } catch {
      copy.textContent = 'No se pudo copiar';
    }
  }
  copy.addEventListener('click', onCopy);

  return {
    mount(parent) {
      parent.append(root);
    },
    update(state) {
      const receipt = state.checkout.receipt;
      if (receipt === shown) {
        return;
      }
      shown = receipt;
      root.hidden = receipt === null;
      ticketHost.replaceChildren(...(receipt ? [buildTicket(receipt)] : []));
      copy.textContent = 'Copiar código';
    },
    destroy() {
      copy.removeEventListener('click', onCopy);
      root.remove();
    },
  };
}
