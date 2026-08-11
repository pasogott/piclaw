# Selected-version Earendil fixture and semantic contract suite

Status: required while Harness v3 runtime/storage slices remain incomplete. Released `0.84.1` is a stub baseline; authoritative `harness.md` plus draft PR #7976 define the target design/type surface.

The fixture implements the selected Earendil version's public declarations and durable semantics. Released `0.84.1` fixture evidence may follow its v2 session/record model; the target fixture follows Harness v3 entries/registers/usage and manual effects as implementation slices land. It does not imitate Piclaw's current agent loop or promise compatibility with another Earendil version.

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

For the Harness v3 target, the fixture uses the selected public type slice for:

- `Storage`, `Transaction`, `Entry`, typed registers and `UsageRow`;
- `Session`, `SessionTree`, `SessionRepo` and Memory backend/conformance when available;
- `AgentHarness`, `AgentLane`, operation results and `lane.lastResult`;
- typed events, snapshots, hooks and manual actions/effects;
- generic contextual tools, model contracts, compaction/retry and telemetry.

The fixture supplies unavailable runtime slices through the selected public interfaces. An instrumented storage decorator records committed transactions for assertions; production authority remains current entries/registers/usage, not a test log. It implements enough target behaviour to drive semantic cases:

1. atomically accept input plus `op.meta`/initial `op.state` and lane registers;
2. commit provider/tool intent before dispatch;
3. execute deterministic model/tool effects;
4. atomically settle output, usage and next total state;
5. consume queue IDs through `pending.entry` placement transactions;
6. commit cancellation control before signal pull;
7. terminate by deleting operation registers, clearing lane state and writing `lane.lastResult`;
8. expose selected-version manual actions/effects and snapshot-first buffered watches.

Released `0.84.1` record/reducer code remains historical fixture evidence only. No new target case should require `operation_started`, `step_attempt`, `tool_started`, `operation_finished` or a recovery reducer. Piclaw service acceptance, terminal settlement and delivery run in a separate reference implementation around the fixture.

## Manual drive

The fixture supports:

```typescript
await lane.peekAction();
await lane.executeAction();
await lane.runToCompletion();
```

Each `executeAction()` performs at most one selected-version effect/transition. This provides deterministic interleaving with Piclaw commands, faults, restart and cancellation. Harness v3 `ActionInfo` is intentionally generic (`kind`, description and details); the concrete effects boundary covers storage commits, model/tool/deferred effects, hooks and sleeps without freezing v2 action names.

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
    | "corrupt_state";
}
```

Named fault points include every Harness v3 storage transaction/effect boundary, Piclaw acceptance/claim/settlement write, timeline commit, queue delivery, manual action and outbox delivery.

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
- released `0.84.1` only for supported baseline methods/negative capability evidence;
- the pinned Harness v3 draft type/runtime source as slices become usable;
- a later selected released or approved source build.

The report contains:

- pass/fail/unsupported per case;
- normalised Harness v3 storage transactions and terminal current state;
- normalised Piclaw service log;
- selected action/effect trace;
- semantic diff;
- installed package/version/commit/specification metadata.

## Harness-level cases

| ID | Case | Required assertion |
|---|---|---|
| HC-001 | Simple prompt | Acceptance transaction precedes provider intent/effect; terminal transaction yields one result and `lane.lastResult` |
| HC-002 | Tool prompt | Tool `effect_pending` commits before execution; result settlement and final run happen once |
| HC-003 | Parallel tools | Effects may complete out of order; finalisation/result entries commit in source order |
| HC-004 | Safe replay | Restored `effect_pending` tool re-executes only when persisted and current declarations are `safe` |
| HC-005 | Never replay | Restored `never` tool settles interrupted under its reserved result ID and is not executed again |
| HC-006 | Steer | `pending.entry` plus operation inbox owns active-operation steer until one placement transaction consumes it |
| HC-007 | Follow-up | Follow-up remains operation-owned and executes after current work according to queue mode |
| HC-008 | Next run | Lane-level `pendingNextRun` survives terminal cleanup and is captured once by a later operation |
| HC-009 | Abort | Cancellation control commits before signal pull; late model/tool results cannot create a second terminal transaction |
| HC-010 | Compaction | Manual/threshold/overflow structural state, preparation and result entry remain consistent |
| HC-011 | Retry | Captured policy/options and attempt progression survive restore; effective retry options change as specified |
| HC-012 | Suspension | Deferred/missing-identity/crash suspension reports exact current operation and resumes safely |
| HC-013 | Restore | Five current-register reads plus bounded hydration reconstruct open state without history folding |
| HC-014 | Corruption | Invalid current register/reference combinations are rejected, not repaired silently |
| HC-015 | Lane isolation | Operations, configuration and queues do not cross named lanes |
| HC-016 | Close | Close writes nothing, rejects new work, drains admitted commits and leaves open work resumable |
| HC-017 | Manual drive | Manual and automatic drive produce identical durable state; one selected action/effect advances at a time |
| HC-018 | Hooks/events | Typed hook ordering, durable settlement barriers and snapshot-buffer event ordering match the selected harness |
| HC-019 | Usage | Every settled attempt has one `UsageRow`; totals equal ledger sum and do not duplicate |
| HC-020 | Deferred provider | One poll per resume, exact handle lineage, cancel and restart retain the specified outcome |

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
| PC-008 | Restart with open run | Piclaw service log and Harness v3 current state/`lane.lastResult` reconcile without duplicate prompt/tool/delivery |
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
- expected Piclaw service log and Earendil transactions/current state;
- expected delivery cardinality;
- expected terminal disposition and frontier;
- source link to issue/test/evidence.

## Assumption ledger

| ID | Fixture assumption | Evidence | Confidence | Failure response |
|---|---|---|---|---|
| EA-001 | `AgentHarness` public method names and result tags may change | Direct-adoption policy | Expected churn | Update Piclaw and contract cases to the selected version; retain semantic product assertions |
| EA-002 | Harness v3 entries/registers/usage are the target durable protocol | Authoritative `harness.md`; draft PR #7976 type slice | High as design, incomplete runtime | Update fixture to merged selected-version types/storage; no v2 reducer dependency |
| EA-003 | Public `runId` is the durable Harness v3 operation ID | `harness.md` and PR #7976 result types | High as design, incomplete runtime | Correlate directly once selected implementation passes HC-012/013 |
| EA-004 | Steer/follow-up are operation-owned; nextRun is lane-owned | `harness.md` inbox/lane-state design | High as design, incomplete runtime | Validate pending-entry/placement semantics on selected implementation |
| EA-005 | Manual drive exposes one selected action/effect at a time | `harness.md` effects/manual scheduler; PR #7976 generic `ActionInfo` | High as design, incomplete runtime | Update fixture to merged effects API and prove HC-017 |
| EA-006 | Typed snapshot-first buffered watching removes event registration gaps | `harness.md`; PR #7976 typed event/watch contracts | High as design, incomplete runtime | Piclaw still assigns web receipt sequence and validates selected runtime |
| EA-007 | Abort commits cancellation before pulling the harness signal | `harness.md` §4.6 and PR #7976 result/control types | High as design, incomplete runtime | Piclaw's cancellation fence remains outside harness; prove HC-009 |
| EA-008 | Real harness supports deterministic `Models` and generic contextual tools | Harness v3 generic options/tools and manual effects | High as design, type slice drafted | Contract suite supplies direct selected-version implementations |
| EA-009 | Harness v3 backend conformance remains public | `harness.md` build Slice 2; not implemented | Medium | Pin selected source/version and run its unchanged suite |
| EA-010 | Hook/event payloads follow typed Harness v3 maps/unions | `harness.md`; PR #7976 type tests | High as design, incomplete runtime | Adopt selected direct types and update Piclaw on change |

## Acceptance of the fixture design

Implementation may start only when:

- the fixture compiles against the selected Earendil declarations;
- no fixture module imports Piclaw agent-pool/recovery/compaction/process-chat orchestration;
- the selected Harness v3 backend conformance suite passes unchanged;
- every contract case names required capabilities and unsupported real-harness gaps;
- at least one complete golden replay demonstrates crash/restart at every Piclaw settlement boundary and every relevant Harness v3 effect sandwich;
- within one coherent selected Harness v3 source, replacing the fixture factory with the real constructor changes only the factory supplied to semantic cases; on version upgrades, fixture code and Earendil-specific assertions may change while Piclaw service invariants remain explicit;
- version-migration reports record contract changes and Piclaw updates for each selected Earendil upgrade; source compatibility with earlier versions is not required.
