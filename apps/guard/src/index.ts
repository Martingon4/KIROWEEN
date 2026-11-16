// NOT COMPILED IN SANDBOX: depends on fastify, @fastify/static, @modelcontextprotocol/sdk, prisma.
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ApprovalStore } from './approvals/index.ts';
import { MemoryRepository } from './audit/repository.ts';
import type { Repository } from './audit/repository.ts';
import { registerApi } from './api/routes.ts';
import {
  allowedHostsFor,
  bearerValid,
  hostAllowed,
  LoginLimiter,
  originAllowed,
  SessionStore,
} from './api/security.ts';
import { loadConfig } from './config.ts';
import { GuardService } from './core/service.ts';
import { PrismaRepository } from './db/prisma-repository.ts';
import { createMcpServer } from './mcp/server.ts';
import { McpUpstreamClient } from './mcp/upstream.ts';
import { loadPolicyFile } from './policy/loader.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const config = loadConfig(process.env);
const policy = loadPolicyFile(resolve(ROOT, config.policyFile));

const app = Fastify({
  logger: { level: 'info', redact: ['req.headers.authorization', 'req.headers.cookie'] },
  bodyLimit: 64 * 1024,
});

if (policy.mode === 'blocked') {
  app.log.error(`Politica invalida, Guard en MODO BLOQUEADO (todo se deniega): ${policy.error}`);
}

let repo: Repository;
let prisma: PrismaRepository | null = null;
if (config.databaseUrl) {
  prisma = new PrismaRepository();
  repo = prisma;
  await prisma.syncPolicyRules(policy.policy);
} else {
  app.log.warn(
    'DATABASE_URL no definido: la auditoria vive solo en memoria y se pierde al reiniciar.',
  );
  repo = new MemoryRepository();
}

const upstream = new McpUpstreamClient(config.upstreamUrl, config.upstreamToken);
const store = new ApprovalStore();
const service = new GuardService({ evaluate: policy.evaluate, store, repo, upstream });
const expired = await service.expireOnStartup();
if (expired > 0)
  app.log.info(`${expired} solicitudes pendientes de una ejecucion anterior expiradas.`);

// Upstream discovery with a short cache. Failure means "down", never a fake success.
let discovery: { at: number; tools: Set<string>; up: boolean } = {
  at: 0,
  tools: new Set(),
  up: false,
};
async function discover(): Promise<Set<string>> {
  if (Date.now() - discovery.at < 5000) return discovery.tools;
  try {
    discovery = { at: Date.now(), tools: new Set(await upstream.listToolNames()), up: true };
  } catch (err) {
    app.log.warn({ err: err instanceof Error ? err.message : 'unknown' }, 'upstream no disponible');
    discovery = { at: Date.now(), tools: new Set(), up: false };
  }
  return discovery.tools;
}
await discover();

const hosts = allowedHostsFor(config.host, config.port);

app.addHook('onRequest', async (req, reply) => {
  if (!hostAllowed(req.headers.host, hosts)) {
    return reply.code(403).send({ error: 'forbidden_host' });
  }
  if (req.url === '/mcp' || req.url.startsWith('/mcp?')) {
    if (!originAllowed(req.headers.origin, config.allowedOrigins, true)) {
      return reply.code(403).send({ error: 'forbidden_origin' });
    }
    if (!bearerValid(req.headers.authorization, config.mcpToken)) {
      return reply.code(401).header('WWW-Authenticate', 'Bearer').send({ error: 'unauthorized' });
    }
  }
});

app.addHook('onSend', async (req, reply) => {
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('Referrer-Policy', 'no-referrer');
  reply.header('Content-Security-Policy', "default-src 'self'; frame-ancestors 'none'");
  if (req.url.startsWith('/api/')) reply.header('Cache-Control', 'no-store');
});

app.setErrorHandler((err, _req, reply) => {
  app.log.error({ message: err instanceof Error ? err.message : 'error' }, 'request failed');
  const status =
    typeof (err as { statusCode?: number }).statusCode === 'number'
      ? (err as { statusCode: number }).statusCode
      : 500;
  void reply.code(status >= 400 && status < 500 ? status : 500).send({ error: 'request_failed' });
});

// MCP endpoint (Streamable HTTP, stateless: one server and transport per request).
app.post('/mcp', async (req, reply) => {
  const server = createMcpServer({ service, discoveredTools: discover });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  reply.raw.on('close', () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  reply.hijack();
  await transport.handleRequest(req.raw, reply.raw, req.body);
});
const methodNotAllowed = async (
  _req: unknown,
  reply: { code: (n: number) => { send: (b: unknown) => unknown } },
) =>
  reply
    .code(405)
    .send({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null });
app.get('/mcp', methodNotAllowed);
app.delete('/mcp', methodNotAllowed);

registerApi(app, {
  config,
  service,
  sessions: new SessionStore(),
  limiter: new LoginLimiter(),
  policy: () => policy,
  health: async () => {
    await discover();
    return { upstream: discovery.up ? 'up' : 'down', database: prisma ? 'ok' : 'memory' };
  },
  resetDemo: () => upstream.resetDemo(),
  clearAudit: () => repo.clearAll(),
});

// Dashboard build served by Guard. In development use `npm run dev -w @mcp-guard/dashboard`.
const dist = resolve(ROOT, 'apps/dashboard/dist');
if (existsSync(dist)) {
  await app.register(fastifyStatic, { root: dist, wildcard: false });
  app.setNotFoundHandler((req, reply) => {
    if (req.method === 'GET' && !req.url.startsWith('/api/') && !req.url.startsWith('/mcp')) {
      return reply.sendFile('index.html');
    }
    return reply.code(404).send({ error: 'not_found' });
  });
} else {
  app.log.warn('apps/dashboard/dist no existe: ejecute "npm run build" para servir el panel.');
}

const sweeper = setInterval(() => {
  service.sweepExpired().catch(() => undefined);
}, 5000);

async function shutdown(): Promise<void> {
  clearInterval(sweeper);
  store.expireAll();
  await app.close();
  await prisma?.close();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());

await app.listen({ host: config.host, port: config.port });
