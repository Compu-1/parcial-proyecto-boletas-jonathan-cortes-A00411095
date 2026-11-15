# DESIGN.md

Visual and interaction rules for the web client (`client-js/`). They extend
section 5 of `AGENTS.md`; if the two disagree, `AGENTS.md` wins.

## 1. References and what we take from each

| Source | What we keep | What we drop |
| --- | --- | --- |
| Course wireframe (`docs/mockup_componentes.png`) | Layout: header with counters, seat map on the left, selection summary on the right, checkout modal, receipt with code. Legend with four states. Aisle between seats 5 and 6. | Grey-only palette. |
| Cine Colombia (cinecolombia.com) | Token-based design system. Navy and blue palette (`#0a1c3a`, `#0058ad`, `#0068c8`), cyan accents. Dark-blue available seats, light seat on selection, grey unavailable seats. Glowing screen at the top of the room. Sticky purchase summary. Pill badges. Soft card shadows. Inter-like sans serif. | Light page background, mega menus, carousels. |
| Royal Films (cinemasroyal.com) | Dark, immersive "cinema" background where the content stands out. Bold uppercase section titles. Prominent single call to action per step. | Red and pink accents (we stay blue), Material ripple effects, framework-driven widgets. |

Result: **a dark navy theme with blue and cyan accents.** The room should feel
like a dark theatre, with the stage glowing at the top.

## 2. Design tokens

All colours, sizes, radii, shadows and durations are CSS custom properties
defined once in `src/styles/tokens.css`. Component CSS uses only `var(--…)`;
**no raw hex values outside `tokens.css`.**

### 2.1 Colour

```css
:root {
  /* Surfaces (darkest to lightest) */
  --color-bg:             #05122b; /* page background */
  --color-surface:        #0a1c3a; /* panels: seat map, cart */
  --color-surface-raised: #132644; /* cards inside panels, inputs, modal */
  --color-border:         rgba(255 255 255 / 0.12);
  --color-overlay:        rgba(5 18 43 / 0.80);   /* modal backdrop */

  /* Text */
  --color-text:           #ffffff;
  --color-text-muted:     rgba(255 255 255 / 0.70);
  --color-text-subtle:    rgba(255 255 255 / 0.50); /* metadata only, never body text */
  --color-text-on-accent: #05122b;

  /* Brand */
  --color-primary:        #0068c8; /* primary buttons, white text = 5.5:1 */
  --color-primary-hover:  #1a7fe0;
  --color-primary-active: #0058ad;
  --color-accent:         #42d3fe; /* focus ring, "mine" seats, countdown, links */
  --color-accent-soft:    #7bc1eb;

  /* Seats */
  --color-seat-available:        #1a3460;
  --color-seat-available-hover:  #234a85;
  --color-seat-available-border: #4f7fc4; /* 4.2:1 against --color-surface */
  --color-seat-mine:             var(--color-accent);
  --color-seat-locked:           #8fa0dc; /* dashed border + hatch */
  --color-seat-booked:           #2b3550;

  /* Feedback */
  --color-success: #34d571;
  --color-warning: #f59e0b;
  --color-danger:  #e63946;
  --color-info:    var(--color-accent-soft);
}
```

Rules:

- Blue is the identity. Use `--color-primary` for the one main action per view
  and `--color-accent` for "yours" (your seats, your timer, focus).
- Red (`--color-danger`) appears only for errors, the disconnected state and
  the last 10 seconds of the countdown. Never as decoration.
- Zones (VIP, Platea, General) are **not** colour-coded on the seats. Seat
  colour means state; zone is shown by the section heading and a pill badge.
  Mixing both would make the map unreadable.
- Text contrast is at least 4.5:1, and seat borders and icons at least 3:1
  against their background (WCAG 2.2 AA).

### 2.2 Typography

```css
:root {
  --font-sans: Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --font-mono: ui-monospace, "SF Mono", "Cascadia Code", Consolas, monospace;

  --text-xs: 0.75rem;  /* 12px  legend, metadata */
  --text-sm: 0.875rem; /* 14px  body, seat numbers */
  --text-md: 1rem;     /* 16px  inputs, buttons */
  --text-lg: 1.125rem; /* 18px  panel titles */
  --text-xl: 1.5rem;   /* 24px  event title, totals */
  --text-2xl: 2rem;    /* 32px  countdown, booking code */
}
```

- No web-font download: Inter is used if installed, otherwise the system font.
  The app must work on the VM without internet.
- Panel titles: `--text-lg`, weight 700, uppercase, `letter-spacing: 0.04em`
  (Royal style).
- Countdown, prices and counters use `font-variant-numeric: tabular-nums` so
  the digits do not jump.
- The booking code (`RES-XXXXXX`) uses `--font-mono`.

### 2.3 Spacing, radius, shadow, motion

```css
:root {
  --space-1: 4px;  --space-2: 8px;  --space-3: 12px;
  --space-4: 16px; --space-6: 24px; --space-8: 32px;

  --radius-sm: 4px;    /* seats */
  --radius-md: 8px;    /* cards, inputs, buttons */
  --radius-lg: 16px;   /* panels, modal */
  --radius-pill: 999px;

  --shadow-card:  0 8px 24px rgba(0 0 0 / 0.35);
  --shadow-stage: 0 12px 40px rgba(66 211 254 / 0.25);
  --focus-ring:   0 0 0 2px var(--color-bg), 0 0 0 4px var(--color-accent);

  --duration-fast: 150ms;
  --duration-base: 200ms;
  --ease: cubic-bezier(0.2, 0, 0, 1);
}
```

Use only these spacing steps. Animate only `transform`, `opacity`,
`background-color`, `border-color` and `box-shadow`.

## 3. Layout

```text
┌───────────────────────────────────────────────────────────────────┐
│ EventHeader: title, venue, date · [Disponibles][Retenidas]        │
│              [Ocupadas] · ConnectionStatus pill                   │
├───────────────────────────────────────────┬───────────────────────┤
│ SeatMap                                   │ Cart (sticky)         │
│   ╭──────── ESCENARIO (glow) ────────╮    │   countdown + bar     │
│   VIP     A  ▢▢▢▢▢  ▢▢▢▢▢             │   seat list            │
│   PLATEA  C  ▢▢▢▢▢  ▢▢▢▢▢             │   total                │
│   GENERAL F  ▢▢▢▢▢  ▢▢▢▢▢             │   [Confirmar reserva]  │
│ Legend                                    │   [Liberar sillas]    │
├───────────────────────────────────────────┴───────────────────────┤
│ MyBookings (list of receipts)                                     │
└───────────────────────────────────────────────────────────────────┘
Notifications: toasts, bottom-right (desktop) / bottom (mobile)
CheckoutModal + Receipt: native <dialog>
```

- Max content width 1200px, centred, side gutter `--space-4`.
- **≥ 1024px:** two columns, `grid-template-columns: 1fr 360px`. The cart is
  `position: sticky; top: var(--space-4)`.
- **640–1023px:** one column. The cart moves below the map, and a sticky
  bottom bar shows `2 sillas · $ 240.000 · 01:25 [Continuar]` while seats are
  held.
- **< 640px:** same as above. The seat map may scroll horizontally *inside its
  own panel* (the only horizontal scroll allowed); the page never does.
- Seat size: `clamp(28px, 7vw, 40px)` square, gap `--space-1`, aisle
  `--space-4` between seats 5 and 6. Hit area at least 24×24px (WCAG 2.5.8).

## 4. Components

### 4.1 EventHeader

- Band with a subtle gradient `--color-surface` → `--color-bg`.
- Left: event name (`--text-xl`, 700), then `Auditorio Principal · Aforo: 90
  sillas` in `--color-text-muted`.
- Right: three counter cards (`--color-surface-raised`, `--radius-md`), each a
  small uppercase label plus a large tabular number. Counters update from the
  server callback; when a value changes it flashes once (`opacity` pulse,
  `--duration-base`).

### 4.2 SeatMap

- **Stage:** a curved bar at the top (`border-radius: 50% 50% 0 0 / 100% 100%
  0 0`) filled with a cyan-to-blue gradient and `--shadow-stage`, label
  `ESCENARIO`. Inspired by Cine Colombia's glowing screen.
- **Zone sections:** heading `VIP · $ 120.000` as a pill badge, then the rows.
  Row letters on both sides of the row.
- **Seats** are `<button>` elements with `data-state` and a full `aria-label`.
  State is shown by fill, border **and** a glyph, never by colour alone:

| `data-state` | Fill | Border | Content | Cursor | Meaning (Spanish label) |
| --- | --- | --- | --- | --- | --- |
| `available` | `--color-seat-available` | solid `--color-seat-available-border` | seat number | pointer | Disponible |
| `mine` | `--color-seat-mine` | solid 2px accent | ✓ + number, dark text | pointer | Seleccionada por ti |
| `locked` | diagonal hatch (`repeating-linear-gradient`) | dashed `--color-seat-locked` | number, muted | not-allowed | Retenida por otro comprador |
| `booked` | `--color-seat-booked` | none | ✕ | not-allowed | Vendida |

- Example label: `aria-label="Silla A-3, zona VIP, $ 120.000, disponible"`.
  `locked` and `booked` seats use `aria-disabled="true"` (not `disabled`) so
  they stay readable by screen readers.
- Hover on `available`: `--color-seat-available-hover` and
  `transform: translateY(-2px)`.
- When a seat changes because of **another** client (callback), it plays a
  short pulse so the user notices real-time activity.
- Keyboard: roving `tabindex`. One seat is tabbable; arrow keys move between
  seats (skipping nothing), Enter/Space toggles, Home/End go to row ends.
- Clicking a `mine` seat releases it. Clicking `locked`/`booked` does nothing
  except a notification explaining why.

### 4.3 Legend

Four items, each rendering **the same element and CSS** as a real seat (a
non-interactive `<span>` with the same `data-state`), so the legend can never
drift from the map.

### 4.4 Cart (Resumen de selección)

- Title `RESUMEN DE SELECCIÓN`.
- **Countdown** derived from the server's `expiresAt`: `mm:ss` in
  `--text-2xl`, plus a thin progress bar.
  - more than 30 s: `--color-accent`;
  - 30 to 11 s: `--color-warning`;
  - 10 s or less: `--color-danger`.
  - A visually hidden `aria-live="polite"` region announces only at 60, 30
    and 10 seconds, never every second.
- Seat list: `Silla A-1 · VIP` on the left, price on the right, a small "×"
  button to release that seat.
- Total: `--text-xl`, 700, tabular.
- Buttons: `Confirmar reserva` (primary, full width) and `Liberar sillas`
  (secondary). Both disabled, with a hint text, when the cart is empty.
- Empty state: `Selecciona una silla en el mapa para empezar.`

### 4.5 CheckoutModal

- Native `<dialog>` with `showModal()`: it gives Esc to close, focus
  containment and `::backdrop` (`--color-overlay` + `backdrop-filter:
  blur(4px)`).
- Max width 480px, `--color-surface-raised`, `--radius-lg`.
- Summary box at the top: seats, total, and the live countdown.
- Fields: `Nombre completo`, `Correo electrónico`. Labels always visible
  (no placeholder-only labels). Validation on submit and on blur; the error
  text goes below the field in `--color-danger`, linked with
  `aria-describedby`, and the field gets `aria-invalid="true"`.
- Actions: `Finalizar y pagar` (primary) and `Volver al plano` (secondary).
  While the call is in flight the primary button shows `Procesando…` and both
  are disabled, so the user cannot double submit.
- Focus moves to the first field on open and back to the triggering button on
  close.

### 4.6 Receipt

- Shown inside the same dialog after success, styled as a **ticket**: a card
  with notched sides (radial-gradient cut-outs) and a dashed separator.
- Large `RES-XXXXXX` in `--font-mono`, `--text-2xl`, with a `Copiar código`
  button (`navigator.clipboard`).
- Below: seats, zone, total, buyer name and email.
- Heading `¡Reserva confirmada!` with a ✓ icon in `--color-success`.

### 4.7 MyBookings

- Section below the map titled `MIS RESERVAS`.
- One compact ticket per booking (code, seats, total). Most recent first.
- Empty state: `Aún no tienes reservas en esta pestaña.`

### 4.8 Notifications

- Toasts, max 3 visible, newest on top. Bottom-right on desktop (top-right
  would cover the header counters), bottom on mobile, above the sticky bar.
- Each has an icon, a left border in its feedback colour, the message and a
  close button.
- Success and info: `role="status"`, auto-dismiss after 5 s. Errors:
  `role="alert"`, stay 8 s, and pause the timer on hover or focus.
- Messages are short, in Spanish, and say what happened and what to do:
  `La silla C-4 acaba de ser tomada por otro comprador. Elige otra.`

### 4.9 ConnectionStatus

Pill in the header with a dot **and** text:

| State | Dot | Text |
| --- | --- | --- |
| connected | `--color-success` | `En línea` |
| reconnecting | `--color-warning`, pulsing | `Reconectando…` |
| disconnected | `--color-danger` | `Sin conexión` |

While not connected, seat buttons and actions are disabled and the map is
dimmed (`opacity: 0.6`), so the user does not act on stale data.

## 5. Buttons and inputs

- **Primary:** `--color-primary` background, white text, `--radius-md`,
  height 44px, weight 600. Hover `--color-primary-hover`, active
  `--color-primary-active`.
- **Secondary:** transparent, 1px `--color-border`, white text. Hover
  background `rgba(255 255 255 / 0.06)`.
- **Disabled:** `opacity: 0.5`, `cursor: not-allowed`.
- **Inputs:** `--color-surface-raised`, 1px `--color-border`, height 44px,
  `--text-md` (16px avoids zoom on iOS). Focus border `--color-accent`.
- **Focus** for every interactive element: `:focus-visible { outline: none;
  box-shadow: var(--focus-ring); }`. Never remove focus without a replacement.

## 6. Content and formatting

- All visible text is in Spanish and uses **tú** consistently.
- Money: `new Intl.NumberFormat('es-CO', { style: 'currency', currency:
  'COP', maximumFractionDigits: 0 })` → `$ 120.000`. One shared helper.
- Dates: `Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle:
  'short' })`.
- Seat ids are shown as the server sends them (`A-1`).
- Icons are inline SVG built with `createElementNS`, or simple Unicode
  glyphs (✓ ✕). No icon fonts or libraries.

## 7. Accessibility checklist

- `<html lang="es">`, one `<h1>` (event name), panels use `<section>` with a
  heading.
- Everything works with keyboard only: seat map, cart, modal, toasts.
- State is never conveyed by colour alone (glyph, pattern or text too).
- Contrast: text ≥ 4.5:1, UI boundaries and icons ≥ 3:1.
- `@media (prefers-reduced-motion: reduce)` turns off pulses, transforms and
  the progress-bar transition.
- Test at 200% zoom and at 360px width.

## 8. CSS organisation

```text
src/styles/
  tokens.css   # section 2, the only place with raw values
  base.css     # small reset, body, typography, focus, .visually-hidden
  layout.css   # app grid and breakpoints (section 3)
src/components/<name>/<name>.css   # one file per component
```

- Class names: `component__element` with state in attributes
  (`data-state`, `aria-*`), e.g. `.seat-map__seat[data-state="mine"]`.
- No `!important`, no IDs in selectors, nesting depth at most 2.
- Every duration comes from a motion token; `prefers-reduced-motion` sets
  those tokens to `0ms` in `tokens.css`, so no per-component override is
  needed.
- Mobile first: base styles for small screens, `min-width` media queries.
