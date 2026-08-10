# Early Earendil adoption and compatibility fixture

## Early Earendil adoption

### API and package survey

The installed `0.84.1` package survey is recorded in [`evidence/earendil-0.84.1-harness-surface.md`](evidence/earendil-0.84.1-harness-surface.md). It found implemented session contracts and a pure recovery reducer, but the published execution methods, queues, hooks, watchers, lanes and restore path are structural stubs that throw `HarnessNotImplemented`. The compatibility fixture is therefore required until a later Earendil version supplies the execution plane.

Before choosing Piclaw interfaces, the assessment must inventory the pinned Earendil packages and any available future harness source, branch, proposal or example:

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

### Provisional compatibility fixture

The required fixture, deterministic driver/fault model, assumption ledger and parameterised contract cases are specified in [`evidence/compatibility-fixture-contract.md`](evidence/compatibility-fixture-contract.md).

The installed harness cannot execute runs, so the assessment specifies a fixture that mirrors the Earendil package/module structure and names. The fixture remains small and replaceable.

It should model only the lifecycle Piclaw needs:

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

Every provisional symbol needs an assumption record:

The current assumption ledger is in [`evidence/compatibility-fixture-contract.md`](evidence/compatibility-fixture-contract.md) and its coverage status is summarised in [`evidence/traceability-matrix.md`](evidence/traceability-matrix.md). It contains ten versioned assumptions with confidence and failure responses.

The fixture must import no current Piclaw orchestration code. It runs against fake effectors and deterministic model/tool drivers.

### Shared contract suite

One parameterised contract suite must run against both:

1. the provisional fixture; and
2. the real Earendil harness when available.

Tests assert observable lifecycle behaviour, not fixture internals. A real-harness mismatch should produce an explicit compatibility report instead of being hidden behind an adapter that preserves a mistaken fixture design.

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
