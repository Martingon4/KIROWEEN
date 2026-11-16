import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApprovalStore } from '../approvals/index.ts';
import { blockedEvaluator, evaluate, validatePolicy } from '../policy/index.ts';
import type { Policy } from '../policy/index.ts';
import { MemoryRepository } from '../audit/repository.ts';
import { GuardService } from './service.ts';
import type { UpstreamClient, UpstreamResult } from './service.ts';

const policy: Policy = validatePolicy({
  defaultEffect: 'deny',
  rules: [
    {
      id: 'read-order',
      upstream: 'demo-store',
      tool: 'get_order',
      effect: 'allow',
      safePreviewFields: ['orderId'],
      reason: 'lectura',
    },
    {
      id: 'small-refund',
      upstream: 'demo-store',
      tool: 'issue_refund',
      effect: 'allow',
      when: { currency: 'USD', amountCents: { min: 1, max: 2500 } },
      safePreviewFields: ['orderId', 'amountCents', 'currency'],
      reason: 'pequeno',
    },
    {
      id: 'refund-review',
      upstream: 'demo-store',
      tool: 'issue_refund',
      effect: 'require_approval',
      when: { currency: 'USD', amountCents: { min: 2501, max: 50000 } },
      safePreviewFields: ['orderId', 'amountCents', 'currency'],
      reason: 'revision',
    },
    {
      id: 'block-large-refund',
      upstream: 'demo-store',
      tool: 'issue_refund',
      effect: 'deny',
      when: { amountCents: { min: 50001 } },
      safePreviewFields: ['orderId'],
      reason: 'limite',
    },
  ],
  approval: { ttlSeconds: 180 },
});

class FakeUpstream implements UpstreamClient {
  calls: Array<{ tool: string; args: Record<string, unknown> }> = [];
  down = false;
  knownOrders = new Set(['ORD-1042']);
  async callTool(tool: string, args: Record<string, unknown>): Promise<UpstreamResult> {
    if (this.down) throw new Error('connect ECONNREFUSED http://127.0.0.1:3001/mcp');
    this.calls.push({ tool, args });
    if (tool === 'get_order' && !this.knownOrders.has(String(args.orderId))) {
      return { isError: true, content: [{ type: 'text', text: '{"code":"order_not_found"}' }] };
    }
    return { isError: false, content: [{ type: 'text', text: '{"ok":true}' }] };
  }
}

function setup(evalFn = (c: Parameters<typeof evaluate>[1]) => evaluate(policy, c)) {
  let t = 1_000_000;
  const clock = { advance: (ms: number) => (t += ms) };
  const upstream = new FakeUpstream();
  const repo = new MemoryRepository();
  const store = new ApprovalStore({ now: () => t });
  const svc = new GuardService({ evaluate: evalFn, store, repo, upstream, now: () => t });
  return { svc, upstream, repo, store, clock };
}

const refund = (amountCents: unknown, extra: Record<string, unknown> = {}) => ({
  orderId: 'ORD-1042',
  amountCents,
  currency: 'USD',
  reason: 'prueba',
  ...extra,
});

test('A: get_order is allowed and executed', async () => {
  const { svc, upstream } = setup();
  const out = await svc.handleToolCall('demo_store.get_order', { orderId: 'ORD-1042' });
  assert.equal(out.status, 'executed');
  assert.equal(upstream.calls.length, 1);
});

test('B: small refund checks the order then executes', async () => {
  const { svc, upstream } = setup();
  const out = await svc.handleToolCall('demo_store.issue_refund', refund(1000));
  assert.equal(out.status, 'executed');
  assert.deepEqual(
    upstream.calls.map((c) => c.tool),
    ['get_order', 'issue_refund'],
  );
});

test('small refund for a missing order is blocked and never reaches issue_refund', async () => {
  const { svc, upstream } = setup();
  const out = await svc.handleToolCall(
    'demo_store.issue_refund',
    refund(1000, { orderId: 'ORD-0000' }),
  );
  assert.equal(out.status, 'blocked');
  assert.deepEqual(
    upstream.calls.map((c) => c.tool),
    ['get_order'],
  );
});

test('C: 149.99 is pending, upstream untouched, approve executes exactly once', async () => {
  const { svc, upstream } = setup();
  const out = await svc.handleToolCall('demo_store.issue_refund', refund(14999));
  assert.equal(out.status, 'pending_approval');
  assert.ok(out.requestId);
  assert.equal(upstream.calls.length, 0);
  const id = out.requestId as string;
  const a = await svc.approve(id, 'demo-reviewer');
  assert.ok(a.ok);
  assert.equal(a.request.status, 'executed');
  assert.equal(a.request.approvedBy, 'demo-reviewer');
  assert.equal(upstream.calls.filter((c) => c.tool === 'issue_refund').length, 1);
  const again = await svc.approve(id, 'demo-reviewer');
  assert.equal(again.ok, false);
  assert.equal(upstream.calls.filter((c) => c.tool === 'issue_refund').length, 1);
  const st = await svc.getActionStatus(id);
  assert.equal(st.status, 'executed');
});

test('D: deny never calls upstream', async () => {
  const { svc, upstream } = setup();
  const out = await svc.handleToolCall('demo_store.issue_refund', refund(14999));
  const d = await svc.deny(out.requestId as string, 'demo-reviewer');
  assert.ok(d.ok);
  assert.equal(d.request.status, 'denied');
  assert.equal(upstream.calls.length, 0);
  assert.equal((await svc.approve(out.requestId as string, 'x')).ok, false);
});

test('E: 700.00 is blocked before upstream', async () => {
  const { svc, upstream } = setup();
  const out = await svc.handleToolCall('demo_store.issue_refund', refund(70000));
  assert.equal(out.status, 'blocked');
  assert.equal(out.isError, true);
  assert.equal(upstream.calls.length, 0);
});

test('F: unknown tool, negative, wrong type, EUR, extra field are all blocked without upstream', async () => {
  const { svc, upstream } = setup();
  const cases: Array<[string, unknown]> = [
    ['demo_store.delete_everything', {}],
    ['demo_store.issue_refund', refund(-100)],
    ['demo_store.issue_refund', refund('1000')],
    ['demo_store.issue_refund', refund(10.5)],
    ['demo_store.issue_refund', { ...refund(1000), currency: 'EUR' }],
    ['demo_store.issue_refund', refund(1000, { sneaky: true })],
    ['demo_store.get_order', null],
  ];
  for (const [name, args] of cases) {
    const out = await svc.handleToolCall(name, args);
    assert.equal(out.status, 'blocked', name + JSON.stringify(args));
  }
  assert.equal(upstream.calls.length, 0);
});

test('expired pending cannot be approved and does not execute', async () => {
  const { svc, upstream, clock } = setup();
  const out = await svc.handleToolCall('demo_store.issue_refund', refund(14999));
  clock.advance(181_000);
  const a = await svc.approve(out.requestId as string, 'demo-reviewer');
  assert.equal(a.ok, false);
  assert.equal(upstream.calls.length, 0);
  assert.equal((await svc.getActionStatus(out.requestId)).status, 'expired');
});

test('upstream down on allow reports failure, never success', async () => {
  const { svc, upstream } = setup();
  upstream.down = true;
  const out = await svc.handleToolCall('demo_store.get_order', { orderId: 'ORD-1042' });
  assert.equal(out.status, 'failed');
  assert.equal(out.isError, true);
  assert.ok(!out.message.includes('127.0.0.1'));
});

test('upstream down on approval marks failed, not executed', async () => {
  const { svc, upstream } = setup();
  const out = await svc.handleToolCall('demo_store.issue_refund', refund(14999));
  upstream.down = true;
  const a = await svc.approve(out.requestId as string, 'demo-reviewer');
  assert.ok(a.ok);
  assert.equal(a.request.status, 'failed');
});

test('blocked evaluator denies everything including reads', async () => {
  const { svc, upstream } = setup(blockedEvaluator('politica invalida'));
  const out = await svc.handleToolCall('demo_store.get_order', { orderId: 'ORD-1042' });
  assert.equal(out.status, 'blocked');
  assert.equal(upstream.calls.length, 0);
});

test('persisted data never contains original arguments', async () => {
  const { svc, repo } = setup();
  const secretReason = 'SECRETO-NO-GUARDAR-123';
  const out = await svc.handleToolCall(
    'demo_store.issue_refund',
    refund(14999, { reason: secretReason }),
  );
  await svc.approve(out.requestId as string, 'demo-reviewer');
  const all = await repo.listRequests({});
  const events = await repo.listEvents(out.requestId as string);
  const dump = JSON.stringify([all, events]);
  assert.ok(!dump.includes(secretReason));
  assert.ok(events.length >= 3);
});

test('startup expires stale pending rows', async () => {
  const { svc, repo } = setup();
  const out = await svc.handleToolCall('demo_store.issue_refund', refund(14999));
  const fresh = new GuardService({
    evaluate: (c) => evaluate(policy, c),
    store: new ApprovalStore(),
    repo,
    upstream: new FakeUpstream(),
  });
  assert.equal(await fresh.expireOnStartup(), 1);
  assert.equal((await fresh.getActionStatus(out.requestId)).status, 'expired');
  assert.equal((await fresh.approve(out.requestId as string, 'x')).ok, false);
});

test('getActionStatus rejects malformed ids and exposes no arguments', async () => {
  const { svc } = setup();
  assert.equal((await svc.getActionStatus('../etc')).isError, true);
  const out = await svc.handleToolCall(
    'demo_store.issue_refund',
    refund(14999, { reason: 'ZZZ-ARG' }),
  );
  assert.ok(!JSON.stringify(await svc.getActionStatus(out.requestId)).includes('ZZZ-ARG'));
});
