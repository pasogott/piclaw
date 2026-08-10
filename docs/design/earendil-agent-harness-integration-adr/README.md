# ADR: Earendil-aligned agent harness integration

Status: **Proposed — assessment complete; architecture awaiting Rui's decision**

This ADR proposes how Piclaw replaces its agentic loop with a service-plane coordinator around the future Earendil agent harness. The assessment changed documentation only.

## Decision record

| Field | Value |
|---|---|
| Decision owner | Rui Carmo |
| Assessment baseline | Piclaw `v2.13.2` |
| Baseline commit | `0afd3ae645c423bed82deef80c343bcaa6f31d4d` |
| Earendil packages | `pi-coding-agent`, `pi-agent-core`, `pi-ai` and installer-pinned `pi-tui` verified at exact `0.84.1` |
| Document state | Assessment complete; decision requested |
| Production changes | None authorised |
| Final decision | Proposed: select the fixture-first Earendil integration described below |

## Problem

Piclaw has an agentic loop spread across channel handlers, queues, the agent pool, SDK callbacks, compaction and recovery helpers, scheduler delivery, SQLite state and web status handling. The future Earendil agent harness may provide the execution plane that Piclaw currently implements itself.

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

The assessment produced this ADR, its evidence tables and a proposed contract suite. It specifies an Earendil compatibility fixture because the installed execution harness is incomplete. It does not implement the runner, change persistence, replay archived fixes or deploy a new runtime.

## Chapters and evidence

- [Assessment method and quality bar](01-assessment-method.md)
- [Bug and regression corpus](02-regression-corpus.md)
- [Target architecture and replay model](03-target-architecture.md)
- [Early Earendil adoption and compatibility fixture](04-earendil-compatibility.md)
- [Alternatives and migration](05-alternatives-and-migration.md)
- [Acceptance plan and open questions](06-acceptance-plan.md)
- [Evidence register](evidence/README.md)
  - [Piclaw v2.13.2 capability matrix](evidence/current-capability-matrix.md)
  - [Agent lifecycle regression corpus](evidence/regression-corpus.md)
  - [Piclaw effector inventory](evidence/effector-inventory.md)
  - [Target state, event and settlement model](evidence/target-state-model.md)
  - [Compatibility fixture and shared contract suite](evidence/compatibility-fixture-contract.md)
  - [Alternatives, migration and rollback](evidence/alternatives-and-migration.md)
  - [Capability and regression traceability](evidence/traceability-matrix.md)
  - [Assessment quality review](evidence/quality-review.md)
  - [Earendil 0.84.1 harness surface](evidence/earendil-0.84.1-harness-surface.md)

The index is the ADR decision record. Chapters hold the assessment and design analysis. The evidence directory holds registers, captures and replayable scenario descriptions. All files remain part of one ADR.

## Proposed decision

Select the fixture-first architecture in [`evidence/alternatives-and-migration.md`](evidence/alternatives-and-migration.md):

- Piclaw retains authenticated acceptance, canonical source order, operation identity, exact cancellation, timeline/media persistence, scheduler/delivery policy, terminal disposition, frontier and restart reconciliation.
- Earendil owns transcript execution, model/tool lifecycle, execution compaction and execution recovery.
- Piclaw imports no current agent orchestration into the replacement path; reviewed external actions move behind effector ports.
- A test-only Earendil-shaped fixture and one shared contract suite precede real-harness integration.
- Production remains on the v2.13.2 loop until the real harness and staged migration pass the documented gates.

Rui's approval is required before M1 or any production implementation.
