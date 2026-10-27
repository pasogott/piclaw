# Core prompt-owner retirement

The Core legacy `runAgentPrompt` loop is deleted. Native SDK tasks/submissions and host accepted-source/terminal records own supported execution. No new prompt loop, compatibility executor or private SDK compaction adapter replaces it.

## Supported caller decisions

| Caller | Execution owner |
|---|---|
| Web input | Accepted native dispatch, same-identity pending observation and native settlement. |
| Dream | Private admitted native invocation, original model/deadline/FD lease and owned cleanup. |
| Add-on operations | Persisted operation/input epoch, current grant/quota/budget fences and private native settlement. |
| Scheduled agent/Dream work | Admitted S07 occurrence, exact lease/source identity and native dispatch. Host shell/internal maintenance remain separate. |
| Non-web AI polling | Explicitly unsupported without host input admission; native polling refuses before queue/cursor/runner side effects. |

`AgentPool.runAgent` remains a rejection-only public boundary for existing caller signatures and API users. It returns the established non-recoverable admission error in every profile, before reading options, creating sessions or changing accounting. It is not a compatibility executor. Remove this boundary and its deprecated `RunAgentOptions` shape when the remaining legacy fallback signatures in Dream/add-on/scheduler/polling are removed; supported paths already use the native ports above.

## Deleted owner and exclusive helpers

Deleted the old orchestrator, retry/recovery phase, attempt budget/context/finalisation controllers, turn coordinator, protected handoff, tool-ceiling/model-stream interception, leaked-tool-subset memory, tool-state transition logger, blank-turn heuristic, model timing collector and recovery-decision types/logic. The turn coordinator is absent from both native and compatibility composition; no throwing tracker object remains.

Native construction no longer raises shared provider retry settings to a legacy minimum. Native request retry policy remains explicitly bounded by its own model bridge. Removed legacy recovery counters instead of reporting synthetic native zeroes.

The retired run-summary log producer and its process-global age-pruning timer are also deleted. Historical log files are preserved. Native structured logging, request accounting and telemetry are independent and remain in use.

## Retained boundaries and remaining work

Root SDK definitions/resource loading, native model/auth/catalog, MCP transports and permission/effect/budget services remain real host dependencies. Explicit resident legacy capture/import readers remain available; they do not execute prompts. Metadata-only branch registration remains owner-fenced and independent of a prompt lifecycle.

The legacy manual-control dispatcher, session/model/queue handlers, direct slash-prompt executor, compact-then-retry helper, compaction timeout/single-flight owner, JSONL rotation and session-idle waiter are deleted. Missing native control authority cannot hydrate a legacy runtime. `AgentPool` dispatches slash commands only through its admitted host command port; the runtime facade has no slash executor. Model activation after login requires the native authentication context and returns the canonical `model_label`.

Two file-history primitives remain for proven consumers: `session-file-persistence.ts` atomically persists an explicit legacy SDK history, and `branch-seeding.ts` retains effective-context replay for historical deferred seeds. They perform no compaction model request, archive rotation, prompt retry or native admission. Their relocated lines receive no deletion credit. The native bootstrap's timeout formatter is local to its only production caller. Historical side-prompt/provider-boundary fixtures keep their private reference helpers outside production; these moved lines are charged separately against net reduction.

Native root SDK definitions/resources, smart summary preparation, provider quota/model catalogue formatting and credential ownership remain. Native manual compaction/reset, model/thinking/auth controls and read-only history still use captured native ports, with SDK maintenance, owner/lifetime guards and accounting unchanged. The two legacy session-idle-wait environment knobs are removed from runtime configuration documentation and marked removed in the support catalogue. Stored configuration/history is untouched.

#1673 stays open for remaining fallback caller signatures, exclusive configuration consumers and the #1672 composition prerequisite. Read-only legacy recovery-settings metadata still has a general-settings consumer; it grants no native retry permission. The compatibility session/resource composition and its final lifetime audit are outstanding.

#1672 retains its final composition/lifetime audit. #1691/#1692 own physical legacy execution-field and UI projection retirement; no historical marker, payload, receipt or database is removed by this code deletion. No dependency upgrade, deployment, restart or live storage/configuration operation is included.

## Evidence

- `retired-prompt-owner.test.ts`: all-profile direct-prompt refusal before option/factory/accounting access; sixteen module absences; unchanged shared retry settings and absence of obsolete recovery instrumentation.
- `manual-control-retirement.test.ts`: retired module/API absence and missing native control authority refusing old runtime factories, mutation and compaction.
- Fresh native import/composition fences require no legacy construction and no turn-coordinator port; they also forbid the retired manual control, slash, retry and rotation modules.
- `compact.test.ts`, `idle-model.test.ts`, `db-tree.test.ts` and `single-database.test.ts` qualify actual native compaction/reset, model fit, scoped pending work, imported history, same-task checkpoint adoption and reopen.
- Native handler/auth/alias/fuzz tests preserve current catalogue, private credentials and one-time model activation. Retired SDK-session mutation/eviction fixtures do not certify native controls.
- Actual native Dream/add-on/SDK quota/budget/cancellation/compaction and web ACK/reopen cases remain the execution acceptance tests; retired legacy mocks do not certify them.
- Retained metadata/SSH/eviction compatibility fixtures hydrate through their actual introspection API, without using a fake prompt to warm a pool.

Handwritten backend LOC and removed ownership/composition layers are measured separately from tests/docs; file relocation and fixture deletion receive no backend reduction credit.
