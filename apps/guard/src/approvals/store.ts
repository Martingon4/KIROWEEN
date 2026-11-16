import { randomBytes } from 'node:crypto';
import { hashCall } from '../../../../packages/shared/src/canonical.ts';
import type { ActionStatus } from '../../../../packages/shared/src/types.ts';

/** Persistable/serializable view of a request. Never contains the original arguments. */
export interface ActionRecord {
  id: string;
  upstream: string;
  tool: string;
  argumentHash: string;
  preview: Record<string, unknown>;
  status: ActionStatus;
  ruleId: string | null;
  reason: string;
  requestedAt: number;
  expiresAt: number;
  decidedAt: number | null;
  executedAt: number | null;
  decidedBy: string | null;
  resultSummary: string | null;
  errorCode: string | null;
}

export interface CreatePendingInput {
  upstream: string;
  tool: string;
  args: unknown;
  ruleId: string | null;
  reason: string;
  preview: Record<string, unknown>;
  ttlSeconds: number;
}

export interface ExactCall {
  upstream: string;
  tool: string;
  args: unknown;
}

export type ApproveFailure =
  'not_found' | 'not_pending' | 'expired' | 'hash_mismatch' | 'payload_missing';

export type ApproveResult =
  | { ok: true; record: ActionRecord; call: ExactCall }
  | { ok: false; error: ApproveFailure; record: ActionRecord | null };

export type DenyResult =
  | { ok: true; record: ActionRecord }
  | { ok: false; error: 'not_found' | 'not_pending' | 'expired'; record: ActionRecord | null };

export type CompleteResult =
  | { ok: true; record: ActionRecord }
  | { ok: false; error: 'not_found' | 'not_approved'; record: ActionRecord | null };

export interface StoreOptions {
  now?: () => number;
  newId?: () => string;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

/**
 * In-memory pending store. Original arguments live only in `payloads`, are deep-cloned and frozen
 * on entry, and are removed on approve, deny, expiry or restart. JavaScript is single-threaded and
 * every transition below is synchronous, so each check-and-set is atomic.
 */
export class ApprovalStore {
  private readonly records = new Map<string, ActionRecord>();
  private readonly payloads = new Map<string, ExactCall>();
  private readonly now: () => number;
  private readonly newId: () => string;

  constructor(options: StoreOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.newId = options.newId ?? (() => randomBytes(5).toString('hex'));
  }

  createPending(input: CreatePendingInput): ActionRecord {
    if (!Number.isSafeInteger(input.ttlSeconds) || input.ttlSeconds < 1) {
      throw new RangeError('ttlSeconds must be a positive integer');
    }
    const cloned = structuredClone(input.args);
    const argumentHash = hashCall({ upstream: input.upstream, tool: input.tool, args: cloned });
    let id = this.newId();
    while (this.records.has(id)) id = this.newId();
    const requestedAt = this.now();
    const record: ActionRecord = {
      id,
      upstream: input.upstream,
      tool: input.tool,
      argumentHash,
      preview: structuredClone(input.preview),
      status: 'pending_approval',
      ruleId: input.ruleId,
      reason: input.reason,
      requestedAt,
      expiresAt: requestedAt + input.ttlSeconds * 1000,
      decidedAt: null,
      executedAt: null,
      decidedBy: null,
      resultSummary: null,
      errorCode: null,
    };
    this.records.set(id, record);
    this.payloads.set(id, deepFreeze({ upstream: input.upstream, tool: input.tool, args: cloned }));
    return this.view(record);
  }

  get(id: string): ActionRecord | null {
    const r = this.records.get(id);
    if (!r) return null;
    this.expireIfDue(r);
    return this.view(r);
  }

  list(): ActionRecord[] {
    return [...this.records.values()].map((r) => {
      this.expireIfDue(r);
      return this.view(r);
    });
  }

  listPending(): ActionRecord[] {
    return this.list().filter((r) => r.status === 'pending_approval');
  }

  /**
   * pending_approval -> approved, consuming the stored payload. Returns the exact stored call to
   * execute once. A mismatch or expiry leaves nothing executable.
   */
  approve(id: string, approver: string, expectedHash?: string): ApproveResult {
    const r = this.records.get(id);
    if (!r) return { ok: false, error: 'not_found', record: null };
    this.expireIfDue(r);
    if (r.status === 'expired') return { ok: false, error: 'expired', record: this.view(r) };
    if (r.status !== 'pending_approval') {
      return { ok: false, error: 'not_pending', record: this.view(r) };
    }
    const payload = this.payloads.get(id);
    if (!payload) {
      this.finish(r, 'failed', 'payload_missing');
      return { ok: false, error: 'payload_missing', record: this.view(r) };
    }
    const recomputed = hashCall(payload);
    if (
      recomputed !== r.argumentHash ||
      (expectedHash !== undefined && expectedHash !== recomputed)
    ) {
      return { ok: false, error: 'hash_mismatch', record: this.view(r) };
    }
    // Atomic consume: state change and payload removal happen together.
    r.status = 'approved';
    r.decidedAt = this.now();
    r.decidedBy = approver;
    this.payloads.delete(id);
    return { ok: true, record: this.view(r), call: payload };
  }

  deny(id: string, reviewer: string): DenyResult {
    const r = this.records.get(id);
    if (!r) return { ok: false, error: 'not_found', record: null };
    this.expireIfDue(r);
    if (r.status === 'expired') return { ok: false, error: 'expired', record: this.view(r) };
    if (r.status !== 'pending_approval') {
      return { ok: false, error: 'not_pending', record: this.view(r) };
    }
    r.status = 'denied';
    r.decidedAt = this.now();
    r.decidedBy = reviewer;
    this.payloads.delete(id);
    return { ok: true, record: this.view(r) };
  }

  /** approved -> executed. Only valid once, right after approve(). */
  markExecuted(id: string, resultSummary: string): CompleteResult {
    return this.complete(id, 'executed', resultSummary, null);
  }

  /** approved -> failed (upstream error). Never reports success. */
  markFailed(id: string, errorCode: string, summary = ''): CompleteResult {
    return this.complete(id, 'failed', summary || null, errorCode);
  }

  /** Expires every pending request and drops payloads. Call at startup and on shutdown. */
  expireAll(): number {
    let n = 0;
    for (const r of this.records.values()) {
      if (r.status === 'pending_approval') {
        this.expire(r);
        n++;
      }
    }
    this.payloads.clear();
    return n;
  }

  /** Expires due requests; returns their ids. */
  sweep(): string[] {
    const out: string[] = [];
    for (const r of this.records.values()) {
      if (this.expireIfDue(r)) out.push(r.id);
    }
    return out;
  }

  hasPayload(id: string): boolean {
    return this.payloads.has(id);
  }

  private complete(
    id: string,
    status: 'executed' | 'failed',
    summary: string | null,
    errorCode: string | null,
  ): CompleteResult {
    const r = this.records.get(id);
    if (!r) return { ok: false, error: 'not_found', record: null };
    if (r.status !== 'approved') return { ok: false, error: 'not_approved', record: this.view(r) };
    r.status = status;
    r.executedAt = this.now();
    r.resultSummary = summary;
    r.errorCode = errorCode;
    return { ok: true, record: this.view(r) };
  }

  private finish(r: ActionRecord, status: ActionStatus, errorCode: string): void {
    r.status = status;
    r.errorCode = errorCode;
    r.decidedAt = this.now();
    this.payloads.delete(r.id);
  }

  private expire(r: ActionRecord): void {
    r.status = 'expired';
    r.decidedAt = this.now();
    this.payloads.delete(r.id);
  }

  private expireIfDue(r: ActionRecord): boolean {
    if (r.status === 'pending_approval' && this.now() >= r.expiresAt) {
      this.expire(r);
      return true;
    }
    return false;
  }

  private view(r: ActionRecord): ActionRecord {
    return { ...r, preview: structuredClone(r.preview) };
  }
}
