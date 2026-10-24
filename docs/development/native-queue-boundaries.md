# Native queue ownership

Native web input uses host-accepted sources and native intents. AgentPool and its runtime facade expose no `queueStreamingMessage` or `removeQueuedFollowupMessage` API. Web handlers cannot prompt, clear or replay an SDK queue, and do not invoke context-pressure retry for queue delivery.

## Admission and delivery

The explicit backend contract is `AgentPool.isDurableRuntime()`. Native ordinary input requires source selectors, atomic message/queue admission and the steering selector before queue or timeline writes. Optional input-text preparation may transform content and attach a lifetime fence; its presence does not select the backend. Missing or revoked admission authority rejects the request without queue/timeline publication or SDK session creation.

- `/queue <text>` creates deferred accepted input, including while idle. It does not wake itself when a running turn ends during admission.
- `/steer <text>` and compose steering use the same accepted-source path. During a running binding, the captured host port attaches that exact source to the operation. A binding ending after admission leaves the source queued for FIFO delivery.
- Web `/queue-all` is unsupported. Individual input remains ordered by operation settlement.
- The historical `persist_steer` body/header cannot select an SDK delivery path. Native steering materialises one user message with the original source ID, content, media, metadata and selected thread. A null thread self-roots at materialisation; it is never changed to a guessed active legacy thread.
- Steering replies include the materialised `user_message` and its thread. `steering_delivery: pending` records accepted intent, with provider placement and execution still asynchronous.

Lost acknowledgements and before-submit failures reconcile the same committed native intent. Publication failure does not revoke accepted input. No consumed queue row is restored for a replacement SDK submission.

## Queue actions

Queue-item steering requires both `source_accepted` and `source_id`. Manual or historical unaccepted deferred/placeholder rows return409 unchanged. They remain visible, individually removable and eligible for normal FIFO materialisation/admission. Steering does not silently adopt or remove/resubmit their text.

Explicit DELETE uses the existing immediate transaction: reread the exact item, invoke the synchronous host withdrawal compare-and-swap, then remove queue/timeline projection. Missing, fenced, asynchronous or failed withdrawal rolls the transaction back. Other queued inputs retain their identity and order. Placeholder removal uses the exact row; SDK content matching is retired.

Drain preflights its selected rows and rejects protected accepted input before deletion. It supplies no accepted-source withdrawal callback.

## Callers and retained compatibility

`enqueueAgentMessage` captures and calls the real web input handler. A missing handler rejects before storage, queueing or publication. The handler-less SDK/storage fallback is retired.

Native facade queue control commands return an explicit input-admission error before session lookup, revocation or command protection. The separate public session-level handlers in `agent-control/handlers/queue.ts` remain for legacy/non-web control dispatch. They are outside the native queue interface; the broader composition/legacy-stack cleanup is tracked by #1672/#1673.

The old SDK replay audit and wrapper have no supported current caller. Their original bytes are retained as [non-executable historical text](../archive/legacy-queue-audit/README.md). Historical reports are preserved.

## Focused verification

Focused tests cover missing/fenced ports, admission races, manual idle deferral, immutable payloads, branch scoping, exact-row cancellation, rollback, queue drain preflight, peer-message provenance, same-source materialisation and recovery after lost acknowledgements. UI port doubles use real message/queue transactions; separate durable integration tests verify canonical work-store source/intent/recovery contracts.

The frozen issue campaign uses focused tests only. No deployment, dependency installation, restart, schema migration, live database/configuration action or historical-data cleanup accompanies this source change.
