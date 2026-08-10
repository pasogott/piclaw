# Earendil-native effector contracts

Baseline: exported types and implemented semantics in `@earendil-works/pi-agent-core@0.84.1`, `@earendil-works/pi-ai@0.84.1` and `@earendil-works/pi-coding-agent@0.84.1`.

## Rule

Piclaw must not define a parallel execution abstraction over Earendil. Production execution code should use Earendil's exported types and method semantics directly. Piclaw-specific types are limited to service-plane concerns absent from Earendil: accepted input, Piclaw operation correlation, timeline/media settlement, external delivery and web projection.

Allowed composition uses TypeScript's standard `Pick`, `Omit`, generics and declaration merging over Earendil exports. It must not rename a harness method, wrap a tagged harness error in a second error taxonomy, or replace Earendil `Result`/session/tool semantics with a Piclaw equivalent.

## Supported imports

Use public package exports:

```typescript
import {
  AgentHarness,
  type AgentHarnessOptions,
  type AgentLane,
  type RunResult,
  type CompactionResult,
  type NavigationResult,
  type ResumeResult,
  type QueueResult,
  type CancelQueuedResult,
  type AbortResult,
  type SuspendedOperation,
  type LaneSnapshot,
  type SessionSnapshot,
  type ActionInfo,
  type Hooks,
  type Events,
  type WatchHandle,
  type HarnessTool,
  type AgentHarnessTool,
  type AgentHarnessToolContextSource,
  type AgentToolResult,
  type AgentToolUpdateCallback,
  type ExecutionEnv,
  type FileSystem,
  type Shell,
  type FileError,
  type ExecutionError,
  type Result,
  type Session,
  type SessionRepo,
  type SessionStorage,
  type SessionMetadata,
  type SessionTree,
  type Entry,
  type LaneRecord,
  type StepAttemptRecord,
  type ToolStartedRecord,
  type LogItem,
  type JsonlSessionMetadata,
  type JsonlSessionRepoFileSystem,
  type Resources,
  type StreamOptions,
  type Skill,
  type PromptTemplate,
  type CompactionSettings,
  type TelemetryContext,
  JsonlSessionRepo,
  InMemorySessionRepo,
  createReadTool,
  createWriteTool,
  createEditTool,
  createBashTool,
  loadSourcedSkills,
  loadSourcedPromptTemplates,
  HARNESS_TELEMETRY_SCHEMA,
} from "@earendil-works/pi-agent-core";

import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/node";
import { createSessionBackendConformance } from "@earendil-works/pi-agent-core/session/testing";

import type {
  Api,
  Model,
  Models,
  CredentialStore,
  AssistantMessage,
  DeferredHandle,
  Usage,
} from "@earendil-works/pi-ai";

import { ModelRuntime } from "@earendil-works/pi-coding-agent";
```

The installed coding-agent package contains `dist/server/create-harness.js`, but its export map does not expose that path. Piclaw must not use this private deep import. Build from public agent-core exports at the selected version; if a later Earendil release exports the helper, adopt that release's public composition and remove Piclaw's temporary composition code.

## Direct harness boundary

Do not add `HarnessExecutionPort`, `AgentHarnessLike`, `PromptHarnessRun`, `HarnessRunHandle` or renamed queue/abort result types.

The runtime registry stores actual Earendil objects:

```typescript
interface PiclawHarnessBinding {
  readonly harness: AgentHarness;
  readonly lane: AgentLane;
  readonly suspendedAtOpen: readonly SuspendedOperation[];
  readonly piclawOperationId: string;
  readonly sessionId: string;
  readonly laneName: string;
  runId: string | null;
}
```

`PiclawHarnessBinding` is a service correlation record. It does not change harness behaviour. Calls and results remain exact:

```typescript
const run: RunResult = await binding.lane.prompt(promptMessages);
const queued: QueueResult = await binding.lane.steer(steerMessage);
const followUp: QueueResult = await binding.lane.followUp(followUpMessage);
const compacted: CompactionResult = await binding.lane.compact({ customInstructions });
const aborted: AbortResult = await binding.lane.abort();
const resumed: ResumeResult = await binding.lane.resume();
```

Expected rejection uses Earendil's tagged `Result` errors (`LaneBusy`, `NoActiveRun`, `NoActiveOperation`, `MissingIdentities`, `NothingToResume`, `Closed`, and related tags). Piclaw matches `_tag` or the exported `.is()` predicates. It does not catch an expected rejection and convert it to a second generic exception.

Unexpected implementation faults may throw `HarnessFault`, `HarnessClosed` or another `Error`; these are faults, not ordinary result branches.

## Direct session persistence

Earendil owns transcript/session mutation through `SessionRepo`, `Session`, `SessionStorage`, `Entry`, `LaneRecord` and `LogItem`.

Piclaw should first use the exported `JsonlSessionRepo` rather than inventing a session schema. Its filesystem dependency is already typed as:

```typescript
type JsonlSessionRepoFileSystem = Pick<
  FileSystem,
  | "absolutePath"
  | "joinPath"
  | "readTextFile"
  | "writeFile"
  | "appendFile"
  | "renameFile"
  | "fileInfo"
  | "listDir"
  | "exists"
  | "createDir"
  | "remove"
>;
```

The repository preserves source format 3 or 4 metadata, supports lanes/forks and uses Earendil's single mutation sequence. Piclaw chat/operation correlation remains in Piclaw's database; it may place bounded application metadata in `JsonlSessionMetadata.metadata`, but that metadata cannot become the Piclaw source of record.

Any new backend implements `SessionRepo`/`SessionStorage` exactly and passes `createSessionBackendConformance()`. It must preserve Earendil `SessionError` codes and query semantics. Piclaw does not wrap it in another transcript repository interface.

The installed files contain `reduceLaneState()` and `validateRecordLog()`, but `@earendil-works/pi-agent-core@0.84.1` does not export them through `.`, `./node` or `./session/testing`. Direct-adoption policy therefore forbids importing them in Piclaw production code. The selected production version must expose the reducer/validation needed for external recovery, or Piclaw treats `AgentHarness.create`/snapshots/session APIs as the only supported recovery surface. The `0.84.1` test fixture may test the observed reducer semantics internally, but cannot make a private import part of Piclaw's production contract. Piclaw must not implement a second reducer for Earendil entries/records.

## Direct model and credential contracts

Piclaw's installed `ModelRuntime` already implements `Models`. Pass it directly:

```typescript
const options: AgentHarnessOptions = {
  session,
  models: modelRuntime,
  model: selectedModel,
  // ...
};
```

There is no `PiclawModelEffector` or stream wrapper. Earendil calls `Models.streamSimple`, `fetchDeferred` and `cancelDeferred` with its exact semantics.

Piclaw's `FileCredentialStore` already implements Earendil `CredentialStore`. Keep that direct contract. `CredentialStore.modify()` remains the only serialized write path; no alternate keychain credential interface is introduced at the harness boundary.

Piclaw may continue using `ModelRuntime`-specific registration/status methods outside the harness, since `ModelRuntime` is the concrete `Models` implementation. Harness construction accepts it as `Models`.

## Direct `ExecutionEnv` contract

Filesystem and shell effects use Earendil `ExecutionEnv`, which is exactly `FileSystem & Shell`.

Important semantics:

- all `FileSystem` operation methods resolve `Result<T, FileError>` and must never throw/reject;
- `Shell.exec()` resolves `Result<{stdout, stderr, exitCode}, ExecutionError>`;
- `FileError.code` and `ExecutionError.code` are the selected version's error taxonomy;
- `cleanup()` is best effort and must not throw/reject;
- paths are relative to `env.cwd` unless absolute;
- symlinks are not followed implicitly; `canonicalPath()` is explicit;
- abort is supplied through the method's `AbortSignal`/`ShellExecOptions.abortSignal`.

For ordinary local tools, prefer the public `NodeExecutionEnv` directly if it meets Piclaw's process/security requirements.

Piclaw needs a custom `ExecutionEnv` implementation only for semantics the public environment does not provide, principally:

- keychain-backed shell environment resolution;
- session-scoped SSH filesystem/shell routing;
- Piclaw process tracking/observability requirements.

That implementation must still expose Earendil methods and `Result` errors exactly. It can delegate to `NodeExecutionEnv` locally and a remote backend for SSH. It must not expose a Piclaw-specific filesystem or shell interface to the harness.

A per-turn environment snapshot should use `AgentHarnessOptions.toolContext`, not global mutable tool routing. The installed declarations expose `AgentHarnessToolContextSource<TContext>` and contextual `AgentHarnessTool<TContext,...>`, but `AgentHarnessOptions.tools` currently accepts non-contextual `HarnessTool[]`. The private coding-agent helper resolves this by binding context into each tool closure before `AgentHarness.create()`.

Piclaw must not invent another tool interface to bridge this mismatch or prescribe an upstream API. At `0.84.1`, a direct `HarnessTool` may close over a Piclaw-owned context source exactly as the installed coding-agent helper does:

```typescript
interface PiclawToolContext {
  env: ExecutionEnv;
  chatJid: string;
  operationId: string;
}

const contextSource: AgentHarnessToolContextSource<PiclawToolContext> = async () => ({
  env: await resolveExecutionEnv(chatJid),
  chatJid,
  operationId,
});

const contextual: AgentHarnessTool<PiclawToolContext, typeof schema, Details> = createTool();
const bound: HarnessTool = {
  ...contextual,
  async execute(id, params, signal, onUpdate) {
    const context = typeof contextSource === "function" ? await contextSource() : contextSource;
    return contextual.execute(id, params, signal, onUpdate, context);
  },
};
```

This binding preserves Earendil's exact tool types and result semantics. It is temporary version-specific composition code, not a Piclaw execution abstraction. When Earendil changes this surface, Piclaw updates to the new direct type shape and deletes the binding even if that causes local churn. `chatJid` and `operationId` are application metadata for Piclaw-specific tools; built-in tools need only `{ env }`.

## Direct built-in tool contracts

Use Earendil's built-in tools rather than wrapping Piclaw's legacy read/write/edit/bash definitions. At `0.84.1`, bind each exported contextual tool before widening it to `HarnessTool`. The binding is a generic function over Earendil's own `AgentHarnessTool` type, not a Piclaw tool interface:

```typescript
import type { Static, TSchema } from "typebox";

function bindTool<TContext extends object | undefined, TSchemaValue extends TSchema, TDetails>(
  tool: AgentHarnessTool<TContext, TSchemaValue, TDetails>,
  contextSource: AgentHarnessToolContextSource<TContext>,
  replay: "safe" | "never",
): HarnessTool {
  return {
    ...tool,
    replay,
    async execute(id, params, signal, onUpdate) {
      const context = typeof contextSource === "function"
        ? await contextSource()
        : contextSource;
      // HarnessTool erases TSchema to unknown at 0.84.1; the harness has
      // already validated params against tool.parameters before this call.
      return tool.execute(id, params as Static<TSchemaValue>, signal, onUpdate, context);
    },
  };
}

const tools: HarnessTool[] = [
  bindTool(createReadTool<PiclawToolContext>(), contextSource, "safe"),
  bindTool(createWriteTool<PiclawToolContext>(), contextSource, "never"),
  bindTool(createEditTool<PiclawToolContext>(), contextSource, "never"),
  bindTool(createBashTool<PiclawToolContext>({ prepare }), contextSource, "never"),
];
```

The generic keeps each parameter schema until the closure is created; widening to `HarnessTool` afterwards is intentional. At `0.84.1`, `HarnessTool` erases the schema parameter and exposes `params` as `unknown`, so the single `Static<TSchemaValue>` assertion restores the validated schema at the delegation point. No `any` or second schema is introduced. Context is resolved per invocation as the installed helper intends. The exact timing follows the selected Earendil version; Piclaw does not add a persistent context API.

The built-ins already implement:

- Earendil `AgentHarnessTool` execution signatures;
- `ExecutionEnv` access;
- path handling and file-mutation serialization;
- abort propagation;
- read/bash output truncation;
- streamed bash updates;
- exact edit validation/diff details;
- tool errors as thrown errors at the tool boundary.

The harness persists `ToolStartedRecord.replay` and the effective arguments before result persistence. Piclaw must set `replay` explicitly on every supplied tool because the declared property is optional while the durable record requires a concrete value.

Do not add a separate `PiclawToolEffect` interface. A Piclaw-specific tool is an Earendil `HarnessTool`/`AgentHarnessTool` directly:

```typescript
const tool: HarnessTool = {
  name: "example",
  label: "example",
  description: "...",
  parameters: schema,
  replay: "never",
  async execute(toolCallId, params, signal, onUpdate) {
    // return AgentToolResult; throw on failure
  },
};
```

If it needs Piclaw context, use `AgentHarnessTool<PiclawToolContext, ...>` and the exact five-argument execute signature. Do not rename `AgentToolResult`, `AgentToolUpdateCallback`, `executionMode`, `terminate`, `usage` or `addedToolNames`.

## Harness-owned effect execution

Earendil's manual-drive `ActionInfo` already defines the execution effects. Piclaw must not create duplicate effectors for these actions.

| `ActionInfo.kind` | Earendil contract that performs it | Piclaw role |
|---|---|---|
| `append_entry` | `Session.appendEntry()` / `SessionStorage.appendEntry()` | Observe/correlate only |
| `append_record` | `Session.appendRecord()` / `SessionStorage.appendRecord()` | Observe/correlate only |
| `move_lane` | `Session.moveLane()` | Maintain Piclaw branch correlation |
| `set_fact` | `Session.setName()` / `setLabel()` | Project optional metadata |
| `stream_assistant` | `Models.streamSimple()` with `Model`, stream options and retry policy | Supply concrete `Models`/model; do not wrap stream semantics |
| `execute_tool` | exact `HarnessTool.execute()` | Supply direct tool definitions/context/environment |
| `fetch_deferred` | `Models.fetchDeferred()` | Supply `Models`; project status only |
| `cancel_deferred` | `Models.cancelDeferred()` | Piclaw cancellation fence precedes harness action |
| `hook` | `Hooks.on()` registrations | Register supported direct hooks |
| `sleep` | harness retry scheduler | Observe progress/deadline; no second retry timer |
| `consume_queue_item` | harness queue/session records | Reconcile Piclaw accepted source to durable harness state |
| `apply_pending_write` | harness session storage | No Piclaw duplicate write |
| `commit_follow_up` | harness queue/session protocol | Reconcile delivery/consumption |
| `try_finish_run` / `finish_operation` | harness reducer and `operation_finished` record | Use typed result as Piclaw terminal candidate; Piclaw still commits service disposition |

Piclaw effectors begin outside this table: service acceptance, timeline/media transaction, external delivery, notifications and web projection. Session storage, model calls, tools, hooks and harness retry/compaction are Earendil-owned effects.

## Direct replay policy

Earendil supports exactly `"never" | "safe"` on `HarnessTool` and persists it in `ToolStartedRecord`. Piclaw adds no third replay state.

| Class | Earendil replay value | Examples |
|---|---|---|
| Deterministic read/query with no external mutation | `safe` | read, list, search, status, bounded introspection |
| General filesystem/process/network mutation | `never` | write, edit, bash, delete, send, remote workflow |
| Idempotent application mutation | `safe` only after reviewed exact-key reconciliation | compare-and-set/outbox operation with stable idempotency key |
| Unknown add-on tool | `never` | default until metadata and recovery are reviewed |

An unresolved `never` call follows Earendil suspended/recovery semantics and Piclaw containment policy. Piclaw does not silently reinterpret it as safe.

## Direct resources

Harness resources use Earendil `Resources`, `Skill` and `PromptTemplate` directly. Loaders can use `loadSourcedSkills()` and `loadSourcedPromptTemplates()` with an `ExecutionEnv`; Piclaw provenance can be preserved in the generic source value and mapped to an extended `Skill`/`PromptTemplate` type.

```typescript
const resources: Resources = {
  skills,
  promptTemplates,
};
```

Commands are not an Earendil harness resource. Piclaw slash commands stay in the Piclaw service plane and call exact `AgentLane`/`AgentHarness` methods or Piclaw service operations after authorization.

The installed `createCodingAgentHarness()` helper is a private deep module, not a package export. At `0.84.1`, use public agent-core tools/resources and a Piclaw-owned `systemPrompt` callback passed through `AgentHarnessOptions`. If a selected later release exports coding-agent composition, adopt its public types and remove the local composition.

## Direct compaction and retry semantics

Use Earendil's:

- `CompactionSettings` in `AgentHarnessOptions.compaction`;
- `RetryPolicy` in `AgentHarnessOptions.retry`;
- the selected version's `StreamOptions` (`SimpleStreamOptions` at `0.84.1`) in `streamOptions`;
- `AgentLane.compact()` and `CompactionResult`;
- `StepAttemptRecord` with `manual | threshold | overflow` compaction reasons;
- `CompactionError` codes;
- suspended/resume outcomes.

Piclaw may choose product defaults and deadlines before constructing/configuring the harness. It does not wrap compaction in a second Piclaw single-flight/retry/rotation state machine.

## Direct hooks, events and watchers

Use `Hooks`, `Events`, `WatchHandle<LaneSnapshot>` and `WatchHandle<SessionSnapshot>` directly.

The installed declarations type hook/event payloads as `unknown`. Piclaw must therefore:

- register only documented hook names;
- narrow payloads at the boundary;
- treat passive events as projection hints;
- use `LaneSnapshot`, `SessionSnapshot` and durable session logs for authority/recovery;
- avoid defining an alternative authoritative harness event union.

Piclaw may define a separate **web projection DTO** after narrowing/redaction. That DTO is not a harness event type and cannot drive execution state.

Manual execution uses Earendil `ActionInfo` directly from `peekAction()`/`executeAction()`. The test fixture must produce the exact action union; it does not define renamed action commands.

## Direct telemetry

Pass Piclaw's `TelemetryContext` through `AgentHarnessOptions.context` and use Earendil's `HARNESS_TELEMETRY_SCHEMA`/`AGENT_TELEMETRY_SCHEMAS` directly.

The schema already covers run, compaction, navigation, checkpoint, turn, step, tool, hook, sleep, event handler and session write spans. Piclaw adds an external parent/service span for accepted-source and terminal-settlement work; it does not duplicate harness spans under Piclaw names.

Tool arguments/results and secrets remain absent from telemetry. Piclaw correlation may be carried in its service parent span/baggage where the telemetry implementation supports it; Earendil's `pi.operation.id` continues to mean the harness durable operation ID.

## Exact error semantics

| Boundary | Expected failure mechanism |
|---|---|
| Harness operation methods | Earendil `Result<T, TaggedErrorUnion>` |
| Harness programming/runtime fault | thrown `HarnessFault`, `HarnessClosed` or `Error` |
| Filesystem operation | resolved `Result<T, FileError>`; never throw/reject |
| Shell execution | resolved `Result<T, ExecutionError>` |
| Session storage/repository | rejected `SessionError` with the selected version's code |
| Tool execution | throw on failure; harness converts to tool-result error semantics |
| Models request | stream/final assistant error semantics; `ModelsError` for auth/catalog operations as documented |
| Compaction helper | `Result<T, CompactionError>` |

Piclaw service-plane stores may use Earendil's generic `Result<T, TError>` and `TaggedError()` utility, but their error tags remain explicitly Piclaw service errors. They must not masquerade as harness errors.

## What remains Piclaw-specific

Only service-plane effects need Piclaw contracts:

- accepted-source transaction and sequence;
- Piclaw operation claim/version/disposition;
- operation-to-session/lane/run correlation;
- timeline/media terminal transaction;
- external delivery outbox and run log;
- scheduler claim/next-run policy;
- web/SSE projection DTOs;
- notification delivery;
- service restart/reconciliation coordination.

These contracts can use Earendil's generic `Result`/`TaggedError` utilities, but they are not added to `AgentHarnessOptions`, `AgentLane`, `SessionStorage`, `ExecutionEnv` or `HarnessTool`.

## Implementation checks

- imports come from public package exports only;
- `ModelRuntime satisfies Models` and Piclaw credential storage satisfies `CredentialStore` at compile time;
- local/SSH execution environments satisfy `ExecutionEnv` and its no-throw `Result` contract;
- all tools satisfy `HarnessTool` with explicit replay metadata;
- session backend passes the public conformance suite unchanged;
- no private reducer import is used in production;
- fixture actions satisfy `ActionInfo` and operation results retain exact Earendil result types;
- no `HarnessExecutionPort`, `AgentHarnessLike`, `PiclawToolEffect`, custom filesystem/shell result or duplicate harness error taxonomy exists;
- projection DTOs are named Piclaw/web projections and never treated as harness authority.
