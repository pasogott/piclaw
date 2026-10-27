# Native web execution

Web turns execute through `dispatchAcceptedInput` and its same-identity pending observer. `processChat` no longer calls `AgentPool.runAgent` or constructs a legacy preflight, streaming or finalisation runtime. A missing dispatcher or accepted source fails explicitly; it cannot enter another prompt lifecycle.

## Cursor and queue handoff

The cursor selects persisted input. It grants no execution authority. Selection reads pending messages and their thread lineage; historical failed-run markers cannot consume or skip accepted native work. Existing marker rows remain unchanged until the separate owned schema retirement.

Accepted dispatch advances the cursor only after confirmed settlement. Pending or failed observation keeps the cursor unchanged and retains the same message/row identity for the next wake. Display and resume failures cannot revoke a committed settlement. Native settlement wakes the lane; deferred materialisation uses its existing targeted queue key. Deferred controls and queue payload/provenance remain supported.

SDK tasks/submissions and host accepted-source/terminal records own execution and publication. Historical `agent_timing`/outcome blocks remain readable by the UI; deleting their legacy producer does not delete or reinterpret stored posts. Native SSE publication continues through the existing native event/turn-view adapters. No frontend interaction change is introduced.

## Root metadata and routing ownership

Creating a root chat is host metadata registration. The live native owner allocates its SDK context later through input-source preparation. Native root registration requires the existing routing owner, checks it inside the same immediate SQL transaction and skips legacy session warmup. Missing, revoked or closed ownership rejects creation; a failed branch insert rolls back chat metadata too.

Native forks, address changes and destructive purges retain their immutable-routing refusal. A pool with no native routing profile still refuses native root creation. No default conversation or legacy factory is selected as a fallback.

## Removed code and retained work

Removed:

- The legacy runner, protected continuation, draft-fallback and turn-finalisation branch in the web handler.
- `process-chat-preflight-runtime.ts`, `process-chat-streaming-runtime.ts` and `process-chat-finalization-runtime.ts` and their exclusive fixtures.
- The policy-free `processChat` → `processAuthorisedChat` forwarding step and legacy failed-marker selection.

Slash recognition now uses the existing command parser directly. The explicitly retained legacy slash executor re-exports recognition for its current callers; native web parsing does not import that executor merely to recognise a command.

Before #1674 closes, retire the remaining legacy restart draft/interruption helpers and their public wiring, review model-switch failed-run handling, and qualify the complete pending/reconnect/queue/cancellation path at the merged head. #1673 owns final runner/compaction retirement. #1691/#1692 own the subsequent schema/projection removals. Source deletion does not authorise live data cleanup, migration, deployment or restart.

## Focused evidence

- `native-web-only.test.ts`: missing dispatcher cannot access a legacy runner or write markers; historical failed markers cannot skip accepted input; pending wakeups retain one identity.
- `process-chat-native-dispatch-import-boundary.test.ts`: native settlement/pending/failure/status paths never load retired helpers or publish legacy run markers.
- `web-channel.test.ts`: surviving HTTP, cards, controls, queue and status contracts use explicit accepted-dispatch test ports; legacy runner calls are trapped in migrated execution cases.
- `application-web.test.ts`: real native pool/channel, lost wait acknowledgement and deferred uncertain compaction.
- Existing native factory routing/event cases: native source/queue policy, immutable identities, root registration and SSE publication.
- `native-routing-policy.test.ts`: missing/revoked/closed owner and failed registration preserve metadata; authorised root registration adds no SDK conversation.

Run only defining/directly affected files through the isolated priority launcher, with relevant runtime/private/qualification typechecks. Tests exclusive to the retired web lifecycle were removed; surviving wire/queue behavior retains coverage.
