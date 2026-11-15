package co.icesi.booking.server;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import com.zeroc.Ice.Current;

import BookingApp.BookingException;
import BookingApp.BookingRecord;
import BookingApp.BookingResult;
import BookingApp.BookingService;
import BookingApp.EventInfo;
import BookingApp.InvalidBookingException;
import BookingApp.LockExpiredException;
import BookingApp.LockResult;
import BookingApp.Seat;
import BookingApp.SeatObserverPrx;
import BookingApp.SeatNotAvailableException;
import BookingApp.SeatNotFoundException;
import BookingApp.SeatState;
import BookingApp.SeatZone;

public class BookingServiceImpl implements BookingService {

    public static final long DEFAULT_LOCK_DURATION_SECONDS = 90;

    private final EventInfo eventInfo;
    private final Map<String, Seat> seatsMap = new HashMap<>();
    private final List<BookingRecord> bookingsList = new ArrayList<>();
    private final SeatNotifier notifier = new SeatNotifier();

    /** Copies of the changed seats and the counters, taken inside the monitor. */
    private record Change(Seat[] seats, EventInfo info) {}

    public BookingServiceImpl() {
        this.eventInfo = new EventInfo(
                "EVT-2026-LIVE",
                "Concierto Icesi Live Rock & Pop 2026",
                "2026-11-28 20:00",
                "Auditorio Manuelita - Universidad Icesi",
                90, 90, 0, 0,
                120000.0, 75000.0, 45000.0
        );
        initSeats();
    }

    private void initSeats() {
        seatsMap.clear();
        bookingsList.clear();

        createSeatsForZone("A", 1, 10, SeatZone.ZONEVIP, 120000.0);
        createSeatsForZone("B", 1, 10, SeatZone.ZONEVIP, 120000.0);

        createSeatsForZone("C", 1, 10, SeatZone.ZONEPLATEA, 75000.0);
        createSeatsForZone("D", 1, 10, SeatZone.ZONEPLATEA, 75000.0);
        createSeatsForZone("E", 1, 10, SeatZone.ZONEPLATEA, 75000.0);

        createSeatsForZone("F", 1, 10, SeatZone.ZONEGENERAL, 45000.0);
        createSeatsForZone("G", 1, 10, SeatZone.ZONEGENERAL, 45000.0);
        createSeatsForZone("H", 1, 10, SeatZone.ZONEGENERAL, 45000.0);
        createSeatsForZone("I", 1, 10, SeatZone.ZONEGENERAL, 45000.0);

        updateEventCounters();
        System.out.printf("[INFO] Inventario inicializado con %d sillas en 3 zonas (VIP, Platea, General).%n", seatsMap.size());
    }

    private void createSeatsForZone(String row, int startNum, int endNum, SeatZone zone, double price) {
        for (int num = startNum; num <= endNum; num++) {
            String seatId = String.format("%s-%d", row, num);
            Seat seat = new Seat(
                    seatId,
                    zone,
                    row,
                    num,
                    price,
                    SeatState.AVAILABLE,
                    "",
                    0L,
                    DEFAULT_LOCK_DURATION_SECONDS
            );
            seatsMap.put(seatId, seat);
        }
    }

    private boolean isLockExpired(Seat seat) {
        if (seat.state != SeatState.LOCKED) return false;
        long expiresAt = seat.lockTimestamp + (seat.lockDurationSeconds * 1000L);
        return System.currentTimeMillis() >= expiresAt;
    }

    private void updateEventCounters() {
        int avail = 0;
        int locked = 0;
        int booked = 0;
        for (Seat s : seatsMap.values()) {
            if (s.state == SeatState.BOOKED) {
                booked++;
            } else if (s.state == SeatState.LOCKED && !isLockExpired(s)) {
                locked++;
            } else {
                avail++;
            }
        }
        eventInfo.totalSeats = seatsMap.size();
        eventInfo.availableSeats = avail;
        eventInfo.lockedSeats = locked;
        eventInfo.bookedSeats = booked;
    }

    /**
     * Must be called while holding the monitor. Returns copies, never the
     * internal objects, with the owner hidden: buyers never see other ids.
     */
    private Change captureChange(Iterable<String> seatIds) {
        updateEventCounters();
        List<Seat> copies = new ArrayList<>();
        for (String id : seatIds) {
            Seat seat = seatsMap.get(id);
            if (seat != null) {
                Seat copy = seat.clone();
                copy.lockedByClientId = "";
                copies.add(copy);
            }
        }
        return new Change(copies.toArray(new Seat[0]), eventInfo.clone());
    }

    /** Caller holds the monitor: queues the change in commit order (see SeatNotifier). */
    private void publish(Change change) {
        notifier.publish(change.seats(), change.info());
    }

    @Override
    public synchronized EventInfo getEventInfo(Current current) {
        updateEventCounters();
        return eventInfo.clone();
    }

    @Override
    public synchronized Seat[] getAllSeats(Current current) {
        List<Seat> list = new ArrayList<>();
        for (Seat s : seatsMap.values()) {
            list.add(s.clone());
        }
        list.sort(Comparator.comparing((Seat s) -> s.row).thenComparingInt(s -> s.number));
        return list.toArray(new Seat[0]);
    }

    @Override
    public synchronized Seat[] getSeatsByZone(SeatZone zone, Current current) {
        List<Seat> list = new ArrayList<>();
        for (Seat s : seatsMap.values()) {
            if (s.zone == zone) {
                list.add(s.clone());
            }
        }
        list.sort(Comparator.comparing((Seat s) -> s.row).thenComparingInt(s -> s.number));
        return list.toArray(new Seat[0]);
    }

    @Override
    public synchronized Seat getSeat(String seatId, Current current) throws SeatNotFoundException {
        Seat seat = seatsMap.get(seatId);
        if (seat == null) {
            throw new SeatNotFoundException("Silla no encontrada en inventario: " + seatId);
        }
        return seat.clone();
    }

    @Override
    public LockResult lockSeat(String seatId, String clientId, Current current)
            throws SeatNotFoundException, SeatNotAvailableException {
        // Check-then-act, snapshot and enqueue under the monitor; the callbacks
        // themselves are sent later by the notifier thread, outside it.
        synchronized (this) {
            LockResult result = lockSeatLocked(seatId, clientId);
            publish(captureChange(List.of(seatId)));
            return result;
        }
    }

    /** Caller holds the monitor. */
    private LockResult lockSeatLocked(String seatId, String clientId)
            throws SeatNotFoundException, SeatNotAvailableException {

        // An empty clientId is the value that means "nobody" in Seat.lockedByClientId
        if (clientId == null || clientId.trim().isEmpty()) {
            throw new SeatNotAvailableException("El identificador del cliente es obligatorio para bloquear una silla.");
        }

        Seat seat = seatsMap.get(seatId);
        if (seat == null) {
            throw new SeatNotFoundException("Silla no encontrada: " + seatId);
        }

        // Si estaba bloqueada pero expiró el tiempo de retención, liberarla
        if (seat.state == SeatState.LOCKED && isLockExpired(seat)) {
            System.out.printf("[LOCK-EXPIRED] El bloqueo de la silla %s expiró. Liberando.%n", seatId);
            seat.state = SeatState.AVAILABLE;
            seat.lockedByClientId = "";
        }

        // Validación de disponibilidad
        if (seat.state != SeatState.AVAILABLE) {
            if (seat.state == SeatState.LOCKED && clientId.equals(seat.lockedByClientId)) {
                // El mismo cliente renueva el bloqueo
                seat.lockTimestamp = System.currentTimeMillis();
                long expiresAt = seat.lockTimestamp + (seat.lockDurationSeconds * 1000L);
                return new LockResult(true, seatId, "Bloqueo renovado con éxito.", expiresAt);
            }
            throw new SeatNotAvailableException(String.format("La silla %s ya no se encuentra disponible (Estado: %s).", seatId, seat.state));
        }

        // Simulación de latencia de red / I/O en base de datos (No remover)
        try {
            Thread.sleep(25);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }

        seat.state = SeatState.LOCKED;
        seat.lockedByClientId = clientId;
        seat.lockTimestamp = System.currentTimeMillis();
        seat.lockDurationSeconds = DEFAULT_LOCK_DURATION_SECONDS;

        long expiresAt = seat.lockTimestamp + (DEFAULT_LOCK_DURATION_SECONDS * 1000L);
        System.out.printf("[LOCK-OK] Silla %s bloqueada exitosamente para cliente: %s (expira en %ds)%n",
                seatId, clientId, DEFAULT_LOCK_DURATION_SECONDS);

        return new LockResult(true, seatId, "Silla bloqueada exitosamente.", expiresAt);
    }

    @Override
    public boolean releaseSeat(String seatId, String clientId, Current current) throws SeatNotFoundException {
        synchronized (this) {
            boolean released = releaseSeatLocked(seatId, clientId);
            if (released) {
                publish(captureChange(List.of(seatId)));
            }
            return released;
        }
    }

    /** Caller holds the monitor. */
    private boolean releaseSeatLocked(String seatId, String clientId) throws SeatNotFoundException {
        Seat seat = seatsMap.get(seatId);
        if (seat == null) {
            throw new SeatNotFoundException("Silla no encontrada: " + seatId);
        }

        // Solo puede liberar el cliente que la bloqueó o si ya expiró
        if (seat.state == SeatState.LOCKED) {
            if (clientId.equals(seat.lockedByClientId) || isLockExpired(seat)) {
                seat.state = SeatState.AVAILABLE;
                seat.lockedByClientId = "";
                seat.lockTimestamp = 0L;
                System.out.printf("[RELEASE-OK] Silla %s liberada por cliente: %s%n", seatId, clientId);
                return true;
            }
        }
        return false;
    }

    @Override
    public BookingResult confirmBooking(String[] seatIds, String clientId, String customerName, String customerEmail, Current current)
            throws InvalidBookingException, BookingException {
        synchronized (this) {
            BookingResult result = confirmBookingLocked(seatIds, clientId, customerName, customerEmail);
            publish(captureChange(List.of(seatIds)));
            return result;
        }
    }

    /** Caller holds the monitor. All or nothing: validates every seat before changing any. */
    private BookingResult confirmBookingLocked(String[] seatIds, String clientId, String customerName, String customerEmail)
            throws InvalidBookingException, BookingException {

        if (seatIds == null || seatIds.length == 0) {
            throw new InvalidBookingException("Debe seleccionar al menos una silla para completar la reserva.");
        }
        if (customerName == null || customerName.trim().isEmpty()) {
            throw new InvalidBookingException("El nombre del comprador es obligatorio.");
        }
        if (customerEmail == null || !customerEmail.contains("@")) {
            throw new InvalidBookingException("El correo electrónico del comprador es inválido.");
        }
        if (clientId == null || clientId.trim().isEmpty()) {
            throw new InvalidBookingException("El identificador del cliente es obligatorio.");
        }

        double totalAmount = 0.0;
        List<Seat> validatedSeats = new ArrayList<>();

        // Paso 1: validar TODAS las sillas antes de modificar alguna (todo o nada).
        // Cada silla debe estar LOCKED por este mismo cliente y con el bloqueo vigente.
        Set<String> seenIds = new HashSet<>();
        for (String seatId : seatIds) {
            if (!seenIds.add(seatId)) {
                throw new InvalidBookingException("La silla " + seatId + " está repetida en la solicitud.");
            }
            Seat seat = seatsMap.get(seatId);
            if (seat == null) {
                throw new SeatNotFoundException("Silla no existe: " + seatId);
            }
            if (seat.state == SeatState.BOOKED) {
                throw new BookingException("La silla " + seatId + " ya fue vendida definitivamente.");
            }
            if (seat.state != SeatState.LOCKED) {
                throw new BookingException("La silla " + seatId + " no está bloqueada. Debe seleccionarla antes de comprar.");
            }
            if (!clientId.equals(seat.lockedByClientId)) {
                throw new BookingException("La silla " + seatId + " se encuentra bloqueada por otro comprador.");
            }
            if (isLockExpired(seat)) {
                throw new LockExpiredException("El bloqueo temporal de la silla " + seatId + " ha expirado.");
            }
            totalAmount += seat.price;
            validatedSeats.add(seat);
        }

        // Paso 2: confirmación. Ocurre dentro del mismo monitor que la validación,
        // así que ningún otro hilo puede cambiar las sillas entre los dos pasos.
        for (Seat s : validatedSeats) {
            s.state = SeatState.BOOKED;
            s.lockedByClientId = clientId;
        }

        String bookingCode = "RES-" + UUID.randomUUID().toString().substring(0, 6).toUpperCase();
        long now = System.currentTimeMillis();

        BookingRecord record = new BookingRecord(
                bookingCode,
                eventInfo.id,
                clientId,
                customerName.trim(),
                customerEmail.trim(),
                seatIds,
                totalAmount,
                now
        );
        bookingsList.add(record);

        System.out.printf("[BOOKING-CONFIRMED] Código: %s | Cliente: %s (%s) | %d sillas | Total: $%,.0f COP%n",
                bookingCode, customerName, clientId, seatIds.length, totalAmount);

        return new BookingResult(
                true,
                bookingCode,
                "Reserva confirmada con éxito. Disfrute del evento.",
                seatIds,
                totalAmount,
                now
        );
    }

    @Override
    public synchronized Seat[] getMyLockedSeats(String clientId, Current current) {
        List<Seat> list = new ArrayList<>();
        if (clientId != null && !clientId.isEmpty()) {
            for (Seat s : seatsMap.values()) {
                if (s.state == SeatState.LOCKED && clientId.equals(s.lockedByClientId) && !isLockExpired(s)) {
                    list.add(s.clone());
                }
            }
        }
        return list.toArray(new Seat[0]);
    }

    @Override
    public synchronized BookingRecord[] getMyBookings(String clientId, Current current) {
        List<BookingRecord> list = new ArrayList<>();
        if (clientId != null && !clientId.isEmpty()) {
            for (BookingRecord b : bookingsList) {
                if (clientId.equals(b.clientId)) {
                    list.add(b);
                }
            }
        }
        return list.toArray(new BookingRecord[0]);
    }

    @Override
    public void resetSeats(Current current) {
        synchronized (this) {
            initSeats();
            publish(captureChange(seatsMap.keySet()));
        }
        System.out.println("[RESET] Inventario y reservas reiniciadas a estado de fábrica.");
    }

    /**
     * Run every second by a scheduled task (see BookingServerApp). Frees expired
     * locks proactively, so no tab keeps showing a stale LOCKED seat.
     */
    public void expireLocks() {
        synchronized (this) {
            List<String> expired = new ArrayList<>();
            for (Seat seat : seatsMap.values()) {
                if (isLockExpired(seat)) {
                    seat.state = SeatState.AVAILABLE;
                    seat.lockedByClientId = "";
                    seat.lockTimestamp = 0L;
                    expired.add(seat.id);
                }
            }
            if (expired.isEmpty()) {
                return;
            }
            System.out.printf("[LOCK-EXPIRED] Sillas liberadas por tiempo: %s%n", expired);
            publish(captureChange(expired));
        }
    }

    @Override
    public void subscribe(SeatObserverPrx observer, Current current) {
        // current.con is null only for collocated calls: there is no
        // connection to call back on, so there is nothing to subscribe.
        if (observer != null && current.con != null) {
            notifier.add(observer, current.con);
        }
    }

    @Override
    public void unsubscribe(SeatObserverPrx observer, Current current) {
        if (observer != null && current.con != null) {
            notifier.remove(observer.ice_fixed(current.con));
        }
    }
}
