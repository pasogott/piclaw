# Compose submission shortcuts and draft safety

Classic and Visual use the same keyboard shortcuts:

- Enter submits normally; a busy chat queues a follow-up.
- Ctrl+Enter or Cmd+Enter requests steering, even if the browser has not yet received a busy-state update.
- Shift+Enter inserts a newline.

Search-mode behaviour and model/session popup pinning shortcuts remain separate. IME composition, already-handled events, repeats, and Alt combinations do not submit through the steering shortcut. Classic recognises the shortcut before mention/slash autocomplete consumes Enter. The explicit Steer button uses the same steering request in Visual.

## Starting-turn boundary

A processing lane becomes busy when work is scheduled, before its callback executes. A protected agent run is active before SDK hydration or prompting sets `isStreaming`. Admission now checks these in-memory states as well as streaming/compaction/retry activity. Passive session prewarming alone does not imply an active run.

A streaming session accepts steering through the existing SDK path. If no stream can accept the correction yet, the web handler records a durable follow-up using the existing guarded queue admission. It acknowledges that fallback as a follow-up, not as successful steering. This also covers a stream ending during delivery and a new turn starting while the request waits for storage. Pending startup input is not inserted as an ordinary row that a current turn's cursor could consume. If the chat becomes idle after the queue commit, the existing wake path resumes it.

Fallback admission preserves media IDs, content blocks, link previews and screen hints. The visible acknowledgement distinguishes “Steering queued for the current turn.” from “Follow-up queued.” The fallback waits for the normal next-turn boundary; it does not claim to alter a prompt already being hydrated.

## Preserve text when acknowledgement is unconfirmed

Both composers decode and validate an explicit acceptance result before treating the request as successful. A successful HTTP status with malformed JSON, an empty payload or an explicit rejection is not acceptance. Classic uses its existing captured-draft restoration; Visual parses the response before clearing text, attachments or history. Text entered during a pending acknowledgement remains available. Errors are visible; neither composer automatically retries uncertain submissions.

Positive queue/steer, durable-message/thread, successful control-command and UI-only acknowledgements remain compatible. A `source_committed` relay receipt takes precedence over a forwarding error; restoring that source as unsent could encourage a duplicate. Uncertain responses advise checking the timeline or queue before retrying.

This supersedes the earlier queue-only proposal in PR #1617 following Rui's clarification that Ctrl+Enter was intended to steer during a starting turn. The amendment preserves the draft-safety changes and adds startup-lane admission coverage. No provider, credential, live prompt, configuration, installation or restart changes were made.
