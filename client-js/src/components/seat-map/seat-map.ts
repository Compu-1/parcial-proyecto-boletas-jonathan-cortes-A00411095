import type { AppState, SeatView, Zone } from '../../state/types.ts';
import { type Component, el } from '../component.ts';
import { formatMoney, ZONE_LABEL } from '../format.ts';
import { paintSeat, STATUS_LABEL } from '../seat/seat.ts';
import './seat-map.css';

export interface SeatMapIntents {
  onToggleSeat(seatId: string): void;
}

const ZONES: Zone[] = ['VIP', 'PLATEA', 'GENERAL'];

export function createSeatMap(intents: SeatMapIntents): Component {
  const root = el('section', 'seat-map');
  root.setAttribute('aria-labelledby', 'seat-map-title');
  const title = el('h2', 'panel-title', 'Mapa de sillas');
  title.id = 'seat-map-title';
  const hint = el(
    'p',
    'seat-map__hint',
    'Toca una silla para retenerla durante 90 segundos. Usa las flechas para moverte con el teclado.',
  );
  const scroller = el('div', 'seat-map__scroller');
  const stage = el('div', 'seat-map__stage', 'Escenario');
  const zonesHost = el('div', 'seat-map__zones');
  scroller.append(stage, zonesHost);
  root.append(title, hint, scroller);

  const buttons = new Map<string, HTMLButtonElement>();
  /** Seat ids by row, for arrow-key navigation. */
  let grid: string[][] = [];
  let builtFor = '';
  let previous = new Map<string, SeatView['status']>();
  /** The one seat reachable with Tab (roving tabindex). */
  let activeId = '';

  function build(seats: SeatView[]) {
    zonesHost.replaceChildren();
    buttons.clear();
    grid = [];

    for (const zone of ZONES) {
      const zoneSeats = seats.filter(seat => seat.zone === zone);
      if (zoneSeats.length === 0) {
        continue;
      }
      const section = el('div', 'seat-map__zone');
      section.dataset.zone = zone;
      const heading = el(
        'h3',
        'pill seat-map__zone-title',
        `${ZONE_LABEL[zone]} · ${formatMoney(zoneSeats[0].price)}`,
      );
      section.append(heading);

      const rows = [...new Set(zoneSeats.map(seat => seat.row))];
      for (const row of rows) {
        const rowSeats = zoneSeats
          .filter(seat => seat.row === row)
          .sort((a, b) => a.number - b.number);
        const rowEl = el('div', 'seat-map__row');
        rowEl.setAttribute('role', 'group');
        rowEl.setAttribute('aria-label', `Fila ${row}`);
        rowEl.append(el('span', 'seat-map__row-label', row));

        const aisleAt = Math.ceil(rowSeats.length / 2);
        rowSeats.forEach((seat, index) => {
          if (index === aisleAt) {
            rowEl.append(el('span', 'seat-map__aisle'));
          }
          const button = el('button', 'seat seat-map__seat');
          button.type = 'button';
          button.dataset.seatId = seat.id;
          button.tabIndex = -1;
          buttons.set(seat.id, button);
          rowEl.append(button);
        });

        rowEl.append(el('span', 'seat-map__row-label', row));
        section.append(rowEl);
        grid.push(rowSeats.map(seat => seat.id));
      }
      zonesHost.append(section);
    }

    activeId = grid[0]?.[0] ?? '';
    const first = buttons.get(activeId);
    if (first) {
      first.tabIndex = 0;
    }
  }

  function paint(seat: SeatView, state: AppState) {
    const button = buttons.get(seat.id);
    if (!button) {
      return;
    }
    const before = previous.get(seat.id);
    if (before === seat.status && button.dataset.state) {
      return;
    }
    paintSeat(button, seat.status, seat.number);
    button.setAttribute(
      'aria-label',
      `Silla ${seat.id}, zona ${ZONE_LABEL[seat.zone]}, ${formatMoney(seat.price)}, ${STATUS_LABEL[seat.status].toLowerCase()}`,
    );
    button.setAttribute('aria-pressed', String(seat.status === 'mine'));
    const unavailable = seat.status === 'locked' || seat.status === 'booked';
    button.setAttribute('aria-disabled', String(unavailable));

    // Another buyer changed this seat: pulse it so the activity is visible.
    const byOthers =
      before !== undefined && before !== 'mine' && seat.status !== 'mine';
    if (byOthers && !state.pendingSeatIds.includes(seat.id)) {
      button.classList.remove('is-pulsing');
      void button.offsetWidth; // restart the animation
      button.classList.add('is-pulsing');
    }
  }

  function focusSeat(id: string) {
    const next = buttons.get(id);
    if (!next) {
      return;
    }
    const current = buttons.get(activeId);
    if (current) {
      current.tabIndex = -1;
    }
    next.tabIndex = 0;
    next.focus();
    activeId = id;
  }

  function onKeyDown(event: KeyboardEvent) {
    const target = event.target as HTMLElement;
    const id = target.dataset.seatId;
    if (!id) {
      return;
    }
    const r = grid.findIndex(row => row.includes(id));
    const c = grid[r].indexOf(id);
    const clampCol = (row: string[]) => row[Math.min(c, row.length - 1)];

    let nextId: string | undefined;
    switch (event.key) {
      case 'ArrowRight':
        nextId = grid[r][c + 1];
        break;
      case 'ArrowLeft':
        nextId = grid[r][c - 1];
        break;
      case 'ArrowDown':
        nextId = grid[r + 1] && clampCol(grid[r + 1]);
        break;
      case 'ArrowUp':
        nextId = grid[r - 1] && clampCol(grid[r - 1]);
        break;
      case 'Home':
        nextId = grid[r][0];
        break;
      case 'End':
        nextId = grid[r][grid[r].length - 1];
        break;
      default:
        return;
    }
    event.preventDefault();
    if (nextId) {
      focusSeat(nextId);
    }
  }

  function onClick(event: MouseEvent) {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
      '.seat-map__seat',
    );
    const id = button?.dataset.seatId;
    if (!id || root.dataset.offline === 'true') {
      return;
    }
    focusSeat(id);
    intents.onToggleSeat(id);
  }

  root.addEventListener('keydown', onKeyDown);
  root.addEventListener('click', onClick);

  return {
    mount(parent) {
      parent.append(root);
    },
    update(state) {
      const signature = state.seats.map(seat => seat.id).join();
      if (signature !== builtFor) {
        build(state.seats);
        builtFor = signature;
        previous = new Map();
      }
      for (const seat of state.seats) {
        paint(seat, state);
      }
      previous = new Map(state.seats.map(seat => [seat.id, seat.status]));

      for (const [id, button] of buttons) {
        button.toggleAttribute('aria-busy', state.pendingSeatIds.includes(id));
      }
      root.dataset.offline = String(state.connection !== 'connected');
      root.setAttribute('aria-busy', String(state.seats.length === 0));
    },
    destroy() {
      root.removeEventListener('keydown', onKeyDown);
      root.removeEventListener('click', onClick);
      root.remove();
    },
  };
}
