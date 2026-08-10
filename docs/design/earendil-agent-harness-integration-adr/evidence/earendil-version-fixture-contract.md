# Selected-version Earendil fixture and semantic contract suite

Status: required because the installed Earendil `0.84.1` execution harness is a structural preview whose run, queue, abort, lane, watcher and restore methods throw `HarnessNotImplemented`.

The fixture implements the selected Earendil version's public declarations and uses its implemented session/reducer semantics. It does not imitate Piclaw's current agent loop or promise compatibility with another Earendil version.

## Purpose

The fixture lets Piclaw test the service/harness boundary while the selected version's real harness is unavailable. It is disposable: when Piclaw selects a usable Earendil version, the fixture and direct integration update to that version, and the semantic product suite runs against both implementations.

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
├── factory.ts
├── cases.ts
├── service-boundary-cases.ts
├── replay-cases.ts
└── run.ts
```

The future implementation should place fixture code under tests or a non-shipping development package. No production import may resolve to the fixture.

## API shape

The fixture implements the exported public `AgentHarness` surface. Because the concrete class has private members and a private constructor, a separate implementation cannot be nominally assigned to `AgentHarness`. The test type is therefore derived mechanically with `Pick`/`Omit`; no methods or results are restated:

```typescript
import {
  AgentHarness,
  type AgentHarnessOptions,
  type SuspendedOperation,
} from "@earendil-works/pi-agent-core";

type AgentHarnessPublic = Pick<AgentHarness, keyof AgentHarness>;
type RealCreateResult = Awaited<ReturnType<typeof AgentHarness.create>>;
type HarnessCreateResult = Omit<RealCreateResult, "harness"> & {
  harness: AgentHarnessPublic;
};

type CreateHarnessUnderTest = (
  options: AgentHarnessOptions,
) => Promise<HarnessCreateResult>;

const realCreate: CreateHarnessUnderTest = (options) => AgentHarness.create(options);
```

The real `AgentHarness.create` result is assignable to this factory result. The fixture implements exactly the selected version's mapped public surface and uses `AgentLane`, result unions, snapshots, actions, hooks and watchers without renaming them. A compile-time key/signature audit fails when Earendil changes that surface, and Piclaw updates rather than preserving the old shape. Test-only fault/release controls are held by the fixture factory outside the returned harness object.

A separate test support manifest may report which installed methods still throw `HarnessNotImplemented`. It is metadata for selecting/migrating Earendil versions, not an alternative harness interface. Required boundary cases cannot be marked passed by the fixture when the installed implementation is unsupported.

## Fixture internals

The fixture uses public installed Earendil code for:

- `Session`;
- `InMemorySessionRepo`/`InMemorySessionStorage`;
- entry and record contracts;
- result/error types;
- compaction/retry configuration types;
- tool replay metadata.

The installed private reducer implementation is source evidence for expected record semantics, not a fixture import. The fixture reconstructs only enough selected-version behaviour to drive the semantic cases through public session contracts; it must not become production recovery code.

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

The test model is a real Earendil `Models` implementation, preferably `createModels()` with the exported faux provider. Scripted responses are concrete `AssistantMessage` values and deferred steps use `DeferredHandle`; failures follow the `Models` stream/final-message contract rather than a Piclaw provider result union.

Tests hold/release provider streams through test-only controls outside `Models` to create races. Generated message IDs, timestamps and `Usage` values come from injected deterministic sources. Contract cases interact only through `AgentHarnessOptions.models`, `model`, `streamOptions` and harness methods.

## Deterministic tools

Each test tool is an Earendil `HarnessTool` or `AgentHarnessTool` directly. It returns `AgentToolResult`, throws on failure, receives Earendil's `AbortSignal` and optional update callback, and sets `replay` to `safe` or `never`.

Test-only controls can delay completion, record an external effect before throwing, or ignore abort to exercise late results. Those controls are closures captured by the tool implementation; they are not part of the tool contract. The trace stores tool call ID, name, replay policy, result status and effect key. Secret arguments/results are replaced by stable hashes.

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

A simulated crash discards in-memory actors, reopens Piclaw service state and the Earendil `SessionRepo`, then continues through the same public contracts.

## Shared contract runner

```typescript
interface HarnessContractCase {
  id: string;
  run(createHarness: CreateHarnessUnderTest): Promise<ContractEvidence>;
}

async function runHarnessContract(
  createHarness: CreateHarnessUnderTest,
): Promise<VersionMigrationReport>;
```

`ContractEvidence` and `VersionMigrationReport` are test-report DTOs only. They do not wrap or replace Earendil operation results.

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
| HC-013 | Restore | Open operation reconstructs through the selected version's public restore/recovery surface; the 0.84.1 fixture follows observed record semantics |
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
| EA-001 | `AgentHarness` public method names and result tags may change | Direct-adoption policy | Expected churn | Update Piclaw and contract cases to the selected version; retain semantic product assertions |
| EA-002 | Session entry/record protocol is the durable recovery evidence | Public `Session`; installed non-exported reducer implementation | High as 0.84.1 evidence | Update fixture to selected-version public restore/recovery semantics; no private production import |
| EA-003 | `runId` behaviour across suspension/resume follows the selected version | `ResumeOutcome`, suspended operation declarations | Unknown at 0.84.1 runtime | Update Piclaw correlation and semantic expectations to observed selected-version behaviour |
| EA-004 | `steer`/`followUp` queue records remain run-owned; `nextRun` lane-owned | Record union and reducer implementation | High for 0.84.1 | Update acceptance mapping and contract cases |
| EA-005 | `peekAction`/`executeAction` expose one action at a time | Method names and `ActionInfo` declaration | Medium-low | Update the fixture to the selected direct action semantics; do not hide differences behind a Piclaw action type |
| EA-006 | Events/watchers eventually expose enough ordering data to assign a projection receipt sequence | Declared unknown event listeners/watchers | Low | Piclaw projector assigns receipt sequence and reconciles authority from typed snapshots/durable log |
| EA-007 | Abort durably appends intent before returning queued state | Record model and `AbortResult` declarations | Medium | Contract requires this; Piclaw's own cancellation fence remains outside the harness |
| EA-008 | A real harness supports deterministic `Models` and `HarnessTool` implementations | `AgentHarnessOptions` accepts the exported types; pi-ai exports faux provider support | Medium-high | Contract suite supplies direct selected-version implementations; no parallel provider/tool type |
| EA-009 | Session backend conformance remains exported | Package export map | High for 0.84.1 | Pin source/version and port suite if renamed |
| EA-010 | Hook payload shapes may change | All 0.84.1 hook events are `unknown` | Expected churn | Narrow the selected version directly and update Piclaw on change |

## Acceptance of the fixture design

Implementation may start only when:

- the fixture compiles against the selected Earendil declarations;
- no fixture module imports Piclaw agent-pool/recovery/compaction/process-chat orchestration;
- upstream session backend conformance passes for its chosen backend;
- every contract case names required capabilities and unsupported real-harness gaps;
- at least one complete golden replay demonstrates crash/restart at every service settlement boundary;
- within one selected Earendil version, replacing the fixture factory with `AgentHarness.create` changes only the factory supplied to cases; on version upgrades, fixture code and Earendil-specific assertions may change while Piclaw service invariants remain explicit;
- version-migration reports record contract changes and Piclaw updates for each selected Earendil upgrade; source compatibility with earlier versions is not required.
