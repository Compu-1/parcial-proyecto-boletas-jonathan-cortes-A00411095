// Plain application types. Nothing from Ice reaches this layer: the ice/
// boundary converts enums to strings and Ice.Long to number.

export type Zone = 'VIP' | 'PLATEA' | 'GENERAL';

/** Seat state from this tab's point of view. */
export type SeatStatus = 'available' | 'mine' | 'locked' | 'booked';

export interface SeatView {
  id: string;
  zone: Zone;
  row: string;
  number: number;
  price: number;
  status: SeatStatus;
  /** Epoch milliseconds when the lock ends; null if the seat is not locked. */
  expiresAt: number | null;
}

export interface EventView {
  name: string;
  date: string;
  venue: string;
  totalSeats: number;
  availableSeats: number;
  lockedSeats: number;
  bookedSeats: number;
}

export interface BookingView {
  code: string;
  customerName: string;
  customerEmail: string;
  seatIds: string[];
  total: number;
  /** Epoch milliseconds. */
  timestamp: number;
}

export type ConnectionStatus =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected';

export type NoticeKind = 'success' | 'info' | 'warning' | 'error';

export interface Notice {
  id: number;
  kind: NoticeKind;
  message: string;
}

export interface CheckoutState {
  open: boolean;
  submitting: boolean;
  /** Set after a successful booking; the modal then shows the receipt. */
  receipt: BookingView | null;
}

export interface AppState {
  connection: ConnectionStatus;
  event: EventView | null;
  seats: SeatView[];
  bookings: BookingView[];
  /** Seats with a lock or release call in flight, to block double clicks. */
  pendingSeatIds: string[];
  checkout: CheckoutState;
  notices: Notice[];
}
