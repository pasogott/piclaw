# Direct Earendil adoption and selected-version fixture

## Early Earendil adoption

### API and package survey

The installed `0.84.1` package survey is recorded in [`evidence/earendil-0.84.1-harness-surface.md`](evidence/earendil-0.84.1-harness-surface.md). It found implemented v2 session contracts and a private recovery reducer, but the execution methods, queues, hooks, watchers, lanes and restore path are structural stubs that throw `HarnessNotImplemented`.

Earendil has since consolidated the audited Harness v3 target into [`packages/agent/docs/harness.md`](https://github.com/earendil-works/pi/blob/2a9b4ebc680053c64e31f635b0b22d5e22564001/packages/agent/docs/harness.md). The exact design and draft type-contract implementation are assessed in [`evidence/earendil-harness-v3-assessment.md`](evidence/earendil-harness-v3-assessment.md). Harness v3 replaces the v2 record-log/reducer model with immutable entries, mutable total-state registers and an append-only usage ledger. A selected-version test implementation remains required until a coherent v3 runtime/backend is available.

The fixture and future production code use the selected Earendil version's exact exported types and semantics described in [`evidence/earendil-native-effector-contracts.md`](evidence/earendil-native-effector-contracts.md), not Piclaw equivalents. Piclaw accepts source breakage when selecting a newer Earendil version.

Before choosing Piclaw service interfaces, the assessment must inventory the pinned Earendil packages and each candidate harness source/version:

- public package exports;
- `AgentHarness`, session and run lifecycle types;
- event and callback model;
- transcript ownership;
- model/provider interfaces;
- tool registration and lifecycle;
- compaction hooks and retained state;
- cancellation semantics;
- checkpoint or recovery facilities;
- extension points;
- filesystem and persistence ports;
- disposal and process ownership.

The survey must record exact package versions and source commits. [`docs/earendil-0.84-upgrade-assessment.md`](../../earendil-0.84-upgrade-assessment.md) provides historical evidence but states that Piclaw did not then implement `AgentHarness`, `SessionRepo`, `SessionStorage` or `FileSystem`.

### Selected-version test fixture

The required fixture, deterministic driver/fault model, assumption ledger and parameterised contract cases are specified in [`evidence/earendil-version-fixture-contract.md`](evidence/earendil-version-fixture-contract.md).

The installed harness cannot execute runs, so the assessment specifies a test implementation of the selected contracts. For `0.84.1`, this follows the released surface only as baseline evidence. The target fixture should move to Harness v3's public types as implementation slices land. It remains small and disposable; it changes with the selected Earendil version.

It should implement only the direct contract surface needed by the semantic cases:

- run creation with Piclaw `operation_id` correlation;
- initial input delivery;
- steer delivery;
- transcript events;
- model lifecycle;
- tool lifecycle;
- compaction and checkpoint events;
- abort-signal propagation;
- usage and diagnostics;
- terminal result;
- recoverable state or restart token, if Earendil plans to expose one.

Every selected-version assumption needs an evidence record. The current assumption ledger is in [`evidence/earendil-version-fixture-contract.md`](evidence/earendil-version-fixture-contract.md) and its coverage status is summarised in [`evidence/traceability-matrix.md`](evidence/traceability-matrix.md). It contains ten versioned assumptions with confidence and failure responses.

The fixture must import no current Piclaw orchestration code. Its Harness v3 target uses selected direct `Models`, generic `AgentHarnessTool<TContext>`, `ExecutionEnv`, `Storage`, `SessionRepo`, event/hook and result/error contracts with deterministic test implementations. The released-v2 fixture surface remains historical evidence only.

### Shared contract suite

One parameterised contract suite must run against both:

1. the test implementation of the selected Earendil contracts; and
2. that selected version's real `AgentHarness.create` implementation.

Tests assert observable product invariants through the selected Earendil version's own public types and methods, not fixture internals. A real-harness mismatch produces a version-migration report and corresponding Piclaw/test updates; it is not hidden behind a Piclaw compatibility interface.

The contract suite must cover:

- event order and owner correlation;
- exact steer and cancellation delivery;
- late-result rejection;
- model and tool lifecycle;
- compaction and recovery;
- terminal result cardinality;
- resource disposal;
- deterministic fake provider/tool execution;
- replay trace parity.
