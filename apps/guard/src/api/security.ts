import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

function digest(s: string): Buffer {
  return createHash('sha256').update(s, 'utf8').digest();
}

/** Constant-time comparison. An empty expected secret never matches (fail closed). */
export function secretEquals(given: string, expected: string): boolean {
  if (expected.length === 0) return false;
  return timingSafeEqual(digest(given), digest(expected));
}

export function bearerValid(header: string | undefined, token: string): boolean {
  if (!header || !header.startsWith('Bearer ')) return false;
  return secretEquals(header.slice(7), token);
}

/** Host header must be one of the exact loopback names, e.g. "127.0.0.1:3000". */
export function hostAllowed(host: string | undefined, allowedHosts: readonly string[]): boolean {
  return host !== undefined && allowedHosts.includes(host.toLowerCase());
}

/**
 * Origin check. Absent Origin is accepted only when `allowMissing` (non-browser MCP clients).
 * A present Origin must match an allowed origin exactly.
 */
export function originAllowed(
  origin: string | undefined,
  allowedOrigins: readonly string[],
  allowMissing: boolean,
): boolean {
  if (origin === undefined) return allowMissing;
  return allowedOrigins.includes(origin);
}

export function allowedHostsFor(host: string, port: number): string[] {
  const names = new Set([host, '127.0.0.1', 'localhost']);
  return [...names].map((h) => `${h}:${port}`);
}

export interface Session {
  id: string;
  csrf: string;
  reviewer: string;
  expiresAt: number;
}

/** In-memory sessions. Restarting Guard logs everyone out. */
export class SessionStore {
  private readonly sessions = new Map<string, Session>();
  private readonly now: () => number;
  private readonly ttlMs: number;

  constructor(now: () => number = () => Date.now(), ttlMs = 8 * 60 * 60 * 1000) {
    this.now = now;
    this.ttlMs = ttlMs;
  }

  create(reviewer: string): Session {
    const s: Session = {
      id: randomBytes(32).toString('hex'),
      csrf: randomBytes(24).toString('hex'),
      reviewer,
      expiresAt: this.now() + this.ttlMs,
    };
    this.sessions.set(s.id, s);
    return s;
  }

  get(id: string | undefined): Session | null {
    if (!id) return null;
    const s = this.sessions.get(id);
    if (!s) return null;
    if (this.now() >= s.expiresAt) {
      this.sessions.delete(id);
      return null;
    }
    return s;
  }

  destroy(id: string | undefined): void {
    if (id) this.sessions.delete(id);
  }
}

export function csrfValid(session: Session, header: string | undefined): boolean {
  return header !== undefined && secretEquals(header, session.csrf);
}

/** Minimal cookie parser for a single named cookie. */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() === name) return part.slice(idx + 1).trim();
  }
  return undefined;
}

/** Fixed-window limiter for failed logins, keyed by a coarse label (single local user). */
export class LoginLimiter {
  private failures: number[] = [];
  private readonly now: () => number;
  private readonly max: number;
  private readonly windowMs: number;

  constructor(now: () => number = () => Date.now(), max = 5, windowMs = 60_000) {
    this.now = now;
    this.max = max;
    this.windowMs = windowMs;
  }

  blocked(): boolean {
    const t = this.now();
    this.failures = this.failures.filter((f) => t - f < this.windowMs);
    return this.failures.length >= this.max;
  }

  fail(): void {
    this.failures.push(this.now());
  }
}
