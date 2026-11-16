import { randomBytes } from 'node:crypto';
import { hashCall } from '../../../../packages/shared/src/canonical.ts';
import { buildPreview } from '../../../../packages/shared/src/redact.ts';
import type { ActionStatus, Effect } from '../../../../packages/shared/src/types.ts';
import type { ApprovalStore, ActionRecord } from '../approvals/index.ts';
import type { PolicyCall, PolicyDecision } from '../policy/index.ts';
import { resolvePublicName, validateToolArgs } from '../mcp/tools.ts';
import { safeErrorSummary, sanitizeDetails } from '../audit/sanitize.ts';
import type {
  AuditEventType,
  AuditEventView,
  AuditFilter,
  Repository,
  RequestView,
} from '../audit/repository.ts';

export interface McpContent {
  type: string;
  text?: string;
  [key: string]: unknown;
}

export interface UpstreamResult {
  isError: boolean;
  content: McpContent[];
}

/** Calls the configured upstream. Must throw when the upstream is unreachable. */
export interface UpstreamClient {
  callTool(tool: string, args: Record<string, unknown>): Promise<UpstreamResult>;
}

export interface GuardDeps {
  evaluate: (call: PolicyCall) => PolicyDecision;
  store: ApprovalStore;
  repo: Repository;
  upstream: UpstreamClient;
  now?: () => number;
  newId?: () => string;
}

export type OutcomeStatus = ActionStatus;

/** What the agent receives. Never contains original arguments or internal details. */
export interface AgentOutcome {
  isError: boolean;
  status: OutcomeStatus;
  requestId: string | null;
  message: string;
  ruleId?: string | null;
  expiresAt?: string;
  /** Upstream content, only present when the call really executed. */
  content?: McpContent[];
}

export type GuardEvent = { type: 'request_updated'; id: string; status: ActionStatus };

export type ReviewResult =
  { ok: true; request: RequestView } | { ok: false; error: string; request: RequestView | null };

const ID_PATTERN = /^[0-9a-f]{10}$/;

/** Only these upstream fields may reach the stored summary. Free text (body, reason) never does. */
const SUMMARY_FIELDS = ['id', 'orderId', 'status', 'amountCents', 'currency', 'code'] as const;
const SAFE_SCALAR = /^[A-Za-z0-9_-]{1,40}$/;

/** Builds the stored result summary from a fixed set of identifier-like fields, never raw text. */
export function summarizeContent(content: McpContent[]): string {
  const first = content.find((c) => c.type === 'text' && typeof c.text === 'string');
  if (!first?.text) return 'sin contenido';
  let parsed: unknown;
  try {
    parsed = JSON.parse(first.text);
  } catch {
    return 'respuesta sin formato reconocido (contenido omitido)';
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return 'respuesta sin formato reconocido (contenido omitido)';
  }
  const obj = parsed as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of SUMMARY_FIELDS) {
    const v = obj[key];
    if (typeof v === 'number' && Number.isFinite(v)) parts.push(`${key}=${v}`);
    else if (typeof v === 'string' && SAFE_SCALAR.test(v)) parts.push(`${key}=${v}`);
  }
  return parts.length > 0 ? parts.join(', ') : 'respuesta recibida (contenido omitido)';
}

export class GuardService {
  private readonly deps: GuardDeps;
  private readonly now: () => number;
  private readonly listeners = new Set<(e: GuardEvent) => void>();

  constructor(deps: GuardDeps) {
    this.deps = deps;
    this.now = deps.now ?? (() => Date.now());
  }

  subscribe(listener: (e: GuardEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** On startup nothing pending from a previous run may ever execute. */
  async expireOnStartup(): Promise<number> {
    this.deps.store.expireAll();
    const ids = await this.deps.repo.expireStalePending(this.now());
    for (const id of ids) {
      await this.event(id, 'expired', 'system', { cause: 'restart' });
      this.emit(id, 'expired');
    }
    // Approved but never completed (crash mid-execution): the outcome is unknown, never retried.
    const stuck = await this.deps.repo.failStaleApproved(this.now());
    for (const id of stuck) {
      await this.event(id, 'failed', 'system', { errorCode: 'interrupted', cause: 'restart' });
      this.emit(id, 'failed');
    }
    return ids.length;
  }

  async sweepExpired(): Promise<string[]> {
    const ids = this.deps.store.sweep();
    for (const id of ids) {
      const rec = this.deps.store.get(id);
      if (rec) await this.syncRecord(rec);
    }
    return ids;
  }

  async handleToolCall(publicName: string, rawArgs: unknown): Promise<AgentOutcome> {
    const def = resolvePublicName(publicName);
    if (!def) {
      return this.block(
        {
          publicToolName: publicName.slice(0, 80),
          upstream: 'unknown',
          tool: 'unknown',
          args: rawArgs,
        },
        null,
        'Herramienta desconocida. No se ejecuto nada.',
        'unknown_tool',
      );
    }
    const base = { publicToolName: def.publicName, upstream: def.upstream, tool: def.tool };
    const valid = validateToolArgs(def.tool, rawArgs ?? {});
    if (!valid.ok) {
      return this.block(
        { ...base, args: rawArgs },
        null,
        `Argumentos invalidos: ${valid.issues.join(', ')}. No se ejecuto nada.`,
        'invalid_arguments',
      );
    }
    const args = valid.args;
    const decision = this.deps.evaluate({ upstream: def.upstream, tool: def.tool, args });
    const preview = buildPreview(args, decision.safePreviewFields);

    if (decision.effect === 'deny') {
      return this.block({ ...base, args }, decision, decision.reason, 'policy_deny', preview);
    }

    if (decision.effect === 'require_approval') {
      const rec = this.deps.store.createPending({
        upstream: def.upstream,
        tool: def.tool,
        args,
        ruleId: decision.ruleId,
        reason: decision.reason,
        preview,
        ttlSeconds: decision.ttlSeconds,
      });
      const view: RequestView = {
        id: rec.id,
        publicToolName: def.publicName,
        upstream: def.upstream,
        tool: def.tool,
        argumentHash: rec.argumentHash,
        preview,
        decision: 'require_approval',
        status: 'pending_approval',
        ruleId: decision.ruleId,
        ruleName: decision.ruleName,
        reason: decision.reason,
        requestedAt: rec.requestedAt,
        expiresAt: rec.expiresAt,
        decidedAt: null,
        executedAt: null,
        approvedBy: null,
        resultSummary: null,
        errorCode: null,
        durationMs: null,
      };
      await this.deps.repo.upsertRequest(view);
      await this.event(rec.id, 'requested', 'agent', { tool: def.publicName });
      await this.event(rec.id, 'pending_approval', 'guard', {
        ruleId: decision.ruleId,
        reason: decision.reason,
      });
      this.emit(rec.id, 'pending_approval');
      return {
        isError: false,
        status: 'pending_approval',
        requestId: rec.id,
        message:
          'La accion requiere aprobacion humana y NO se ha ejecutado. Consulte guard.get_action_status con el requestId.',
        ruleId: decision.ruleId,
        expiresAt: new Date(rec.expiresAt).toISOString(),
      };
    }

    // effect === 'allow'
    return this.allow({ ...base, args }, decision, preview);
  }

  private async allow(
    call: { publicToolName: string; upstream: string; tool: string; args: Record<string, unknown> },
    decision: PolicyDecision,
    preview: Record<string, unknown>,
  ): Promise<AgentOutcome> {
    const started = this.now();
    const id = await this.freshId();
    const view = this.baseView(id, call, decision, preview, 'allow', 'requested', started);
    await this.deps.repo.upsertRequest(view);
    await this.event(id, 'requested', 'agent', { tool: call.publicToolName });

    // The policy engine cannot know whether the order exists, so Guard checks before allowing.
    if (call.tool === 'issue_refund') {
      const check = await this.safeUpstream('get_order', { orderId: call.args.orderId });
      if (!check.ok) return this.finishFailed(view, started, check.code, check.message);
      if (check.result.isError) {
        view.decision = 'deny';
        view.status = 'blocked';
        view.reason = 'La orden no existe; el reembolso no se ejecuto.';
        view.errorCode = 'order_not_found';
        view.decidedAt = this.now();
        view.durationMs = view.decidedAt - started;
        await this.deps.repo.upsertRequest(view);
        await this.event(id, 'blocked', 'guard', { ruleId: decision.ruleId, reason: view.reason });
        this.emit(id, 'blocked');
        return {
          isError: true,
          status: 'blocked',
          requestId: id,
          message: `${view.reason} No se llamo a la herramienta de destino.`,
          ruleId: decision.ruleId,
        };
      }
    }

    view.decidedAt = this.now();
    await this.event(id, 'approved', 'guard', {
      ruleId: decision.ruleId,
      reason: decision.reason,
      automatic: true,
    });
    const res = await this.safeUpstream(call.tool, call.args);
    if (!res.ok) return this.finishFailed(view, started, res.code, res.message);
    if (res.result.isError) {
      return this.finishFailed(
        view,
        started,
        'upstream_error',
        summarizeContent(res.result.content),
      );
    }
    view.status = 'executed';
    view.executedAt = this.now();
    view.durationMs = view.executedAt - started;
    view.resultSummary = summarizeContent(res.result.content);
    await this.deps.repo.upsertRequest(view);
    await this.event(id, 'executed', 'guard', { summary: view.resultSummary });
    this.emit(id, 'executed');
    return {
      isError: false,
      status: 'executed',
      requestId: id,
      message: 'Ejecutada.',
      ruleId: decision.ruleId,
      content: res.result.content,
    };
  }

  /**
   * `expectedHash` is the hash the reviewer saw. When given, the stored call must match it.
   * If persistence fails after the payload was consumed, nothing is executed and the record
   * is completed as `failed` so it never stays `approved`.
   */
  async approve(id: string, reviewer: string, expectedHash?: string): Promise<ReviewResult> {
    const res = this.deps.store.approve(id, reviewer, expectedHash);
    if (!res.ok) {
      if (res.record) await this.syncRecord(res.record);
      return { ok: false, error: res.error, request: await this.view(id) };
    }
    try {
      await this.syncRecord(res.record);
      await this.event(id, 'approved', reviewer, { hash: res.record.argumentHash });
    } catch (err) {
      const done = this.deps.store.markFailed(
        id,
        'persistence_error',
        'No se pudo registrar la aprobacion.',
      );
      this.emit(id, 'failed');
      try {
        if (done.ok) await this.syncRecord(done.record);
      } catch {
        // Database still unavailable: startup recovery marks leftover approved rows failed.
      }
      void err;
      return { ok: false, error: 'persistence_error', request: null };
    }
    this.emit(id, 'approved');
    // Exactly one execution of the stored call; the store already consumed the payload.
    const out = await this.safeUpstream(res.call.tool, res.call.args as Record<string, unknown>);
    let done;
    if (!out.ok) {
      done = this.deps.store.markFailed(id, out.code, out.message);
      await this.event(id, 'failed', 'guard', { errorCode: out.code, message: out.message });
    } else if (out.result.isError) {
      const summary = summarizeContent(out.result.content);
      done = this.deps.store.markFailed(id, 'upstream_error', summary);
      await this.event(id, 'failed', 'guard', { errorCode: 'upstream_error', message: summary });
    } else {
      const summary = summarizeContent(out.result.content);
      done = this.deps.store.markExecuted(id, summary);
      await this.event(id, 'executed', 'guard', { summary });
    }
    if (done.ok) await this.syncRecord(done.record);
    const final = await this.view(id);
    if (final) this.emit(id, final.status);
    return { ok: true, request: final as RequestView };
  }

  async deny(id: string, reviewer: string): Promise<ReviewResult> {
    const res = this.deps.store.deny(id, reviewer);
    if (!res.ok) {
      if (res.record) await this.syncRecord(res.record);
      return { ok: false, error: res.error, request: await this.view(id) };
    }
    await this.syncRecord(res.record);
    await this.event(id, 'denied', reviewer, {});
    this.emit(id, 'denied');
    return { ok: true, request: (await this.view(id)) as RequestView };
  }

  /** Read-only status for the agent. No arguments, no approval capability. */
  async getActionStatus(requestId: unknown): Promise<AgentOutcome> {
    if (typeof requestId !== 'string' || !ID_PATTERN.test(requestId)) {
      return { isError: true, status: 'failed', requestId: null, message: 'requestId no valido.' };
    }
    const v = await this.view(requestId);
    if (!v) {
      return {
        isError: true,
        status: 'failed',
        requestId: null,
        message: 'Solicitud no encontrada.',
      };
    }
    return {
      isError: false,
      status: v.status,
      requestId: v.id,
      ruleId: v.ruleId,
      message: [
        `decision=${v.decision}`,
        `motivo=${v.reason}`,
        v.resultSummary ? `resultado=${v.resultSummary}` : null,
        v.errorCode ? `error=${v.errorCode}` : null,
      ]
        .filter(Boolean)
        .join('; '),
    };
  }

  /** Request view with live pending status overlaid. */
  async view(id: string): Promise<RequestView | null> {
    const rec = this.deps.store.get(id);
    if (rec) await this.syncRecord(rec);
    return this.deps.repo.getRequest(id);
  }

  async pending(): Promise<RequestView[]> {
    const out: RequestView[] = [];
    for (const r of this.deps.store.listPending()) {
      const v = await this.deps.repo.getRequest(r.id);
      if (v) out.push(v);
    }
    return out.sort((a, b) => (a.expiresAt ?? 0) - (b.expiresAt ?? 0));
  }

  async detail(id: string): Promise<{ request: RequestView; events: AuditEventView[] } | null> {
    const request = await this.view(id);
    if (!request) return null;
    return { request, events: await this.deps.repo.listEvents(id) };
  }

  async list(filter: AuditFilter): Promise<RequestView[]> {
    await this.sweepExpired();
    return this.deps.repo.listRequests(filter);
  }

  // ---- internals ----

  private baseView(
    id: string,
    call: { publicToolName: string; upstream: string; tool: string; args: unknown },
    decision: PolicyDecision | null,
    preview: Record<string, unknown>,
    effect: Effect,
    status: ActionStatus,
    at: number,
  ): RequestView {
    let argumentHash: string;
    try {
      argumentHash = hashCall({ upstream: call.upstream, tool: call.tool, args: call.args });
    } catch {
      argumentHash = 'unhashable';
    }
    return {
      id,
      publicToolName: call.publicToolName,
      upstream: call.upstream,
      tool: call.tool,
      argumentHash,
      preview,
      decision: effect,
      status,
      ruleId: decision?.ruleId ?? null,
      ruleName: decision?.ruleName ?? null,
      reason: decision?.reason ?? '',
      requestedAt: at,
      expiresAt: null,
      decidedAt: null,
      executedAt: null,
      approvedBy: null,
      resultSummary: null,
      errorCode: null,
      durationMs: null,
    };
  }

  private async block(
    call: { publicToolName: string; upstream: string; tool: string; args: unknown },
    decision: PolicyDecision | null,
    reason: string,
    errorCode: string,
    preview: Record<string, unknown> = {},
  ): Promise<AgentOutcome> {
    const at = this.now();
    const id = await this.freshId();
    const view = this.baseView(id, call, decision, preview, 'deny', 'blocked', at);
    view.reason = reason;
    view.errorCode = errorCode;
    view.decidedAt = at;
    view.durationMs = 0;
    await this.deps.repo.upsertRequest(view);
    await this.event(id, 'requested', 'agent', { tool: call.publicToolName });
    await this.event(id, 'blocked', 'guard', { ruleId: view.ruleId, reason, errorCode });
    this.emit(id, 'blocked');
    return {
      isError: true,
      status: 'blocked',
      requestId: id,
      message: `Bloqueada por Guard: ${reason} No se llamo a la herramienta de destino.`,
      ruleId: view.ruleId,
    };
  }

  private async finishFailed(
    view: RequestView,
    started: number,
    code: string,
    message: string,
  ): Promise<AgentOutcome> {
    view.status = 'failed';
    view.errorCode = code;
    view.resultSummary = message;
    view.executedAt = this.now();
    view.durationMs = view.executedAt - started;
    await this.deps.repo.upsertRequest(view);
    await this.event(view.id, 'failed', 'guard', { errorCode: code, message });
    this.emit(view.id, 'failed');
    return {
      isError: true,
      status: 'failed',
      requestId: view.id,
      message: `La llamada fallo (${code}). No se simula exito.`,
      ruleId: view.ruleId,
    };
  }

  private async safeUpstream(
    tool: string,
    args: Record<string, unknown>,
  ): Promise<{ ok: true; result: UpstreamResult } | { ok: false; code: string; message: string }> {
    try {
      return { ok: true, result: await this.deps.upstream.callTool(tool, args) };
    } catch (err) {
      return { ok: false, code: 'upstream_unavailable', message: safeErrorSummary(err) };
    }
  }

  private async syncRecord(rec: ActionRecord): Promise<void> {
    const existing = await this.deps.repo.getRequest(rec.id);
    if (!existing) return;
    const next: RequestView = {
      ...existing,
      status: rec.status,
      decidedAt: rec.decidedAt,
      executedAt: rec.executedAt,
      approvedBy: rec.decidedBy,
      resultSummary: rec.resultSummary,
      errorCode: rec.errorCode,
      durationMs:
        rec.executedAt !== null || rec.decidedAt !== null
          ? (rec.executedAt ?? rec.decidedAt ?? rec.requestedAt) - rec.requestedAt
          : null,
    };
    if (JSON.stringify(next) !== JSON.stringify(existing)) {
      await this.deps.repo.upsertRequest(next);
    }
    if (existing.status === 'pending_approval' && rec.status === 'expired') {
      await this.event(rec.id, 'expired', 'system', { cause: 'ttl' });
      this.emit(rec.id, 'expired');
    }
  }

  private async event(
    requestId: string,
    eventType: AuditEventType,
    actor: string,
    details: Record<string, unknown>,
  ): Promise<void> {
    await this.deps.repo.addEvent({
      id: randomBytes(8).toString('hex'),
      requestId,
      eventType,
      actor,
      details: sanitizeDetails(details),
      createdAt: this.now(),
    });
  }

  private emit(id: string, status: ActionStatus): void {
    for (const l of this.listeners) l({ type: 'request_updated', id, status });
  }

  private async freshId(): Promise<string> {
    const gen = this.deps.newId ?? (() => randomBytes(5).toString('hex'));
    for (;;) {
      const id = gen();
      if (!(await this.deps.repo.getRequest(id))) return id;
    }
  }
}
