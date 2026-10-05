# Adapter MCP server Settings

Both MCP panes now preview and apply adapter server overrides through owner-only direct routes. Native engine replacement stays unavailable. Source only: no production installation, restart, configuration mutation or real-account test.

## Change boundary

The exact public adapter dependency is `dddfcf630508f42c169889c11dee94e69b746e7c`, merged PR10 after 1,436 Bun tests/public-package checks. Server GET/preview use its virtual highest-project override reader; they do not write, resolve credentials or execute servers. Opaque five-minute bounded tokens retain private candidates, instance/bridge/workspace bindings and exact preview state.

Explicit per-server patches preserve unrelated raw settings/imports/servers and private/advanced fields. Withheld argument/map/credential values stay out of browser payloads. Unknown enabled semantics reject; disabled/private definitions can be retained inertly. Effective inherited credential reuse after endpoint/transport change rejects, including retained values inside changed header objects. Removing an override previews any revealed inherited definition; disabling keeps it inert.

All Apply flows share one controller phase and captured-prompt fence. Server changes drain main/side lifecycle work, abort turns, await all public adapter shutdown acknowledgements and release old credential leases. A private single-use batch receipt prevents captured ordinary reloads before instance commit/hydration. Fresh owner/cancellation/file/workspace/source identity checks run after lock and before rename. The synchronous rename callback records commit before asynchronous unlock/deadline tails. Its private receipt binds the committed file hash/inode, unchanged original lower sources and exact previewed effective configuration through hydration and startup admission.

Guarded hydration checks authority/signal/source identities before and after late keychain results and before publication. Reload uses public session APIs and a common startup barrier; no participant resumes until all reloads finish. Failed/late participants are quarantined and admissions stay blocked. A post-rename failure reports saved-but-not-activated. No automatic fallback, rollback claim or provider execution is introduced. Session identity/history is retained.

## Evidence so far

- Corrected authority/controller/writer/ACK/API/model/codemode/exact-package regression: 181 passed / 791 assertions across 14 files, 13.58 seconds.
- Actual offline Pi1.0.1 + synthetic stdio MCP current/new-session test passed; old process closes before replacement, identity/history retained, no external network/provider.
- Rebuilt Classic/Visual browser matrix: 14 passed / 590 assertions; Chromium/WebKit, desktop/mobile codemode regressions plus server preview/disable/Apply/remove/private preservation/owner denial.
- Web build: nine passed / 26 assertions. Five type stages pass with 95 unchanged frontend transitive diagnostics. Changed-file lint/circular-dependency/pack/stale checks pass.
- Synthetic isolated disk-backed 100 read/preview requests with 25 servers: wall187.15ms, CPU user165179µs/system27274µs, maxeventloop14.78ms/p9913.27ms, 1051JSONparse6.67ms/600serialise1.20ms/250SQLquerylookups0.54ms. Uses direct owner handler with SELECT1 authority probe; excludes complete HTTP auth/CSRF, credentials, Apply, servers/providers, production throughput and separate commit costs.

Local logs under `/workspace/tmp/mcp-server-*`. Machine-readable profiling/receipt is maintained separately. Full frozen qualification and final independent source review are required before publication.

The first frozen full run at `b4cc07012950d0ed691133a61c26a22c95e8c3bf` failed: 6,383 passed, eight skipped, one stale exact-adapter-pin assertion, 41,017 assertions in 1,008.28 seconds. Log SHA256 `d09a9c871cd64ac1857155163a1bc82ab594fedd5092085591ed86ac5adf188b`. Final review separately found retained stdio credentials could follow changed executable/arguments/cwd, and post-rename unlock mutations could activate unpreviewed configuration. Both have targeted local/inherited and gated unlock/startup regressions. Stdio identity now includes arguments/cwd and preserved credential-bearing environment/argument references; the rename receipt fences committed and lower files through activation. The old full run does not qualify these corrections.

A subsequent v2 gate was stopped for confirmed reference/literal rebinding corrections; exit143, logSHA `6bae91e61bc0f71190a4161e6f880a5093c44ce1ede3d6040dfbe8bace7c834e`. References are compared by environment/keychain identity across fields, keys and formats. Destination changes with opaque old/new argument/map/auth payloads fail closed when clearing cannot be proved. Local and inherited wrapped/rekeyed reference and literal cases reject. An actual offline Pi post-rename mutation fixture confirms saved-but-not-activated, old PID closed and zero replacement processes. No stopped run is qualifying evidence.

## Retained failures

The first new Classic/WebKit matrix case hit its unchanged20-second deadline; isolated unchanged rerun passed1.87s, then final rebuilt matrix passed all14. Old policy browser locators matched the added editor too; scoped original-section locators retain assertions and identify the added editor separately. No timeout or functional assertion was removed.

Initial HTTP fixtures named non-existent route/rate-rule exports; corrected to actual exported functions. Failed body stream previously returned503 after refactor; fixed400 restored original assertion. Actual runtime fixture omitted a binding callback needed for SDK reload start hook; added public onError binding and reject production reload that bypasses its startup gate. All failed logs remain local. A delegated final source review timed out and supplied no approval.
