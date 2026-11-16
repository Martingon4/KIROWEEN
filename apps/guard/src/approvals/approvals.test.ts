import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApprovalStore } from './index.ts';
import { buildPreview } from '../../../../packages/shared/src/redact.ts';
import { hashCall } from '../../../../packages/shared/src/canonical.ts';

function setup(ttl = 180) {
  let t = 1_000_000;
  let n = 0;
  const store = new ApprovalStore({ now: () => t, newId: () => `id${++n}` });
  const args = {
    orderId: 'ORD-1042',
    amountCents: 14999,
    currency: 'USD',
    reason: 'dañado',
    apiToken: 'SECRET-TOKEN',
  };
  const rec = store.createPending({
    upstream: 'demo-store',
    tool: 'issue_refund',
    args,
    ruleId: 'refund-review',
    reason: 'Requiere aprobación.',
    preview: buildPreview(args, ['orderId', 'amountCents', 'currency']),
    ttlSeconds: ttl,
  });
  return { store, rec, args, advance: (s: number) => (t += s * 1000) };
}

test('create stores hash and sanitized view only', () => {
  const { store, rec, args } = setup();
  assert.equal(rec.status, 'pending_approval');
  assert.equal(rec.argumentHash, hashCall({ upstream: 'demo-store', tool: 'issue_refund', args }));
  assert.equal(rec.expiresAt - rec.requestedAt, 180_000);
  assert.equal(store.listPending().length, 1);
});

test('no plaintext args in anything serializable', () => {
  const { store, rec } = setup();
  const dump = JSON.stringify([rec, store.get(rec.id), store.list(), store.listPending()]);
  assert.ok(!dump.includes('SECRET-TOKEN'));
  assert.ok(!dump.includes('dañado'));
  assert.ok(!dump.includes('apiToken'));
  assert.ok(dump.includes('ORD-1042'));
  assert.ok(!JSON.stringify(store).includes('SECRET-TOKEN'));
});

test('approve returns the exact stored call once; replay is rejected', () => {
  const { store, rec } = setup();
  const r = store.approve(rec.id, 'reviewer-demo');
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.call.tool, 'issue_refund');
  assert.equal((r.call.args as { amountCents: number }).amountCents, 14999);
  assert.equal(r.record.status, 'approved');
  assert.equal(r.record.decidedBy, 'reviewer-demo');
  assert.equal(store.hasPayload(rec.id), false);
  const again = store.approve(rec.id, 'reviewer-demo');
  assert.deepEqual([again.ok, again.ok ? null : again.error], [false, 'not_pending']);
  assert.equal(store.deny(rec.id, 'x').ok, false);
  assert.ok(store.markExecuted(rec.id, 'refund RF-1').ok);
  assert.equal(store.get(rec.id)?.status, 'executed');
  assert.equal(store.approve(rec.id, 'a').ok, false);
  assert.equal(store.markExecuted(rec.id, 'again').ok, false);
});

test('concurrent double approve executes once', () => {
  const { store, rec } = setup();
  const results = [store.approve(rec.id, 'a'), store.approve(rec.id, 'b')];
  assert.equal(results.filter((r) => r.ok).length, 1);
});

test('mutating the caller args after create does not change the stored call', () => {
  const { store, rec, args } = setup();
  args.amountCents = 1;
  const r = store.approve(rec.id, 'a');
  assert.ok(r.ok);
  if (r.ok) assert.equal((r.call.args as { amountCents: number }).amountCents, 14999);
});

test('stored call is frozen so the executor cannot tamper before use', () => {
  const { store, rec } = setup();
  const r = store.approve(rec.id, 'a');
  assert.ok(r.ok);
  if (r.ok)
    assert.throws(() => {
      (r.call.args as { amountCents: number }).amountCents = 1;
    }, TypeError);
});

test('hash presented by reviewer must match the call (tampered args)', () => {
  const { store, rec } = setup();
  const tampered = hashCall({
    upstream: 'demo-store',
    tool: 'issue_refund',
    args: { orderId: 'ORD-1042', amountCents: 1, currency: 'USD' },
  });
  const bad = store.approve(rec.id, 'a', tampered);
  assert.deepEqual([bad.ok, bad.ok ? null : bad.error], [false, 'hash_mismatch']);
  assert.equal(store.get(rec.id)?.status, 'pending_approval');
  const good = store.approve(rec.id, 'a', rec.argumentHash);
  assert.ok(good.ok);
});

test('different tool for same args yields different hash and is not approvable by it', () => {
  const { store, rec } = setup();
  const other = hashCall({ upstream: 'demo-store', tool: 'send_customer_email', args: {} });
  assert.equal(store.approve(rec.id, 'a', other).ok, false);
});

test('expired requests cannot be approved or denied and drop their payload', () => {
  const { store, rec, advance } = setup(60);
  advance(60);
  const r = store.approve(rec.id, 'a');
  assert.deepEqual([r.ok, r.ok ? null : r.error], [false, 'expired']);
  assert.equal(store.get(rec.id)?.status, 'expired');
  assert.equal(store.hasPayload(rec.id), false);
  assert.equal(store.deny(rec.id, 'a').ok, false);
});

test('just before expiry still approvable', () => {
  const { store, rec, advance } = setup(60);
  advance(59);
  assert.ok(store.approve(rec.id, 'a').ok);
});

test('deny consumes the payload and never yields a call', () => {
  const { store, rec } = setup();
  const d = store.deny(rec.id, 'reviewer-demo');
  assert.ok(d.ok);
  assert.equal(store.get(rec.id)?.status, 'denied');
  assert.equal(store.hasPayload(rec.id), false);
  assert.equal(store.approve(rec.id, 'a').ok, false);
});

test('upstream failure ends as failed, not executed', () => {
  const { store, rec } = setup();
  assert.ok(store.approve(rec.id, 'a').ok);
  assert.ok(store.markFailed(rec.id, 'upstream_error', 'timeout').ok);
  const r = store.get(rec.id);
  assert.equal(r?.status, 'failed');
  assert.equal(r?.errorCode, 'upstream_error');
});

test('markExecuted before approval is rejected', () => {
  const { store, rec } = setup();
  const r = store.markExecuted(rec.id, 'x');
  assert.deepEqual([r.ok, r.ok ? null : r.error], [false, 'not_approved']);
});

test('expireAll (startup) expires all pending and wipes payloads', () => {
  const { store, rec } = setup();
  assert.equal(store.expireAll(), 1);
  assert.equal(store.get(rec.id)?.status, 'expired');
  assert.equal(store.approve(rec.id, 'a').ok, false);
  assert.equal(store.listPending().length, 0);
});

test('sweep expires due requests only', () => {
  const { store, rec, advance } = setup(10);
  advance(5);
  assert.deepEqual(store.sweep(), []);
  advance(5);
  assert.deepEqual(store.sweep(), [rec.id]);
});

test('unknown id and invalid ttl', () => {
  const { store } = setup();
  const r = store.approve('nope', 'a');
  assert.deepEqual([r.ok, r.ok ? null : r.error], [false, 'not_found']);
  assert.throws(() =>
    store.createPending({
      upstream: 'u',
      tool: 't',
      args: {},
      ruleId: null,
      reason: '',
      preview: {},
      ttlSeconds: 0,
    }),
  );
});

test('returned records are copies; mutating them does not change store state', () => {
  const { store, rec } = setup();
  rec.status = 'executed';
  rec.preview.orderId = 'HACK';
  assert.equal(store.get(rec.id)?.status, 'pending_approval');
  assert.equal(store.get(rec.id)?.preview.orderId, 'ORD-1042');
});
