# Target state, event and settlement model

Status: proposed architecture for the ADR decision.

The target uses two journals with explicit correlation:

1. Piclaw owns service acceptance, ordering, operation state, delivery and terminal disposition.
2. Earendil owns harness transcript, execution records, tool/compaction state and resumable execution.

Piclaw does not recreate Earendil's execution reducer. Earendil does not become the authority for external acceptance or Piclaw terminal consumption.

## Identity hierarchy

| Identity | Owner | Lifetime | Purpose |
|---|---|---|---|
| `chatJid` | Piclaw | Chat/branch | Routing, authorisation and user-visible conversation |
| `sourceSeq` | Piclaw | Monotonic per chat | Canonical order for messages, steers, follow-ups, controls and cancellation intents |
| `operationId` | Piclaw | Accepted work operation | Exact service owner, terminal disposition and delivery correlation |
| `operationVersion` | Piclaw | Monotonic per operation | Compare-and-set fencing for intents and settlement |
| `sessionId` | Earendil | Durable harness session | Transcript and lane namespace |
| `lane` | Earendil | Session lane | Harness execution/tree branch |
| `runId` | Earendil | Prompt/compaction/navigation operation | Exact execution owner and abort/resume target |
| `attempt` | Earendil | Step series | Retry and compaction attempt order |
| `eventSeq` | Boundary projector | Monotonic per run | UI/event ordering and duplicate rejection |
| `deliveryId` | Piclaw | One external delivery effect | Timeline/channel/log/notification idempotency |

The correlation table is durable:

```typescript
interface OperationHarnessCorrelation {
  operationId: string;
  operationVersion: number;
  sessionId: string;
  lane: string;
  runId: string | null;
  harnessState: "not_started" | "running" | "suspended" | "aborting" | "finished";
  lastHarnessLogSeq: number;
  lastProjectedEventSeq: number;
}
```

A command with a stale `operationVersion` or mismatched `runId` returns a typed no-op. No fallback resolves "whatever is active".

## Piclaw accepted-source model

All external and trusted input uses one per-chat sequence.

```typescript
type AcceptedSourceKind =
  | "message"
  | "steer"
  | "follow_up"
  | "continuation"
  | "control"
  | "cancellation"
  | "scheduled_agent"
  | "internal";

interface AcceptedSource {
  chatJid: string;
  sourceSeq: number;
  sourceId: string;
  kind: AcceptedSourceKind;
  acceptedAt: string;
  targetOperationId: string | null;
  parentSourceSeq: number | null;
  payloadRef: string;
  provenance: SourceProvenance;
  state: "pending" | "claimed" | "consumed" | "disposed";
  dispositionReason: string | null;
}
```

Rules:

- `sourceSeq` is allocated in the same transaction as durable payload/timeline acceptance.
- A steer accepted during a run normally targets that exact Piclaw `operationId`.
- A follow-up can target the current operation for Earendil `followUp()` delivery or remain a Piclaw successor. Product semantics choose this at acceptance and persist the choice.
- Controls and cancellation are sources even when they produce no harness prompt.
- Trusted provenance changes authorisation, not ordering or durability.
- A source changes from pending to claimed once. It becomes consumed/disposed only through terminal settlement or an explicit owner-fenced disposition.

## Piclaw operation model

```typescript
type PiclawOperationPhase =
  | "accepted"
  | "claimed"
  | "starting_harness"
  | "executing"
  | "suspended"
  | "cancelling"
  | "settling"
  | "terminal";

type PiclawDisposition =
  | "completed"
  | "cancelled"
  | "failed"
  | "skipped"
  | "superseded";

interface PiclawOperationState {
  operationId: string;
  chatJid: string;
  version: number;
  phase: PiclawOperationPhase;
  primarySourceSeq: number;
  claimedSourceSeqs: number[];
  createdAt: string;
  deadlineAt: string | null;
  cancellation: null | {
    sourceSeq: number;
    cause: string;
    requestedAt: string;
  };
  harness: OperationHarnessCorrelation | null;
  terminal: null | {
    disposition: PiclawDisposition;
    terminalMessageRowId: number | null;
    errorCode: string | null;
    committedAt: string;
  };
}
```

The persisted operation log contains immutable intent/disposition rows plus a current projection. The projection is rebuildable from the log and may be updated transactionally for fast claims.

### Allowed service transitions

| Current | Event | Next | Required command |
|---|---|---|---|
| none | source accepted and eligible | accepted | enqueue wake outbox |
| accepted | claim succeeds | claimed | open/load harness lane |
| claimed | harness lane ready | starting_harness | append correlation intent |
| starting_harness | Earendil run accepted | executing | persist `runId`; start projection |
| executing | steer/follow-up accepted | executing | append source and deliver exact-run queue command |
| executing | Earendil suspended | suspended | persist harness snapshot/missing identities |
| suspended | resumable and owner valid | executing | call exact lane `resume()` |
| executing/suspended | cancellation accepted | cancelling | persist first cancellation; call exact-run abort |
| executing/suspended/cancelling | terminal candidate | settling | commit terminal transaction |
| settling | commit succeeds | terminal | append deliveries/maintenance wakes |
| any non-terminal | stale result | unchanged | record bounded diagnostic only |

## Earendil execution model

The compatibility target is the installed declared API:

- `Session` and `SessionStorage` append entries/records;
- `AgentHarness`/`AgentLane` create `runId`-owned operations;
- `reduceLaneState()` reconstructs open execution state;
- actions append intents/results in durable order;
- tool records declare `safe` or `never` replay;
- compaction/navigation are first-class operations;
- abort appends `abort_requested` and returns queued steer/follow-up state;
- suspended runs require explicit identity reconciliation before resume.

Piclaw reads Earendil snapshots through the adapter. It does not mutate Earendil storage directly except through the supported session/harness ports.

## Boundary events

Versioned boundary events contain no unbounded secret/tool payload by default.

```typescript
type HarnessBoundaryEventV1 =
  | { v: 1; type: "run_accepted"; operationId: string; runId: string; lane: string }
  | { v: 1; type: "run_progress"; operationId: string; runId: string; eventSeq: number; phase: string; publicData: JsonValue }
  | { v: 1; type: "run_suspended"; operationId: string; runId: string; eventSeq: number; missingTools: string[]; missingModels: string[] }
  | { v: 1; type: "run_terminal"; operationId: string; runId: string; eventSeq: number; outcome: HarnessOutcomeRef }
  | { v: 1; type: "run_fault"; operationId: string; runId: string | null; eventSeq: number; code: string };
```

The adapter normalises real harness events into this boundary. Unknown future events can be journalled as redacted diagnostics but cannot drive service transitions until mapped by a reviewed version.

## Service commands

```typescript
type ServiceCommandV1 =
  | { v: 1; type: "wake_chat"; chatJid: string; frontier: number; idempotencyKey: string }
  | { v: 1; type: "open_harness"; operationId: string; expectedVersion: number; sessionId: string; lane: string }
  | { v: 1; type: "prompt"; operationId: string; expectedVersion: number; lane: string; inputRef: string }
  | { v: 1; type: "queue_input"; operationId: string; expectedVersion: number; expectedRunId: string; sourceSeq: number; queue: "steer" | "followUp" }
  | { v: 1; type: "abort"; operationId: string; expectedVersion: number; expectedRunId: string; cancellationSourceSeq: number }
  | { v: 1; type: "resume"; operationId: string; expectedVersion: number; expectedRunId: string }
  | { v: 1; type: "settle"; operationId: string; expectedVersion: number; terminalCandidateRef: string }
  | { v: 1; type: "deliver"; deliveryId: string; operationId: string; channel: string; payloadRef: string }
  | { v: 1; type: "maintenance"; operationId: string; maintenanceKind: string };
```

Every command result is appended before the next transition. An `effect_may_have_happened` result triggers reconciliation by idempotency key or expected version.

## Atomic terminal settlement

One Piclaw SQLite transaction performs:

1. verify `operationId`, version and non-terminal phase;
2. verify the terminal candidate's correlated `runId` or authorised service-only terminal source;
3. insert the immutable disposition;
4. insert or bind the terminal timeline row and media references;
5. mark claimed source intents consumed/disposed with reasons;
6. advance the per-chat accepted-source frontier through consecutive terminally disposed sources;
7. release active operation ownership;
8. insert successor, delivery, notification and maintenance outbox intents;
9. increment operation version and commit.

If timeline/media storage cannot share the transaction, the operation enters `settling` with a persisted terminal intent and idempotency key. A reconciler completes the same protocol; no output is broadcast and no frontier is advanced before the terminal row is durable.

SSE and notifications run from outbox records after commit. Delivery failure cannot roll back operation completion. Duplicate delivery claims return the existing result.

## Cancellation model

Cancellation has two ordered stages:

1. Piclaw accepts a cancellation source against exact `operationId` and expected version. The first accepted cancellation wins.
2. The adapter aborts the correlated Earendil `runId` and owned process/tool effectors.

Rules:

- missing/mismatched operations return `not_found`/`owner_mismatch` without calling the harness;
- repeated exact cancellation returns the stored cancellation/disposition;
- an Earendil `NoActiveOperation` result does not erase Piclaw cancellation; reconciliation determines whether the run finished first or was already aborted;
- late terminal harness output cannot replace a committed cancelled disposition;
- tool process groups receive the same abort signal and owner IDs;
- restart reads both Piclaw cancellation and Earendil `abort_requested`/open-operation state before acting.

## Restart reconciliation

For each chat with non-terminal Piclaw work:

1. read the Piclaw operation/source projection and immutable log;
2. open the correlated Earendil session and reduce each relevant lane;
3. compare `operationId ↔ sessionId/lane/runId` correlation;
4. classify one of the cases below;
5. append a Piclaw reconciliation event before issuing a command.

| Piclaw state | Earendil state | Action |
|---|---|---|
| claimed/starting | no run | safely start prompt with stored input/idempotency key |
| executing | same open run | resume/watch according to harness status |
| cancelling | same open run, not aborting | issue exact abort |
| cancelling | same run aborting | wait/reconcile |
| executing | run terminal, Piclaw not terminal | build terminal candidate and settle |
| terminal | open same run | abort/close as stale execution; never unset Piclaw terminal |
| non-terminal | different run | quarantine owner mismatch; operator/recovery policy decides |
| non-terminal | corrupt record log | fail operation with corruption code; no automatic mutation replay |
| source pending | no operation | claim in FIFO order and wake |
| `never` tool unresolved | open/suspended run | containment; do not replay; require result reconciliation or explicit disposition |

Steers/follow-ups exist in both logs only after successful exact-run delivery. Piclaw source state distinguishes accepted-but-undelivered from delivered. Restart reissues safe queue delivery by source idempotency key only when the harness has no matching queue/entry record.

## Replay record

A replay fixture contains:

```typescript
interface ReplayFixtureV1 {
  v: 1;
  name: string;
  piclawInitial: PiclawServiceSnapshot;
  earendilInitial: EarendilSessionSnapshot;
  inputs: ReplayInput[];
  injectedResults: EffectResult[];
  expected: {
    piclawLog: NormalisedServiceEvent[];
    earendilLog: NormalisedHarnessLogItem[];
    commands: NormalisedCommand[];
    deliveries: NormalisedDelivery[];
    terminal: NormalisedTerminalState;
  };
}
```

Normalisation replaces timestamps and generated IDs with stable symbols while preserving equality and ordering relationships. Full model/tool text may be stored only in a secure fixture when necessary; ordinary golden fixtures use payload hashes and bounded public projections.

Replay runs in manual drive:

1. reducer/service consumes one input;
2. emits commands;
3. fake effector returns the next injected result;
4. result is appended as an event;
5. repeat until quiescent;
6. compare both journals, commands, deliveries and terminal state.

## Fault points

Every mutating command is tested with:

- throw before effect;
- effect then throw before acknowledgement;
- acknowledgement then crash before event append;
- duplicate command/result;
- delayed result after replacement;
- restart between each durable write;
- cancellation concurrent with completion;
- malformed/corrupt harness log;
- unavailable model/tool identity;
- delivery success followed by completion-write failure.

The expected result is one disposition, no lost accepted source, no unsafe mutation replay and bounded reconciliation.

## Projection model

The web/client projection key is:

```text
(chatJid, operationId, runId, connectionGeneration, eventSeq)
```

The server drops mismatched operation/run events. The client drops an older connection generation or non-increasing sequence. A fresh `/agent/status` response includes the current Piclaw operation authority and correlated harness status. Presentation-only waiting/watchdog states never erase authority.

Terminal projection starts only after Piclaw settlement commits. Intermediate harness text can be shown as a draft but is not a terminal timeline row without a Piclaw commit result.

## Scheduler model

A due agent task becomes `scheduled_agent` accepted source with a task-run idempotency key. The scheduler owns:

- schedule claim and next-run calculation;
- one Piclaw operation;
- one timeline delivery intent;
- one run-log record;
- optional Pushover intent.

The harness owns only execution. It cannot write the timeline directly for scheduled runs. Shell tasks retain their existing execution/delivery semantics behind separate effectors.

## Safety properties

The reference model and contract suite assert:

- one active Piclaw operation per chat lane;
- source sequences never decrease or disappear;
- terminal implies one disposition and released owner;
- frontier never crosses pending/claimed source;
- cancellation cause is immutable;
- every harness run is correlated to one Piclaw operation;
- stale/mismatched run result cannot settle;
- each delivery ID completes at most once;
- unresolved `never` tool is never automatically re-executed;
- protected payload classes never appear in public projection;
- recovery and reconciliation commands are bounded.
