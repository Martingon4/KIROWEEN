export type Effect = 'allow' | 'require_approval' | 'deny';

export type ActionStatus =
  | 'requested'
  | 'pending_approval'
  | 'approved'
  | 'denied'
  | 'blocked'
  | 'expired'
  | 'executed'
  | 'failed';

export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface ToolCall {
  upstream: string;
  tool: string;
  args: unknown;
}

export interface Decision {
  effect: Effect;
  ruleId: string | null;
  ruleName: string | null;
  reason: string;
  safePreviewFields: string[];
  ttlSeconds: number;
}
