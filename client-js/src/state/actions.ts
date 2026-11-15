// User intents. Components call these; these call ice/ and update the store.
// Other buyers' changes arrive through Ice callbacks (applyChanges). After any
// failure we reload from the server instead of trusting local state.
import * as booking from '../ice/booking-client.ts';
import { isConnectionError, toUserMessage } from '../ice/errors.ts';
import type { Store } from './store.ts';
import type { EventView, NoticeKind, SeatView } from './types.ts';

export interface Actions {
  start(): Promise<void>;
  refresh(): Promise<void>;
  toggleSeat(seatId: string): Promise<void>;
  releaseAll(): Promise<void>;
  openCheckout(): void;
  closeCheckout(): void;
  confirmBooking(name: string, email: string): Promise<void>;
  notify(kind: NoticeKind, message: string): void;
  dismissNotice(id: number): void;
}

const MAX_NOTICES = 3;
const RETRY_MIN_MS = 1000;
const RETRY_MAX_MS = 10000;
/** Failed attempts before the status changes from "reconnecting" to "offline". */
const ATTEMPTS_BEFORE_OFFLINE = 3;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export function createActions(store: Store): Actions {
  let nextNoticeId = 1;
  let reconnecting = false;

  function notify(kind: NoticeKind, message: string) {
    const notice = { id: nextNoticeId++, kind, message };
    const notices = [...store.getState().notices, notice].slice(-MAX_NOTICES);
    store.setState({ notices });
  }

  function mySeatIds(): string[] {
    return store
      .getState()
      .seats.filter(seat => seat.status === 'mine')
      .map(seat => seat.id);
  }

  async function refresh() {
    try {
      const snapshot = await booking.loadSnapshot();
      store.setState(snapshot);
      closeCheckoutIfCartEmptied();
    } catch (error) {
      if (isConnectionError(error)) {
        void reconnect();
      } else {
        notify('error', toUserMessage(error));
      }
    }
  }

  /** The cart can empty itself (lock expired) while the form is open. */
  function closeCheckoutIfCartEmptied() {
    const { checkout } = store.getState();
    if (checkout.open && !checkout.receipt && mySeatIds().length === 0) {
      store.setState({ checkout: { ...checkout, open: false } });
      notify('warning', 'Tus sillas se liberaron porque el tiempo terminó.');
    }
  }

  /** Replaces the given seats in the store, keeping the server's order. */
  function patchSeats(changed: SeatView[]) {
    const byId = new Map(changed.map(seat => [seat.id, seat]));
    store.setState({
      seats: store.getState().seats.map(seat => byId.get(seat.id) ?? seat),
    });
  }

  /**
   * Called by the SeatObserver servant. Callbacks never say whose lock it is,
   * so a seat that is already ours stays 'mine' while it is still LOCKED
   * (the server sends changes in commit order: if our lock had ended we would
   * first receive it as AVAILABLE).
   */
  function applyChanges(changed: SeatView[], event: EventView) {
    const current = new Map(store.getState().seats.map(s => [s.id, s]));
    const merged = changed.map(seat =>
      seat.status === 'locked' && current.get(seat.id)?.status === 'mine'
        ? { ...seat, status: 'mine' as const }
        : seat,
    );
    patchSeats(merged);
    store.setState({ event });
    closeCheckoutIfCartEmptied();
  }

  function setSeatStatus(
    seatId: string,
    status: SeatView['status'],
    expiresAt: number | null,
  ) {
    const seat = store.getState().seats.find(s => s.id === seatId);
    if (seat) {
      patchSeats([{ ...seat, status, expiresAt }]);
    }
  }

  async function handleFailure(error: unknown) {
    if (isConnectionError(error)) {
      void reconnect();
      return;
    }
    notify('error', toUserMessage(error));
    await refresh();
  }

  /**
   * Called once per connection. Subscribe first, then read the snapshot, so
   * no change can slip between the two. When the connection closes, the
   * subscription dies with it: reconnect() subscribes again.
   */
  async function onConnected() {
    await booking.subscribe(applyChanges, () => void reconnect());
    // Not refresh(): it swallows errors, and the retry loop needs them.
    store.setState(await booking.loadSnapshot());
    store.setState({ connection: 'connected' });
    closeCheckoutIfCartEmptied();
  }

  /** Retries with exponential backoff (1 s, 2 s, 4 s… up to 10 s). */
  async function reconnect() {
    if (reconnecting) {
      return;
    }
    reconnecting = true;
    store.setState({ connection: 'reconnecting' });

    let delay = RETRY_MIN_MS;
    let attempts = 0;
    for (;;) {
      try {
        await booking.ping();
        await onConnected();
        break;
      } catch {
        attempts++;
        if (attempts === ATTEMPTS_BEFORE_OFFLINE) {
          store.setState({ connection: 'disconnected' });
        }
        await sleep(delay);
        delay = Math.min(delay * 2, RETRY_MAX_MS);
      }
    }

    reconnecting = false;
    notify('success', 'Conexión restablecida.');
  }

  async function start() {
    try {
      await booking.ping();
      await onConnected();
    } catch {
      await reconnect();
    }
  }

  function setPending(seatId: string, pending: boolean) {
    const current = store.getState().pendingSeatIds;
    store.setState({
      pendingSeatIds: pending
        ? [...current, seatId]
        : current.filter(id => id !== seatId),
    });
  }

  async function toggleSeat(seatId: string) {
    const state = store.getState();
    const seat = state.seats.find(s => s.id === seatId);
    if (
      !seat ||
      state.connection !== 'connected' ||
      state.pendingSeatIds.includes(seatId)
    ) {
      return;
    }

    if (seat.status === 'locked') {
      notify('info', `La silla ${seat.id} está retenida por otro comprador.`);
      return;
    }
    if (seat.status === 'booked') {
      notify('info', `La silla ${seat.id} ya fue vendida.`);
      return;
    }

    setPending(seatId, true);
    try {
      if (seat.status === 'mine') {
        if (await booking.releaseSeat(seatId)) {
          setSeatStatus(seatId, 'available', null);
        } else {
          await refresh(); // the lock had already ended
        }
      } else {
        const outcome = await booking.lockSeat(seatId);
        if (outcome.ok) {
          // The server's answer is the only proof the seat is ours.
          setSeatStatus(seatId, 'mine', outcome.expiresAt);
        } else {
          notify('warning', outcome.message);
          await refresh();
        }
      }
    } catch (error) {
      await handleFailure(error);
    } finally {
      setPending(seatId, false);
    }
  }

  async function releaseAll() {
    const ids = mySeatIds();
    if (ids.length === 0) {
      return;
    }
    try {
      await Promise.all(ids.map(id => booking.releaseSeat(id)));
      for (const id of ids) {
        setSeatStatus(id, 'available', null);
      }
      notify(
        'info',
        ids.length === 1
          ? 'Liberaste 1 silla.'
          : `Liberaste ${ids.length} sillas.`,
      );
    } catch (error) {
      await handleFailure(error);
    }
  }

  function openCheckout() {
    if (mySeatIds().length === 0) {
      return;
    }
    store.setState({
      checkout: { open: true, submitting: false, receipt: null },
    });
  }

  function closeCheckout() {
    store.setState({
      checkout: { open: false, submitting: false, receipt: null },
    });
  }

  async function confirmBooking(name: string, email: string) {
    const ids = mySeatIds();
    const { checkout } = store.getState();
    if (ids.length === 0 || checkout.submitting) {
      return;
    }

    store.setState({ checkout: { ...checkout, submitting: true } });
    try {
      const receipt = await booking.confirmBooking(ids, name, email);
      store.setState({ checkout: { open: true, submitting: false, receipt } });
      notify('success', `¡Reserva ${receipt.code} confirmada!`);
      await refresh();
    } catch (error) {
      store.setState({
        checkout: { ...store.getState().checkout, submitting: false },
      });
      await handleFailure(error);
    }
  }

  function dismissNotice(id: number) {
    store.setState({
      notices: store.getState().notices.filter(notice => notice.id !== id),
    });
  }

  return {
    start,
    refresh,
    toggleSeat,
    releaseAll,
    openCheckout,
    closeCheckout,
    confirmBooking,
    notify,
    dismissNotice,
  };
}
