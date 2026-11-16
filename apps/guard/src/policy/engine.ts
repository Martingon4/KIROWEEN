import type { Policy, PolicyCall, PolicyDecision, PolicyEffect, PolicyRule } from './types.ts';

const PRIORITY: Record<PolicyEffect, number> = { deny: 3, require_approval: 2, allow: 1 };

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function conditionsMatch(rule: PolicyRule, args: Record<string, unknown>): boolean {
  const { currency, amountCents } = rule.when;
  if (currency !== undefined && args.currency !== currency) return false;
  if (amountCents !== undefined) {
    const amount = args.amountCents;
    // Non-integer, string, NaN or unsafe amounts never match any amount condition.
    if (typeof amount !== 'number' || !Number.isSafeInteger(amount)) return false;
    if (amountCents.min !== undefined && amount < amountCents.min) return false;
    if (amountCents.max !== undefined && amount > amountCents.max) return false;
  }
  return true;
}

function denyDefault(reason: string, ttlSeconds: number): PolicyDecision {
  return {
    effect: 'deny',
    ruleId: null,
    ruleName: null,
    reason,
    safePreviewFields: [],
    ttlSeconds,
  };
}

/**
 * Pure, deterministic evaluation. Exact upstream/tool match; priority deny > require_approval >
 * allow; no match means deny. Existence checks (e.g. the order exists) are the caller's duty.
 */
export function evaluate(policy: Policy, call: PolicyCall): PolicyDecision {
  const ttl = policy.approval.ttlSeconds;
  if (!isRecord(call.args)) {
    return denyDefault('Argumentos invalidos: se esperaba un objeto.', ttl);
  }
  const args = call.args;
  let best: PolicyRule | null = null;
  for (const rule of policy.rules) {
    if (rule.upstream !== call.upstream || rule.tool !== call.tool) continue;
    if (!conditionsMatch(rule, args)) continue;
    if (best === null || PRIORITY[rule.effect] > PRIORITY[best.effect]) best = rule;
  }
  if (best === null) {
    return denyDefault('Ninguna regla permite esta llamada (denegado por defecto).', ttl);
  }
  return {
    effect: best.effect,
    ruleId: best.id,
    ruleName: best.name,
    reason: best.reason,
    safePreviewFields: [...best.safePreviewFields],
    ttlSeconds: ttl,
  };
}

/** Evaluator used when the policy is invalid at startup: denies everything. */
export function blockedEvaluator(message: string): (call: PolicyCall) => PolicyDecision {
  return () => denyDefault(`Guard en modo bloqueado: ${message}`, 0);
}
