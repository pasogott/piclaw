# Earendil version-selection constraints

Piclaw follows Earendil's type system and semantics. It does not require Earendil to preserve Piclaw compatibility or accept Piclaw-designed APIs.

## Policy

- Select an Earendil commit/package version whose public harness can satisfy Piclaw's required product behaviour.
- Import and use that version's public types directly.
- Treat compilation failures and semantic contract failures on an upgrade as normal migration work.
- Prefer deleting Piclaw compatibility code over preserving old Earendil shapes.
- Pin all Earendil packages at one exact reviewed version during migration; update them together even when this causes broad Piclaw changes.
- Do not use private deep imports to avoid upgrading or adapting.
- Do not maintain two Earendil type dialects in production or add shims solely to keep an older selected version compiling.
- Keep only Piclaw service-plane types that represent responsibilities Earendil does not own.

## Current 0.84.1 constraints

The installed version is useful for assessment because it contains the exported session model, reducer, action vocabulary, tools, environment, models and telemetry types. It is not a production execution target because most `AgentHarness` operations are unimplemented.

Piclaw may build a test fixture against `0.84.1` declarations to make the service boundary concrete. Before production work, reassess the latest selected Earendil version and update the fixture/contracts to that exact shape. There is no promise that a fixture compiled against `0.84.1` remains source-compatible.

## Upgrade workflow

For each Earendil candidate:

1. update all exact Earendil package pins together;
2. compile Piclaw's direct imports and `satisfies` checks;
3. update local construction/context binding to the candidate's API;
4. run upstream session backend conformance unchanged;
5. run HC-001–HC-020 through the candidate's real `AgentHarness.create`;
6. run PC-001–PC-020 and golden replay fixtures;
7. inspect semantic differences in result tags, records, actions, snapshots, tools, errors and telemetry;
8. remove obsolete Piclaw glue rather than retaining both paths;
9. record the selected version and evidence in the ADR/release review.

## Acceptable churn

The following can change on the Piclaw side without blocking adoption:

- constructor and option wiring;
- tool-context binding;
- resource loading/composition;
- event narrowing and web projection;
- session backend setup;
- model/provider construction;
- hook registrations;
- test fixtures and expected traces;
- Piclaw modules that only existed to emulate an older Earendil API.

## Non-negotiable Piclaw responsibilities

Version churn cannot transfer these service responsibilities into an in-memory harness by accident:

- authenticated source acceptance and canonical ordering;
- Piclaw operation identity and exact cancellation authority;
- timeline/media and scheduler delivery policy;
- immutable terminal disposition and accepted-source frontier;
- external delivery idempotency;
- service restart reconciliation between Piclaw state and Earendil session state.

If a future Earendil release offers durable service features that could replace these, adopting them requires a new ADR decision based on their actual contracts. This ADR does not build a compatibility layer pre-emptively.
