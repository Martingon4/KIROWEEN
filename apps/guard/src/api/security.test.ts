import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  allowedHostsFor,
  bearerValid,
  csrfValid,
  hostAllowed,
  originAllowed,
  readCookie,
  SessionStore,
} from './security.ts';
import { safeErrorSummary, sanitizeDetails } from '../audit/sanitize.ts';
import { resolvePublicName, validateToolArgs } from '../mcp/tools.ts';

test('bearer token: exact match only, empty token never matches', () => {
  assert.equal(bearerValid('Bearer abc', 'abc'), true);
  assert.equal(bearerValid('Bearer abd', 'abc'), false);
  assert.equal(bearerValid(undefined, 'abc'), false);
  assert.equal(bearerValid('Bearer ', ''), false);
  assert.equal(bearerValid('abc', 'abc'), false);
});

test('host and origin validation', () => {
  const hosts = allowedHostsFor('127.0.0.1', 3000);
  assert.equal(hostAllowed('127.0.0.1:3000', hosts), true);
  assert.equal(hostAllowed('evil.example:3000', hosts), false);
  assert.equal(hostAllowed(undefined, hosts), false);
  const origins = ['http://127.0.0.1:3000'];
  assert.equal(originAllowed(undefined, origins, true), true);
  assert.equal(originAllowed(undefined, origins, false), false);
  assert.equal(originAllowed('http://127.0.0.1:3000', origins, false), true);
  assert.equal(originAllowed('http://evil.example', origins, true), false);
});

test('sessions expire and csrf is checked', () => {
  let t = 0;
  const s = new SessionStore(() => t, 1000);
  const sess = s.create('demo-reviewer');
  assert.ok(s.get(sess.id));
  assert.equal(csrfValid(sess, sess.csrf), true);
  assert.equal(csrfValid(sess, 'nope'), false);
  assert.equal(csrfValid(sess, undefined), false);
  t = 1000;
  assert.equal(s.get(sess.id), null);
  assert.equal(s.get(undefined), null);
});

test('cookie parsing', () => {
  assert.equal(readCookie('a=1; guard_session=xyz; b=2', 'guard_session'), 'xyz');
  assert.equal(readCookie(undefined, 'x'), undefined);
});

test('sanitizeDetails drops args and redacts secrets', () => {
  const out = sanitizeDetails({
    args: { reason: 'x' },
    arguments: 1,
    headers: { authorization: 'Bearer abc' },
    note: 'token Bearer abc.def here',
    nested: { password: 'p', ok: 1 },
  });
  const text = JSON.stringify(out);
  assert.ok(!text.includes('abc.def'));
  assert.ok(!text.includes('"args"'));
  assert.ok(!text.includes('"p"'));
  assert.equal((out.nested as Record<string, unknown>).ok, 1);
});

test('safeErrorSummary strips urls and bounds length', () => {
  const s = safeErrorSummary(new Error('fail http://127.0.0.1:3001/mcp ' + 'x'.repeat(500)));
  assert.ok(!s.includes('127.0.0.1'));
  assert.ok(s.length <= 160);
});

test('tool table: exact names, no approve tool', () => {
  assert.ok(resolvePublicName('demo_store.get_order'));
  assert.equal(resolvePublicName('get_order'), null);
  assert.equal(resolvePublicName('__proto__'), null);
  assert.equal(resolvePublicName('demo_store.approve'), null);
});

test('validateToolArgs rejects wrong types and unknown fields without echoing values', () => {
  const bad = validateToolArgs('issue_refund', {
    orderId: 'A',
    amountCents: '5',
    currency: 'USD',
    reason: 'r',
    x: 1,
  });
  assert.equal(bad.ok, false);
  const good = validateToolArgs('issue_refund', {
    orderId: 'A',
    amountCents: 5,
    currency: 'USD',
    reason: 'r',
  });
  assert.equal(good.ok, true);
  assert.equal(validateToolArgs('constructor', {}).ok, false);
});

import { LoginLimiter } from './security.ts';

test('login limiter blocks after repeated failures and recovers', () => {
  let t = 0;
  const l = new LoginLimiter(() => t, 3, 1000);
  l.fail();
  l.fail();
  assert.equal(l.blocked(), false);
  l.fail();
  assert.equal(l.blocked(), true);
  t = 1500;
  assert.equal(l.blocked(), false);
});
