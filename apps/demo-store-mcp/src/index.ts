// NOT COMPILED IN SANDBOX: depends on @modelcontextprotocol/sdk and zod (registry blocked).
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { DemoStore, type StoreResult } from './store.ts';

const HOST = '127.0.0.1';
const PORT = Number(process.env.UPSTREAM_PORT ?? 3001);
const TOKEN = process.env.UPSTREAM_TOKEN ?? '';
const MAX_BODY_BYTES = 64 * 1024;

const store = new DemoStore();

function toResult<T>(r: StoreResult<T>) {
  if (r.ok) return { content: [{ type: 'text' as const, text: JSON.stringify(r.value) }] };
  return {
    isError: true,
    content: [
      { type: 'text' as const, text: JSON.stringify({ code: r.code, message: r.message }) },
    ],
  };
}

function buildServer(): McpServer {
  const server = new McpServer({ name: 'demo-store', version: '0.1.0' });
  server.tool(
    'get_order',
    'Consulta una orden simulada.',
    { orderId: z.string().min(1).max(40) },
    async ({ orderId }) => toResult(store.getOrder(orderId)),
  );
  server.tool(
    'issue_refund',
    'Emite un reembolso simulado. Monto en centavos enteros.',
    {
      orderId: z.string().min(1).max(40),
      amountCents: z.number().int(),
      currency: z.string().min(3).max(3),
      reason: z.string().max(200),
    },
    async ({ orderId, amountCents, currency, reason }) =>
      toResult(store.issueRefund(orderId, amountCents, currency, reason)),
  );
  server.tool(
    'send_customer_email',
    'Registra un correo simulado. No se envia nada a Internet.',
    {
      orderId: z.string().min(1).max(40),
      subject: z.string().max(200),
      body: z.string().max(2000),
    },
    async ({ orderId, subject, body }) => toResult(store.sendCustomerEmail(orderId, subject, body)),
  );
  return server;
}

function digest(s: string): Buffer {
  return createHash('sha256').update(s).digest();
}

function authorized(req: IncomingMessage): boolean {
  if (!TOKEN) return false; // fail closed: a token is required
  const header = req.headers.authorization ?? '';
  const given = header.startsWith('Bearer ') ? header.slice(7) : '';
  return timingSafeEqual(digest(given), digest(TOKEN));
}

function hostOk(req: IncomingMessage): boolean {
  const h = req.headers.host ?? '';
  return h === `127.0.0.1:${PORT}` || h === `localhost:${PORT}`;
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined);
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

const http = createServer(async (req, res) => {
  try {
    if (!hostOk(req) || req.headers.origin !== undefined)
      return send(res, 403, { error: 'forbidden' });
    const path = (req.url ?? '').split('?')[0];
    if (path === '/health' && req.method === 'GET') return send(res, 200, { ok: true });
    if (!authorized(req)) return send(res, 401, { error: 'unauthorized' });
    if (path === '/reset' && req.method === 'POST') {
      store.reset();
      return send(res, 200, { ok: true });
    }
    if (path === '/state' && req.method === 'GET') {
      return send(res, 200, { refunds: store.listRefunds(), emails: store.listEmails() });
    }
    if (path !== '/mcp') return send(res, 404, { error: 'not_found' });
    if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
    const body = await readBody(req);
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  } catch {
    if (!res.headersSent) send(res, 500, { error: 'internal_error' });
  }
});

http.listen(PORT, HOST, () => {
  console.error(`demo-store-mcp listening on http://${HOST}:${PORT}/mcp`);
});
