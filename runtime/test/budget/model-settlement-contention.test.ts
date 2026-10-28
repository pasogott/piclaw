import { expect, test } from 'bun:test';
import { createTempWorkspace } from '../helpers.js';

test('terminal accounting yields to a WAL writer without replaying provider work or SQL callbacks', async () => {
  const entry = new URL('../fixtures/model-settlement-contention-disk.ts', import.meta.url).pathname;
  const launcher = new URL('../../scripts/local-test-priority.ts', import.meta.url).pathname;
  const workspace = createTempWorkspace('model-settlement-contention-');
  const child = Bun.spawn([process.execPath, '--no-env-file', launcher, '--', '--env', 'PICLAW_DB_IN_MEMORY=0', '--env', `PICLAW_WORKSPACE=${workspace.workspace}`, '--env', `PICLAW_STORE=${workspace.store}`, '--env', `PICLAW_DATA=${workspace.data}`, '--', process.execPath, '--no-env-file', entry], { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
  const timer = setTimeout(() => child.kill('SIGKILL'), 12000);
  try {
    const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect(exit, stderr).toBe(0);
    expect(JSON.parse(stdout.trim().split('\n').at(-1)!)).toEqual({ settledAfterRelease: true, cancelledUsageSettled: true, snapshotPreserved: true, oneCharge: true, abandonedAfterRelease: true, noCallbackReplay: true, busyTimeoutRestored: true });
  } finally {
    clearTimeout(timer); if (child.exitCode === null) child.kill('SIGKILL'); await child.exited; workspace.cleanup();
  }
}, 15000);
