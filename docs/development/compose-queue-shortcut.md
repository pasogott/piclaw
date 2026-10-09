# Ctrl/Cmd+Enter queues compose input

Ctrl+Enter and Cmd+Enter explicitly submit the compose input with `mode: "queue"` in Classic and Visual. A busy agent receives a deferred follow-up; an idle target follows the backend's existing queue-mode admission rules. This shortcut does not steer the current run.

Previously, Classic mapped Ctrl/Cmd+Enter to steering while Visual treated it as ordinary Enter. The shortcut is now recognised before mention/slash autocomplete consumes Enter in Classic. Search-mode behaviour is unchanged. IME composition, handled events, repeated key events and Shift/Alt combinations do not trigger the queue shortcut. Visual's existing Shift+Enter steering and ordinary Enter behaviour remain available.

## Preserve text when acknowledgement is unconfirmed

The composers decode and validate an explicit acceptance result before treating the request as successful. A successful HTTP status with malformed JSON, an empty payload or an explicit rejection is not acceptance. Classic uses its existing captured-draft restoration; Visual now parses the response before clearing text, attachments or history. Text entered during a pending acknowledgement remains available. Errors are visible; neither composer automatically retries an uncertain submission.

Positive queue/steer, durable-message/thread, successful control-command and UI-only acknowledgements remain compatible. A `source_committed` relay receipt takes precedence over a forwarding error: restoring that source as unsent could cause a duplicate. Uncertain responses advise checking the timeline or queue before retrying.

The change does not alter server queue storage, cursor handling, steering persistence, credentials or admission authority. No live probe prompts were sent. Qualification includes shipped Classic/Visual browser entrypoints in Chromium/WebKit, busy/idle Ctrl+Enter, Cmd+Enter, handled/repeated events, delayed acknowledgement with a newer draft, malformed/empty acknowledgements and rejection recovery.
