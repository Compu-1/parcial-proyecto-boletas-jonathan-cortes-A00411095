// Maps remote failures to Spanish messages for the user (RF-7).
import { Ice } from 'ice';
import { BookingApp } from '../generated/BookingService.js';

/** True when the failure means "no connection", not "request refused". */
export function isConnectionError(error: unknown): boolean {
  return (
    error instanceof Ice.SocketException || // connect failed, refused, lost
    error instanceof Ice.TimeoutException ||
    error instanceof Ice.CloseConnectionException ||
    error instanceof Ice.CommunicatorDestroyedException
  );
}

/** The server already writes its reasons in Spanish; prefer them. */
function reasonOr(error: BookingApp.BookingException, fallback: string) {
  return error.reason.trim() || fallback;
}

export function toUserMessage(error: unknown): string {
  // Subclasses first: they all extend BookingException.
  if (error instanceof BookingApp.SeatNotFoundException) {
    return reasonOr(error, 'La silla seleccionada no existe.');
  }
  if (error instanceof BookingApp.SeatNotAvailableException) {
    return reasonOr(
      error,
      'Esa silla ya no está disponible. Elige otra en el mapa.',
    );
  }
  if (error instanceof BookingApp.LockExpiredException) {
    return reasonOr(
      error,
      'El tiempo de retención terminó. Vuelve a seleccionar tus sillas.',
    );
  }
  if (error instanceof BookingApp.InvalidBookingException) {
    return reasonOr(error, 'Los datos de la reserva no son válidos.');
  }
  if (error instanceof BookingApp.BookingException) {
    return reasonOr(error, 'No fue posible completar la reserva.');
  }
  if (isConnectionError(error)) {
    return 'Se perdió la conexión con el servidor. Intentando reconectar…';
  }
  return 'Ocurrió un error inesperado. Intenta de nuevo.';
}
