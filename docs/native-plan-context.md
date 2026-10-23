# Native Plan context and request prefixes

Native Plan state is stored as immutable, hidden `host.plan-context` entries. Each entry contributes a user-role model message at its original position. The next request appends a new snapshot only when the rendered checklist changes. Unchanged state adds no duplicate entry, including across user turns and reopen.

```text
First request:   history + Plan A
After a tool:   history + Plan A + assistant/tools + Plan B
Unchanged:      history + Plan A + assistant/tools + Plan B + new input
```

The Plan tool, sidebar storage and visible timeline keep their existing behaviour. Historical snapshots are model context, not accepted human input. They are validated and excluded by the existing private-history tree projection. The current add-on reloads its default scaffold after stored Markdown is cleared; that behaviour is preserved. If the renderer returns no checklist, the bridge emits an explicit `(empty)` snapshot. Installed Plan capability guidance stays stable.

## Native request boundary

The SDK pins a context cutoff before `beforeRequest`. Appending an entry from that hook does not automatically include it in that request. `materializePlanContext` therefore:

1. Reads the public conversation context and checks that the pinned request matches its prefix.
2. Allows only exact, trailing, same-generation Plan entries to extend that prefix. Unrelated or edited missing contributions fail closed.
3. Checks the live generation and raw context tail in the append transaction.
4. Persists a new snapshot only if the latest active snapshot or its effective contribution differs from the current rendered checklist.
5. Projects any verified missing snapshots, followed by the new one, into this request.

A pre-dispatch interruption can leave committed snapshots beyond the pinned cutoff. Recovery keeps them in order and appends newer Plan state after them. No private SDK checkpoint is modified, and no missing footer is guessed from prompt text.

The Plan hook runs before request-only prompt sections so its comparison uses the SDK context. Provider adapters continue to hoist system guidance. Registering the hook first can change guidance ordering once on rollout; it does not alter tools or cache/session keys.

## Authority and lifecycle

The hook reads Plan KV through the existing qualified, read-only operation authority. The runtime bridge rechecks the owner, installed add-on and exact still-claimed accepted sources inside the SDK storage transaction through `withAdmissionGuard`. It also checks the public live generation and cancellation state. A legitimate pre-ACK harness binding can advance the host operation version; prompt persistence does not grant Plan KV writes or external tool authority.

Deduplication reads active native context, not a process-local cache or a whole-history search. Forks retain inherited snapshots. Reset and compaction can discard snapshots; the next request materializes the current checklist again. Context edits that omit a snapshot also cause current state to be materialized without changing the original entry.

## Verification and limits

Qualification covers tool changes, unchanged state, A/B/A transitions, clearing, initially empty state, reopen, cooperative pre-dispatch interruption, fork, independent conversations, reset, real compaction, context edits, SQL-boundary source revocation, unknown cutoffs and terminal tasks. An offline test runs the actual public Codex HTTP serializer and compares input-item JSON prefixes, instructions, tools and cache key. Native factory tests check direct and codemode Plan updates, Goal integration, persisted entries and private tree projection.

Compaction, intentional context edits, model/settings changes and other dynamic prompt sections can still change a request prefix. Existing Goal prompt behaviour is unchanged. The first deployment cannot reconstruct previously unpersisted Plan footers. No live cache-rate improvement or crash/SIGKILL recovery measurement is claimed by these tests. Installation, restart and controlled production measurement require separate approval.
