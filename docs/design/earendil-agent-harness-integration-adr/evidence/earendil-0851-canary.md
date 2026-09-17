# Disposable 0.85.1 upgrade and rollback gate

**Prepared, not executed.** No microVM access, deployment, restart, UI mutation or provider call was made for this gate. Local portable extraction/CLI probes are recorded separately in [candidate readiness](earendil-0851-readiness.md).

The authorised upgrade/restart/rollback receipt is a prerequisite for PR B merge. Its rollback unit is the exact baseline 0.84.4 runtime/dependency set, restored as one coherent change rather than isolated package downgrades. No production schema migration or session rewrite is intended. Broader inactive HC completion is tracked separately as PR C and does not waive this canary gate.

## Approval needed

Approve one identified disposable target, its access method, service restart and test-data mutation. Confirm nobody else is using it. VM 900 / piclaw-test / 192.168.1.78 appears in local test notes, but those coordinates must be revalidated; they are not authority to modify a guest. No production credentials or Smith state may be copied into it. Use the keychain-backed Proxmox/SSH tools; do not inline credentials or reuse another host's service paths.

Specify whether a deterministic fake-provider fixture is sufficient. Any paid-provider smoke call needs separate approval and a bounded allowance; none is currently granted.

## Preparation (before touching the target)

1. Record the approved guest identity, OS/architecture, service manager, current executable and profile/workspace paths, active users and network policy.
2. Build immutable candidate and baseline packages from their recorded revisions; record SHA-256, version, dependency family and archive listing. Candidate version text alone is insufficient because both packages may be Piclaw 3.1.2.
3. Capture an owned disposable-state checkpoint and service configuration. Include test session JSONL, SQLite, add-on configuration and fixture identities. Record hashes/row counts. Keep the original checkpoint immutable.
4. Use separate release directories and a temporary test profile. Deny outbound provider access or supply a deterministic local provider. Do not mount/copy Smith `/workspace/.piclaw` or auth files.
5. Record which assertions are public SessionRepo/current-loop tests and which require Harness promotion. Keep Harness/pi-server disabled throughout.

## Baseline → candidate → baseline sequence

| Phase | Required observation |
|---|---|
| Baseline start | Exact baseline artifact/source receipt; health HTTP 200; test profile isolated; no unrelated sessions |
| Seed baseline fixtures | Synthetic saved session, queue entries, tool call/result, explicit usage provenance and selected model/effort; record IDs, hashes and expected counts |
| Controlled stop | Stop only the approved target service; verify process exit and retained test state |
| Candidate start | Exact 0.85.1 package closure and artifact hashes; service active; health succeeds; no pi-server process and no Harness activation |
| Read/continue fixture | Model/effort retained, tools visible including extensions, stored reasoning/tool records parse, queue ownership and results retain identifiers; no duplicate terminal/projection entries |
| Runtime actions | Deterministic tool cancellation/timeout, UI-prompt stale-watchdog suspension with absolute deadline intact, managed compaction/recovery, branch/session affinity and MCP lifecycle cleanup |
| UI checks | Explicit disposable URL/flag; Classic and Visual load; prompts, cancellation, reconnect, settings/provider catalogue; no local-production browser target |
| Capture candidate state | Export synthetic session/store observations and exact expected diffs; preserve baseline checkpoint |
| Rollback start | Stop target only, select baseline artifact and restore the immutable test checkpoint if downgrade compatibility is not established |
| Rollback verification | Health and artifact identity; baseline fixture hashes/counts restored; session/queue/use provenance intact; no leaked process groups or duplicate externally visible effects |

Do not silently open a candidate-written store in the old runtime if backward compatibility has not been proved. A rollback plan must specify whether it reuses candidate state or restores the baseline checkpoint; these are different claims.

## Required receipt

- Approval reference and disposable target identity.
- Baseline/candidate artifact hashes, source revisions and resolved family versions.
- Commands and exit codes for stop/start/health and tests; no raw credentials.
- Before/after/rollback fixture counts and hashes, including exact session/queue IDs.
- Process ownership/cleanup and denied live-provider evidence.
- Passed/failed/skipped scenarios, with browser execution distinct from source/unit evidence.
- Final target state and owner hand-back.

Until this receipt exists, upgrade/rollback and browser-canary acceptance are unchecked. No merge, production deployment or rollout follows automatically from a successful canary.
