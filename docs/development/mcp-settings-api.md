# MCP instance settings read and preview

`GET /agent/settings/mcp` and `POST /agent/settings/mcp/preview` expose owner-only policy inspection without starting, stopping or changing MCP connections. This is the first backend slice of #1451; no settings pane or apply operation is delivered here.

Both routes require a freshly resolved single-user administrator principal. The preview rechecks identity after reading the body and before publishing. Family and isolated-container modes deny access. Responses are private/no-store; unauthorised requests are rejected before body parsing or configuration reads. Normal HTTP authentication and preview CSRF checks remain in the request guard. GET and preview share an enforced rate-limit bucket.

Preview accepts only `{ "engine": "adapter" | "native", "codemode": "auto" | "on" | "off" }`. Bodies are limited to 2,048 bytes, decoded as strict UTF-8, and have a five-second body-read timeout. This is not an absolute deadline for synchronous filesystem/configuration work. Query parameters are rejected. No save/apply routes exist.

## Response contract

- `persisted.policy` describes desired settings, defaulting to adapter/Auto.
- `runtime.configuredFactory` is `adapter`, reflecting existing source wiring. `observedPolicy` is null and `connectionStatus` is `unknown`; cached metadata is not evidence of connected servers.
- `readiness` is exactly `{ adapter: true, native: false, codemode: false }` until the transition host/factories are qualified and connected.
- `applyAvailable` is false even when the compatibility plan is applicable. Preview acceptance does not apply settings.
- `servers[].nativeProjectionStatus` is the bridge's mapped/blocked/quarantined classification. A blocked native projection may still be usable by the adapter; it is not connection status.
- Server names, setting names and fixed planner rejection messages are intentionally visible to the owner. Raw commands, arguments, URLs, headers, environment values, keychain references, source paths, diagnostic payloads and secret-derived configuration hashes are omitted.

Read/preview uses only prepared bridge state; it does not hydrate credentials, read the keychain, invoke a provider or contact a server. The existing clone-returning bridge API stays unchanged. A new deep-readonly accessor permits pure planners to inspect the recursively frozen generation without copying it; hydration atomically replaces the generation and existing readers keep their frozen snapshot.

## Tests

Focused tests cover real route registration, denied owner modes before body/state reads, exact readiness/unknown state, no apply/save path, malformed/oversized/multibyte/chunked bodies, stalled/failed readers, abort, identity/role/mode revocation, no sensitive field disclosure, real request-guard throttling, immutable bridge generations and compatibility planner cases. They use synthetic configuration and isolated databases only.

The initial test exposed a member-auth check reading malformed config before rejecting the role. The role check now precedes config access. Review also caught unregistered GET throttling and ambiguous `status`; tests exercise the actual guard and the response now names native projection explicitly.

## Profiling results

The [machine-readable measurements](receipts/mcp-settings-profile.json) contain three runs per mode per stage, with raw batch timings, instrumentation totals, event-loop statistics, memory readings and source fingerprints. The [initial handler](receipts/mcp-settings-baseline/handler.ts.txt) is retained for reproduction. It was an early unmerged implementation; this endpoint did not exist on mainline, so these are implementation-variant comparisons, not release-to-release speed claims.

Workload: 1,000 direct preview-handler requests in ten batches, 100 configured synthetic servers, 20 KiB of unrelated configuration, real session/user reads against a disposable disk SQLite database, WAL and synchronous=2. Five milliseconds between batches permits event-loop sampling. The pre-dispatch HTTP/auth/CSRF/rate-limit layer is outside the timed workload. CPU profiles include startup/schema creation as well as the timed handler work.

| Stage | Plain median (range), ms | Instrumented median, ms | Instrumented + CPU median, ms |
|---|---:|---:|---:|
| Initial duplicate check + clone | 648.6 (632.1–800.2) | 690.2 | 738.9 |
| Remove duplicate synchronous owner check | 579.6 (562.6–609.9) | 650.8 | 665.2 |
| Also use immutable snapshot view | 278.4 (274.3–444.0) | 335.9 | 394.6 |

The final plain median is 57.1% lower than the initial implementation. Counts per 1,000 requests are stable across measured instrumented runs:

| Operation | Initial | Final |
|---|---:|---:|
| JSON.parse | 10,000 | 8,000 |
| SQLite prepare | 4,000 | 3,000 |
| SQLite query lookup | 4,000 | 3,000 |
| SQLite statement get | 8,000 | 6,000 |
| JSON.stringify | 5,000 | 4,000 |

Removing the immediately repeated owner lookup retains initial, post-body and pre-publication fresh authorisation; it introduces no cross-request authorisation cache. Reusing the already-frozen bridge removes the dominating clone without making shared data mutable. The final response field-name correction and profiling-only unused-assignment cleanup are recorded as distinct measurement stages.

### Remaining hotspots and coverage gaps

- Whole-process CPU samples initially attribute roughly 1.1 seconds across three runs to `structuredClone`; it drops out of the final top frames. This includes setup and is not a precise per-endpoint CPU total.
- Synchronous config reads/parsing, SQL statement preparation and authentication reads remain visible. They need wider call-site/connection-lifetime measurements before cache or query changes.
- Native SQLite `run` frames dominate startup wall samples (roughly ten seconds summed over three fresh processes). Fresh schema creation and auto-vacuum migration are separate suspects; the profile alone does not isolate their causes.
- The batched synthetic workload produces event-loop stalls; it measures scheduling effects, not independent production-request latency. CPU instrumentation adds overhead and sample spread is material.
- Transaction throughput, lock contention, FTS/query plans, large-history parsing and background maintenance are not qualified by this fixture. These remain required profiling work under #1455.

The profiler wraps SQL methods but records no query text or bind values. Raw `.cpuprofile` files remain local under `/workspace/tmp/mcp-settings-api-100/profiles/`; only reviewed synthetic aggregates are committed. Correctness tests run without instrumentation. No production database, provider/network activity, durability setting change or restart was used.

## Candidate validation

On 3 October 2026, frozen tree `751ca6f0c23919aec17da0b07b6220ba8871d33d` passed `make ci-fast`: 5,994 runtime tests, eight existing skips, zero failures; 25 feature tests, nine web checks, and the separate frozen 0.99.1 replay of 468 tests / 8,720 assertions. Final focused routes/guards/config/planner/keychain checks passed 64 tests / 402 assertions. All five typecheck stages passed with the unchanged 95-diagnostic compose baseline; changed-file lint, pack hygiene (24,748 files) and stale-dist checks passed.

Independent narrow reviews found no blocker after correcting revision-hash disclosure, GET rate-limit dispatch and status naming. Broader audit attempts timed out and supplied no findings or approval. The full log is `/workspace/tmp/mcp-settings-api-100/ci-fast.log`, SHA-256 `7bf5dfacf972dff467c3a6dfeb0a04bbcfc33602c7d2fc7b6b522f092511102d`. Only this validation paragraph changed after the frozen gate.

## Reproduce the workload

From the repository root, invoke the existing launcher with disk-backed isolation and an output directory for CPU files:

```sh
bun --no-env-file -e 'import {runLocalTestCommand} from "./runtime/scripts/local-test-priority.ts"; await runLocalTestCommand([process.execPath,"--cpu-prof","--cpu-prof-dir=/tmp/mcp-profile","test/fixtures/mcp-settings-profile.ts","--instrument"],{cwd:process.cwd()+"/runtime",env:{PICLAW_DB_IN_MEMORY:"0"}});'
```

Create the output directory first. Omit `--cpu-prof` for method instrumentation only and omit `--instrument` for an uninstrumented timing run. Each run creates disposable state through the launcher. A code review and separate scope decision are required before any later apply endpoint or engine activation.
