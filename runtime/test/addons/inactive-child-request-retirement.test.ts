import { expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = resolve(import.meta.dir, '../../src');
const retired = [
  ...['accounting', 'captured-provider', 'contracts', 'errors', 'executor', 'host', 'http', 'output', 'scope', 'validation'].map(name => `addons/child-request-${name}.ts`),
  'budget/shared-model-request-boundary.ts', 'budget/install-shared-request-boundary.ts',
];

test('unregistered child-request proxy and stream installer are absent from executable core', () => {
  for (const path of retired) expect(existsSync(resolve(source, path)), path).toBe(false);
});

test('native Delegate and captured host accounting keep their existing real owners', () => {
  const runtime = readFileSync(resolve(source, '../durable-engine/src/default-application-runtime.ts'), 'utf8');
  const accounting = readFileSync(resolve(source, '../durable-engine/src/host-request-accounting.ts'), 'utf8');
  expect(runtime).toContain('createHostDelegateTool');
  expect(accounting).toContain('modelRequestAccounting');
  for (const path of ['budget/model-request-accounting.ts', 'budget/request-cost-bound.ts', 'budget/request-reservation-admission.ts', 'db/budget-request-reservations.ts']) {
    expect(existsSync(resolve(source, path)), path).toBe(true);
  }
  expect(runtime).not.toContain('createChildRequestsApi');
  expect(runtime).not.toContain('installSharedRequestBoundary');
});
