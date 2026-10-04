# MCP codemode settings qualification

Adapter codemode settings now apply through the owner-only backend in Classic and Visual. Native engine replacement lacks qualified shutdown and capability contracts, so its Apply path rejects explicitly. Relates to #1451; server/auth management and native parity are unfinished.

## Implementation

- `mcp-codemode-runtime.ts` selects immutable instance policy, loads public Pi 1.0.1 scripting with `models: false`, fences captured prompts/tool calls, and applies codemode through public active-tool APIs.
- The controller fences admission, drains lifecycle work, deduplicates main/side participants, aborts active turns, rechecks owner authority and config/bridge revisions, commits the policy, updates active tools and resumes.
- Sessions retain their identity, history and unrelated active tools. Codemode changes retain the existing adapter owner and transports; they do not reload extensions.
- Random preview tokens expire after five minutes and are bounded to 128 entries. A transition has a 30-second asynchronous deadline. Failures keep admissions blocked; saved-policy/failed-activation responses distinguish persistence from successful activation.
- Both panes require a compatible preview and explicit interruption acknowledgement. Selection changes invalidate previews and acknowledgement. Active Apply locks selection and request controls.
- Native diagnostics use the ten exact 1.0.1 public-contract gaps plus the separate suppressed-close probe. Connection status is explicitly unknown. No fallback, private shutdown-handler invocation or native waiver is provided.

## Completed evidence

| Check | Result |
|---|---|
| Expanded focused controller/routes/planner/bridge/admission/guard tests | 89 passed / 548 assertions |
| Post-retention focused gate at `84ce5ab69` | 31 passed / 286 assertions |
| Actual Pi 1.0.1 in-memory scripted-provider fixture | Current/new sessions, scripting, nested policy, disabled models, Off enforcement and preserved identity/history passed; enforced zero network/child attempts |
| Five repository typecheck stages | Passed; 95 pre-existing frontend transitive diagnostics unchanged |
| Strict standalone Visual MCP component/shared-controller compilation | Passed |
| Scoped lint; silent-catch/logging/cycle/test-entrypoint checks | Passed |
| Separate @github source review of controller/handler | No confirmed blocker; hanging-abort and resume-refusal regressions requested, added and passed |

Two delegate reviews timed out and supplied no findings or approval. Self-review subsequently added a post-resume inspection-failure regression and restored the global captured-prompt fence in that failure path. A type-only local import created a dependency cycle; the host now uses a small structural contract and the cycle check passes.

## Pending qualification

- Rebuilt Chromium/WebKit matrix for Classic/Visual at desktop/narrow widths, plus actual settings navigation.
- Updated synthetic disk-SQLite request profiling, with method counts, event-loop delay and CPU samples. Historical preview measurements are retained separately.
- Full frozen runtime/feature/web gate and final exact-head review before publication.

The shared feature's browser verification tag is withheld until the updated matrix passes. Earlier preview-only browser/full counts do not qualify this Apply flow. The matrix uses real UI/controller/handler/persistence with a synthetic runtime; actual Pi scripting is tested separately. Full production authentication and live MCP transports are outside this component fixture.

No production install, configuration change, provider call, native activation or restart was performed.
