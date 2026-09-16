# SVG image contract and implementation gap

Issue [#1324](https://github.com/rcarmo/piclaw/issues/1324) separates desired SVG-image acceptance from the current renderer. Issue [#1325](https://github.com/rcarmo/piclaw/issues/1325) owns implementation. Production code is unchanged in the contract/test PR.

## Revision evidence

- Piclaw [`70d33bc93`](https://github.com/rcarmo/piclaw/commit/70d33bc93ab540845bbcf5f80503ca8125c71594): Classic `runtime/web/src/markdown.ts` escapes source, parses Markdown and highlights code; it special-cases Mermaid but has no SVG-fence image converter. `runtime/web/src/components/post.ts` adds the normal source-copy control through `enhanceCodeBlocks`.
- Piclaw [`3f8ee0d2f`](https://github.com/rcarmo/piclaw/commit/3f8ee0d2f9eddab3828f9a5d4f626716469636d8) requested safe accessible SVG rendering in Gherkin/test wording. It did not implement the renderer and precedes 70d33bc93.
- Vibes [`4c9191b8`](https://github.com/rcarmo/vibes/blob/4c9191b86953bb564cc82a517f8d417fdc7751e7/src/vibes/static/js/app.js#L164-L189) sanitises fence content into a data-URL `img` with alt text, not page-DOM SVG. Its inspected helper has no explicit size limits and replaces malformed input with an “Invalid SVG” placeholder. It is a reference, not a complete implementation of our desired fallback/bounds contract.
- Tau (`rcarmo/tau-prime`) main [`3a0d734a`](https://github.com/rcarmo/tau-prime/blob/3a0d734ac264ab975b6fee6557889008824afcdb/src/tau_web/vibes/static/js/app.js#L351-L378) did not corroborate equivalent SVG-fence conversion in the inspected renderer. Other Tau revisions are unverified. Piclaw public main was still 70d33bc93 during the 16 September check; no later merged implementation was verified.

The source-only `@ux-original-029` introduced by #1323 described that Classic baseline. It was not a permanent product prohibition. #1324 moves the identity to [planned/svg-images.feature](../../planned/svg-images.feature) and keeps the negative observation here rather than using it as cross-port acceptance.

## Required acceptance and coverage

| ID | Requirement | Evidence / test status |
|---|---|---|
| ux-original-029 | Safe image, inert embedding, source access | Desired; #1325 not implemented |
| ux-svg-001 | Explicit fence scope; raw HTML and attachments unchanged | Desired; baseline raw SVG escaping is separately tested |
| ux-svg-002 | Active/external content removal or document rejection | Desired; needs malicious fixtures and network/script instrumentation |
| ux-svg-003 | Finite byte/node/depth limits | Desired; exact values must be specified in #1325 before implementation |
| ux-svg-004 | Readable/copyable source fallback | Desired; malformed/oversized/rejected cases need renderer tests |
| ux-svg-005 | Accessible name and responsive layout | Desired; validate both skins and narrow viewport |
| ux-svg-006 | Original source copy after sanitisation | Desired; current source-only copy is separately tested |
| ux-svg-007 | Streaming/reload reconciliation without duplicates | Desired; requires lifecycle browser coverage |

The structural `runtime/test/features/canonical-ux-contract.test.ts` checks ID uniqueness and planned/current separation, not feature success. It replaces the stale hash/path/prose oracle and is included by `run-feature-tests.ts`. Its lightweight tag/identity checks do not replace Cucumber syntax parsing.

## Baseline browser test

`runtime/test/web/svg-fence-baseline.optional.test.ts` bundles the actual Classic `renderMarkdown` and `enhanceCodeBlocks` functions into an isolated browser document. It verifies inert code output, the real copy-button handler (with a platform clipboard spy), unfenced SVG escaping and absence of fixture script/network/navigation activity. It does not contact a running Piclaw instance. It is not an accessibility audit, full malicious-SVG proof or desired-renderer acceptance test.

From repository root, using installed browser binaries:

```sh
bun run test:local --cwd runtime -- bun test test/features/canonical-ux-contract.test.ts
PICLAW_RUN_OPTIONAL_BROWSER_TESTS=1 bun run test:local --cwd runtime -- bun test --timeout=30000 test/web/svg-fence-baseline.optional.test.ts
PICLAW_RUN_OPTIONAL_BROWSER_TESTS=1 PICLAW_OPTIONAL_BROWSER=webkit bun run test:local --cwd runtime -- bun test --timeout=30000 test/web/svg-fence-baseline.optional.test.ts
bun run ci:fast:features
```

Set `PLAYWRIGHT_BROWSERS_PATH` to the installed browser directory if test filesystem isolation changes the default home. No live internal secret, server target or provider is needed.

## Contract/test PR validation — 16 September 2026

- Cucumber parsing: 26 files, 248 unique scenarios/outlines, 44 example rows (235 Classic / 5 Visual / 8 planned). All indexed line anchors and touched local Markdown links resolve. The other 240 scenario ASTs are unchanged from 70d33bc93.
- Repaired contract plus existing Markdown tests: 10 passed, 144 assertions.
- Isolated feature gate (`bun run ci:fast:features`): 25 passed, 164 assertions, including the repaired structural test.
- Optional baseline browser test: Chromium and WebKit each passed, 11 assertions per engine. No live application server or provider used.
- `bun run typecheck`, local-test-entrypoint check and `git diff --check`: passed.
- Full `make ci-fast` attempt did not pass: its runtime test child reported 5,322 pass, four skips, one failure/one error in the same missing MCP export (`getActiveMcpRuntimeOwnerCount`). The outer command timed out while the isolated child finished. A focused rerun on clean canonical main reproduced that export failure (zero pass, one failure/one error). No dependency repair or full-green CI claim is made.
- Repository lint fails with the same diagnostic set as clean main (compared after sorting). No diagnostic names the changed tests. Unrelated family/runtime lint repairs are outside this PR.
- Generated bundles touched by repository tests were restored; production source, dependency pins and bundles are unchanged in the patch.
- A bounded independent Gherkin/browser-test review returned no blockers after clarifying observables and strengthening the complete-message SVG DOM assertion. The initial broader review timed out and is not counted as approval.

When editing Gherkin, use the Cucumber parser from the existing `tests/e2e` dependency tree; do not add a second parser dependency or claim structural matching executes steps. Record parse counts, browser engines and gate outcomes in the PR. The #1323 [validation record](validation.md) remains historical and its old hash/path failure is not a current failure claim after this repair.
