# ADR: Earendil-aligned agent harness integration

Status: **Proposed — assessment complete; architecture awaiting Rui's decision**

This ADR proposes how Piclaw replaces its agentic loop with a service-plane coordinator around a selected Earendil agent harness version. The assessment changed documentation only.

## Decision record

| Field | Value |
|---|---|
| Decision owner | Rui Carmo |
| Assessment baseline | Piclaw `v2.13.2` |
| Baseline commit | `0afd3ae645c423bed82deef80c343bcaa6f31d4d` |
| Earendil packages | `pi-coding-agent`, `pi-agent-core`, `pi-ai` and installer-pinned `pi-tui` verified at exact `0.84.1` |
| Document state | Assessment complete; decision requested |
| Production changes | None authorised |
| Final decision | Proposed: select direct Earendil adoption with a selected-version test implementation first |

## Problem

Piclaw has an agentic loop spread across channel handlers, queues, the agent pool, SDK callbacks, compaction and recovery helpers, scheduler delivery, SQLite state and web status handling. Earendil's agent harness is the intended execution plane once Piclaw selects a version with an implemented public surface.

The integration needs a state-machine runner that:

- imports none of Piclaw's existing orchestration or state-machine implementation;
- reuses Piclaw code only through reviewed effector ports;
- records deterministic inputs, transitions, commands and results for replay;
- supports new states, events, effects and recovery behaviour without cross-cutting edits;
- adopts Earendil's public structure, terminology and lifecycle contracts as early as the available APIs permit.

The assessment must preserve existing behaviour deliberately and carry known defects into the design as regression requirements. It must not treat the existing loop as the target architecture.

## Scope

The assessment covers the complete lifecycle of agent work:

1. input acceptance and ordering;
2. operation and session ownership;
3. prompt, model and tool execution;
4. compaction and recovery;
5. cancellation and late results;
6. terminal persistence and queue advancement;
7. restart reconciliation;
8. scheduled agent work;
9. SSE and web status projection;
10. extension and add-on integration points.

The assessment produced this ADR, its evidence tables and a proposed semantic contract suite. It specifies a test implementation of the selected Earendil public contracts because the installed execution harness is incomplete. It does not implement the production runner, change persistence, replay archived fixes or deploy a new runtime.

## Chapters and evidence

- [Assessment method and quality bar](01-assessment-method.md)
- [Bug and regression corpus](02-regression-corpus.md)
- [Target architecture and replay model](03-target-architecture.md)
- [Direct Earendil adoption and selected-version fixture](04-earendil-adoption.md)
- [Alternatives and migration](05-alternatives-and-migration.md)
- [Acceptance plan and open questions](06-acceptance-plan.md)
- [Evidence register](evidence/README.md)
  - [Piclaw v2.13.2 capability matrix](evidence/current-capability-matrix.md)
  - [Agent lifecycle regression corpus](evidence/regression-corpus.md)
  - [Piclaw effector inventory](evidence/effector-inventory.md)
  - [Earendil-native effector contracts](evidence/earendil-native-effector-contracts.md)
  - [Tool, environment and resource migration](evidence/tool-resource-migration.md)
  - [Earendil 0.84.1 adoption constraints](evidence/earendil-0.84.1-constraints.md)
  - [Earendil version-selection policy](evidence/earendil-version-selection.md)
  - [Direct Earendil type audit](evidence/direct-type-audit.md)
  - [Target state, event and settlement model](evidence/target-state-model.md)
  - [Selected-version fixture and semantic contract suite](evidence/earendil-version-fixture-contract.md)
  - [Alternatives, migration and rollback](evidence/alternatives-and-migration.md)
  - [Capability and regression traceability](evidence/traceability-matrix.md)
  - [Assessment quality review](evidence/quality-review.md)
  - [Earendil 0.84.1 harness surface](evidence/earendil-0.84.1-harness-surface.md)

The index is the ADR decision record. Chapters hold the assessment and design analysis. The evidence directory holds registers, captures and replayable scenario descriptions. All files remain part of one ADR.

## Proposed decision

Select the direct-adoption architecture in [`evidence/alternatives-and-migration.md`](evidence/alternatives-and-migration.md), starting with a selected-version test implementation:

- Piclaw retains authenticated acceptance, canonical source order, operation identity, exact cancellation, timeline/media persistence, scheduler/delivery policy, terminal disposition, frontier and restart reconciliation.
- Earendil owns transcript execution, model/tool lifecycle, execution compaction and execution recovery.
- Piclaw imports no current agent orchestration into the replacement path. Piclaw service actions use reviewed service-plane ports; execution uses Earendil's exported harness/session/model/tool/environment contracts directly.
- A test-only implementation of the selected Earendil public contracts and one semantic contract suite precede real-harness integration. Piclaw updates the fixture and integration when Earendil types change; backward source compatibility is not a goal.
- Production remains on the v2.13.2 loop until the real harness and staged migration pass the documented gates.

Rui's approval is required before M1 or any production implementation.
