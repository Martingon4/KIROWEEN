import type { ActionStatus, Effect } from '../../../../packages/shared/src/types.ts';

/** Persisted view of a request. Never has the original arguments, only a safe preview and hash. */
export interface RequestView {
  id: string;
  publicToolName: string;
  upstream: string;
  tool: string;
  argumentHash: string;
  preview: Record<string, unknown>;
  decision: Effect;
  status: ActionStatus;
  ruleId: string | null;
  ruleName: string | null;
  reason: string;
  requestedAt: number;
  expiresAt: number | null;
  decidedAt: number | null;
  executedAt: number | null;
  approvedBy: string | null;
  resultSummary: string | null;
  errorCode: string | null;
  durationMs: number | null;
}

export type AuditEventType =
  | 'requested'
  | 'blocked'
  | 'pending_approval'
  | 'approved'
  | 'denied'
  | 'expired'
  | 'executed'
  | 'failed';

export interface AuditEventView {
  id: string;
  requestId: string;
  eventType: AuditEventType;
  actor: string;
  details: Record<string, unknown>;
  createdAt: number;
}

export interface AuditFilter {
  status?: string;
  tool?: string;
  from?: number;
  to?: number;
  limit?: number;
}

export interface Repository {
  upsertRequest(view: RequestView): Promise<void>;
  addEvent(event: AuditEventView): Promise<void>;
  getRequest(id: string): Promise<RequestView | null>;
  listRequests(filter: AuditFilter): Promise<RequestView[]>;
  listEvents(requestId: string): Promise<AuditEventView[]>;
  /** Startup: pending rows from a previous process can never be executed, so mark them expired. */
  expireStalePending(now: number): Promise<string[]>;
  /** Startup: rows left `approved` by a crashed process never completed. Marks them failed. */
  failStaleApproved(now: number): Promise<string[]>;
  /** Removes demo history. Only used by the explicit demo reset option. */
  clearAll(): Promise<void>;
}

export function matchesFilter(r: RequestView, f: AuditFilter): boolean {
  if (f.status && r.status !== f.status) return false;
  if (f.tool && r.publicToolName !== f.tool && r.tool !== f.tool) return false;
  if (f.from !== undefined && r.requestedAt < f.from) return false;
  if (f.to !== undefined && r.requestedAt > f.to) return false;
  return true;
}

export class MemoryRepository implements Repository {
  private readonly requests = new Map<string, RequestView>();
  private readonly events: AuditEventView[] = [];

  async upsertRequest(view: RequestView): Promise<void> {
    this.requests.set(view.id, structuredClone(view));
  }

  async addEvent(event: AuditEventView): Promise<void> {
    this.events.push(structuredClone(event));
  }

  async getRequest(id: string): Promise<RequestView | null> {
    const r = this.requests.get(id);
    return r ? structuredClone(r) : null;
  }

  async listRequests(filter: AuditFilter): Promise<RequestView[]> {
    const limit = Math.min(Math.max(filter.limit ?? 100, 1), 500);
    return [...this.requests.values()]
      .filter((r) => matchesFilter(r, filter))
      .sort((a, b) => b.requestedAt - a.requestedAt)
      .slice(0, limit)
      .map((r) => structuredClone(r));
  }

  async listEvents(requestId: string): Promise<AuditEventView[]> {
    return this.events
      .filter((e) => e.requestId === requestId)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((e) => structuredClone(e));
  }

  async expireStalePending(now: number): Promise<string[]> {
    const ids: string[] = [];
    for (const r of this.requests.values()) {
      if (r.status === 'pending_approval') {
        r.status = 'expired';
        r.decidedAt = now;
        ids.push(r.id);
      }
    }
    return ids;
  }

  async failStaleApproved(now: number): Promise<string[]> {
    const ids: string[] = [];
    for (const r of this.requests.values()) {
      if (r.status === 'approved') {
        r.status = 'failed';
        r.errorCode = 'interrupted';
        r.executedAt = now;
        ids.push(r.id);
      }
    }
    return ids;
  }

  async clearAll(): Promise<void> {
    this.requests.clear();
    this.events.length = 0;
  }
}
