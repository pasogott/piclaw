# Audit validation

Audit base: `3f8ee0d2f9eddab3828f9a5d4f626716469636d8`. Validation ran in the isolated audit worktree on Smith, an LXC container managed by user-systemd. No service restart, live UX mutation or deployment occurred.

| Check | Command / method | Result |
|---|---|---|
| Cucumber syntax and stable IDs | Installed `@cucumber/gherkin` parser + AST walk of every feature | 24 files, 241 scenarios/outlines, 25 example rows; zero parser, missing-ID or duplicate-ID errors |
| Full scenario index | AST compared to COMPLETION.md scenario rows | Every scenario appears exactly once |
| Evidence paths and Markdown links | Resolve repository-relative source/test paths and local Markdown links; validate scenario line anchors | Zero missing explicit paths/links |
| Change scope | Diff against reconciled PR head plus untracked files | Only .feature and completion/index/evidence .md files under tests/e2e/features; no production/test/dependency/bundle edits |
| Whitespace | `git diff --check` | Pass |
| Frozen dependencies | `bun install --frozen-lockfile` | Pass; no tracked dependency changes |
| Fast local gate | `make ci-fast` | Pass: 5,326 runtime tests, 4 skips; 23 feature-regression tests; Classic and Visual builds; 9 web-build tests |
| Type checking | `bun run typecheck` | Pass: runtime, scripts, web Settings and panes |
| Immutable oracle | `bun run test:local --cwd runtime -- bun test test/features/canonical-ux-contract.test.ts` | Fail: 0 pass, 1 fail, exit 1 at first SHA assertion |
| Independent review | Bounded judge packets | See review.md; source review only |
| Browser execution | Not run | No per-scenario execution claim |

## Immutable oracle conflict

The contributor's follow-up head pins SHA-256 `a08a623880c6f327bc051edc51bb2bbff2959aed86421b5227e61d5a92fc2441`. The original head pinned `a3bad9d5df6f75f85d7b367989be7345175e137a5e10a9234d38a295c1c26d83`. Corrected Gherkin differs from both. The failure occurs before the legacy required-topic and safety-prose assertions; changing only the hash would not settle those semantic mismatches.

The test file is byte-identical to the adopted PR head. It was neither edited nor skipped: it was invoked separately and failed. `make ci-fast` runs `runtime/test/features/run-feature-tests.ts`, which selects `feature-regression.test.ts`; the immutable oracle is outside that wrapper. A passing fast gate therefore does not imply a passing immutable oracle.

## Initial failed runtime attempt

Before frozen-lockfile installation, make ci-fast could not resolve `@earendil-works/pi-coding-agent` and cascaded into 421 failures / 203 errors (3,371 pass, 1 skip). After installation it passed without tracked source or dependency changes. The initial error is not attributed to Gherkin.

## Evidence retention

Run summaries and review dispositions are committed here. Local raw logs: `/workspace/tmp/1323-ci-fast-final.log`, `/workspace/tmp/1323-typecheck.log`, `/workspace/tmp/1323-integrity-final.log`. These paths are optional local diagnostics, not required repository links. Delivery is recorded in the PR update and delivery.md.
