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

- Where is the future Earendil harness source or design proposal, and which commit should this ADR target?
- Which Earendil lifecycle types are expected to remain stable?
- Does Earendil intend to expose recoverable run state or a restart token?
- Does the harness own tool process groups, or only tool invocation protocol?
- Which transcript events are durable, and who owns transcript persistence?
- Can the real harness run against deterministic fake model and tool providers?
- Which Piclaw persistence actions can form one SQLite transaction, and which require an outbox protocol?
- Which existing modules pass the effector eligibility test without refactoring?
- Which baseline behaviours should be deliberately removed rather than preserved?
- What live shadow period and performance budget are required before cutover?
