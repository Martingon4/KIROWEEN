// NOT COMPILED IN SANDBOX: depends on zod.
import { z } from 'zod';

const secret = z
  .string()
  .min(16, 'debe tener al menos 16 caracteres')
  .refine((v) => v !== 'change-me', 'cambie el valor de ejemplo por un secreto aleatorio');

const loopbackUrl = z
  .string()
  .url()
  .refine((v) => ['127.0.0.1', 'localhost'].includes(new URL(v).hostname), 'solo loopback');

const EnvSchema = z.object({
  GUARD_HOST: z.literal('127.0.0.1').default('127.0.0.1'),
  GUARD_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  UPSTREAM_URL: loopbackUrl.default('http://127.0.0.1:3001/mcp'),
  UPSTREAM_TOKEN: secret,
  POLICY_FILE: z.string().min(1).default('config/policy.example.yaml'),
  MCP_GUARD_TOKEN: secret,
  DASHBOARD_ADMIN_SECRET: secret,
  PANEL_ALLOWED_ORIGINS: z.string().default('http://127.0.0.1:3000'),
  DATABASE_URL: z.string().optional(),
  DEMO_MODE: z.enum(['true', 'false']).default('false'),
  NODE_ENV: z.string().default('development'),
});

export interface GuardConfig {
  host: '127.0.0.1';
  port: number;
  upstreamUrl: string;
  upstreamToken: string;
  policyFile: string;
  mcpToken: string;
  adminSecret: string;
  allowedOrigins: string[];
  databaseUrl: string | undefined;
  demoMode: boolean;
  production: boolean;
}

/** Throws with a readable message when configuration is missing or insecure (fail closed). */
export function loadConfig(env: NodeJS.ProcessEnv): GuardConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new Error(`Configuracion invalida:\n${lines.join('\n')}`);
  }
  const e = parsed.data;
  return {
    host: e.GUARD_HOST,
    port: e.GUARD_PORT,
    upstreamUrl: e.UPSTREAM_URL,
    upstreamToken: e.UPSTREAM_TOKEN,
    policyFile: e.POLICY_FILE,
    mcpToken: e.MCP_GUARD_TOKEN,
    adminSecret: e.DASHBOARD_ADMIN_SECRET,
    allowedOrigins: e.PANEL_ALLOWED_ORIGINS.split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    databaseUrl: e.DATABASE_URL,
    demoMode: e.DEMO_MODE === 'true',
    production: e.NODE_ENV === 'production',
  };
}
