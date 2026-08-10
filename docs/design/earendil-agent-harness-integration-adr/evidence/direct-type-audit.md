# Direct Earendil type audit

This audit checks that the ADR uses Earendil's execution type system directly and defines Piclaw types only for Piclaw service responsibilities.

## Earendil-owned type families

| Family | Direct exported types/values | ADR treatment |
|---|---|---|
| Harness | `AgentHarness`, `AgentHarnessOptions`, `AgentLane`, `Hooks`, `Events`, `WatchHandle` | Use directly; no Piclaw execution port/interface |
| Operation results | `RunResult`, `CompactionResult`, `NavigationResult`, `ResumeResult`, `QueueResult`, `CancelQueuedResult`, `AbortResult` | Preserve exact tagged `Result` unions |
| Harness errors | `LaneBusy`, `MissingIdentities`, `NoActiveRun`, `NoActiveOperation`, `NothingToResume`, `Closed`, related tags, `HarnessFault`, `HarnessClosed` | Match direct tags/classes; no second error taxonomy |
| Actions/snapshots | `ActionInfo`, `LaneSnapshot`, `SessionSnapshot`, `SuspendedOperation` | Fixture/manual drive and reconciliation use exact shapes |
| Session | `SessionRepo`, `SessionStorage`, `Session`, `SessionTree`, `SessionMetadata`, `Entry`, `LaneRecord`, `LogItem`, `SessionError` | Use directly; backend passes upstream conformance |
| Recovery reducer | Installed `reduceLaneState`, `validateRecordLog`, `RecordLogCorruption` | Semantics are evidence at 0.84.1, but symbols are not package-exported; no production deep import or Piclaw execution reducer |
| Models/auth | `Models`, `Model`, `CredentialStore`, `ModelsError`; concrete `ModelRuntime implements Models` | Pass directly in `AgentHarnessOptions` |
| Tools | `HarnessTool`, `AgentHarnessTool`, `AgentToolResult`, `AgentToolUpdateCallback`, `ToolExecutionMode` | Use directly; explicit `safe`/`never` replay |
| Environment | `ExecutionEnv`, `FileSystem`, `Shell`, `FileError`, `ExecutionError`, `NodeExecutionEnv` | Implement/delegate exact no-throw `Result` contract |
| Generic result/error | `Result`, `TaggedError`, `matchError` | May also be used by Piclaw service ports without pretending service errors are harness errors |
| Resources | `Resources`, `Skill`, `PromptTemplate`, sourced loaders | Use directly; commands stay Piclaw service-side |
| Compaction/retry | `CompactionSettings`, `RetryPolicy`, `CompactionError`, helper results | Harness owns execution semantics |
| Telemetry | `TelemetryContext`, `HARNESS_TELEMETRY_SCHEMA`, `AGENT_TELEMETRY_SCHEMAS` | Pass/use directly; Piclaw adds external service spans only |
| JSONL | `JsonlSessionRepo`, `JsonlSessionMetadata`, `JsonlSessionRepoFileSystem` | Preferred initial backend at matching version |
| Built-in tool binding | contextual `AgentHarnessTool<TContext,TSchema,...>` widened to `HarnessTool` | Generic closure binder; one `Static<TSchema>` assertion after harness validation at 0.84.1 |

## Piclaw-owned type families

These have no equivalent harness responsibility and remain Piclaw-specific:

- accepted source and canonical `sourceSeq`;
- Piclaw operation ID/version/phase/disposition;
- correlation to Earendil session/lane/run;
- timeline/media terminal commit request/result;
- delivery outbox intent/claim/result;
- scheduler claim, run-log and notification intent;
- Piclaw web projection DTO;
- service authorization/provenance;
- service restart reconciliation decision.

They may use Earendil's generic `Result`/`TaggedError` utilities. They must not extend or replace an Earendil execution union.

## Parallel types removed from the ADR

The review removed or prohibited:

- `HarnessExecutionPort`;
- `AgentHarnessLike`;
- Piclaw prompt/queue/abort handle/result aliases;
- `PiclawToolEffect`;
- custom model/tool script result semantics presented as production contracts;
- authoritative `HarnessBoundaryEventV1`;
- custom filesystem/shell result/error contracts;
- a permanent coding-agent helper compatibility interface.

Test-only `ContractEvidence`, migration reports, fault controls and Piclaw projection DTOs remain acceptable because they do not replace execution contracts.

## Churn policy

- Earendil types may change between selected versions.
- Piclaw updates direct imports, constructors, tools, environments, fixtures and tests.
- Old and new Earendil type shapes are not supported simultaneously in the new production path.
- Version-specific binding code is deleted when no longer needed.
- Semantic product contracts remain tests, not a frozen copy of Earendil's API.

## Compile probe

A temporary strict TypeScript probe against installed `0.84.1` verified:

- root, `./node` and `./session/testing` public imports used by the design;
- `AgentHarness.create` assignability to the mechanically derived test factory;
- direct `ModelRuntime`/`Models` and `CredentialStore` availability;
- direct local `NodeExecutionEnv` construction;
- the generic contextual built-in tool binder using one `Static<TSchema>` assertion after `HarnessTool` schema erasure.

The first probe correctly failed on private reducer imports and naive contextual tool spreading; the ADR was corrected. The final strict probe passed. The transient source file was deleted.

## Audit result

The ADR now requires direct Earendil types across the entire execution boundary. Remaining custom interfaces in examples are Piclaw service-plane ports or test/report controls. Implementation must enforce this with import-boundary checks and `satisfies` assertions against the selected exact Earendil version.
