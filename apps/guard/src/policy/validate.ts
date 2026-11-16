import type { AmountRange, Policy, PolicyEffect, PolicyRule, RuleConditions } from './types.ts';

export class PolicyValidationError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    super(`Invalid policy: ${issues.join('; ')}`);
    this.name = 'PolicyValidationError';
    this.issues = issues;
  }
}

const EFFECTS: readonly string[] = ['allow', 'require_approval', 'deny'];
const MAX_TTL_SECONDS = 86400;
const DEFAULT_TTL_SECONDS = 180;

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function unknownKeys(
  obj: Record<string, unknown>,
  allowed: string[],
  path: string,
  issues: string[],
) {
  for (const k of Object.keys(obj)) {
    if (!allowed.includes(k)) issues.push(`${path}: unknown key "${k}"`);
  }
}

function nonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function parseRange(v: unknown, path: string, issues: string[]): AmountRange | undefined {
  if (!isRecord(v)) {
    issues.push(`${path}: must be an object with min and/or max`);
    return undefined;
  }
  unknownKeys(v, ['min', 'max'], path, issues);
  const range: AmountRange = {};
  for (const key of ['min', 'max'] as const) {
    const val = v[key];
    if (val === undefined) continue;
    if (typeof val !== 'number' || !Number.isSafeInteger(val) || val < 0) {
      issues.push(`${path}.${key}: must be a non-negative integer (cents)`);
    } else {
      range[key] = val;
    }
  }
  if (range.min === undefined && range.max === undefined) {
    issues.push(`${path}: needs min or max`);
  }
  if (range.min !== undefined && range.max !== undefined && range.min > range.max) {
    issues.push(`${path}: min is greater than max`);
  }
  return range;
}

function parseWhen(v: unknown, path: string, issues: string[]): RuleConditions {
  if (v === undefined) return {};
  if (!isRecord(v)) {
    issues.push(`${path}: must be an object`);
    return {};
  }
  unknownKeys(v, ['currency', 'amountCents'], path, issues);
  const when: RuleConditions = {};
  if (v.currency !== undefined) {
    if (!nonEmptyString(v.currency)) issues.push(`${path}.currency: must be a non-empty string`);
    else when.currency = v.currency;
  }
  if (v.amountCents !== undefined) {
    const range = parseRange(v.amountCents, `${path}.amountCents`, issues);
    if (range) when.amountCents = range;
  }
  return when;
}

function parseRule(v: unknown, index: number, issues: string[]): PolicyRule | null {
  const path = `rules[${index}]`;
  if (!isRecord(v)) {
    issues.push(`${path}: must be an object`);
    return null;
  }
  unknownKeys(
    v,
    ['id', 'name', 'upstream', 'tool', 'effect', 'when', 'reason', 'safePreviewFields'],
    path,
    issues,
  );
  const before = issues.length;
  if (!nonEmptyString(v.id)) issues.push(`${path}.id: required non-empty string`);
  if (!nonEmptyString(v.upstream)) issues.push(`${path}.upstream: required non-empty string`);
  if (!nonEmptyString(v.tool)) issues.push(`${path}.tool: required non-empty string`);
  if (typeof v.effect !== 'string' || !EFFECTS.includes(v.effect)) {
    issues.push(`${path}.effect: must be one of ${EFFECTS.join(', ')}`);
  }
  if (!nonEmptyString(v.reason)) issues.push(`${path}.reason: required non-empty string`);
  if (v.name !== undefined && !nonEmptyString(v.name)) {
    issues.push(`${path}.name: must be a non-empty string`);
  }
  const fields: string[] = [];
  if (v.safePreviewFields !== undefined) {
    if (!Array.isArray(v.safePreviewFields) || !v.safePreviewFields.every(nonEmptyString)) {
      issues.push(`${path}.safePreviewFields: must be a list of non-empty strings`);
    } else {
      fields.push(...(v.safePreviewFields as string[]));
    }
  }
  const when = parseWhen(v.when, `${path}.when`, issues);
  if (issues.length > before) return null;
  return {
    id: v.id as string,
    name: typeof v.name === 'string' ? v.name : (v.id as string),
    upstream: v.upstream as string,
    tool: v.tool as string,
    effect: v.effect as PolicyEffect,
    when,
    reason: v.reason as string,
    safePreviewFields: fields,
  };
}

/** Validates a parsed policy document (e.g. from YAML). Throws PolicyValidationError. */
export function validatePolicy(input: unknown): Policy {
  const issues: string[] = [];
  if (!isRecord(input)) throw new PolicyValidationError(['policy must be an object']);
  unknownKeys(input, ['defaultEffect', 'rules', 'approval'], 'policy', issues);

  if (input.defaultEffect !== 'deny') issues.push('defaultEffect: must be "deny"');

  const rules: PolicyRule[] = [];
  if (!Array.isArray(input.rules)) {
    issues.push('rules: must be a list');
  } else {
    const seen = new Set<string>();
    input.rules.forEach((r, i) => {
      const rule = parseRule(r, i, issues);
      if (!rule) return;
      if (seen.has(rule.id)) issues.push(`rules[${i}].id: duplicate id "${rule.id}"`);
      seen.add(rule.id);
      rules.push(rule);
    });
  }

  let ttlSeconds = DEFAULT_TTL_SECONDS;
  if (input.approval !== undefined) {
    if (!isRecord(input.approval)) {
      issues.push('approval: must be an object');
    } else {
      unknownKeys(input.approval, ['ttlSeconds'], 'approval', issues);
      const t = input.approval.ttlSeconds;
      if (t !== undefined) {
        if (typeof t !== 'number' || !Number.isSafeInteger(t) || t < 1 || t > MAX_TTL_SECONDS) {
          issues.push(`approval.ttlSeconds: must be an integer between 1 and ${MAX_TTL_SECONDS}`);
        } else {
          ttlSeconds = t;
        }
      }
    }
  }

  if (issues.length > 0) throw new PolicyValidationError(issues);
  return { defaultEffect: 'deny', rules, approval: { ttlSeconds } };
}
