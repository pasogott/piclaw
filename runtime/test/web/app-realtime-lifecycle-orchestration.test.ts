import { expect, test } from 'bun:test';

import { resolveBackstopIntervalMs, shouldInvalidateAgentStatusSnapshot } from '../../web/src/ui/app-realtime-lifecycle-orchestration.js';

test('resolveBackstopIntervalMs uses fast polling while agent is active', () => {
  expect(resolveBackstopIntervalMs(true)).toBe(15000);
});

test('resolveBackstopIntervalMs uses slower polling while agent is idle', () => {
  expect(resolveBackstopIntervalMs(false)).toBe(60000);
});

 test("opening and terminal statuses both invalidate cached Idle snapshots", () => {
 for (const event of ["agent_status","connected","model_changed"]) expect(shouldInvalidateAgentStatusSnapshot(event)).toBe(true);
 for (const event of ["agent_thought_delta","agent_draft_delta","profile_update"]) expect(shouldInvalidateAgentStatusSnapshot(event)).toBe(false);
});
