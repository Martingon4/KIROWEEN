import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPreview,
  canonicalJson,
  formatMoney,
  hashCall,
  isCents,
  parseDecimalToCents,
  redact,
} from './index.ts';

test('canonicalJson sorts keys recursively and is whitespace free', () => {
  assert.equal(
    canonicalJson({ b: 1, a: { d: [2, { z: 1, y: 2 }], c: null } }),
    '{"a":{"c":null,"d":[2,{"y":2,"z":1}]},"b":1}',
  );
});

test('canonicalJson rejects undefined, NaN, bigint and class instances', () => {
  assert.throws(() => canonicalJson({ a: undefined }));
  assert.throws(() => canonicalJson({ a: NaN }));
  assert.throws(() => canonicalJson({ a: 1n }));
  assert.throws(() => canonicalJson(new Date()));
});

test('hashCall is order independent and changes with tool, upstream or args', () => {
  const base = {
    upstream: 'demo-store',
    tool: 'issue_refund',
    args: { orderId: 'ORD-1', amountCents: 14999 },
  };
  const h = hashCall(base);
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(hashCall({ ...base, args: { amountCents: 14999, orderId: 'ORD-1' } }), h);
  assert.notEqual(hashCall({ ...base, tool: 'get_order' }), h);
  assert.notEqual(hashCall({ ...base, upstream: 'other' }), h);
  assert.notEqual(hashCall({ ...base, args: { orderId: 'ORD-1', amountCents: 14998 } }), h);
});

test('redact masks sensitive keys at any depth, case insensitive', () => {
  const out = redact({
    orderId: 'ORD-1',
    Authorization: 'Bearer abc',
    nested: {
      apiToken: 'x',
      list: [{ cardNumber: '4111' }, { ok: 1 }],
      PASSWORD: 'p',
      credentials: 'c',
      client_secret: 's',
    },
  });
  const text = JSON.stringify(out);
  for (const leak of ['Bearer abc', '"x"', '4111', '"p"', '"c"', '"s"'])
    assert.ok(!text.includes(leak), leak);
  assert.equal((out as { orderId: string }).orderId, 'ORD-1');
  assert.equal(text.split('[REDACTED]').length - 1, 6);
});

test('buildPreview only exposes safe fields and redacts them', () => {
  const p = buildPreview(
    { orderId: 'ORD-1', amountCents: 5, body: 'long private text', token: 't' },
    ['orderId', 'amountCents', 'token', 'missing'],
  );
  assert.deepEqual(p, { orderId: 'ORD-1', amountCents: 5, token: '[REDACTED]' });
  assert.deepEqual(buildPreview('nope', ['a']), {});
});

test('money helpers use integer cents', () => {
  assert.equal(formatMoney(14999, 'USD'), 'USD 149.99');
  assert.equal(formatMoney(5, 'USD'), 'USD 0.05');
  assert.equal(parseDecimalToCents('149.99'), 14999);
  assert.equal(parseDecimalToCents('10'), 1000);
  assert.equal(parseDecimalToCents('10.5'), 1050);
  assert.equal(parseDecimalToCents('-1'), null);
  assert.equal(isCents(10.5), false);
  assert.equal(isCents('100'), false);
  assert.equal(isCents(100), true);
  assert.throws(() => formatMoney(1.5, 'USD'));
});
