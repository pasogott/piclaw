# Evidence register

| Evidence ID | Source | Baseline relevance | State |
|---|---|---|---|
| E-001 | `v2.13.2` / `0afd3ae645c423bed82deef80c343bcaa6f31d4d` | Stable Piclaw assessment baseline | Verified tag and commit; ADR scaffold is the only child commit on `main` |
| E-002 | `package.json`, `bun.lock`, `Makefile:193` | Earendil dependency and installer baseline | Verified `pi-coding-agent`, `pi-agent-core`, `pi-ai` and installer-pinned `pi-tui` at `0.84.1` |
| E-003 | `docs/architecture.md` | Published component and current turn-flow description | To verify against source |
| E-004 | `docs/archive/turn-mechanism-audit.md` | Earlier full-stack turn audit | To review |
| E-005 | `docs/design/agent-turn-state-machine-assessment.md` | Current-loop hazards and prior reducer proposal | Reviewed as evidence; recommendation not adopted |
| E-006 | `docs/earendil-0.84-upgrade-assessment.md` | Earendil 0.84 compatibility history | Reviewed; future harness API still unknown |
| E-007 | `/workspace/notes/piclaw-stable-revert-2026-08-10.md` | Post-release campaign, regressions and rollback context | Reviewed as non-baseline evidence |
| E-008 | `archive/post-v2.13.2-fixes-20260810` | Candidate fixes and regression history | Preserved at `da47ca62f3c1e7e0d5e538cc250303eb8c9ca1f4`; inspect selectively |
| E-009 | `/workspace/backups/piclaw-post-v2.13.2-fixes-20260810.bundle` | Verified archive backup | `git bundle verify` passed; complete history at `da47ca62f3c1e7e0d5e538cc250303eb8c9ca1f4` |
| E-010 | Baseline pre-push `make ci-fast` on ADR-only commits | Release validation environment | Guard reached the baseline test suite but failed because the host injects `PICLAW_MCP_MEMENTO_TOKEN`; isolated `runtime/test/secure/mcp-keychain.test.ts` passes 8/8 with that variable unset and fails 1/8 with it inherited |
| E-011 | [`earendil-0.84.1-harness-surface.md`](earendil-0.84.1-harness-surface.md) | Installed Earendil harness declarations, implementation, reducer and session contracts at `0.84.1` | Surveyed; execution methods are structural stubs, while reducer/session contracts are implemented |
| E-012 | [`current-capability-matrix.md`](current-capability-matrix.md) | Piclaw v2.13.2 agent lifecycle inventory | Initial 59-capability ownership and evidence matrix complete; named coverage gaps retained |
| E-013 | [`regression-corpus.md`](regression-corpus.md) | Baseline tests, issues, audits and post-v2.13.2 rollback campaign | 25 regressions mapped to 14 invariants and named contract scenarios |
| E-014 | [`effector-inventory.md`](effector-inventory.md) | Piclaw v2.13.2 I/O, storage, session, tool, scheduler and projection surfaces | 35 surfaces classified as reusable, split, replace or reject; target ports and fake requirements defined |
| E-015 | [`target-state-model.md`](target-state-model.md) | Proposed Piclaw service-plane and Earendil execution-plane integration | Identity hierarchy, accepted-source and operation models, terminal transaction, cancellation, restart reconciliation, replay and safety properties defined |
| E-016 | [`compatibility-fixture-contract.md`](compatibility-fixture-contract.md) | Provisional Earendil-shaped fixture and shared contract suite | Manual driver, deterministic model/tools, fault plan, 20 harness cases, 20 Piclaw boundary cases and 10 assumptions specified |
| E-017 | [`alternatives-and-migration.md`](alternatives-and-migration.md) | Architecture comparison and cutover planning | Fixture-first alternative selected; eight reversible phases, shadow metrics, validation and installed-service gates defined |
