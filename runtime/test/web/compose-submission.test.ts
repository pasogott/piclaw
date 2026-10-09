import { expect, test } from 'bun:test';
import { isComposeQueueShortcut, requireComposeAcknowledgement } from '../../web/src/ui/compose-submission.js';

test('Ctrl and Cmd Enter explicitly queue, preserving newline/IME/handled/repeated events', () => {
  expect(isComposeQueueShortcut({ key: 'Enter', ctrlKey: true })).toBe(true);
  expect(isComposeQueueShortcut({ key: 'Enter', metaKey: true })).toBe(true);
  for (const patch of [{ shiftKey: true }, { altKey: true }, { isComposing: true }, { repeat: true }, { defaultPrevented: true }, { key: 'a' }]) {
    expect(isComposeQueueShortcut({ key: 'Enter', ctrlKey: true, ...patch })).toBe(false);
  }
  expect(isComposeQueueShortcut({ key: 'Enter' })).toBe(false);
});
test('queue/steer/durable message and explicit control outcomes confirm acceptance', () => {
  for (const response of [{ queued: 'followup' }, { queued: 'steer' }, { thread_id: 10 }, { user_message: { id: 10 } }, { command: { status: 'success' } }, { ui_only: true }, { source_committed: true }]) {
    expect(() => requireComposeAcknowledgement(response)).not.toThrow();
  }
});
test('committed relay-source receipt is retained even when forwarding fails', () => {
  expect(() => requireComposeAcknowledgement({ source_committed: true, relayed: false, error: 'Forwarding unavailable' })).not.toThrow();
});
test('empty or rejected successful HTTP payloads do not silently consume a draft', () => {
  for (const response of [null, {}, { status: 'error' }, { error: 'Rejected' }, { command: { status: 'error', message: 'Rejected' } }]) {
    expect(() => requireComposeAcknowledgement(response)).toThrow();
  }
});
