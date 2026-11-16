// Runs demo-store, guard and dashboard dev servers in parallel. No third-party dependencies.
import { spawn } from 'node:child_process';

const workspaces = ['@mcp-guard/demo-store-mcp', '@mcp-guard/guard', '@mcp-guard/dashboard'];
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const children = [];
let stopping = false;

function stop(code) {
  if (stopping) return;
  stopping = true;
  for (const c of children) if (c.exitCode === null) c.kill('SIGTERM');
  setTimeout(() => process.exit(code), 500).unref();
}

for (const name of workspaces) {
  const child = spawn(npm, ['run', 'dev', '-w', name], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  child.on('exit', (code) => {
    if (!stopping)
      console.error(`[dev] ${name} termino (codigo ${code ?? 'senal'}); deteniendo el resto.`);
    stop(code ?? 1);
  });
  children.push(child);
}
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
