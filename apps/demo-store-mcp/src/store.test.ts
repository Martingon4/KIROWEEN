import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DemoStore } from './store.ts';

test('seed contains ORD-1042 with 14999 USD cents', () => {
  const s = new DemoStore();
  const r = s.getOrder('ORD-1042');
  assert.ok(r.ok);
  assert.equal(r.value.totalCents, 14999);
  assert.equal(r.value.currency, 'USD');
});

test('unknown order is reported, not invented', () => {
  const s = new DemoStore();
  const r = s.getOrder('ORD-9999');
  assert.equal(r.ok, false);
});

test('refund is recorded exactly once per call and reset restores the seed', () => {
  const s = new DemoStore();
  const r = s.issueRefund('ORD-1042', 1000, 'USD', 'prueba');
  assert.ok(r.ok);
  assert.equal(s.listRefunds().length, 1);
  s.reset();
  assert.equal(s.listRefunds().length, 0);
});

test('invalid refunds are rejected without side effects', () => {
  const s = new DemoStore();
  assert.equal(s.issueRefund('ORD-1042', -5, 'USD', 'x').ok, false);
  assert.equal(s.issueRefund('ORD-1042', 10.5, 'USD', 'x').ok, false);
  assert.equal(s.issueRefund('ORD-1042', 100, 'EUR', 'x').ok, false);
  assert.equal(s.issueRefund('ORD-1043', 4501, 'USD', 'x').ok, false);
  assert.equal(s.issueRefund('NOPE', 100, 'USD', 'x').ok, false);
  assert.equal(s.listRefunds().length, 0);
});

test('email is simulated and never sent', () => {
  const s = new DemoStore();
  const r = s.sendCustomerEmail('ORD-1042', 'Hola', 'Cuerpo');
  assert.ok(r.ok);
  assert.equal(r.value.status, 'simulated_not_sent');
  assert.equal(s.listEmails().length, 1);
});
