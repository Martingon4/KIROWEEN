export const REDACTED = '[REDACTED]';

const SENSITIVE_KEY = /token|secret|password|authorization|card|credential/i;
const MAX_DEPTH = 16;
const MAX_STRING = 200;

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key);
}

/** Returns a deep copy with values of sensitive keys replaced by "[REDACTED]". */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return REDACTED;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = isSensitiveKey(k) ? REDACTED : redact(v, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string' && value.length > MAX_STRING) {
    return value.slice(0, MAX_STRING) + '...';
  }
  if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') {
    return String(typeof value);
  }
  return value;
}

/** Safe preview: only top-level fields on the rule's safe list, then redacted. */
export function buildPreview(
  args: unknown,
  safeFields: readonly string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (args === null || typeof args !== 'object' || Array.isArray(args)) return out;
  const src = args as Record<string, unknown>;
  for (const field of safeFields) {
    if (Object.prototype.hasOwnProperty.call(src, field)) {
      out[field] = isSensitiveKey(field) ? REDACTED : redact(src[field]);
    }
  }
  return out;
}
