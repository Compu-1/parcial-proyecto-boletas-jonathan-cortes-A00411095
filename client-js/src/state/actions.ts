// User intents. Components call these; these call ice/ and update the store.
// After any failure we reload from the server instead of trusting local state.
import * as booking from '../ice/booking-client.ts';
import { isConnectionError, toUserMessage } from '../ice/errors.ts';
import type { Store } from './store.ts';
import type { NoticeKind } from './types.ts';

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

  async function handleFailure(error: unknown) {
    if (isConnectionError(error)) {
      void reconnect();
      return;
    }
    notify('error', toUserMessage(error));
    await refresh();
  }

  /** Called once per connection: when it closes, start reconnecting. */
  async function onConnected() {
    store.setState({ connection: 'connected' });
    await booking.watchConnection(() => void reconnect());
    await refresh();
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
    await onConnected();
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
        await booking.releaseSeat(seatId);
      } else {
        const refusal = await booking.lockSeat(seatId);
        if (refusal) {
          notify('warning', refusal);
        }
      }
      await refresh();
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
      notify(
        'info',
        ids.length === 1
          ? 'Liberaste 1 silla.'
          : `Liberaste ${ids.length} sillas.`,
      );
      await refresh();
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
