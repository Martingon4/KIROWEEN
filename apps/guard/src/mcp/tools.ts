/** Public tool table and argument validation. Dependency-free. Upstream metadata is never trusted. */

export const UPSTREAM_NAME = 'demo-store';
export const STATUS_TOOL = 'guard.get_action_status';

export interface ToolDef {
  publicName: string;
  upstream: string;
  tool: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const ORDER_ID = { type: 'string', minLength: 1, maxLength: 40 };

export const TOOL_TABLE: readonly ToolDef[] = [
  {
    publicName: 'demo_store.get_order',
    upstream: UPSTREAM_NAME,
    tool: 'get_order',
    description: 'Consulta una orden de la tienda simulada.',
    inputSchema: {
      type: 'object',
      properties: { orderId: ORDER_ID },
      required: ['orderId'],
      additionalProperties: false,
    },
  },
  {
    publicName: 'demo_store.issue_refund',
    upstream: UPSTREAM_NAME,
    tool: 'issue_refund',
    description:
      'Emite un reembolso simulado. El monto va en centavos enteros (14999 = USD 149.99).',
    inputSchema: {
      type: 'object',
      properties: {
        orderId: ORDER_ID,
        amountCents: { type: 'integer' },
        currency: { type: 'string', minLength: 3, maxLength: 3 },
        reason: { type: 'string', maxLength: 200 },
      },
      required: ['orderId', 'amountCents', 'currency', 'reason'],
      additionalProperties: false,
    },
  },
  {
    publicName: 'demo_store.send_customer_email',
    upstream: UPSTREAM_NAME,
    tool: 'send_customer_email',
    description: 'Registra un correo simulado a un cliente. No se envia nada a Internet.',
    inputSchema: {
      type: 'object',
      properties: {
        orderId: ORDER_ID,
        subject: { type: 'string', maxLength: 200 },
        body: { type: 'string', maxLength: 2000 },
      },
      required: ['orderId', 'subject', 'body'],
      additionalProperties: false,
    },
  },
];

export const STATUS_TOOL_DEF = {
  name: STATUS_TOOL,
  description: 'Consulta el estado de una llamada MCP protegida por Guard.',
  inputSchema: {
    type: 'object',
    properties: { requestId: { type: 'string' } },
    required: ['requestId'],
    additionalProperties: false,
  },
} as const;

const BY_PUBLIC = new Map(TOOL_TABLE.map((t) => [t.publicName, t]));

/** Exact-match lookup. Unknown names return null. */
export function resolvePublicName(name: string): ToolDef | null {
  return BY_PUBLIC.get(name) ?? null;
}

type FieldSpec = { kind: 'string'; max: number; min?: number } | { kind: 'int' };

const FIELDS: Record<string, Record<string, FieldSpec>> = {
  get_order: { orderId: { kind: 'string', min: 1, max: 40 } },
  issue_refund: {
    orderId: { kind: 'string', min: 1, max: 40 },
    amountCents: { kind: 'int' },
    currency: { kind: 'string', min: 3, max: 3 },
    reason: { kind: 'string', max: 200 },
  },
  send_customer_email: {
    orderId: { kind: 'string', min: 1, max: 40 },
    subject: { kind: 'string', max: 200 },
    body: { kind: 'string', max: 2000 },
  },
};

export type ArgsValidation =
  { ok: true; args: Record<string, unknown> } | { ok: false; issues: string[] };

/** Validates against the announced schema. Issues name fields only, never echo values. */
export function validateToolArgs(upstreamTool: string, args: unknown): ArgsValidation {
  const spec = Object.hasOwn(FIELDS, upstreamTool) ? FIELDS[upstreamTool] : undefined;
  if (!spec) return { ok: false, issues: ['herramienta sin esquema'] };
  if (args === null || typeof args !== 'object' || Array.isArray(args)) {
    return { ok: false, issues: ['los argumentos deben ser un objeto'] };
  }
  const obj = args as Record<string, unknown>;
  const issues: string[] = [];
  for (const key of Object.keys(obj)) {
    if (!Object.hasOwn(spec, key)) issues.push(`campo no permitido: ${key.slice(0, 40)}`);
  }
  for (const [name, f] of Object.entries(spec)) {
    const v = obj[name];
    if (v === undefined) {
      issues.push(`falta el campo ${name}`);
    } else if (f.kind === 'int') {
      if (typeof v !== 'number' || !Number.isSafeInteger(v)) {
        issues.push(`${name} debe ser un entero (centavos)`);
      }
    } else if (typeof v !== 'string') {
      issues.push(`${name} debe ser texto`);
    } else if (v.length > f.max || v.length < (f.min ?? 0)) {
      issues.push(`${name} tiene una longitud no valida`);
    }
  }
  return issues.length ? { ok: false, issues } : { ok: true, args: obj };
}
