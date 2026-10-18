# Temporary task-bound model identity shim

`runtime/durable-engine/src/task-model-boundary-shim.ts` is a candidate adapter for
an upstream SDK request-boundary API. It decorates the public `RegistryReader`:
each exported task phase runs in an invocation-local async context holding its
actual `TaskRuntime.taskId`, `conversationId`, `signal`, task kind and phase.
Definitions, checkpoints, versions and installed SDK files are not mutated.

The application model policy can read that context only when its request signal
is the exact invocation signal. Missing, unrelated and aborted signals deny.
The default factory uses it only for its exact owned manual-maintenance task,
`pi.compaction`/`summarize`, while generation retains its existing source hook.
An active maintenance flag alone is never authority. Automatic/generation-owned
compaction is not granted this fallback.

## Upstream shape and removal

An SDK implementation should supply this identity directly at each model request,
independently of selected conversation extensions and on every recovered phase.
The temporary adapter instead wraps phase entry because the current public registry
has no request callback. Its context is task-invocation identity, **not** a durable
per-provider-request ID. Do not use it alone to deduplicate billing or claim atomic
dispatch. Those contracts still need pre-auth reservation, per-send identity and
terminal settlement; caps remain denied.

When the SDK provides the callback, replace `withTaskModelRequestScope` at harness
construction and `taskModelRequestScope` in model policy, then delete this adapter.
Keep tests for exact signal matching, async propagation, phase restart/recovery,
registry replacement/subscription, cancellation and absence of scope leakage.
No dependency pin change is needed for this local adapter.

## Current evidence limits

The direct adapter test and manual compaction fixture cover exact signal authority
through awaited phase execution, observer detach and maintenance reconciliation.
The actual default factory's existing ordinary-conversation regression passes.
Dedicated saved-summary checkpoint replay and a full actual-factory model-backed
compaction regression still require qualification; no claim of arbitrary-crash,
exactly-once, accounting or broad automatic-compaction coverage is made.

Additional local checks cover concurrent phase isolation, registry replacement
without changing old snapshots, and disk-backed close/reopen directly into a
synthetic task's persisted summary phase (3 tests / 17 assertions). This proves the
decorator follows recovered phase execution; it is not real compaction checkpoint
recovery evidence. A bounded shim-only review found no scope/cache/receiver blocker.
Upstream draft API proposal: https://github.com/earendil-works/pi/pull/11104.
