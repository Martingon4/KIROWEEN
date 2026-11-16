import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blockedEvaluator, evaluate, PolicyValidationError, validatePolicy } from './index.ts';

const doc = {
  defaultEffect: 'deny',
  rules: [
    {
      id: 'read-order',
      upstream: 'demo-store',
      tool: 'get_order',
      effect: 'allow',
      safePreviewFields: ['orderId'],
      reason: 'Consulta de orden de solo lectura.',
    },
    {
      id: 'small-refund',
      upstream: 'demo-store',
      tool: 'issue_refund',
      effect: 'allow',
      when: { currency: 'USD', amountCents: { min: 1, max: 2500 } },
      safePreviewFields: ['orderId', 'amountCents'],
      reason: 'Reembolso pequeño.',
    },
    {
      id: 'refund-review',
      upstream: 'demo-store',
      tool: 'issue_refund',
      effect: 'require_approval',
      when: { currency: 'USD', amountCents: { min: 2501, max: 50000 } },
      reason: 'Requiere aprobación.',
    },
    {
      id: 'block-large-refund',
      upstream: 'demo-store',
      tool: 'issue_refund',
      effect: 'deny',
      when: { amountCents: { min: 50001 } },
      reason: 'Supera el límite.',
    },
    {
      id: 'email-review',
      upstream: 'demo-store',
      tool: 'send_customer_email',
      effect: 'require_approval',
      reason: 'Revisión.',
    },
  ],
  approval: { ttlSeconds: 180 },
};
const policy = validatePolicy(doc);
const refund = (amountCents: unknown, currency: unknown = 'USD') =>
  evaluate(policy, {
    upstream: 'demo-store',
    tool: 'issue_refund',
    args: { orderId: 'ORD-1042', amountCents, currency, reason: 'x' },
  });

test('A: get_order is allowed by read-order', () => {
  const d = evaluate(policy, {
    upstream: 'demo-store',
    tool: 'get_order',
    args: { orderId: 'ORD-1042' },
  });
  assert.equal(d.effect, 'allow');
  assert.equal(d.ruleId, 'read-order');
  assert.deepEqual(d.safePreviewFields, ['orderId']);
});

test('B/C/E: refunds by amount', () => {
  assert.equal(refund(1000).effect, 'allow');
  assert.equal(refund(1000).ruleId, 'small-refund');
  const c = refund(14999);
  assert.equal(c.effect, 'require_approval');
  assert.equal(c.ruleId, 'refund-review');
  assert.equal(c.ttlSeconds, 180);
  const e = refund(70000);
  assert.equal(e.effect, 'deny');
  assert.equal(e.ruleId, 'block-large-refund');
});

test('boundaries 2500/2501/50000/50001 and 1/0', () => {
  assert.equal(refund(2500).effect, 'allow');
  assert.equal(refund(2501).effect, 'require_approval');
  assert.equal(refund(50000).effect, 'require_approval');
  assert.equal(refund(50001).effect, 'deny');
  assert.equal(refund(1).effect, 'allow');
  assert.equal(refund(0).effect, 'deny');
});

test('F: unknown tool, negative, string, float, wrong currency all deny', () => {
  assert.equal(
    evaluate(policy, { upstream: 'demo-store', tool: 'delete_all', args: {} }).effect,
    'deny',
  );
  assert.equal(
    evaluate(policy, { upstream: 'other', tool: 'get_order', args: { orderId: 'a' } }).effect,
    'deny',
  );
  assert.equal(refund(-500).effect, 'deny');
  assert.equal(refund('1000').effect, 'deny');
  assert.equal(refund('99999').effect, 'deny');
  assert.equal(refund(10.5).effect, 'deny');
  assert.equal(refund(NaN).effect, 'deny');
  assert.equal(refund(undefined).effect, 'deny');
  assert.equal(refund(1000, 'EUR').effect, 'deny');
  assert.equal(refund(14999, 'EUR').effect, 'deny');
  assert.equal(refund(1000, null).effect, 'deny');
  assert.equal(refund(1000, 'usd').effect, 'deny');
  assert.equal(
    evaluate(policy, { upstream: 'demo-store', tool: 'issue_refund', args: null }).effect,
    'deny',
  );
  assert.equal(
    evaluate(policy, { upstream: 'demo-store', tool: 'issue_refund', args: [1] }).effect,
    'deny',
  );
  const d = refund(-500);
  assert.equal(d.ruleId, null);
});

test('email requires approval', () => {
  assert.equal(
    evaluate(policy, {
      upstream: 'demo-store',
      tool: 'send_customer_email',
      args: { orderId: 'o', subject: 's', body: 'b' },
    }).effect,
    'require_approval',
  );
});

test('priority deny > require_approval > allow regardless of order', () => {
  const rules = [
    { id: 'a', upstream: 'u', tool: 't', effect: 'allow', reason: 'r' },
    { id: 'b', upstream: 'u', tool: 't', effect: 'require_approval', reason: 'r' },
    { id: 'c', upstream: 'u', tool: 't', effect: 'deny', reason: 'r' },
  ];
  for (const order of [
    [0, 1, 2],
    [2, 1, 0],
    [1, 0, 2],
    [1, 2, 0],
  ]) {
    const p = validatePolicy({ defaultEffect: 'deny', rules: order.map((i) => rules[i]) });
    assert.equal(evaluate(p, { upstream: 'u', tool: 't', args: {} }).ruleId, 'c');
  }
  const p2 = validatePolicy({ defaultEffect: 'deny', rules: [rules[0], rules[1]] });
  assert.equal(evaluate(p2, { upstream: 'u', tool: 't', args: {} }).effect, 'require_approval');
});

test('exact tool match, no prefix or case tricks', () => {
  for (const tool of ['get_order ', 'GET_ORDER', 'get_orde', 'demo_store.get_order']) {
    assert.equal(
      evaluate(policy, { upstream: 'demo-store', tool, args: { orderId: 'a' } }).effect,
      'deny',
    );
  }
});

test('empty rules deny everything', () => {
  const p = validatePolicy({ defaultEffect: 'deny', rules: [] });
  assert.equal(evaluate(p, { upstream: 'demo-store', tool: 'get_order', args: {} }).effect, 'deny');
});

test('invalid policies throw PolicyValidationError', () => {
  const bad: unknown[] = [
    null,
    [],
    { rules: [] },
    { defaultEffect: 'allow', rules: [] },
    { defaultEffect: 'deny' },
    {
      defaultEffect: 'deny',
      rules: [{ id: 'a', upstream: 'u', tool: 't', effect: 'permit', reason: 'r' }],
    },
    { defaultEffect: 'deny', rules: [{ id: 'a', upstream: 'u', tool: 't', effect: 'allow' }] },
    {
      defaultEffect: 'deny',
      rules: [
        { id: 'a', upstream: 'u', tool: 't', effect: 'allow', reason: 'r' },
        { id: 'a', upstream: 'u', tool: 't', effect: 'deny', reason: 'r' },
      ],
    },
    {
      defaultEffect: 'deny',
      rules: [
        {
          id: 'a',
          upstream: 'u',
          tool: 't',
          effect: 'allow',
          reason: 'r',
          when: { amountCents: { min: 1.5 } },
        },
      ],
    },
    {
      defaultEffect: 'deny',
      rules: [
        {
          id: 'a',
          upstream: 'u',
          tool: 't',
          effect: 'allow',
          reason: 'r',
          when: { amountCents: { min: 10, max: 5 } },
        },
      ],
    },
    {
      defaultEffect: 'deny',
      rules: [
        {
          id: 'a',
          upstream: 'u',
          tool: 't',
          effect: 'allow',
          reason: 'r',
          when: { amountCents: { min: '1' } },
        },
      ],
    },
    {
      defaultEffect: 'deny',
      rules: [
        { id: 'a', upstream: 'u', tool: 't', effect: 'allow', reason: 'r', when: { other: 1 } },
      ],
    },
    {
      defaultEffect: 'deny',
      rules: [{ id: 'a', upstream: 'u', tool: 't', effect: 'allow', reason: 'r', extra: 1 }],
    },
    { defaultEffect: 'deny', rules: [], approval: { ttlSeconds: 0 } },
    { defaultEffect: 'deny', rules: [], approval: { ttlSeconds: 1.5 } },
    { defaultEffect: 'deny', rules: [], surprise: true },
  ];
  for (const b of bad)
    assert.throws(() => validatePolicy(b), PolicyValidationError, JSON.stringify(b));
});

test('blocked evaluator denies everything with a clear message', () => {
  const ev = blockedEvaluator('politica invalida');
  const d = ev({ upstream: 'demo-store', tool: 'get_order', args: { orderId: 'a' } });
  assert.equal(d.effect, 'deny');
  assert.match(d.reason, /politica invalida/);
});

test('policy objects returned are not shared with decisions', () => {
  const d = evaluate(policy, { upstream: 'demo-store', tool: 'get_order', args: { orderId: 'a' } });
  d.safePreviewFields.push('hacked');
  assert.deepEqual(
    evaluate(policy, { upstream: 'demo-store', tool: 'get_order', args: { orderId: 'a' } })
      .safePreviewFields,
    ['orderId'],
  );
});
