// NOT COMPILED IN SANDBOX: depends on fastify.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { describeAction } from '../../../../packages/shared/src/describe.ts';
import type { GuardConfig } from '../config.ts';
import type { GuardService } from '../core/service.ts';
import type { RequestView } from '../audit/repository.ts';
import type { LoadedPolicy } from '../policy/loader.ts';
import {
  csrfValid,
  LoginLimiter,
  originAllowed,
  readCookie,
  secretEquals,
  SessionStore,
} from './security.ts';
import type { Session } from './security.ts';

export const SESSION_COOKIE = 'guard_session';
const REVIEWER = 'demo-reviewer';
const ID_PATTERN = /^[0-9a-f]{10}$/;
const STATUSES = [
  'pending_approval',
  'approved',
  'denied',
  'blocked',
  'expired',
  'executed',
  'failed',
];

export interface ApiContext {
  config: GuardConfig;
  service: GuardService;
  sessions: SessionStore;
  limiter: LoginLimiter;
  policy: () => LoadedPolicy;
  health: () => Promise<{ upstream: 'up' | 'down'; database: 'ok' | 'memory' }>;
  resetDemo: () => Promise<void>;
  clearAudit: () => Promise<void>;
}

function present(v: RequestView) {
  return {
    ...v,
    description: describeAction(v.tool, v.preview),
    hashShort: v.argumentHash.slice(0, 12),
    reachedTarget: v.status === 'executed' || v.status === 'failed',
  };
}

function parseTime(value: unknown): number | undefined {
  if (typeof value !== 'string' || value === '') return undefined;
  const n = /^\d+$/.test(value) ? Number(value) : Date.parse(value);
  return Number.isFinite(n) ? n : undefined;
}

export function registerApi(app: FastifyInstance, ctx: ApiContext): void {
  const secureCookie = ctx.config.production ? '; Secure' : '';

  const session = (req: FastifyRequest): Session | null =>
    ctx.sessions.get(readCookie(req.headers.cookie, SESSION_COOKIE));

  /** Authenticated read. */
  const needSession = (req: FastifyRequest, reply: FastifyReply): Session | null => {
    const s = session(req);
    if (!s) void reply.code(401).send({ error: 'unauthorized' });
    return s;
  };

  /** Authenticated mutation: session + exact Origin + CSRF header. */
  const needMutation = (req: FastifyRequest, reply: FastifyReply): Session | null => {
    if (!originAllowed(req.headers.origin, ctx.config.allowedOrigins, false)) {
      void reply.code(403).send({ error: 'forbidden_origin' });
      return null;
    }
    const s = needSession(req, reply);
    if (!s) return null;
    const header = req.headers['x-csrf-token'];
    if (!csrfValid(s, typeof header === 'string' ? header : undefined)) {
      void reply.code(403).send({ error: 'csrf' });
      return null;
    }
    return s;
  };

  app.get('/api/health', async () => {
    const h = await ctx.health();
    const p = ctx.policy();
    return { status: 'ok', policyMode: p.mode, upstream: h.upstream, database: h.database };
  });

  app.post('/api/session', async (req, reply) => {
    if (!originAllowed(req.headers.origin, ctx.config.allowedOrigins, false)) {
      return reply.code(403).send({ error: 'forbidden_origin' });
    }
    if (ctx.limiter.blocked()) return reply.code(429).send({ error: 'too_many_attempts' });
    const body = req.body as { secret?: unknown } | null;
    const given = typeof body?.secret === 'string' ? body.secret : '';
    if (!secretEquals(given, ctx.config.adminSecret)) {
      ctx.limiter.fail();
      return reply.code(401).send({ error: 'invalid_credentials' });
    }
    const s = ctx.sessions.create(REVIEWER);
    void reply.header(
      'Set-Cookie',
      `${SESSION_COOKIE}=${s.id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${secureCookie}`,
    );
    return { csrfToken: s.csrf, reviewer: s.reviewer, demoMode: ctx.config.demoMode };
  });

  app.get('/api/session', async (req, reply) => {
    const s = needSession(req, reply);
    if (!s) return reply;
    return { csrfToken: s.csrf, reviewer: s.reviewer, demoMode: ctx.config.demoMode };
  });

  app.delete('/api/session', async (req, reply) => {
    const s = needMutation(req, reply);
    if (!s) return reply;
    ctx.sessions.destroy(s.id);
    void reply.header(
      'Set-Cookie',
      `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secureCookie}`,
    );
    return { ok: true };
  });

  app.get('/api/pending', async (req, reply) => {
    if (!needSession(req, reply)) return reply;
    return { pending: (await ctx.service.pending()).map(present), now: Date.now() };
  });

  app.get('/api/summary', async (req, reply) => {
    if (!needSession(req, reply)) return reply;
    const all = await ctx.service.list({ limit: 500 });
    const h = await ctx.health();
    return {
      pending: all.filter((r) => r.status === 'pending_approval').length,
      allowed: all.filter((r) => r.decision === 'allow' && r.status === 'executed').length,
      approved: all.filter((r) => r.approvedBy !== null && r.status !== 'denied').length,
      rejected: all.filter((r) => r.status === 'denied').length,
      blocked: all.filter((r) => r.status === 'blocked').length,
      upstream: h.upstream,
      database: h.database,
      policyMode: ctx.policy().mode,
    };
  });

  app.get('/api/actions/:id', async (req, reply) => {
    if (!needSession(req, reply)) return reply;
    const { id } = req.params as { id: string };
    if (!ID_PATTERN.test(id)) return reply.code(404).send({ error: 'not_found' });
    const d = await ctx.service.detail(id);
    if (!d) return reply.code(404).send({ error: 'not_found' });
    return { request: present(d.request), events: d.events, now: Date.now() };
  });

  const review = (kind: 'approve' | 'deny') => async (req: FastifyRequest, reply: FastifyReply) => {
    const s = needMutation(req, reply);
    if (!s) return reply;
    const { id } = req.params as { id: string };
    if (!ID_PATTERN.test(id)) return reply.code(404).send({ error: 'not_found' });
    const res =
      kind === 'approve'
        ? await ctx.service.approve(id, s.reviewer)
        : await ctx.service.deny(id, s.reviewer);
    if (res.ok) return { request: present(res.request) };
    const code = res.error === 'not_found' ? 404 : res.error === 'expired' ? 410 : 409;
    return reply.code(code).send({
      error: res.error,
      request: res.request ? present(res.request) : null,
    });
  };
  app.post('/api/actions/:id/approve', review('approve'));
  app.post('/api/actions/:id/deny', review('deny'));

  app.get('/api/audit', async (req, reply) => {
    if (!needSession(req, reply)) return reply;
    const q = req.query as Record<string, unknown>;
    const status =
      typeof q.status === 'string' && STATUSES.includes(q.status) ? q.status : undefined;
    const tool = typeof q.tool === 'string' && q.tool.length <= 80 ? q.tool : undefined;
    const limit = typeof q.limit === 'string' ? Number(q.limit) : undefined;
    const rows = await ctx.service.list({
      ...(status ? { status } : {}),
      ...(tool ? { tool } : {}),
      ...(parseTime(q.from) !== undefined ? { from: parseTime(q.from) as number } : {}),
      ...(parseTime(q.to) !== undefined ? { to: parseTime(q.to) as number } : {}),
      ...(limit !== undefined && Number.isFinite(limit) ? { limit } : {}),
    });
    return { requests: rows.map(present) };
  });

  app.get('/api/policy', async (req, reply) => {
    if (!needSession(req, reply)) return reply;
    const p = ctx.policy();
    return { mode: p.mode, error: p.error, policy: p.policy };
  });

  app.get('/api/events', async (req, reply) => {
    if (!needSession(req, reply)) return reply;
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Content-Type-Options': 'nosniff',
    });
    res.write('retry: 3000\n\n');
    res.write(`event: ready\ndata: {}\n\n`);
    const unsubscribe = ctx.service.subscribe((e) => {
      res.write(`event: request\ndata: ${JSON.stringify(e)}\n\n`);
    });
    const beat = setInterval(() => res.write(': keep-alive\n\n'), 15000);
    req.raw.on('close', () => {
      clearInterval(beat);
      unsubscribe();
    });
    return reply;
  });

  app.post('/api/demo/reset', async (req, reply) => {
    if (!ctx.config.demoMode) return reply.code(404).send({ error: 'not_found' });
    if (!needMutation(req, reply)) return reply;
    const body = req.body as { clearAudit?: unknown } | null;
    try {
      await ctx.resetDemo();
      if (body?.clearAudit === true) await ctx.clearAudit();
    } catch {
      return reply.code(502).send({ error: 'reset_failed' });
    }
    return { ok: true, auditCleared: body?.clearAudit === true };
  });
}
