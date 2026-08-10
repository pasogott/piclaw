# Assessment method and quality bar

## Constraints

### No existing Piclaw orchestration

The proposed state-machine runner must not import or call the current Piclaw agent-pool, recovery, compaction-orchestration, queue-orchestration or web turn state machine.

Existing Piclaw code qualifies for reuse only when it is an effector: a narrow adapter that performs an external action or reads/writes an owned resource without deciding the next agent lifecycle transition.

An effector must satisfy all of these tests:

- its input and output can be expressed as a versioned contract;
- it has one named side effect or query responsibility;
- it does not select the next state, retry strategy or terminal outcome;
- it does not infer ownership from "whatever is active";
- it accepts explicit operation, run or generation identity where ownership matters;
- it can be replaced by a deterministic fake;
- its failures can be represented as data and replayed.

Code that mixes I/O with lifecycle policy is not an effector. The assessment must split its required external action from its policy before considering reuse.

### Earendil alignment

The target design should use actual Earendil concepts and public APIs. A local abstraction must not force the future Earendil harness to imitate Piclaw's current loop.

Where the future API is unavailable, the assessment may define a provisional, versioned compatibility fixture. Every fixture field and behaviour must identify its Earendil source or be marked as an assumption.

### Assessment-only change

This phase may change this document only. It must not modify production code, generated bundles, schemas, tests or package pins.

## Assessment quality bar

The assessment is ready for an implementation decision only when an engineer can implement the chosen design without rediscovering Piclaw's material behaviour or inventing an Earendil boundary during coding.

### Evidence standard

Every material behaviour needs source evidence and, where practical, test or runtime-trace evidence. Inference alone is allowed only when marked `inferred` with the missing evidence named.

Evidence claims use these confidence values:

- `proven`: source plus passing test, trace or persisted-state evidence;
- `source-only`: implementation found but no behavioural evidence rerun;
- `test-only`: behaviour asserted but implementation ownership not yet traced;
- `inferred`: reasoned from adjacent evidence;
- `unresolved`: conflicting or missing evidence.

Version, commit and command belong next to each measured claim. Results from the archived post-`v2.13.2` campaign are evidence, not baseline behaviour.

### Functional traceability matrix

Every capability receives one row with these fields:

| Field | Required content |
|---|---|
| Capability ID | Stable identifier used by the ADR and contract suite |
| Capability | Observable behaviour |
| Trigger | Message, steer, control, timer, restart, tool event or scheduler event |
| Preconditions | Relevant durable and in-memory state |
| Current path | Entry point and principal source locations |
| State mutations | Durable and volatile writes |
| Effects | Model, tool, timeline, scheduler, process or notification actions |
| Terminal condition | Success, cancellation, retry, deferral or failure |
| Existing evidence | Tests, traces, issue, PR or operational evidence |
| Known defects | Fixed, open, intermittent or suspected defects |
| Target owner | Piclaw service plane, Earendil harness or boundary adapter |
| Migration disposition | Preserve, replace, simplify or remove |
| Confidence | One evidence confidence value |

A source-file inventory alone does not count as functional capture. The row must describe the externally meaningful transition and its ownership.

### Required capability inventory

#### Input acceptance

- normal interactive messages;
- streaming steers;
- queued follow-ups and reordering;
- protected and ordinary continuations;
- slash controls and cancellation;
- scheduled agent work;
- internal trusted work and add-on initiated work.

#### Ownership and ordering

- chat, branch and session identity;
- accepted-source ordering and cursor/frontier semantics;
- operation identity;
- active owner and generation;
- steer ownership during an active run;
- successor claims;
- queue reservation, materialisation and consumption.

#### Execution

- session creation, restoration, rotation and disposal;
- prompt execution;
- provider and model selection;
- thinking-level state;
- tool discovery, activation, admission and execution;
- tool budgets, ceilings and mutation containment;
- partial text, thought, draft, attachment and usage events.

#### Compaction and recovery

- automatic and manual compaction;
- pre-prompt and in-turn compaction;
- timeout, context-pressure and watchdog paths;
- retry classification and bounds;
- protected recovery and continuation hand-off;
- restart recovery and checkpoints;
- stale event and stale generation rejection.

#### Terminal settlement

- final response persistence;
- tool-complete and no-text outcomes;
- failure and cancellation outcomes;
- exactly-once disposition;
- accepted-source consumption;
- cursor/frontier advancement;
- ownership release;
- post-turn maintenance and next-work wake-up.

#### External presentation and delivery

- timeline rows and media;
- SSE generation and status projection;
- exact operation authority in the web UI;
- Compose Abort;
- notifications;
- task run logs;
- extension and add-on hooks.
