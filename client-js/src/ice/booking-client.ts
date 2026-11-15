// The only module that talks to the server. It owns the communicator and the
// BookingService proxy, and converts every Ice type into a plain type from
// state/types.ts (enums to strings, Ice.Long to number).
import { Ice } from 'ice';
import { BookingApp } from '../generated/BookingService.js';
import type {
  BookingView,
  EventView,
  SeatStatus,
  SeatView,
  Zone,
} from '../state/types.ts';

const SERVICE_IDENTITY = 'BookingService';
const host = import.meta.env.VITE_ICE_HOST || window.location.hostname;
const port = import.meta.env.VITE_ICE_PORT || '10002';

function createCommunicator(): Ice.Communicator {
  const initData = new Ice.InitializationData();
  initData.properties = Ice.createProperties();
  // Same policy as the server: both sides always send heartbeats, and the
  // connection closes only if nothing arrives for 30 s. An idle tab keeps its
  // WebSocket (and its callbacks); a dead server is detected within 30 s.
  initData.properties.setProperty('Ice.ACM.Client.Timeout', '30');
  initData.properties.setProperty('Ice.ACM.Client.Heartbeat', '3'); // Always
  initData.properties.setProperty('Ice.ACM.Client.Close', '4'); // OnIdleForceful
  // Fail fast (5 s) when the server is down instead of waiting forever.
  initData.properties.setProperty('Ice.Override.ConnectTimeout', '5000');
  return Ice.initialize(initData);
}

const communicator = createCommunicator();
const proxy = BookingApp.BookingServicePrx.uncheckedCast(
  communicator.stringToProxy(`${SERVICE_IDENTITY}:ws -h ${host} -p ${port}`),
);

/** One buyer per tab: sessionStorage is per tab, localStorage is not. */
function loadClientId(): string {
  const key = 'icesi-live-arena.clientId';
  try {
    const saved = sessionStorage.getItem(key);
    if (saved) {
      return saved;
    }
    const created = crypto.randomUUID();
    sessionStorage.setItem(key, created);
    return created;
  } catch {
    // Storage blocked (private mode): the id lives only until reload.
    return crypto.randomUUID();
  }
}

export const clientId = loadClientId();

// ---------- Conversions from Ice types ----------

function toZone(zone: BookingApp.SeatZone): Zone {
  if (zone === BookingApp.SeatZone.ZONEVIP) return 'VIP';
  if (zone === BookingApp.SeatZone.ZONEPLATEA) return 'PLATEA';
  return 'GENERAL';
}

/**
 * `mine` holds the ids the server says this tab has locked
 * (getMyLockedSeats). We never compare lockedByClientId ourselves: the
 * callbacks blank it, and "mine" always comes from the server.
 */
function toSeatView(
  seat: BookingApp.Seat,
  now: number,
  mine: ReadonlySet<string>,
): SeatView {
  const base = {
    id: seat.id,
    zone: toZone(seat.zone),
    row: seat.row,
    number: seat.number,
    price: seat.price,
  };

  if (seat.state === BookingApp.SeatState.BOOKED) {
    return { ...base, status: 'booked', expiresAt: null };
  }

  if (seat.state === BookingApp.SeatState.LOCKED) {
    const expiresAt =
      seat.lockTimestamp.toNumber() +
      seat.lockDurationSeconds.toNumber() * 1000;
    // An expired lock means the seat can be taken again (the server's
    // expiry task will confirm it within a second).
    if (expiresAt > now) {
      const status: SeatStatus = mine.has(seat.id) ? 'mine' : 'locked';
      return { ...base, status, expiresAt };
    }
  }

  return { ...base, status: 'available', expiresAt: null };
}

function toEventView(info: BookingApp.EventInfo): EventView {
  return {
    name: info.name,
    date: info.date,
    venue: info.venue,
    totalSeats: info.totalSeats,
    availableSeats: info.availableSeats,
    lockedSeats: info.lockedSeats,
    bookedSeats: info.bookedSeats,
  };
}

function toBookingView(record: BookingApp.BookingRecord): BookingView {
  return {
    code: record.bookingCode,
    customerName: record.customerName,
    customerEmail: record.customerEmail,
    seatIds: [...record.seatIds],
    total: record.totalAmount,
    timestamp: record.timestamp.toNumber(),
  };
}

// ---------- Remote operations ----------

export interface Snapshot {
  event: EventView;
  seats: SeatView[];
  bookings: BookingView[];
}

/** Reads everything the page shows. Used on connect and after failures. */
export async function loadSnapshot(): Promise<Snapshot> {
  const [info, seats, myLocks, bookings] = await Promise.all([
    proxy.getEventInfo(),
    proxy.getAllSeats(),
    proxy.getMyLockedSeats(clientId),
    proxy.getMyBookings(clientId),
  ]);
  const now = Date.now();
  const mine = new Set(myLocks.map(seat => seat.id));
  return {
    event: toEventView(info),
    seats: seats.map(seat => toSeatView(seat, now, mine)),
    bookings: bookings
      .map(toBookingView)
      .sort((a, b) => b.timestamp - a.timestamp),
  };
}

export type LockOutcome =
  | { ok: true; expiresAt: number }
  | { ok: false; message: string };

export async function lockSeat(seatId: string): Promise<LockOutcome> {
  const result = await proxy.lockSeat(seatId, clientId);
  return result.success
    ? { ok: true, expiresAt: result.expiresAt.toNumber() }
    : { ok: false, message: result.message };
}

export async function releaseSeat(seatId: string): Promise<boolean> {
  return proxy.releaseSeat(seatId, clientId);
}

export async function confirmBooking(
  seatIds: string[],
  customerName: string,
  customerEmail: string,
): Promise<BookingView> {
  const result = await proxy.confirmBooking(
    seatIds,
    clientId,
    customerName,
    customerEmail,
  );
  if (!result.success) {
    throw new BookingApp.BookingException(result.message);
  }
  return {
    code: result.bookingCode,
    customerName,
    customerEmail,
    seatIds: [...result.seatIds],
    total: result.totalAmount,
    timestamp: result.timestamp.toNumber(),
  };
}

/** Opens (or reuses) the connection; throws if the server is unreachable. */
export async function ping(): Promise<void> {
  await proxy.ice_ping();
}

// ---------- Real-time callbacks ----------

/** Changed seats arrive with LOCKED as 'locked'; the state layer keeps 'mine'. */
export type ChangeListener = (seats: SeatView[], event: EventView) => void;

/** Servant the server calls. It only converts types and forwards them. */
class SeatObserverI extends BookingApp.SeatObserver {
  private readonly listener: ChangeListener;

  constructor(listener: ChangeListener) {
    super();
    this.listener = listener;
  }

  seatsChanged(seats: BookingApp.SeatList, info: BookingApp.EventInfo) {
    const now = Date.now();
    const none = new Set<string>();
    this.listener(
      seats.map(seat => toSeatView(seat, now, none)),
      toEventView(info),
    );
  }
}

let adapter: Ice.ObjectAdapter | null = null;
let observer: BookingApp.SeatObserverPrx | null = null;

/**
 * Subscribes this tab to seat changes over a bidirectional connection:
 * an object adapter with no endpoints is attached to the connection we
 * opened, so the server calls us back through it (browsers cannot accept
 * incoming connections). Call it again after every reconnection.
 */
export async function subscribe(
  onChange: ChangeListener,
  onClose: () => void,
): Promise<void> {
  if (!adapter || !observer) {
    adapter = await communicator.createObjectAdapter('');
    observer = BookingApp.SeatObserverPrx.uncheckedCast(
      adapter.addWithUUID(new SeatObserverI(onChange)),
    );
  }
  const connection = await proxy.ice_getConnection();
  connection.setAdapter(adapter);
  connection.setCloseCallback(() => onClose());
  await proxy.subscribe(observer);
}
