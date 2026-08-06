# Earendil 0.84 upgrade assessment

Status: ready for reviewed PR and canary observation

Assessment commit: `da08de8b1489ab88ca7388e618680e31bbe2086f`

Baseline:

- Piclaw `v2.12.12`
- Earendil `0.83.0`
- baseline release commit `8ba84aaf4f1ca9bea9f33cedc759cef5e660b481`
- compaction-fixed main used for the assessment: `0d98688371ed49392890a769a07e5bd0d9de9fcf`

## Required Piclaw changes

Earendil 0.84 changes the model refresh and provider publication contracts.

Piclaw now:

- updates `PiclawModelRegistry.refresh()` to accept `ModelsRefreshOptions` and return `ModelsRefreshResult`;
- preserves aborted state and provider errors through the session-affinity compatibility wrapper;
- replaces GitHub Copilot `context.store` access with immutable `context.stored` snapshots and generation-checked `context.publish()` calls;
- applies cached and live Copilot catalogue state only after the publication is accepted;
- scopes refresh coalescing to the exact abort signal so an aborted older generation cannot suppress a newer refresh;
- preserves nullable `ProviderHeaders` through pi-ai stream requests;
- converts nullable headers to string-only headers only at the direct provider-native HTTP boundary.

## Breaking changes with no Piclaw migration

- `ModelRuntime.setRuntimeApiKey()` is not called by Piclaw.
- Piclaw has no config-form OAuth `refreshToken` callback.
- JSON/RPC `message_update` removes cumulative partial messages, but Piclaw embeds `AgentSession` and does not use the Earendil RPC client. Core in-process events still include `partial`.
- Piclaw does not implement Earendil `SessionRepo`, `SessionStorage`, `AgentHarness`, or `FileSystem`.
- The v4 agent-core repository and required `FileSystem.renameFile()` therefore do not affect Piclaw's persistence port.
- Baseten appears through the upstream provider catalogue. No Piclaw UI or configuration change is required.
- `samplingParams` remains an advanced `models.json` feature.
- remote sessions, Markdown transformers, fullscreen TUI, Mermaid and LaTeX are upstream CLI features. Piclaw uses its own web UI and does not use the new RPC client.

## Compatibility evidence

Local validation on Earendil 0.84:

- typecheck: passed
- lint: passed
- stale-dist: passed
- pack hygiene: passed
- model/provider migration contracts: 35 passed
- provider/model suite: 267 passed across 29 files
- session persistence/rotation: 42 passed
- recovery/tool/private-canary suite: 82 passed, 3 pre-existing skipped
- combined affected suite: 347 passed, 3 pre-existing skipped
- canonical `ci-fast`: 3,825 passed, 3 pre-existing skipped, 0 failed
- feature suite: 23 passed
- web-build suite: 9 passed

The three skipped pre-prompt compaction tests were already skipped on the 0.83 baseline and are not counted as passing evidence.

## Package and build evidence

- npm tarball: 29.65 MB packed, 63.36 MB unpacked, 1,004 files
- Linux x64 portable bundle: 187,593,580 bytes
- Linux x64 baseline portable bundle: 187,507,161 bytes
- production frozen install in both portable builders: 378 packages
- classic and visual web builds: passed
- generated web source assets: unchanged

New transitive packages:

- `@earendil-works/pi-client`
- `@earendil-works/pi-protocol`
- `@earendil-works/pi-telemetry`
- `grok-mermaid`
- `undici` 8.5 to 8.9

The Earendil packages declare Node >=22.19. Piclaw's supported runtime and release paths use Bun 1.3.14. This container does not provide Node, and no Node-only Piclaw execution path was validated.

A clean `bun install -g piclaw-2.12.12.tgz` triggers a Bun 1.3.14 dependency-loop error that resolves the package repository URL back to Piclaw. The tarball contains no self-dependency. Portable production staging and installation pass. This is baseline packaging debt and is not caused by Earendil 0.84.

## Disposable microVM evidence

Target: `piclaw-test`, VM 900 on node `radxax4`.

Upgrade:

- baseline: Piclaw 2.12.11, Earendil 0.83.0
- canary: Piclaw 2.12.12 assessment build, Earendil 0.84.0
- service PID changed and HTTP returned 200
- background model refresh completed with zero provider errors
- 31 models were available, including dynamic GitHub Copilot models
- bounded Copilot side prompt returned exactly `EAR84_OK` with stop reason `stop`

Database before and after upgrade:

- integrity: `ok`
- messages: 823 at initial upgrade; 875 after controlled UI/agent activity
- chats: 28 at initial upgrade; 29 after controlled activity
- cursors: 25
- restart preserved identical counts and integrity

Rollback:

- 0.84 to preserved 0.83 release: HTTP 200 and database integrity/counts unchanged
- 0.83 back to 0.84 canary: HTTP 200 and database integrity/counts unchanged

UI:

- compaction/model slice: 6 passed, 1 passed on retry, 2 cleanup-hook timeouts
- provider-independent desktop slice: 34 passed, 15 skipped, 1 existing layout assertion failure (900 px configured chat surface versus a >1024 px assertion)
- `/compact`, click-to-compact, model selector, model switching and post-compaction controls passed at least once
- cleanup flakiness was caused by an external provider retry and a pre-existing operator abort endpoint mismatch; no Earendil process crash occurred

## Resource impact

Equivalent fresh starts on the same VM and data:

| Metric | Earendil 0.83 | Earendil 0.84 | Change |
|---|---:|---:|---:|
| Apparent release bytes | 552,546,499 | 561,940,259 | +9,393,760 |
| Disk KiB | 656,540 | 666,832 | +10,292 |
| Service memory bytes | 118,071,296 | 149,811,200 | +31,739,904 |

The memory increase is about 32 MB on a 4 GB test VM. Production canary monitoring should include RSS and startup latency.

## Residual risks

- Piclaw still uses private coding-agent `_checkCompaction` and `_runAutoCompaction` canaries. They exist in 0.84 and the suppression/restoration tests pass.
- The new client/protocol/telemetry packages increase the portable footprint even though Piclaw does not use remote sessions.
- Three pre-prompt compaction tests remain skipped from the baseline.
- E2E queue cleanup and the operator run-abort endpoint have pre-existing defects that can leave provider retries active.
- Clean global tarball installation under Bun 1.3.14 has a baseline self-resolution bug; portable installation is the validated deployment path.
- Production has not been upgraded. A reviewed PR, exact-main CI, canary backup, explicit restart permission and post-restart observation remain required.

## Recommendation

Proceed with a reviewed Earendil 0.84 PR. Do not merge automatically.

After exact-head CI and review, deploy a portable canary with:

1. a verified SQLite backup and preserved previous release directory;
2. version, PID, HTTP and model-catalog checks;
3. bounded Copilot stream, compaction, tool-state and restart-recovery smoke tests;
4. RSS/startup observation;
5. a tested symlink rollback to the prior release.

Production deployment requires explicit approval and an active-session check before restart.
