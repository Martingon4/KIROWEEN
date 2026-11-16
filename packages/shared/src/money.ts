export const SUPPORTED_CURRENCIES: readonly string[] = ['USD'];

/** True only for safe integers (cents). Rejects floats, strings, NaN, Infinity. */
export function isCents(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

export function isPositiveCents(value: unknown): value is number {
  return isCents(value) && value > 0;
}

export function isSupportedCurrency(value: unknown): value is string {
  return typeof value === 'string' && SUPPORTED_CURRENCIES.includes(value);
}

/** 14999 -> "149.99". Throws if not integer cents. */
export function formatCents(cents: number): string {
  if (!isCents(cents)) throw new TypeError('formatCents: amount must be integer cents');
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, '0');
  return `${sign}${whole}.${frac}`;
}

/** 14999,"USD" -> "USD 149.99". */
export function formatMoney(cents: number, currency: string): string {
  return `${currency} ${formatCents(cents)}`;
}

/** "149.99" -> 14999 without floats. Returns null if the text is not a valid decimal amount. */
export function parseDecimalToCents(text: string): number | null {
  const m = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(text);
  if (!m) return null;
  const whole = Number(m[1]);
  const frac = Number((m[2] ?? '').padEnd(2, '0'));
  return whole * 100 + frac;
}
