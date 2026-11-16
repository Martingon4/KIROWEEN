// NOT COMPILED IN SANDBOX: depends on zod.
import { z } from 'zod';
import { readSecretFile } from './secret-file.ts';

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
  // Preferred: a chmod 600 file outside the repo and outside the agent's environment.
  DASHBOARD_ADMIN_SECRET_FILE: z.string().min(1).optional(),
  DASHBOARD_ADMIN_SECRET: secret.optional(),
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
  let adminSecret: string;
  if (e.DASHBOARD_ADMIN_SECRET_FILE) {
    try {
      adminSecret = readSecretFile(e.DASHBOARD_ADMIN_SECRET_FILE);
    } catch (err) {
      throw new Error(
        `Configuracion invalida:\nDASHBOARD_ADMIN_SECRET_FILE: ${err instanceof Error ? err.message : 'ilegible'}`,
      );
    }
  } else if (e.DASHBOARD_ADMIN_SECRET) {
    adminSecret = e.DASHBOARD_ADMIN_SECRET;
  } else {
    throw new Error(
      'Configuracion invalida:\nDASHBOARD_ADMIN_SECRET_FILE o DASHBOARD_ADMIN_SECRET es obligatorio',
    );
  }
  return {
    host: e.GUARD_HOST,
    port: e.GUARD_PORT,
    upstreamUrl: e.UPSTREAM_URL,
    upstreamToken: e.UPSTREAM_TOKEN,
    policyFile: e.POLICY_FILE,
    mcpToken: e.MCP_GUARD_TOKEN,
    adminSecret,
    allowedOrigins: e.PANEL_ALLOWED_ORIGINS.split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    databaseUrl: e.DATABASE_URL,
    demoMode: e.DEMO_MODE === 'true',
    production: e.NODE_ENV === 'production',
  };
}
