# Earendil 0.84.1 constraints for direct adoption

This file records what Piclaw must account for when using the installed version's public contracts. It is not a request for Earendil changes.

## Production blockers in this version

### C-001 — Execution harness is incomplete

`AgentHarness` prompt, queue, abort, compaction, navigation, resume, lane, watcher and manual-drive methods throw `HarnessNotImplemented`. Restore rejects sessions containing records.

Piclaw response: use this version for type/fixture assessment only. Select a later working version before production execution.

### C-002 — Coding-agent harness helper is private

`dist/server/create-harness` is absent from the package export map.

Piclaw response: use public agent-core composition at this version. If a later selected version exports a helper, adopt it and delete local composition.

### C-003 — Contextual tool types require closure binding

`AgentHarnessTool<TContext,...>` and `toolContext` exist, while `AgentHarnessOptions.tools` is `HarnessTool[]`. The installed coding-agent helper binds context into tool closures.

Piclaw response: follow that exact closure-binding pattern with public types in test code. Rework it when the selected Earendil API changes.

### C-004 — `HarnessTool` erases the parameter schema

`HarnessTool = AgentTool` uses the default schema and exposes `execute` parameters as `unknown`. Binding a contextual `AgentHarnessTool<TContext, TSchema,...>` to `HarnessTool` requires one assertion back to `Static<TSchema>` after harness validation.

Piclaw response: use a small generic closure binder derived entirely from Earendil/typebox exports; no `any`, copied schema or Piclaw tool interface. Delete/update it with the selected version.

### C-005 — Hook/event payloads are `unknown`

Piclaw response: narrow payloads locally for projection only. Use typed operation results, snapshots and durable session logs for authority. Update narrowing when Earendil types evolve.

### C-006 — Restore/resume semantics are declared but not executable

Piclaw response: keep assumptions explicit in fixture tests; select a version where HC-009/HC-012/HC-013 pass before cutover.

### C-007 — Recovery reducer is not package-exported

The installed files implement `reduceLaneState()` and `validateRecordLog()`, but the package export map exposes only `.`, `./node`, `./session/testing` and `./package.json`; the root index does not re-export the reducer.

Piclaw response: do not deep-import it. Use it as assessment/fixture evidence only. Select a production version with a sufficient public restore/recovery surface.

### C-008 — Bun is outside the declared engine contract

Piclaw response: run public session conformance, execution environment and real harness suites under Bun. If the selected version cannot support Bun, use an explicitly approved runtime boundary or do not adopt it.

## Lower-confidence surfaces

- passive event ordering and correlation to durable record sequence;
- exact `runId` behaviour across restore/resume;
- abort ordering around pending queues and late tool/model results;
- concrete hook payload shapes;
- manual-drive action timing.

Piclaw response: let the selected version's direct contract tests determine behaviour. Do not hide differences behind compatibility interfaces.

## Prohibited workarounds

- private deep imports;
- monkey-patching harness methods;
- Piclaw copies of Earendil result/error/session/tool/environment types;
- a permanent wrapper preserving `0.84.1` method signatures after Earendil changes;
- treating the fixture as a specification that overrides the real harness;
- assuming Bun compatibility without evidence.
