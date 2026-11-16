// NOT COMPILED IN SANDBOX: depends on the "yaml" package.
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { blockedEvaluator, evaluate, validatePolicy } from './index.ts';
import type { Policy, PolicyCall, PolicyDecision } from './index.ts';

export interface LoadedPolicy {
  /** null when the policy is invalid: Guard then runs in blocked mode and denies everything. */
  policy: Policy | null;
  evaluate: (call: PolicyCall) => PolicyDecision;
  mode: 'active' | 'blocked';
  error: string | null;
}

export function loadPolicyFile(file: string): LoadedPolicy {
  try {
    const parsed: unknown = parse(readFileSync(file, 'utf8'));
    const policy = validatePolicy(parsed);
    return { policy, evaluate: (call) => evaluate(policy, call), mode: 'active', error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { policy: null, evaluate: blockedEvaluator(message), mode: 'blocked', error: message };
  }
}
