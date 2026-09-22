import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

function importWebServerInChild() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '--eval', "await import('./apps/web/server.js')"], {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('web server module kept the child event loop alive'));
    }, 10_000);
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timeout);
      if (signal) return reject(new Error(`child exited by ${signal}`));
      resolve({ code, stderr });
    });
  });
}

test('importing the web server does not retain the Node event loop', async () => {
  const result = await importWebServerInChild();
  assert.equal(result.code, 0, result.stderr);
});
