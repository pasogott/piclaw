# Target architecture and replay model

The reviewed Piclaw effector classification is in [`evidence/effector-inventory.md`](evidence/effector-inventory.md). Implementable future interfaces, adapters over current Piclaw internals, fake contracts and fault cases are specified in [`evidence/future-effector-specifications.md`](evidence/future-effector-specifications.md). [`evidence/earendil-native-effector-contracts.md`](evidence/earendil-native-effector-contracts.md) requires direct use of Earendil's exported harness, session, model, tool, environment, result/error, resource and telemetry types; Piclaw-specific ports are limited to service-plane responsibilities. Harness v3's authoritative entries/registers/usage-ledger design and emerging type contracts are assessed in [`evidence/earendil-harness-v3-assessment.md`](evidence/earendil-harness-v3-assessment.md). The complete proposed Piclaw identity, accepted-source, settlement, cancellation, restart and replay design is in [`evidence/target-state-model.md`](evidence/target-state-model.md). Current Piclaw orchestration and Earendil v2 record-log details remain evidence only.

## Required target invariants

The assessment must test and refine these candidate invariants:

1. Every accepted source has one durable sequence and one lifecycle owner.
2. Prompt, compact, retry, steer, abort and terminal commands carry exact owner identity.
3. Events and command results from stale run, attempt, session or generation identities do not mutate current state.
4. A terminal operation has one immutable disposition.
5. Final output persistence, accepted-source consumption, frontier advancement and ownership release form one atomic settlement boundary or one idempotent transaction protocol.
6. The first accepted cancellation wins and remains scoped to its operation across late events and restart.
7. Tool-call state is monotonic and duplicate results are idempotent.
8. Recovery attempts, elapsed budget and tool use remain bounded.
9. Containment keeps tools disabled until accepted terminal settlement.
10. Restart reconciliation preserves truthful FIFO carry, disposal and successor claims.
11. Scheduler and `runAgent()` output have one delivery owner.
12. UI status and SSE events identify the exact operation and event generation.
13. A harness transcript or in-memory queue is not proof of durable Piclaw acceptance or terminal consumption.

## Target ownership boundary

The ADR must assign each responsibility to one owner. The table below is a hypothesis to validate against Earendil's real API.

| Responsibility | Candidate owner | Status |
|---|---|---|
| Channel authentication and routing | Piclaw | To verify |
| Durable input acceptance and source order | Piclaw | To verify |
| Operation identity and acceptance acknowledgement | Piclaw | To verify |
| Timeline and media persistence | Piclaw | To verify |
| Scheduler intent and delivery policy | Piclaw | To verify |
| Exact cancellation authority | Piclaw | To verify |
| Terminal durable disposition and frontier | Piclaw | To verify |
| Restart reconciliation of Piclaw-owned work | Piclaw | To verify |
| Transcript execution | Earendil harness | To verify |
| Provider/model execution | Earendil harness | To verify |
| Tool execution lifecycle | Earendil harness | To verify |
| Execution-time compaction | Earendil harness | To verify |
| Harness-native execution recovery | Earendil harness | To verify |
| Execution checkpoint or restart token | Earendil harness, if exposed | Unknown API |
| Projection from Earendil events/snapshots to Piclaw status | Piclaw projection service | Direct Earendil inputs; web DTO output |

No final design may share ownership of accepted-input queues, operation completion, cancellation authority, scheduler delivery or terminal persistence.

## State-machine design quality bar

### Piclaw service transition model

Piclaw's service-plane coordinator should have the semantic shape:

```text
reduce(serviceState, serviceEvent) -> { serviceState, commands }
```

This reducer owns accepted sources, Piclaw operation correlation, terminal disposition, frontier and external delivery. It performs no I/O. Command executors call service effectors and direct Earendil methods, then turn results into service events.

Earendil execution is not replayed through this reducer. Harness v3 owns its durable interpreter through `op.state` and atomic storage transactions. Time, IDs, external delivery results and storage faults must be injected into the Piclaw model; model/tool/provider execution uses the selected Earendil contracts. The same Piclaw snapshot and ordered service event stream must produce the same semantic service state and command trace.

### Versioned state, events and commands

The assessment must specify:

- the smallest useful state stages and orthogonal substates;
- versioned external events;
- versioned command and result types;
- operation, run, attempt, session and generation identity;
- monotonic event sequence rules;
- terminal and cancellation precedence;
- schema evolution and replay compatibility.

Adding one event, state or effector should require local additions and an exhaustive compiler or contract failure. It should not require unrelated edits across channel, recovery and persistence modules.

### Effect boundaries

Each command must define:

- owner identity;
- idempotency key;
- precondition or expected version;
- effect class;
- success result;
- retry-safe failure;
- ambiguous `effect-may-have-happened` failure;
- compensation or reconciliation rule;
- redaction policy.

## Replay and fault-boundary standard

The design must support:

- a versioned initial-state snapshot;
- an ordered event record;
- deterministic state and command traces;
- state hashes for divergence detection;
- redaction of model text, tool arguments/results and secrets where full payloads are unnecessary;
- golden replay fixtures;
- fault injection before and after every durable command;
- restart at each durable boundary;
- semantic comparison of live and replayed terminal state.

Replay equality excludes timestamps and generated IDs after normalisation. It includes owner identity, accepted-source order, commands, dispositions, frontier state, cancellation and externally visible delivery counts.

### Minimum golden scenarios

- successful prompt without tools;
- prompt with one tool;
- parallel tool calls and duplicate completion;
- steer during model execution;
- multiple FIFO steers;
- compaction followed by continuation;
- abort before model completion;
- abort during a tool process;
- late model or tool result after cancellation;
- process restart with claimed work;
- context-pressure retry and retry exhaustion;
- mutation containment and accepted terminal release;
- scheduled agent delivery;
- terminal persistence failure before and after the effect;
- successor claim and restart reconciliation;
- stale generation event;
- mobile Compose Abort with exact authority.
