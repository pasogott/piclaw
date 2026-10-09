/** Ctrl/Cmd+Enter steers; Shift+Enter remains a newline. */
export function isComposeSteerShortcut(event: { key?: string; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; altKey?: boolean; isComposing?: boolean; repeat?: boolean; defaultPrevented?: boolean }): boolean {
  return event.key === 'Enter' && Boolean(event.ctrlKey || event.metaKey)
    && !event.shiftKey && !event.altKey && !event.isComposing && !event.repeat && !event.defaultPrevented;
}

export function composeSubmissionNotice(response: any): string | null {
  if (response?.queued === 'steer') return 'Steering queued for the current turn.';
  if (response?.queued === 'followup') return 'Follow-up queued.';
  return null;
}

/** A successful HTTP status alone does not prove a prompt was accepted. Never retry automatically. */
export function requireComposeAcknowledgement(response: any): void {
  // A relay may commit the source but fail forwarding. Restoring it as unsent
  // would encourage a duplicate; its explicit committed receipt is authoritative.
  if (response?.source_committed === true) return;
  if (response?.command?.status === 'error' || response?.status === 'error' || response?.error) {
    throw new Error(typeof response.error === 'string' ? response.error : response.command?.message || response.message || 'Submission was rejected. Your draft has been preserved.');
  }
  const accepted = response && typeof response === 'object' && (
    response.queued === 'followup' || response.queued === 'steer'
    || response.user_message != null
    || response.thread_id != null
    || response.command?.status === 'success'
    || response.ui_only === true
    || response.source_committed === true
  );
  if (!accepted) throw new Error('The server response did not confirm acceptance. Your draft has been preserved; check the timeline or queue before retrying.');
}
