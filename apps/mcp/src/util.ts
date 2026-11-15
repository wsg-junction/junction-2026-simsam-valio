import { createHash, randomBytes } from 'node:crypto';

export const DAY_MS = 24 * 60 * 60 * 1000;

/** Today's date (UTC) as YYYY-MM-DD. */
export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** "Mon 16 Nov" */
export function formatDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

export function eur(amount: number): string {
  return `€${amount.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function qty(amount: number, unit: string): string {
  return `${amount.toLocaleString('en-GB', { maximumFractionDigits: 2 })} ${unit}`;
}

export const round2 = (n: number) => Math.round(n * 100) / 100;

export function shortId(prefix: string): string {
  return `${prefix}-${randomBytes(4).toString('hex').toUpperCase()}`;
}

/** JSON with sorted keys, so signatures and hashes are stable. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );
}

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}
