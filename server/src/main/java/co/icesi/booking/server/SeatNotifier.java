package co.icesi.booking.server;

import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import com.zeroc.Ice.Connection;

import BookingApp.EventInfo;
import BookingApp.Seat;
import BookingApp.SeatObserverPrx;

/**
 * Keeps the browser tabs subscribed to seat changes and pushes changes to them.
 *
 * Thread safety: the set is a concurrent set, so subscribe, unsubscribe and
 * sending can run from different threads.
 *
 * Ordering: publish() is called INSIDE the inventory lock, but it only puts
 * the change in a queue (O(1), never blocks). One dispatcher thread sends the
 * queue in order, outside the lock, with asynchronous calls. Enqueueing under
 * the lock keeps changes in commit order: without it, two threads touching the
 * same seat could publish "AVAILABLE" before "LOCKED" and tabs would keep a
 * stale state. A slow tab never blocks a booking.
 */
public class SeatNotifier {

    private final Set<SeatObserverPrx> observers = ConcurrentHashMap.newKeySet();
    private final ExecutorService dispatcher = Executors.newSingleThreadExecutor(runnable -> {
        Thread thread = new Thread(runnable, "seat-notifier");
        thread.setDaemon(true); // never keeps the JVM alive on shutdown
        return thread;
    });

    /**
     * Registers a tab. The proxy is bound to the connection the tab opened
     * (bidirectional connection): the server never connects back to the browser.
     */
    public void add(SeatObserverPrx observer, Connection connection) {
        SeatObserverPrx fixed = observer.ice_fixed(connection);
        observers.add(fixed);
        // Tab closed or network lost: forget it right away.
        connection.setCloseCallback(con -> remove(fixed));
        System.out.printf("[SUBSCRIBE] Observadores activos: %d%n", observers.size());
    }

    public void remove(SeatObserverPrx observer) {
        if (observers.remove(observer)) {
            System.out.printf("[UNSUBSCRIBE] Observadores activos: %d%n", observers.size());
        }
    }

    /** Queues the change; call it while holding the inventory lock. */
    public void publish(Seat[] seats, EventInfo info) {
        if (seats.length > 0) {
            dispatcher.execute(() -> sendToAll(seats, info));
        }
    }

    /** Runs on the dispatcher thread, outside the inventory lock. */
    private void sendToAll(Seat[] seats, EventInfo info) {
        for (SeatObserverPrx observer : observers) {
            observer.seatsChangedAsync(seats, info).whenComplete((ok, error) -> {
                if (error != null) {
                    remove(observer); // the tab is gone or broken
                }
            });
        }
    }
}
