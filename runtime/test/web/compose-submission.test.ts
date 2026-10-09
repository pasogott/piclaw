import { expect, test } from 'bun:test';
import { isComposeSteerShortcut, requireComposeAcknowledgement, composeSubmissionNotice } from '../../web/src/ui/compose-submission.js';

test('Ctrl and Cmd Enter explicitly steer, preserving newline/IME/handled/repeated events', () => {
  expect(isComposeSteerShortcut({ key: 'Enter', ctrlKey: true })).toBe(true);
  expect(isComposeSteerShortcut({ key: 'Enter', metaKey: true })).toBe(true);
  for (const patch of [{ shiftKey: true }, { altKey: true }, { isComposing: true }, { repeat: true }, { defaultPrevented: true }, { key: 'a' }]) {
    expect(isComposeSteerShortcut({ key: 'Enter', ctrlKey: true, ...patch })).toBe(false);
  }
  expect(isComposeSteerShortcut({ key: 'Enter' })).toBe(false);
});
test('acknowledgement notice distinguishes steering from a safe follow-up fallback', () => {
  expect(composeSubmissionNotice({queued:'steer'})).toBe('Steering queued for the current turn.');
  expect(composeSubmissionNotice({queued:'followup'})).toBe('Follow-up queued.');
  expect(composeSubmissionNotice({thread_id:1})).toBeNull();
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
