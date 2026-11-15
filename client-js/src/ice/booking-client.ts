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
  // Send heartbeats so the WebSocket stays open while the user is idle,
  // and never close the connection for inactivity.
  initData.properties.setProperty('Ice.ACM.Client.Heartbeat', '3'); // Always
  initData.properties.setProperty('Ice.ACM.Client.Close', '0'); // Off
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

function toSeatView(seat: BookingApp.Seat, now: number): SeatView {
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
    // The server may still report a lock that has already run out.
    // An expired lock means the seat can be taken again.
    if (expiresAt > now) {
      const status: SeatStatus =
        seat.lockedByClientId === clientId ? 'mine' : 'locked';
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

/** Reads everything the page shows. Used on load and after every action. */
export async function loadSnapshot(): Promise<Snapshot> {
  const [info, seats, bookings] = await Promise.all([
    proxy.getEventInfo(),
    proxy.getAllSeats(),
    proxy.getMyBookings(clientId),
  ]);
  const now = Date.now();
  return {
    event: toEventView(info),
    seats: seats.map(seat => toSeatView(seat, now)),
    bookings: bookings
      .map(toBookingView)
      .sort((a, b) => b.timestamp - a.timestamp),
  };
}

/** Returns the server's message when the lock is refused without throwing. */
export async function lockSeat(seatId: string): Promise<string | null> {
  const result = await proxy.lockSeat(seatId, clientId);
  return result.success ? null : result.message;
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

/** Calls `onClose` once when the current connection to the server closes. */
export async function watchConnection(onClose: () => void): Promise<void> {
  const connection = await proxy.ice_getConnection();
  connection.setCloseCallback(() => onClose());
}
