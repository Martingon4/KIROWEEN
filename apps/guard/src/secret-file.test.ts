import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { readSecretFile } from './secret-file.ts';

function tmp(content: string, mode: number): string {
  const p = join(mkdtempSync(join(tmpdir(), 'guard-secret-')), 'admin-secret');
  writeFileSync(p, content);
  chmodSync(p, mode);
  return p;
}

test('reads and trims a private secret file', () => {
  assert.equal(readSecretFile(tmp('a'.repeat(32) + '\n', 0o600), 'linux'), 'a'.repeat(32));
});

test('rejects group/world readable files, short secrets and the example value', () => {
  assert.throws(() => readSecretFile(tmp('a'.repeat(32), 0o644), 'linux'), /600/);
  assert.throws(() => readSecretFile(tmp('short', 0o600), 'linux'), /corto/);
  assert.throws(() => readSecretFile(tmp('change-me', 0o600), 'linux'), /corto/);
});
