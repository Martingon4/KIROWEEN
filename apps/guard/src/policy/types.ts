export type PolicyEffect = 'allow' | 'require_approval' | 'deny';

export interface AmountRange {
  min?: number;
  max?: number;
}

export interface RuleConditions {
  currency?: string;
  amountCents?: AmountRange;
}

export interface PolicyRule {
  id: string;
  name: string;
  upstream: string;
  tool: string;
  effect: PolicyEffect;
  when: RuleConditions;
  reason: string;
  safePreviewFields: string[];
}

export interface Policy {
  defaultEffect: 'deny';
  rules: PolicyRule[];
  approval: { ttlSeconds: number };
}

export interface PolicyDecision {
  effect: PolicyEffect;
  ruleId: string | null;
  ruleName: string | null;
  reason: string;
  safePreviewFields: string[];
  ttlSeconds: number;
}

export interface PolicyCall {
  upstream: string;
  tool: string;
  args: unknown;
}
