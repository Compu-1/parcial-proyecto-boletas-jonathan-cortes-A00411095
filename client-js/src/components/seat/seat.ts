// Shared look of a seat. Not a component: a helper used by SeatMap and
// Legend, so the legend always matches the map.
import type { SeatStatus } from '../../state/types.ts';
import './seat.css';

export const STATUS_LABEL: Record<SeatStatus, string> = {
  available: 'Disponible',
  mine: 'Seleccionada por ti',
  locked: 'Retenida por otro comprador',
  booked: 'Vendida',
};

/**
 * Paints a seat element. The glyph repeats the state so it is never shown by
 * colour alone: a check for yours, a cross for sold, stripes for held.
 */
export function paintSeat(
  element: HTMLElement,
  status: SeatStatus,
  number: number | null,
) {
  element.dataset.state = status;
  const label = number === null ? '' : String(number);
  if (status === 'mine') {
    element.textContent = `✓${label}`;
  } else if (status === 'booked') {
    element.textContent = '✕';
  } else {
    element.textContent = label;
  }
}
