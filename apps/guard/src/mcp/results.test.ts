import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toToolResult } from './results.ts';
import { STATUS_TOOL, TOOL_TABLE } from './tools.ts';

test('pending outcome is a non-error result carrying requestId', () => {
  const r = toToolResult({
    isError: false,
    status: 'pending_approval',
    requestId: 'abc',
    message: 'm',
  });
  assert.equal(r.isError, false);
  assert.match(r.content[0]?.text ?? '', /"requestId":"abc"/);
  assert.match(r.content[0]?.text ?? '', /pending_approval/);
});

test('blocked outcome is an error result', () => {
  assert.equal(
    toToolResult({ isError: true, status: 'blocked', requestId: 'x', message: 'm' }).isError,
    true,
  );
});

test('executed passthrough keeps only text items', () => {
  const r = toToolResult({
    isError: false,
    status: 'executed',
    requestId: 'x',
    message: 'ok',
    content: [
      { type: 'text', text: 'hola' },
      { type: 'resource_link', uri: 'file:///etc/passwd' },
    ],
  });
  assert.equal(r.content.length, 1);
});

test('no tool exposed to the agent can approve', () => {
  const names = [...TOOL_TABLE.map((t) => t.publicName), STATUS_TOOL];
  assert.ok(names.every((n) => !/approv|deny|reject/i.test(n.replace('get_action_status', ''))));
});
