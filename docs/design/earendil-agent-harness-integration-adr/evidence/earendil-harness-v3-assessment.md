# Earendil Harness v3 assessment

## Pinned evidence

| Item | Pin |
|---|---|
| Earendil repository | [`earendil-works/pi`](https://github.com/earendil-works/pi) |
| Reviewed `main` | [`2a9b4ebc680053c64e31f635b0b22d5e22564001`](https://github.com/earendil-works/pi/commit/2a9b4ebc680053c64e31f635b0b22d5e22564001) |
| Authoritative specification | [`packages/agent/docs/harness.md`](https://github.com/earendil-works/pi/blob/2a9b4ebc680053c64e31f635b0b22d5e22564001/packages/agent/docs/harness.md) |
| Specification blob | `9e38c1fab7ed77107952c1de850cdba987fff82c` |
| Last specification commit at reviewed main | [`40a3d8556ab7fb4a6b4da20ffe1f5dfc08ec121d`](https://github.com/earendil-works/pi/commit/40a3d8556ab7fb4a6b4da20ffe1f5dfc08ec121d) |
| Original completed `harness-v3.md` blob | `290d839e9c6fe114d4a99a5204f0ade2abf884a5` at `24047f5dfb222ef7d26b554a0e576e5efa844024` |
| First implementation slice | Draft PR [#7976](https://github.com/earendil-works/pi/pull/7976), head [`69130ae34e91207249b262008eea3fb0ac3adf44`](https://github.com/earendil-works/pi/commit/69130ae34e91207249b262008eea3fb0ac3adf44) |
| Published packages | still `0.84.1`; no Harness v3 release |

`harness-v3.md` was consolidated into `harness.md` at `85a2060811a23f1580c13ab59a210b1409092837`; superseded v2/spec/test-matrix documents were deleted. The reviewed `harness.md` is therefore the current design reference, even though production implementation is incomplete.

## Status

Harness v3 is an implementation specification, not the current released runtime. Its build order deliberately starts by deleting the current harness implementation and landing a complete behaviour-free type surface. Draft PR #7976 contains that first slice and marks it complete on its branch; it is open, draft and mergeable at the pinned review. Current `main` still has the `0.84.1`-shaped stub execution harness.

Piclaw must distinguish three evidence levels:

1. released `0.84.1`: installed implementation evidence;
2. `main` `harness.md`: authoritative target-design evidence;
3. draft PR #7976: emerging public type-contract evidence, not a selected dependency.

The v3 implementation plan has one shared type slice followed by parallel storage (`S1`–`S4`) and sequential runtime (`R1`–`R12`) tracks. PR #7976 only covers Slice 1. Memory/conformance, durable backends and the executable runtime remain outstanding.

## Core v3 model

Harness v3 replaces the v2 append-only operation-record/reducer design with three durable stores:

| Store | Semantics |
|---|---|
| Entries | Immutable conversation tree; write once |
| Registers | Current mutable typed state; overwrite/delete |
| Usage ledger | Append-only cost/usage rows |

The key operation registers are:

- `lane.leaf/{lane}`;
- `lane.config/{lane}`;
- `lane.state/{lane}`;
- `lane.lastResult/{lane}`;
- `op.meta/{operationId}`;
- `op.state/{operationId}`;
- `op.tool_args/{operationId}:{stepId}:{sourceIndex}`;
- `op.preparation/{operationId}:{taskId}`;
- `pending.entry/{entryId}`.

`op.state` is a total durable program counter. Recovery reads current registers and exact referenced entries/registers; there is no orchestration history or recovery reducer. Terminal transactions delete all operation registers, clear the lane's current operation, and write one bounded `lane.lastResult`.

## Alignment with Piclaw

### Strong alignment

| Piclaw requirement | Harness v3 mechanism |
|---|---|
| Explicit execution identity | Durable `operationId`; public name remains `runId` |
| Exact cancellation | Durable `control.cancel_requested` committed before signal pull |
| Late-result handling | State-sequence conditional commits and external-finalisation stop |
| Tool replay policy | Persisted `safe`/`never` plus current declaration check |
| No duplicated unsafe mutation | Unknown `never` call settles as interrupted instead of replaying |
| Durable continuation | Total checkpoint/continuation state |
| Restart recovery | Point reads of total registers plus bounded hydration |
| Terminal cardinality | At most one terminal transaction; `lane.lastResult` |
| Deterministic manual drive | `peekAction`, `executeAction`, `runToCompletion` |
| Event projection | Typed events and snapshot+buffered watch contract |
| Tool-context ownership | Generic `AgentHarness<TContext>` and `AgentHarnessTool<TContext>` |
| Schema evolution | `storageVersion` and total migrate-on-open mappings |
| Fault boundaries | Intent → external effect → settlement transaction |

This supersedes several workarounds proposed from `0.84.1` evidence:

- no private `reduceLaneState()` dependency is needed;
- no Piclaw execution reducer is needed;
- no contextual-tool closure binder should remain once v3 types land;
- no `HarnessTool` parameter-schema erasure workaround should remain;
- no untyped event/hook narrowing layer should remain once v3 typed unions land;
- Piclaw should not design around v2 `LaneRecord`, `StepAttemptRecord`, `ToolStartedRecord` or `LogItem`.

### Ownership boundary remains

Harness v3 is a library, not Piclaw's authenticated service. Piclaw still owns:

- channel authentication/routing;
- external accepted-source ordering and acknowledgement;
- Piclaw operation correlation to Earendil session/lane/operation;
- timeline/media persistence;
- scheduler intent and delivery policy;
- notifications and external delivery idempotency;
- Piclaw terminal disposition/frontier;
- reconciliation between Piclaw service state and Earendil's `lane.lastResult`/open operation.

Harness v3's `operationId` is the durable harness operation. Piclaw may correlate its own operation ID one-to-one where possible, but must not assume it can inject that ID until the selected public constructor/prompt contract permits it. The durable correlation table therefore remains necessary.

## Important semantic changes from v2

| v2 / `0.84.1` assumption | Harness v3 target |
|---|---|
| Append-only operation records | Total mutable operation registers |
| Reducer validates/rebuilds lane state from records | Recovery reads current registers; no reducer/history |
| `operation_finished` record | Terminal transaction deletes `op.*`, clears lane, writes `lane.lastResult` |
| `queue_enqueued`/`queue_cancelled` records | Queue IDs in lane/operation state plus `pending.entry` registers |
| Repeated cancelled queue may return `already_cleared` | `cancelled`, `already_consumed` or `not_found`; retry treats `not_found` as success |
| Usage records in operation log | Separate append-only usage ledger |
| Configuration entries in transcript | Total `lane.config` register |
| `runId` and operation ID described separately | Public `runId` is durable operation ID |
| Restored safe tools inferred from record/result existence | `effect_pending` state plus persisted args/replay declaration |
| Finished operation state remains queryable in records | Only bounded `lane.lastResult` remains after terminal cleanup |
| JSONL is durable history | JSONL is replay recipe for current registers plus permanent entries/usage; dead revisions compacted |

## Public surface in v3

The target lane adds or clarifies:

- `getLastResult()` for post-crash/external-finalisation reconciliation;
- distinct `QueueResult` and `NextRunResult`;
- `CancelQueuedResult.kind = cancelled | already_consumed | not_found`;
- optional final assistant for all-terminating tool batches;
- missing-identity suspension as an accepted outcome;
- `getModel(): Model | undefined` when the durable identity is unavailable;
- typed `LaneSnapshot`/`SessionSnapshot`;
- typed, filtered `HarnessEvent` union;
- typed `HookMap`;
- generic `AgentHarnessOptions<TContext>` with direct contextual tools;
- harness-owned `AbortSignal` and curated stream options;
- `SessionTree` facts and global/branch entry queries;
- `storageVersion` and runtime schemas for custom messages/registers.

Draft PR #7976 implements these type contracts and compile-time tests, including 28 event types, 11 hook names, generic contextual tools, direct storage/register/operation state types and signal-exclusion checks. It is draft and not yet merged/published.

## Event and projection consequences

Harness v3 specifies snapshot-first buffered watching:

1. `watch()` atomically captures a snapshot and begins buffering;
2. Piclaw sends the snapshot;
3. `start()` flushes buffered events in order and then delivers live events;
4. reconnect creates a new watch.

This directly addresses Piclaw's SSE gap/reset hazards. Earendil events have no durable event sequence and cross-lane events are only process ordered. Piclaw should therefore:

- keep connection-generation/receipt sequence for web projection;
- treat `entry_added` as the proof of durable transcript mutation;
- treat operation results and `lane.lastResult` as terminal authority;
- use the snapshot+buffer contract rather than replaying old process events;
- redact event content at the service boundary because events intentionally may contain prompts/tool data.

## Cancellation and terminal consequences

Harness v3's first `abort()` durably writes cancellation and drained queue IDs, then pulls the signal. Repeated abort is idempotent while open. It starts no new ordinary provider/tool/decision/retry effects after cancellation. Close is explicitly not abort and writes nothing.

Piclaw still commits its own service cancellation before calling Earendil abort. Reconciliation rules become:

- Piclaw cancellation + open running harness operation → call `abort()`;
- Piclaw cancellation + harness `aborting` → wait/watch;
- Piclaw terminal + harness open → external finalisation or abort according to selected public admin surface;
- harness terminal + Piclaw non-terminal → read operation result or `getLastResult()`, then settle Piclaw;
- both terminal → compare correlation/outcome and deliver at most once.

## Storage consequences

Do not implement Piclaw's proposed harness session backend against v2 types. Harness v3's Slice 1 deletes the old harness/session implementations; Slice 2 supplies Memory and conformance; JSONL and SQLite follow independently.

Piclaw should:

- keep Earendil session storage separate from `messages.db` unless a later decision proves otherwise;
- prefer a selected released v3 backend and unchanged conformance suite;
- retain Piclaw timeline/operation/outbox data in `messages.db`;
- test one-writer/session lifecycle and Bun support;
- test JSONL migration/compaction if selecting JSONL;
- test fenced lease and `BEGIN IMMEDIATE` behaviour if selecting SQLite;
- avoid building against current v2 JSONL format 4 because v3 explicitly replaces it without migration.

## Tool/resource consequences

Harness v3 removes the main contextual-tool mismatch documented for `0.84.1`:

- `AgentHarness<TContext>` and `AgentHarnessOptions<TContext>` are generic;
- `tools` are `AgentHarnessTool<TContext>[]` directly;
- `toolContext` is resolved once per live/restored batch;
- safe replay receives a fresh environmental context after restart;
- `replay` moves onto the base `AgentTool` and defaults to `never`.

Piclaw's selected-version tool migration should therefore target these v3 types when released rather than preserving the `0.84.1` binder.

## Migration and contract-suite changes

Keep semantic HC/PC scenarios but update their Earendil-specific expected traces:

- compare committed transactions/current registers, not v2 operation records;
- use instrumented `Storage.commit()` as write-order oracle;
- assert `lane.lastResult` rather than `operation_finished` history;
- model queue content through `pending.entry` and state IDs;
- assert register cleanup after terminal settlement;
- add total migration tests for open `op.state` across harness storage versions;
- add close-as-controlled-crash cases distinct from abort;
- add external finalisation races;
- add optional-final-assistant/all-terminating-tool cases;
- add snapshot-buffer event-gap cases using typed v3 events;
- retain Piclaw service ledger/outbox fault cases unchanged.

## Adoption gates

Harness v3 is not selectable for production until:

1. the authoritative specification's required slices are implemented and released or pinned to an approved source;
2. real `prompt`, tool, queue, abort, resume, compaction, navigation, manual drive and watch methods work;
3. Memory/session conformance and at least one durable backend are implemented;
4. typed events/hooks and contextual tools are public;
5. Piclaw's HC/PC suite passes under Bun or an approved runtime boundary;
6. restart tests cover every v3 effect sandwich and terminal transaction;
7. storage migration from any selected pre-v3 source is explicit;
8. installed-service/mobile/scheduler acceptance gates pass.

## Assessment decision

Use Harness v3 `harness.md` as the **target execution design**. Keep released `0.84.1` as the **implemented baseline evidence**. Track draft PR #7976 and subsequent implementation slices, but do not update Piclaw package pins until a coherent real harness/backend is available.
