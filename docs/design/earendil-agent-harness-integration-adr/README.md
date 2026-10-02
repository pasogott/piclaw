# ADR: Earendil-aligned agent harness integration

Status: **Pi 1.0.0 current-loop migration merged; pi-durable successor proposed, inactive and awaiting architecture approval**

This ADR proposes a future service-plane coordinator around Earendil durable execution. The [1.0.0 architecture and 45-row HC/PC crosswalk](evidence/earendil-100-durable-crosswalk.md) supersedes the old lane/Drive/Gate design for the selected target. Current-loop migration [#1497](https://github.com/rcarmo/piclaw/pull/1497) merged independently at `5cc738d7c`; neither that merge nor this assessment deploys or activates pi-durable. Original chapters and versioned evidence retain their historical API assumptions and results.

## Decision record

| Field | Value |
|---|---|
| Decision owner | Rui Carmo |
| Assessment baseline | Piclaw `v2.13.2` |
| Baseline commit | `0afd3ae645c423bed82deef80c343bcaa6f31d4d` |
| Earendil runtime selection | Exact published Pi `1.0.0`, gitHead `a13d35a742c6ef8462812a28fbe1d8c8b7431c32`, for the existing loop. Merged through #1497; deployed version is outside this source assessment. |
| Earendil released evidence | Versioned 0.84–0.99.1 receipts remain historical. #1452/#1453 are completed 0.99.1 assessments; no historical result is relabelled as 1.0.0. Current-loop and durable qualification are separate. |
| Earendil planning tip | `main` at `e4c75a73222ae2c72abb5f5314fa35ee8effc508`; historical planning evidence only, superseded for release-candidate assessment by published 0.87.0 |
| Historical implementation capture | `dev` / draft #8963 at `d14d6b22327d545d6a253f932165b63e48d7f9c8`; spec blob `c7c18c74730d4971f8ca004924e44c7fbe236f25`, SHA-256 `1b200eb7b4255d5afd71e17bb4cf54f82e2c5d1d1e24ae87ba97363838251785` |
| Evidence timestamps | Original capture: 2026-09-01 18:30 UTC; 0.85.1 follow-up: 2026-09-17–18; 0.87.0 candidate assessment: 2026-09-21; observations apply only to their recorded revisions |
| Document state | #1493 maps 25 HC and 20 PC intents to pi-durable 1.0.0. Source contracts and the prior paused Memory probe are distinct; #1494 owns fresh semantics/storage qualification. |
| Production changes | Current-loop source dependencies select 1.0.0. This documentation adds no runtime importer, dependency, schema, activation or service-authority transfer. No installation/restart. |
| Final decision | Proposed: public pi-durable execution with Piclaw service authority retained; architecture approval before production implementation. |

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

The original assessment produced this ADR, evidence tables and a proposed semantic suite. Its 0.84.4 scaffold, earlier `dev` observations and 0.85–0.99.1 lane APIs remain historical. Pi-durable 1.0.0 exports stores and functioning bounded watches; these do not establish backend parity, host ownership or crash recovery. It has no public lane Drive or `Gate.admit()`. No production persistence is migrated here.

## Published 0.85.1 admission follow-up

[Package admission and corrected catalogue evidence](evidence/earendil-0851-admission.md) supersedes the old requirement that pi-server become transitive. Fresh supported root imports pass in Bun and real Node, including the minimum declared Node version. The 0.85.1 loop migration was subsequently superseded; Harness activation remains a separate approval. Historical negative evidence below is preserved.

## Chapters and evidence

- [Pi 1.0.0 durable architecture, authority and complete HC/PC crosswalk](evidence/earendil-100-durable-crosswalk.md) — current successor proposal; source evidence, no activation
- [Pi 1.0.0 current-loop migration](evidence/earendil-100-current-loop-progress.md) — independent merged migration

- [Assessment method and quality bar](01-assessment-method.md)
- [Bug and regression corpus](02-regression-corpus.md)
- [Target architecture and replay model](03-target-architecture.md)
- [Direct Earendil adoption and selected-version fixture](04-earendil-adoption.md)
- [Alternatives and migration](05-alternatives-and-migration.md)
- [Acceptance plan and open questions](06-acceptance-plan.md)
- [Published 0.85.1 A/B/C/D work sequence](evidence/earendil-0851-work-sequence.md)
- [Current-loop migration readiness and receipts](evidence/earendil-0851-readiness.md)
- [Broader inactive HC evidence](evidence/earendil-0851-hc-evidence.md)
- [Published 0.87.0 stable Harness candidate evidence](evidence/earendil-0870-harness-candidate.md)
- [Published 0.87.0 experimental Pico3 assessment](evidence/earendil-0870-pico3-assessment.md)
- [Canary procedure](evidence/earendil-0851-canary.md) and [executed piclaw-test receipt](evidence/earendil-0851-canary-result.md)
- [Evidence register](evidence/README.md)
  - [Piclaw v2.13.2 capability matrix](evidence/current-capability-matrix.md)
  - [Agent lifecycle regression corpus](evidence/regression-corpus.md)
  - [Piclaw effector inventory](evidence/effector-inventory.md)
  - [Future effector specifications](evidence/future-effector-specifications.md)
  - [Earendil-native effector contracts](evidence/earendil-native-effector-contracts.md)
  - [Tool, environment and resource migration](evidence/tool-resource-migration.md)
  - [Earendil 0.84.1 adoption constraints](evidence/earendil-0.84.1-constraints.md)
  - [Earendil Harness v3 assessment](evidence/earendil-harness-v3-assessment.md)
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

Use the [pi-durable 1.0.0 proposal](evidence/earendil-100-durable-crosswalk.md) for the next architecture decision:

- Piclaw retains EF-S01/02/05/07/08 acceptance, source order, exact cancellation, atomic terminal settlement, frontier, delivery and projection fences.
- Durable tasks, submissions, entries and documents own execution after host authorisation. No lane/Drive/Gate or immutable usage-row equivalence is assumed.
- Paused recovery remains effect-denied until every resumable subtree is authorised. Progress calls can start recovered work; bounded watches supply observations only.
- Current production orchestration is not imported into the replacement path. Execution uses public package contracts; Piclaw ports retain service-plane responsibilities.
- #1494 qualifies fresh Bun-only storage/semantics after design approval. Historical 0.99.1 receipts remain separate. Production implementation, activation and deployment require explicit approval.

Rui's architecture approval is required before M1 or production durable implementation. Current-loop migration authorisation does not grant it. The original [effector specifications](evidence/future-effector-specifications.md) retain service invariants, but their legacy execution correlations need the versioned migration identified in the crosswalk.
