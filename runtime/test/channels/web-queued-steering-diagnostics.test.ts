import { expect, test } from 'bun:test';
import { queuedSteeringRejectionReason } from '../../src/channels/web/agent/queued-steering-diagnostics.js';

test('queued steering diagnostics reports only allowlisted rejection categories', () => {
  expect(queuedSteeringRejectionReason(new Error('No active host operation'))).toBe('no_active_operation');
  expect(queuedSteeringRejectionReason(new Error('Host harness binding conflict'))).toBe('binding_conflict');
  expect(queuedSteeringRejectionReason(new Error('Unknown recovered candidate authority'))).toBe('unknown_candidate_authority');
  expect(queuedSteeringRejectionReason({ _tag: 'version_mismatch', conflictingOperationId: 'private' })).toBe('version_mismatch');
  expect(queuedSteeringRejectionReason({ _tag: 'storage_unavailable', details: 'private' })).toBe('storage_unavailable');
});

test('queued steering diagnostics never returns arbitrary exception, payload or provider text', () => {
  const secret = 'PRIVATE_MESSAGE_PROVIDER_HEADER_REASONING';
  for (const error of [new Error(secret), { _tag: secret }, { content: secret }, secret, null, undefined]) {
    expect(queuedSteeringRejectionReason(error)).toBe('unclassified');
  }
  expect(queuedSteeringRejectionReason(Object.defineProperty({}, '_tag', {
    get() { throw Error('Private getter must not execute'); },
  }))).toBe('unclassified');
});
