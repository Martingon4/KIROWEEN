// NOT COMPILED IN SANDBOX: depends on @prisma/client and a generated client.
import { PrismaClient } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import type { Effect, ActionStatus } from '../../../../packages/shared/src/types.ts';
import type { Policy } from '../policy/index.ts';
import type {
  AuditEventType,
  AuditEventView,
  AuditFilter,
  Repository,
  RequestView,
} from '../audit/repository.ts';

type Row = Awaited<ReturnType<PrismaClient['actionRequest']['findFirstOrThrow']>>;
type EventRow = Awaited<ReturnType<PrismaClient['auditEvent']['findFirstOrThrow']>>;

const d = (ms: number | null): Date | null => (ms === null ? null : new Date(ms));
const t = (date: Date | null): number | null => (date === null ? null : date.getTime());

function toView(r: Row): RequestView {
  return {
    id: r.id,
    publicToolName: r.publicToolName,
    upstream: r.upstreamName,
    tool: r.upstreamToolName,
    argumentHash: r.argumentHash,
    preview: r.redactedPreviewJson as Record<string, unknown>,
    decision: r.decision as Effect,
    status: r.status as ActionStatus,
    ruleId: r.ruleId,
    ruleName: r.ruleName,
    reason: r.reason,
    requestedAt: r.requestedAt.getTime(),
    expiresAt: t(r.expiresAt),
    decidedAt: t(r.decidedAt),
    executedAt: t(r.executedAt),
    approvedBy: r.approvedBy,
    resultSummary: r.resultSummary,
    errorCode: r.errorCode,
    durationMs: r.durationMs,
  };
}

function toData(v: RequestView) {
  return {
    publicToolName: v.publicToolName,
    upstreamName: v.upstream,
    upstreamToolName: v.tool,
    argumentHash: v.argumentHash,
    redactedPreviewJson: v.preview as Prisma.InputJsonObject,
    decision: v.decision,
    status: v.status,
    ruleId: v.ruleId,
    ruleName: v.ruleName,
    reason: v.reason,
    requestedAt: new Date(v.requestedAt),
    expiresAt: d(v.expiresAt),
    decidedAt: d(v.decidedAt),
    executedAt: d(v.executedAt),
    approvedBy: v.approvedBy,
    resultSummary: v.resultSummary,
    errorCode: v.errorCode,
    durationMs: v.durationMs,
  };
}

function toEvent(e: EventRow): AuditEventView {
  return {
    id: e.id,
    requestId: e.actionRequestId,
    eventType: e.eventType as AuditEventType,
    actor: e.actor,
    details: e.detailsJson as Record<string, unknown>,
    createdAt: e.createdAt.getTime(),
  };
}

export class PrismaRepository implements Repository {
  private readonly db: PrismaClient;

  constructor(db: PrismaClient = new PrismaClient()) {
    this.db = db;
  }

  async upsertRequest(view: RequestView): Promise<void> {
    const data = toData(view);
    await this.db.actionRequest.upsert({
      where: { id: view.id },
      create: { id: view.id, ...data },
      update: data,
    });
  }

  async addEvent(event: AuditEventView): Promise<void> {
    await this.db.auditEvent.create({
      data: {
        id: event.id,
        actionRequestId: event.requestId,
        eventType: event.eventType,
        actor: event.actor,
        detailsJson: event.details as Prisma.InputJsonObject,
        createdAt: new Date(event.createdAt),
      },
    });
  }

  async getRequest(id: string): Promise<RequestView | null> {
    const r = await this.db.actionRequest.findUnique({ where: { id } });
    return r ? toView(r) : null;
  }

  async listRequests(filter: AuditFilter): Promise<RequestView[]> {
    const where: Prisma.ActionRequestWhereInput = {};
    if (filter.status) where.status = filter.status;
    if (filter.tool)
      where.OR = [{ publicToolName: filter.tool }, { upstreamToolName: filter.tool }];
    if (filter.from !== undefined || filter.to !== undefined) {
      where.requestedAt = {
        ...(filter.from !== undefined ? { gte: new Date(filter.from) } : {}),
        ...(filter.to !== undefined ? { lte: new Date(filter.to) } : {}),
      };
    }
    const rows = await this.db.actionRequest.findMany({
      where,
      orderBy: { requestedAt: 'desc' },
      take: Math.min(Math.max(filter.limit ?? 100, 1), 500),
    });
    return rows.map(toView);
  }

  async listEvents(requestId: string): Promise<AuditEventView[]> {
    const rows = await this.db.auditEvent.findMany({
      where: { actionRequestId: requestId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toEvent);
  }

  async expireStalePending(now: number): Promise<string[]> {
    const rows = await this.db.actionRequest.findMany({
      where: { status: 'pending_approval' },
      select: { id: true },
    });
    const ids = rows.map((r) => r.id);
    if (ids.length > 0) {
      await this.db.actionRequest.updateMany({
        where: { id: { in: ids }, status: 'pending_approval' },
        data: { status: 'expired', decidedAt: new Date(now) },
      });
    }
    return ids;
  }

  async clearAll(): Promise<void> {
    await this.db.$transaction([
      this.db.auditEvent.deleteMany(),
      this.db.actionRequest.deleteMany(),
    ]);
  }

  /** Mirrors the active YAML rules into PolicyRule for visibility. The file stays the source. */
  async syncPolicyRules(policy: Policy | null): Promise<void> {
    const rules = policy?.rules ?? [];
    await this.db.policyRule.updateMany({ where: {}, data: { enabled: false } });
    for (const r of rules) {
      const data = {
        name: r.name,
        upstreamName: r.upstream,
        toolName: r.tool,
        effect: r.effect,
        conditionsJson: r.when as Prisma.InputJsonObject,
        reason: r.reason,
        safePreviewFields: r.safePreviewFields,
        enabled: true,
      };
      await this.db.policyRule.upsert({
        where: { id: r.id },
        create: { id: r.id, ...data },
        update: data,
      });
    }
  }

  async close(): Promise<void> {
    await this.db.$disconnect();
  }
}
