# Acceptance plan and open questions

Full capability/regression/assumption coverage is recorded in [`evidence/traceability-matrix.md`](evidence/traceability-matrix.md): 59 capabilities, 25 regressions and 10 Earendil assumptions all map to owners, mechanisms and planned tests.

## ADR acceptance criteria

This ADR is complete only when it contains:

1. pinned Piclaw and Earendil baselines;
2. current architecture and responsibility map;
3. completed capability traceability matrix;
4. completed bug and regression corpus;
5. approved invariants;
6. target state, event and command model;
7. Piclaw–Earendil ownership boundary;
8. reviewed effector inventory;
9. Earendil API and source survey;
10. fixture design and assumption ledger, if needed;
11. recording and replay design;
12. failure, cancellation and restart semantics;
13. alternatives with evidence;
14. incremental migration sequence;
15. compatibility and rollback strategy;
16. contract and acceptance-test plan;
17. unresolved questions and Earendil dependencies;
18. traceability from every preserved capability and known bug to a target mechanism and test.

## Definition of done for the assessment

The assessment passes when:

- every agentic public entry point is accounted for;
- every durable lifecycle mutation has one target owner;
- every known bug maps to an invariant and regression scenario;
- every target responsibility has one owner;
- the proposed machine runs without importing Piclaw orchestration;
- golden scenarios replay deterministically;
- the provisional fixture can be replaced by the real Earendil harness behind the same contract suite;
- every unsupported claim is marked as an assumption or unresolved question;
- implementation can be divided into reviewed, reversible increments;
- Rui approves the architecture before production implementation starts.

## Assessment work plan

### Phase 1: Pin evidence

- verify baseline package and installer pins;
- record repository, archive and bundle identities;
- identify available Earendil harness source or proposals;
- define evidence IDs and commands.

### Phase 2: Capture current behaviour

- enumerate all ingress paths and lifecycle owners;
- complete the capability matrix;
- map durable and volatile state;
- trace effect and terminal boundaries;
- rerun representative baseline tests without changing code.

### Phase 3: Build the regression corpus

- inspect issues, PRs, regression tests and archive history;
- reduce incidents to ordered scenarios;
- map each incident to an invariant;
- identify gaps requiring future contract fixtures.

### Phase 4: Survey Earendil

- inventory public and proposed harness structure;
- map Piclaw capabilities to Earendil concepts;
- record gaps and assumptions;
- decide whether a compatibility fixture is required.

### Phase 5: Design and compare

- define state, events, commands and effector ports;
- assign ownership;
- specify replay, fault and restart semantics;
- compare alternatives;
- propose the migration and rollback sequence.

### Phase 6: Review the ADR

- check full capability and bug traceability;
- run an independent design review against the quality bar;
- resolve or label every open assumption;
- request Rui's architecture decision.

## Open questions

The assessment resolves ownership and design questions that can be answered from the current baseline. Remaining questions are implementation gates tied to a future Earendil source and deployment policy.

| Question | Current assessment position | Resolution gate |
|---|---|---|
| Which future Earendil source should production target? | Installed `0.84.1` declarations are the fixture compatibility target; its execution harness is incomplete. | Pin the first usable source commit in M0 and run the shared compatibility report. |
| Which lifecycle types remain stable? | Session record/reducer contracts are implemented at `0.84.1`; execution methods/events are less certain. | Compile and run HC-001–HC-020 for every selected version. |
| Does Earendil expose recoverable run state? | Declarations expose suspended operations, durable records and `resume`; installed restore/resume is not implemented. | HC-012/HC-013 on the selected real harness. |
| Who owns tool process groups? | Piclaw tool effectors retain process tracking; Earendil owns invocation and supplies AbortSignal. | TP process-group and real-harness abort tests before M6. |
| Who owns transcript persistence? | Earendil owns harness transcript/session records; Piclaw owns accepted sources, timeline and dispositions. | Session backend conformance and two-journal reconciliation tests. |
| Can real harness use deterministic fake models/tools? | Options accept `Models`, model and tools; execution is unavailable in `0.84.1`. | HC suite against the selected real harness. |
| Which Piclaw writes share one transaction? | Accepted-source, operation, timeline/media rows, disposition, frontier and outbox should share `messages.db`; otherwise use persisted `settling`. Earendil sessions stay separate. | Schema prototype and SP transaction/fault benchmark in M2. |
| Which modules qualify as effectors? | Classified in `evidence/effector-inventory.md`; orchestration modules are rejected. | Per-port implementation review and import-boundary checks. |
| Which baseline behaviours are removed? | Cursor authority, deferred JSON queue, chat-scoped abort/provenance, Piclaw recovery/compaction loop and direct scheduler agent delivery are migration targets. User-visible capabilities remain unless separately approved. | M0 ADR decision and per-capability implementation issues. |
| What shadow/soak and resource budgets apply? | Metrics and gates are defined; numeric budgets need measured real-harness evidence. | Set numbers after M4 canary measurements and before M6/M7 approval. |
