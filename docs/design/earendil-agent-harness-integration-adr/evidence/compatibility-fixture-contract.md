# Earendil compatibility fixture and contract suite

Status: required because the installed Earendil `0.84.1` execution harness is a structural preview whose run, queue, abort, lane, watcher and restore methods throw `HarnessNotImplemented`.

The fixture adopts the installed public declarations and implemented session/reducer semantics. It does not imitate Piclaw's current agent loop.

## Purpose

The fixture lets Piclaw design and test the service/harness boundary before the real harness implementation arrives. It must be disposable: when a usable Earendil harness is installed, the same parameterised contract suite runs against both implementations and reports semantic differences.

The fixture is assessment output. Production implementation follows a separate approved phase.

## Proposed package layout

```text
runtime/test/fixtures/earendil-harness/
├── index.ts
├── create-fixture.ts
├── manual-driver.ts
├── deterministic-model.ts
├── deterministic-tools.ts
├── fault-plan.ts
├── trace.ts
└── types.ts
runtime/test/contracts/earendil-harness/
├── adapter.ts
├── cases.ts
├── service-boundary-cases.ts
├── replay-cases.ts
└── run.ts
```

The future implementation should place fixture code under tests or a non-shipping development package. No production import may resolve to the fixture.

## API shape

The fixture factory mirrors `AgentHarness.create()`:

```typescript
interface HarnessUnderTestFactory {
  name: string;
  capabilities: HarnessCapabilities;
  create(options: AgentHarnessOptions): Promise<{
    harness: AgentHarnessLike;
    suspended: SuspendedOperation[];
    controls: HarnessTestControls;
  }>;
}
```

`AgentHarnessLike` is compile-checked against the public `AgentHarness`/`AgentLane` declaration. The test adapter may narrow unknown event payloads, but it cannot rename public methods or add Piclaw-only lifecycle methods.

```typescript
interface HarnessCapabilities {
  restore: boolean;
  events: boolean;
  hooks: boolean;
  watch: boolean;
  lanes: boolean;
  manualDrive: boolean;
  deferred: boolean;
}
```

A missing capability skips only cases the published real implementation cannot run. Required boundary cases cannot be marked passed by the fixture when the real implementation lacks them; the compatibility report labels them `unsupported`.

## Fixture internals

The fixture uses installed Earendil code for:

- `Session`;
- `InMemorySessionRepo`/`InMemorySessionStorage`;
- entry and record contracts;
- `reduceLaneState()` and `validateRecordLog()`;
- result/error types;
- compaction/retry configuration types;
- tool replay metadata.

It supplies the unavailable execution driver:

1. append `operation_started` before model execution;
2. append provisioned initial messages;
3. append `step_attempt` before each model/compaction/summary effect;
4. execute a deterministic model effect;
5. append assistant result entry;
6. append `tool_started` before each tool effect;
7. append tool results in assistant source order;
8. consume durable steer/follow-up queue records according to queue mode;
9. append `operation_finished` exactly once;
10. expose manual actions matching `ActionInfo`.

The fixture's transition decisions follow the declared Earendil record semantics and minimal agent-loop behaviour. Piclaw service acceptance, terminal settlement and delivery run in a separate reference implementation around it.

## Manual drive

The fixture supports:

```typescript
await lane.peekAction();
await lane.executeAction();
await lane.runToCompletion();
```

Each `executeAction()` performs at most one declared action and appends its durable intent/result. This provides deterministic interleaving with Piclaw commands, faults, restart and cancellation.

Supported action vocabulary matches `ActionInfo`:

- append entry/record;
- move lane/set fact;
- try finish run/finish operation;
- commit follow-up/consume queue item/apply pending write;
- stream assistant;
- execute tool;
- fetch/cancel deferred;
- hook;
- sleep.

The trace records action metadata, not secret payload values.

## Deterministic model

The model driver consumes a scripted queue:

```typescript
type ModelStep =
  | { type: "assistant"; content: ContentBlock[]; stopReason: StopReason; usage?: Usage }
  | { type: "throw"; code: string; message: string }
  | { type: "defer"; handle: DeferredHandle }
  | { type: "wait"; token: string };
```

Tests explicitly release `wait` tokens to create races. Generated message IDs, timestamps and usage values come from injected deterministic sources.

The real-harness adapter uses a fake `Models`/stream function that presents the same script. Contract cases do not inspect fixture model internals.

## Deterministic tools

Tools use the reviewed `PiclawToolEffect` shape and expose an Earendil `HarnessTool` adapter.

```typescript
type ToolStep =
  | { type: "return"; result: ToolResult }
  | { type: "throw"; code: string; message: string }
  | { type: "effect_then_throw"; effectKey: string; error: string }
  | { type: "wait"; token: string; then: ToolStep }
  | { type: "ignore_abort"; then: ToolStep };
```

The test trace stores tool call ID, name, replay policy, result status and effect key. Secret args/results are replaced by stable hashes.

## Fault plan

```typescript
interface FaultPlan {
  at: string;
  occurrence?: number;
  mode:
    | "throw_before"
    | "effect_then_throw"
    | "ack_then_crash"
    | "duplicate_result"
    | "delay_result"
    | "corrupt_record";
}
```

Named fault points include every session append, Piclaw acceptance/claim/settlement write, timeline commit, queue delivery, harness action and outbox delivery.

A simulated crash discards in-memory actors, reopens both journals and continues through the same public adapters.

## Shared contract runner

```typescript
interface HarnessContractCase {
  id: string;
  requires?: (keyof HarnessCapabilities)[];
  run(factory: HarnessUnderTestFactory): Promise<ContractEvidence>;
}

async function runHarnessContract(factory: HarnessUnderTestFactory): Promise<CompatibilityReport>;
```

The runner is test-framework neutral. Bun tests register each case for:

- `fixture`;
- `installed-real` when supported;
- a later selected Earendil package/source build.

The report contains:

- pass/fail/unsupported per case;
- normalised harness log;
- normalised Piclaw service log;
- command/effect trace;
- semantic diff;
- installed package/version/commit metadata.

## Harness-level cases

| ID | Case | Required assertion |
|---|---|---|
| HC-001 | Simple prompt | One run start, initial user entry, assistant entry and one completed finish |
| HC-002 | Tool prompt | Tool start precedes effect; result follows; final assistant settles once |
| HC-003 | Parallel tools | Effects may complete out of order; persisted results follow source order |
| HC-004 | Safe replay | Unresolved `safe` tool resumes/re-executes once according to protocol |
| HC-005 | Never replay | Unresolved `never` tool is reported suspended/blocked and is not executed again |
| HC-006 | Steer | Queue record belongs to active run and is consumed in defined order |
| HC-007 | Follow-up | Follow-up remains run-owned and executes after current work |
| HC-008 | Next run | Lane-level input is captured once by the next operation |
| HC-009 | Abort | Abort request is durable; late model/tool result cannot create second finish |
| HC-010 | Compaction | Manual/threshold/overflow reason and result entry remain consistent |
| HC-011 | Retry | Attempts are consecutive and effective retry options change as specified |
| HC-012 | Suspension | Missing identities are reported; resume requires them and keeps run ID |
| HC-013 | Restore | Open operation reconstructs from bounded log through `reduceLaneState()` |
| HC-014 | Corruption | Invalid log reasons are rejected, not repaired silently |
| HC-015 | Lane isolation | Operations and queues do not cross named lanes |
| HC-016 | Close | Close rejects new operations and disposes active resources once |
| HC-017 | Manual drive | One action per step and `runToCompletion` reaches same semantic terminal trace |
| HC-018 | Hooks/events | Ordering and settlement barriers match selected real harness behaviour |
| HC-019 | Usage | Usage records correlate to run, entry, attempt/tool and do not duplicate |
| HC-020 | Deferred provider | Fetch/cancel and restart retain the same handle and outcome |

## Piclaw boundary cases

These wrap the same harness factory with the Piclaw service reference model and fake ports.

| ID | Case | Required assertion |
|---|---|---|
| PC-001 | Ordinary accepted message | Durable source/operation precede harness prompt |
| PC-002 | Exact steer | Durable target operation and source sequence precede `steer()` |
| PC-003 | Stale steer | No harness queue call; explicit owner-mismatch disposition |
| PC-004 | Exact cancellation | Piclaw cancellation commits before harness abort |
| PC-005 | Stale cancellation | Replacement run remains untouched |
| PC-006 | Late completion after cancellation | One cancelled disposition; late output is observation only |
| PC-007 | Terminal commit fault matrix | No frontier advance before durable terminal row; eventual one disposition |
| PC-008 | Restart with open run | Journals reconcile without duplicate prompt/tool/delivery |
| PC-009 | Pending steer restart | FIFO owner and delivery state survive |
| PC-010 | Protected hand-off | One accepted successor, no tool-free false success |
| PC-011 | Mutation containment | `never` tool uncertainty disables tools until settlement/operator disposition |
| PC-012 | Scheduler agent task | One timeline delivery, one run log and optional one notification |
| PC-013 | Scheduler shell task | Existing shell and Pushover semantics stay unchanged |
| PC-014 | Stale SSE generation | No mutation of current projection |
| PC-015 | Mobile Abort | Fresh status gives exact operation/run and one cancellation |
| PC-016 | Protected evidence | Public traces contain no raw args/results/internal scheduling payload |
| PC-017 | Maintenance failure | Terminal disposition remains committed and delivery is not repeated |
| PC-018 | Trusted internal input | Same acceptance sequence and durability as external input |
| PC-019 | Cross-session steer | Acknowledgement follows durable exact-owner acceptance |
| PC-020 | Goal/checkpoint race | Late accepted steer is consumed, carried or disposed exactly once |

## Golden replay fixtures

Each regression corpus scenario gets a stable fixture ID equal to its `Contract scenario` name. The initial required set contains the 25 scenarios in [`regression-corpus.md`](regression-corpus.md).

Fixture review rules:

- human-readable YAML or JSON with schema version;
- no credentials, raw protected tool data or private timeline content;
- deterministic symbolic IDs;
- explicit input order and fault point;
- expected Piclaw and Earendil logs;
- expected delivery cardinality;
- expected terminal disposition and frontier;
- source link to issue/test/evidence.

## Assumption ledger

| ID | Fixture assumption | Evidence | Confidence | Failure response |
|---|---|---|---|---|
| EA-001 | `AgentHarness` public method names and result tags remain compatible | Installed `0.84.1` declarations | Medium | Compile adapter and emit compatibility diff |
| EA-002 | Session entry/record protocol remains the durable recovery basis | Implemented `Session`, reducer and declaration comments | High for 0.84.1 | Version codec and migrate fixture logs |
| EA-003 | `runId` remains stable across suspension/resume | `ResumeOutcome`, suspended operation declarations | Medium | Keep Piclaw operation correlation capable of run replacement history |
| EA-004 | `steer`/`followUp` queue records remain run-owned; `nextRun` lane-owned | Record union and reducer implementation | High for 0.84.1 | Update acceptance mapping and contract cases |
| EA-005 | `peekAction`/`executeAction` expose one action at a time | Method names and `ActionInfo` declaration | Medium-low | Adapter can derive manual stepping from event/action API if semantics differ |
| EA-006 | Events/watchers eventually expose enough ordering data to assign `eventSeq` | Declared unknown event listeners/watchers | Low | Boundary adapter assigns sequence at receipt and reconciles from durable log |
| EA-007 | Abort durably appends intent before returning queued state | Record model and `AbortResult` declarations | Medium | Contract requires this or Piclaw adds an abort-intent adapter fence |
| EA-008 | A real harness supports deterministic fake `Models` and tools | `AgentHarnessOptions` accepts `Models`, model and tools | Medium | Build provider adapter at stream boundary |
| EA-009 | Session backend conformance remains exported | Package export map | High for 0.84.1 | Pin source/version and port suite if renamed |
| EA-010 | Hook payload shapes are not stable yet | All hook events are `unknown` | High | Do not design Piclaw contracts around concrete hook payloads |

## Acceptance of the fixture design

Implementation may start only when:

- the fixture compiles against the selected Earendil declarations;
- no fixture module imports Piclaw agent-pool/recovery/compaction/process-chat orchestration;
- upstream session backend conformance passes for its chosen backend;
- every contract case names required capabilities and unsupported real-harness gaps;
- at least one complete golden replay demonstrates crash/restart at every service settlement boundary;
- replacing fixture with real harness changes only the factory/adapter, not cases or expected service invariants;
- compatibility reports are committed or attached as review evidence for each Earendil upgrade.
