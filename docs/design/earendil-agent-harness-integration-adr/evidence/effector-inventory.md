# Piclaw effector inventory

Baseline: Piclaw `v2.13.2` at `0afd3ae645c423bed82deef80c343bcaa6f31d4d`.

An effector performs one external query or mutation from an explicit request. It does not choose the next lifecycle state, retry policy, owner or terminal outcome. See [the assessment method](../01-assessment-method.md).

## Classification

| ID | Current module/surface | Classification | Reason | Target action |
|---|---|---|---|---|
| EF-001 | `db/messages.ts`, media accessors and low-level message write helpers | Reusable behind adapter | SQLite persistence is an external effect; low-level calls do not need to decide harness state | Wrap in operation-aware timeline port with transaction/idempotency support |
| EF-002 | `channels/web/messaging/agent-message-store.ts:storeAgentTurn` | Reject as effector | Mixes placeholder consumption, formatting, message persistence, auxiliary callback, SSE, Web Push and terminal policy | Split into timeline transaction, projection broadcast and notification effectors |
| EF-003 | `db/chat-cursors.ts` cursor/preflight/inflight/failed helpers | Replace | Encodes current state machine and recovery policy in cursor fields and composite helpers | New Piclaw accepted-source/operation store; retain low-level SQLite connection/migration utilities |
| EF-004 | `get/setDeferredQueuedFollowups` JSON queue helpers | Replace | Full-list JSON writes and synthetic row IDs are the current queue model | Accepted-source rows and ordered successor/steer intents |
| EF-005 | `db/connection.ts:getDb`, migration and transaction mechanism | Reusable | Storage mechanism, no agent lifecycle decision required | Use for Piclaw operation ledger/outbox migrations |
| EF-006 | `AgentQueue` | Reusable only as dispatcher | Serialises and retries closures but is not durable acceptance and contains generic retry policy | Keep as idempotent wake/worker mechanism; derive tasks from durable pending work |
| EF-007 | `AgentPool` | Reject | Central current orchestrator: session cache, run/recovery, controls, tools, branches and status | Replace with Piclaw service coordinator plus Earendil harness registry |
| EF-008 | `run-agent-orchestrator.ts` | Reject | Implements prompt lifecycle, timers, tool policy, compaction, retries, status and cleanup | Earendil harness/fixture owns execution; Piclaw supplies policy inputs and projects events |
| EF-009 | `run-agent-recovery-phase.ts` | Reject | Decides recovery strategy, budgets, compaction, rotation, tool suppression and terminal outcome | Adopt Earendil durable reducer/actions; retain only product policy configuration where needed |
| EF-010 | `run-agent-attempt-finalization.ts` | Reject | Classifies provider/tool facts into terminal/recovery outcomes | Harness contract returns typed outcome; Piclaw maps to service disposition without prose classification |
| EF-011 | `agent-pool/compaction.ts` | Split | Estimation and product thresholds may be policy; execution, timeout, single-flight and recovery are orchestration | Earendil compaction operation; Piclaw may provide threshold settings and UI projection |
| EF-012 | `session-rotation.ts`, branch seeding | Replace/adapter | Mixes archive/session creation with fallback and recovery policy | Earendil `SessionRepo`, lanes, navigation/fork; Piclaw adapter handles workspace-specific storage/archive only |
| EF-013 | `agent-pool/session-manager.ts` | Reject | Cache, creation, branch realization, model restore, side session sync, eviction and shutdown policy | Harness registry with explicit lane/session lifetime; storage and resource provisioning become ports |
| EF-014 | `agent-pool/session-persistence.ts` and JSONL adapter | Candidate adapter | Isolates persistence reads/writes but targets legacy `SessionManager` shape | Prefer Earendil `SessionRepo`/`SessionStorage`; adapt JSONL only if it passes upstream conformance |
| EF-015 | `agent-pool/sqlite-session-store.ts` prototype | Evidence only | Non-shipping schema is deliberately incompatible with Earendil session protocol | Do not adopt; use its benchmark/fault evidence when selecting a backend |
| EF-016 | `createTrackedBashOperations` | Reusable tool effector | One shell execution effect with cwd/env, AbortSignal, process tracking and bounded output | Wrap as Earendil `HarnessTool`; declare `replay: "never"`; preserve process-group tests |
| EF-017 | read/write/edit/image/browser/integration tools | Reusable after per-tool review | Tool implementations are effectors when they do not choose turn transitions | Adapt to `HarnessTool`; assign replay policy, redaction and idempotency class |
| EF-018 | `extensions/ssh-core.ts` | Split | Remote file/shell transport is an effector; live profile mutation and turn cleanup are policy | Keep transport operations; move profile/turn ownership to Piclaw service and explicit tool context |
| EF-019 | model runtime and provider registry | Reusable infrastructure | Resolves models and performs streams; does not own Piclaw acceptance | Supply `Models`, selected model and stream options to harness fixture/real harness |
| EF-020 | coding-agent resource loader/extensions | Adapter required | Resource discovery is useful, but extension hooks and AgentSession-specific contexts assume old runtime | Build Earendil resource/tool adapter; catalogue unsupported hook/command APIs |
| EF-021 | `task-scheduler.ts` | Split | Polling and schedule computation are service effects; task execution and delivery are mixed in one function | Piclaw scheduler accepts/claims task; harness executes; separate timeline, log, Pushover and shell effects |
| EF-022 | scheduled task DB accessors | Reusable behind adapter | Durable schedule/run-log persistence can remain Piclaw-owned | Add claim/idempotency semantics and explicit delivery IDs |
| EF-023 | `runtime/progress-watchdog.ts` | Split | Timer/monitor mechanism is reusable; chat-scoped phase policy is current orchestration | Key watchdog by Piclaw operation/Earendil run; events feed service cancellation command |
| EF-024 | `utils/process-tracker.ts` | Reusable | Registers and kills process trees; no lifecycle transition policy | Use from tool effectors; cancellation request carries owner/run metadata |
| EF-025 | web SSE broadcaster/status store | Split | Transport is reusable; current status producers and merge rules are policy | Operation/run/sequence-aware projection reducer plus SSE transport effector |
| EF-026 | Web Push/Pushover delivery | Reusable | Named delivery effect independent of harness execution | Trigger from Piclaw delivery outbox with per-effect idempotency key |
| EF-027 | channel `sendMessage` | Reusable behind delivery adapter | External delivery action; must not decide whether execution owns output | Piclaw outbox calls exactly once according to task/channel policy |
| EF-028 | attachment registry/media creation | Reusable | Storage/correlation effect | Associate media with Piclaw operation and terminal message transaction |
| EF-029 | keychain and credential store | Reusable infrastructure | Secret lookup/mutation effect | Inject via tool/provider context; never journal values |
| EF-030 | structured logger/telemetry | Reusable with redaction | Observation effect | Require operation/run/event IDs and allowlisted fields |
| EF-031 | `runtime/restart-handoff.ts` | Replace protocol, reuse storage primitives | Implements a separate continuation lifecycle | Model reload continuation as accepted source and operation outbox |
| EF-032 | side-prompt runner | Replace with harness lane | Implements parallel mini execution loop/session sync | Use named/ephemeral Earendil lane with explicit context seed contract |
| EF-033 | branch manager/chat registry | Split | Chat identity and archive are Piclaw service concerns; session tree mechanics belong upstream | Keep chat/branch registry; map each branch to an Earendil lane/session pointer |
| EF-034 | agent-control handlers | Split | Authentication/parsing is service policy; handlers mutate legacy session runtime | Retain command registry and authorisation; emit typed service/harness commands |
| EF-035 | `formatOutbound` and UI content-block render helpers | Reusable projection | Pure formatting/presentation where it does not infer lifecycle state | Apply after typed outcome; prohibit outcome classification from prose |

## Required target ports

### Service-plane ports

```typescript
interface AcceptedSourceStore {
  accept(request: AcceptSource): Promise<AcceptResult>;
  claimNext(chatJid: string, expectedFrontier: number): Promise<ClaimResult>;
  appendIntent(request: AppendOperationIntent): Promise<AppendIntentResult>;
  settle(request: SettleOperation): Promise<SettleResult>;
  reconcile(chatJid: string): Promise<PiclawOperationSnapshot>;
}

interface TimelinePort {
  commitTerminal(request: CommitTerminalMessage): Promise<CommitTerminalResult>;
  commitIntermediate(request: CommitIntermediateMessage): Promise<CommitIntermediateResult>;
  readOperationArtifacts(operationId: string): Promise<OperationArtifacts>;
}

interface DeliveryOutbox {
  enqueue(request: DeliveryIntent): Promise<DeliveryEnqueueResult>;
  claimNext(): Promise<DeliveryClaim | null>;
  complete(request: CompleteDelivery): Promise<void>;
}
```

All mutations carry:

- Piclaw `operationId`;
- accepted-source sequence;
- expected operation version;
- idempotency key;
- redaction class;
- caller/source provenance.

`settle()` must atomically persist terminal disposition, consume source intents, advance the frontier, release ownership and append successor/wake outbox records. Timeline terminal persistence belongs in the same SQLite transaction where the selected schema permits it; otherwise `settle()` uses a persisted pending-terminal/outbox protocol and never treats an in-memory callback as completion.

### Harness ports

The fixture and later real adapter expose the Earendil-shaped `AgentHarness`/`AgentLane` contract. Piclaw needs a narrower internal adapter:

```typescript
interface HarnessExecutionPort {
  open(request: OpenHarness): Promise<OpenHarnessResult>;
  prompt(request: PromptHarnessRun): Promise<HarnessRunHandle>;
  steer(request: QueueHarnessInput): Promise<HarnessQueueResult>;
  followUp(request: QueueHarnessInput): Promise<HarnessQueueResult>;
  compact(request: CompactHarnessLane): Promise<HarnessCompactionHandle>;
  abort(request: AbortHarnessRun): Promise<HarnessAbortResult>;
  resume(request: ResumeHarnessRun): Promise<HarnessRunHandle>;
  snapshot(lane: HarnessLaneRef): Promise<HarnessLaneSnapshot>;
  close(lane: HarnessLaneRef): Promise<void>;
}
```

Every request contains both Piclaw `operationId` and expected Earendil `runId` where an operation already exists. The adapter rejects a run mismatch before calling the harness.

### Tool effector contract

```typescript
interface PiclawToolEffect<TArgs, TResult> {
  name: string;
  replay: "safe" | "never";
  redact: "metadata" | "result" | "all";
  execute(context: ToolEffectContext, args: TArgs, signal: AbortSignal): Promise<TResult>;
}
```

The fixture converts this to `HarnessTool`. Deterministic fakes record the same metadata and can return, throw, delay, acknowledge-then-throw or ignore cancellation.

### Projection port

```typescript
interface AgentProjectionPort {
  apply(event: CorrelatedHarnessEvent): Promise<void>;
  complete(disposition: PiclawDisposition): Promise<void>;
}
```

The projector accepts only events matching `(chatJid, operationId, runId, generation)` and a monotonic event sequence. It emits allowlisted SSE/status fields and never accepts raw tool arguments/results by default.

## Fake requirements

Each port gets an in-memory deterministic fake with:

- injected monotonic clock and ID source;
- append-only call/result trace;
- configurable fault point before effect, after effect and after acknowledgement;
- duplicate call handling by idempotency key;
- delayed/late completion controls;
- crash snapshot and restore;
- payload redaction assertions.

The fake accepted-source store must use the same transition reference model as the SQLite implementation, but not the same implementation code. The harness fixture may use Earendil's in-memory `Session` backend and `reduceLaneState()`; it must not import Piclaw's existing agent orchestration.

## Tool replay policy

Initial classes:

| Tool/effect class | Replay policy | Examples |
|---|---|---|
| Pure read/query | `safe` | read, search, list, status, bounded introspection |
| Idempotent write with explicit key/version | `safe` after reconciliation | outbox delivery with unique ID, compare-and-set state |
| General mutation | `never` | edit, write, delete, shell, remote workflow, send message |
| Terminal UI/process action | `never` | send card/widget, exit/restart, notification |
| Unknown add-on tool | `never` by default | dynamically installed tools without reviewed metadata |

A `never` tool that has a durable `tool_started` record and no result after restart enters reconciliation/containment. It is not replayed automatically.

## Migration rule

No current module is reused merely because it has tests. Reuse requires the narrow target port, explicit owner identity, deterministic fake and fault-boundary contract. Orchestration modules remain evidence until their last required external effect has moved behind a port.
