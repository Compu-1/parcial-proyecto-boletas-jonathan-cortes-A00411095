import type { Zone } from '../state/types.ts';

const money = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0,
});

const dateTime = new Intl.DateTimeFormat('es-CO', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

export function formatMoney(value: number): string {
  return money.format(value);
}

export function formatDateTime(epochMs: number): string {
  return dateTime.format(epochMs);
}

/** The event date arrives as "2026-11-28 20:00"; show it raw if unparsable. */
export function formatEventDate(raw: string): string {
  const parsed = new Date(raw.replace(' ', 'T'));
  return Number.isNaN(parsed.getTime()) ? raw : dateTime.format(parsed);
}

/** Seconds as mm:ss. */
export function formatCountdown(totalSeconds: number): string {
  const seconds = Math.max(0, totalSeconds);
  const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
  const ss = String(seconds % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

export const ZONE_LABEL: Record<Zone, string> = {
  VIP: 'VIP',
  PLATEA: 'Platea',
  GENERAL: 'General',
};

/** Whole seconds left until `expiresAt` (epoch ms), never negative. */
export function secondsLeft(expiresAt: number): number {
  return Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
}
