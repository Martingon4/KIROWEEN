export interface RequestDto {
  id: string;
  publicToolName: string;
  upstream: string;
  tool: string;
  argumentHash: string;
  hashShort: string;
  preview: Record<string, unknown>;
  description: string;
  decision: 'allow' | 'require_approval' | 'deny';
  status: string;
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
  reachedTarget: boolean;
}

export interface AuditEventDto {
  id: string;
  eventType: string;
  actor: string;
  details: Record<string, unknown>;
  createdAt: number;
}

export interface Summary {
  pending: number;
  allowed: number;
  approved: number;
  rejected: number;
  blocked: number;
  upstream: 'up' | 'down';
  database: 'ok' | 'memory';
  policyMode: 'active' | 'blocked';
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

let csrfToken = '';
export function setCsrf(token: string): void {
  csrfToken = token;
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (method !== 'GET') {
    headers['Content-Type'] = 'application/json';
    headers['X-CSRF-Token'] = csrfToken;
  }
  const res = await fetch(path, {
    method,
    headers,
    credentials: 'same-origin',
    ...(method !== 'GET' ? { body: JSON.stringify(body ?? {}) } : {}),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok)
    throw new ApiError(res.status, typeof data.error === 'string' ? data.error : 'error');
  return data as T;
}

export interface SessionInfo {
  csrfToken: string;
  reviewer: string;
  demoMode: boolean;
}

export const api = {
  getSession: () => call<SessionInfo>('GET', '/api/session'),
  login: (secret: string) => call<SessionInfo>('POST', '/api/session', { secret }),
  logout: () => call<{ ok: boolean }>('DELETE', '/api/session'),
  summary: () => call<Summary>('GET', '/api/summary'),
  pending: () => call<{ pending: RequestDto[]; now: number }>('GET', '/api/pending'),
  action: (id: string) =>
    call<{ request: RequestDto; events: AuditEventDto[]; now: number }>(
      'GET',
      `/api/actions/${id}`,
    ),
  approve: (id: string) => call<{ request: RequestDto }>('POST', `/api/actions/${id}/approve`),
  deny: (id: string) => call<{ request: RequestDto }>('POST', `/api/actions/${id}/deny`),
  audit: (q: Record<string, string>) =>
    call<{ requests: RequestDto[] }>('GET', `/api/audit?${new URLSearchParams(q).toString()}`),
  policy: () =>
    call<{ mode: string; error: string | null; policy: PolicyDto | null }>('GET', '/api/policy'),
  resetDemo: (clearAudit: boolean) =>
    call<{ ok: boolean }>('POST', '/api/demo/reset', { clearAudit }),
};

export interface PolicyDto {
  defaultEffect: string;
  approval: { ttlSeconds: number };
  rules: Array<{
    id: string;
    name: string;
    upstream: string;
    tool: string;
    effect: string;
    when: Record<string, unknown>;
    reason: string;
    safePreviewFields: string[];
  }>;
}
