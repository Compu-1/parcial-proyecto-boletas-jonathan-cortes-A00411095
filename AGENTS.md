# AGENTS.md

Rules for any AI agent working in this repository.

## 1. Project summary

**Icesi Live Arena** is the final project of Computación en Internet I (Universidad Icesi): a distributed seat-booking system.

- **Backend:** Java 17 + ZeroC Ice 3.7. It was provided with an intentional concurrency bug that must be fixed.
- **Frontend:** a single-page application in vanilla TypeScript, built from scratch, talking to the backend through ZeroC Ice over WebSocket.
- **Domain:** 90 seats. VIP is rows A-B (20 seats), Platea is rows C-E (30), General is rows F-I (40). Seat ids look like `A-1`.
- **Seat lifecycle:** `AVAILABLE -> LOCKED (90 s, exclusive to one client) -> BOOKED (irreversible, code RES-XXXXXX)`. A lock that expires returns the seat to `AVAILABLE`.

Sources of truth:

- Requirements: `docs/Proyecto_Reserva_Boletas_Ice_Webpack.tex` (RF-1 to RF-7, RNF-1 to RNF-4).
- RPC contract: `common/src/main/slice/BookingService.ice`.

The spec mandates Webpack and npm. This project uses **Vite and pnpm** instead, with the professor's approval. Wherever the spec says Webpack or npm, read Vite or pnpm.

## 2. Repository layout

```text
./
├── build.gradle, settings.gradle, gradlew   # Gradle root project (seat-booking-ice)
├── common/      # Slice contract: src/main/slice/BookingService.ice
├── server/      # Ice server: BookingServerApp, BookingServiceImpl
├── client/      # Java console client and concurrency stress test
├── client-js/   # Frontend (Vite + pnpm + TypeScript)
└── docs/        # Project statement (LaTeX/PDF) and wireframe
```

The delivery instructions name a `codigo_base/` folder for the Java project. Keeping the Java project at the root is a deliberate deviation.

## 3. Hard rules

These are never broken. If a task seems to require breaking one, stop and ask.

1. **No HTTP to the backend.** The browser talks to the server only through ZeroC Ice proxies over the Ice WebSocket endpoint (`ws`, port 10002). Forbidden:
   - `fetch`, `XMLHttpRequest`, axios or any HTTP client;
   - REST or JSON endpoints, server-sent events;
   - a Vite `server.proxy`;
   - any HTTP server added to the Java side;
   - a raw `new WebSocket(...)` with a hand-made protocol.

   The Vite dev server serving the static files is the only HTTP in the system.
2. **No frameworks or UI libraries.** No React, Vue, Angular, Svelte, Lit, jQuery or CSS frameworks. The only runtime dependency is `ice`.
3. **Vite and pnpm only.** No Webpack, npm or yarn, and no `package-lock.json`. Commit `pnpm-lock.yaml`.
4. **Never allow a double lock or overbooking**, under any thread interleaving (RNF-1).
5. **Keep the `Thread.sleep(25)` in `lockSeat`.** It is marked "No remover". The fix must be correct with the delay in place.
6. **Never hand-edit generated Slice code**, Java or TypeScript. Change the `.ice` file and regenerate.
7. **Never commit** `node_modules/`, `dist/`, `build/`, `.gradle/`, or generated code that the build reproduces.

## 4. Frontend tooling (`client-js/`)

- Scripts:
  - `pnpm start` (same as `pnpm dev`): Vite dev server on port 3000 with `strictPort: true`.
  - `pnpm build`: type-check, then emit the production bundle to `dist/`.
  - `pnpm preview`: serve `dist/` locally.
  - `pnpm slice`: regenerate the Ice stubs.
- Pin the `ice` package to the 3.7 line. It must match the server (`com.zeroc:ice:3.7.10`) and the local `slice2js`.
- Generate the stubs with `slice2js --typescript` from `common/src/main/slice/` into `client-js/src/generated/`, as ES modules.
- How the Ice 3.7 output and the `ice` package behave under Vite (ESM and CommonJS interop, `optimizeDeps`) is not verified yet. Verify it first when setting up the frontend, then record the working setup in this section.
- Do not hard-code the Ice endpoint. Read the host from `VITE_ICE_HOST` (default `window.location.hostname`) and the port from `VITE_ICE_PORT` (default `10002`), so the VM deployment needs no code change.

## 5. Frontend architecture

- TypeScript in strict mode, ES modules, no `any` in application code.
- Three layers, with dependencies in one direction only:
  1. `ice/`: communicator, proxy, callback servant, error mapping.
  2. `state/`: one store with subscribe and notify.
  3. `components/`: render from state and emit user intents.

  Components never call Ice directly.
- One component per file, with its own CSS file. Each component exposes `mount`, `update` and `destroy`, and `destroy` removes its listeners and timers.
- Expected components: event header with counters, seat map, legend, cart with countdown, checkout modal, receipt, my bookings, notifications, connection status. The wireframe in `docs/mockup_componentes.png` is a reference, not a requirement.
- Build the DOM with `createElement` and `textContent`. Never put server or user data into `innerHTML`.
- A Slice `long` arrives as `Ice.Long`. Convert it to a number at the `ice/` boundary; never let it reach the state.
- Derive the countdown from the server's `expiresAt`, not from a local 90-second counter. When it reaches zero, refresh from the server.
- Generate `clientId` once per tab with `crypto.randomUUID()` and keep it in `sessionStorage`, so each tab is a different buyer. On load, recover with `getMyLockedSeats` and `getMyBookings`.
- Error handling (RF-7):
  - Map every Slice exception (`SeatNotFoundException`, `SeatNotAvailableException`, `LockExpiredException`, `InvalidBookingException`, `BookingException`) and the Ice connection failures to a user message in Spanish.
  - After any failure, resynchronise from the server instead of trusting local state.
  - On disconnection, reconnect with backoff and subscribe again.
- Validate name and email in the form before calling `confirmBooking`. The server stays the authority.
- Plain CSS with custom properties. The seat grid is responsive, seat state is never shown by colour alone, and seats and the modal work from the keyboard.

## 6. Backend rules

- All inventory reads and writes use one mutual-exclusion policy (a single lock, or `synchronized` on the service). Every check-then-act sequence stays inside the critical section.
- `confirmBooking` is all or nothing. Every seat must be `LOCKED` by the same `clientId` with a lock that has not expired. A seat that is still `AVAILABLE` cannot be booked.
- A scheduled task expires locks proactively, so no client sees a stale `LOCKED` seat.
- Do not return the internal mutable `Seat` or `EventInfo` objects. Return copies made inside the critical section.
- Real-time updates use Ice callbacks, not polling:
  - The Slice contract gains a callback interface (seat changes and counters) and subscribe and unsubscribe operations.
  - The connection is bidirectional: the browser attaches an object adapter to its outgoing connection, and the server builds the callback proxy from `current.con`.
  - Send callbacks outside the inventory lock and asynchronously, so a slow client cannot block bookings.
  - Remove a subscriber when a callback fails or its connection closes.
  - Enable heartbeats so the WebSocket stays open while idle.
- Contract changes are additive. Existing operations keep their signatures so the Java console client and the stress test keep working. Update the Java client whenever the contract changes.
- `./gradlew runClient --args="--test-concurrency"` must report exactly one successful lock out of 10 threads.

## 7. Workflow

- Work in small, reviewable steps. After each one, explain what changed and why (Ice, threading, DOM). The oral defense is individual and may include live modifications, so the student must be able to explain every line.
- Prefer the simplest code that meets the requirement. Do not add abstractions the student cannot justify.
- Code, identifiers, comments and commits are in English. Text shown to the user is in Spanish.
- Use Conventional Commits (`feat`, `fix`, `refactor`, `docs`, `chore`), one logical change per commit, with a continuous history. Commit only when asked.
- Before calling a task done, run `./gradlew build`, the concurrency test and `pnpm build`, and check the flow manually in two browser tabs.
- Ask before changing an existing Slice signature, adding a dependency, or changing a port.

## 8. Commands

Backend, from the repository root:

```bash
./gradlew runServer                               # TCP 10000 + WebSocket 10002
./gradlew runClient                               # interactive console client
./gradlew runClient --args="--test-concurrency"   # 10 threads locking A-1
```

Frontend, from `client-js/`:

```bash
pnpm install
pnpm slice     # regenerate Ice stubs
pnpm start     # dev server on http://localhost:3000
pnpm build     # production bundle in dist/
```

## 9. Open points

- Confirm with the professor that delivering without a `codigo_base/` folder is acceptable.
- VM deployment: a page served over HTTPS cannot open `ws://`. Serve it over plain HTTP or configure `wss`.
- The demo video will show `pnpm start` where the spec says `npm start`.
