import { redact } from '../../../../packages/shared/src/redact.ts';

/** Keys that could carry original tool arguments or request material. Dropped, never stored. */
const DROPPED_KEYS = new Set([
  'args',
  'arguments',
  'payload',
  'body',
  'headers',
  'cookie',
  'cookies',
]);
const BEARER = /bearer\s+[\w\-.~+/=]+/gi;
const MAX_JSON_CHARS = 2000;

function scrub(value: unknown, depth: number): unknown {
  if (depth > 8) return '[TRUNCATED]';
  if (typeof value === 'string') return value.replace(BEARER, 'Bearer [REDACTED]');
  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (DROPPED_KEYS.has(k.toLowerCase())) continue;
      out[k] = scrub(v, depth + 1);
    }
    return out;
  }
  return value;
}

/** Sanitizes audit event details: drops argument-like keys, redacts secrets, caps size. */
export function sanitizeDetails(details: Record<string, unknown>): Record<string, unknown> {
  const cleaned = redact(scrub(details, 0)) as Record<string, unknown>;
  const text = JSON.stringify(cleaned);
  if (text.length > MAX_JSON_CHARS) return { truncated: true };
  return cleaned;
}

/** Short error text safe for storage and for the agent: no stack, no URLs, bounded length. */
export function safeErrorSummary(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw
    .replace(BEARER, 'Bearer [REDACTED]')
    .replace(/https?:\/\/\S+/gi, '[url]')
    .slice(0, 160);
}
