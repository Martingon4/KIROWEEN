import { createHash } from 'node:crypto';
import type { ToolCall } from './types.ts';

function canon(value: unknown, depth: number): string {
  if (depth > 64) throw new TypeError('canonicalJson: nesting too deep');
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'string':
      return JSON.stringify(value);
    case 'number':
      if (!Number.isFinite(value)) throw new TypeError('canonicalJson: non-finite number');
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) {
        return '[' + value.map((v) => canon(v, depth + 1)).join(',') + ']';
      }
      const proto = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null) {
        throw new TypeError('canonicalJson: only plain objects are supported');
      }
      const obj = value as Record<string, unknown>;
      const keys = Object.keys(obj).sort();
      return (
        '{' + keys.map((k) => JSON.stringify(k) + ':' + canon(obj[k], depth + 1)).join(',') + '}'
      );
    }
    default:
      throw new TypeError(`canonicalJson: unsupported type ${typeof value}`);
  }
}

/** Deterministic JSON: object keys sorted, no whitespace. Throws on undefined, bigint, functions. */
export function canonicalJson(value: unknown): string {
  return canon(value, 0);
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** SHA-256 over the canonical JSON of {upstream, tool, args}. */
export function hashCall(call: ToolCall): string {
  return sha256Hex(canonicalJson({ upstream: call.upstream, tool: call.tool, args: call.args }));
}
