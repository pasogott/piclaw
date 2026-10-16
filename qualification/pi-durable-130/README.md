# #1650: isolated Pi durable 1.3.0, first qualification slice

**Candidate in-place prototype qualification, not production integration or completion of #1650.**
Base: Piclaw `4e08281bb6d3942e7560edabca8581acf556b138`; root still targets Pi 1.2.0.
This private package has its own manifest, lock, node_modules and tsconfig. Do not
mix handles, contexts or TypeBox objects across graphs. The candidate API may
change without notice; exact 1.3.0 byte evidence does not qualify future versions.

## Run

From `qualification/pi-durable-130` in this worktree:

```sh
bun install --frozen-lockfile --ignore-scripts
bun run typecheck
bun run test # isolated launcher: test.ts sqlite.test.ts host-handoff.test.ts migration.test.ts
```

Installation may access npm; normal tests are offline. The preload requires the
existing disposable-filesystem launcher and isolated HOME/workspace/store/agent
paths; direct `bun test` fails closed. Fetch/WebSocket and credential lookups
throw; environment credentials are sanitized. These are JS regression guards,
**not an OS security sandbox**. Only a keyless synthetic provider/local stream and
synthetic tools run; no real providers, accounts, filesystem or shell tools.
Typecheck uses TypeScript 7.0.2, @types/bun 1.3.14 (bun-types 1.4.2), and
`skipLibCheck` for external declarations; no bunx download/root dependency symlink.

## Exact candidate identity and provenance

Public registry: `https://registry.npmjs.org`. All five packages below are
**1.3.0**. Tarball URLs are exactly
`https://registry.npmjs.org/@earendil-works/NAME/-/NAME-1.3.0.tgz`, substituting
the package basename for both occurrences of NAME.

| Package basename | Published files | Registry SHA1 (actual archive verified) |
| --- | ---: | --- |
| chord | 131 | `845bb52ed65ffcdfa28f115dbec4862e90170dd3` |
| pi-ai | 837 | `fe720249f828642bcb66b5b6a0e49c1e5f2f8954` |
| pi-codemode | 66 | `f8fd528ac57a326ae7a692d3f5cf6ddbe7d35001` |
| pi-durable | 327 | `e0d25c2b885d1df15f29fa88f51bf07c36a881d8` |
| pi-telemetry | 26 | `1dd6f59e65c4eb067ff96f51148e59a2069b9d8d` |

Registry SHA512 SRI values (actual archive verified):

```text
chord:        sha512-qqYhjALZ193atpBzmmS+M5pHQoiI4Aynetc1jXpv+5O2crXH3Y8wbFEy33orU2nmFrlw1U36rsdgUjaW4b3m/w==
pi-ai:        sha512-KaBI8x7q7sPoFUXICNGD9efHzDG+oRNwVvkA9jdIsSQWH1RjFssOlEGsbLtewUPPgCrvmz0l2KTgSLXTyj3acw==
pi-codemode:  sha512-2G9tmbsPhgzwfz7cmzJpbLSLqOx3eu22Gbzm+Wc3HqeZMjLQS4F3KfAabozVhv7uEjq3k2O1dZTHmhhWr2xbfQ==
pi-durable:   sha512-2aD0xead1LH0BBwUBxex28in/PpUJEwyaEiW/nLoTFUcZ/lDYEl6LHX6mGZKJG8tUHzERwJyysDgy0ruidt84w==
pi-telemetry: sha512-ERGZr+aXjNJzoUbB7ZzHVH3g5otzMHjHLs2Fyizm12By5X+gBEhod9cJXFOk13S7M8a29Am+Mq21zm73mRJFLg==
```

`provenance.json` records acquisition time, exact URLs, both registry digests and
SHA256 of **all 1,387 published files**, including README, package metadata and
all dist JS/declarations/maps. `src/provenance.ts --record` explicitly downloads
metadata and archives, verifies SHA1 and SHA512, extracts to a disposable temp
directory, compares every extracted file with the installed payload and cleans
up. Its tar subprocess receives only PATH, not inherited credentials. This
explicit acquisition command is never called by tests:

```sh
bun src/provenance.ts --record
```

The offline provenance test checks the five-package set, 1.3.0 identities, lock
SRI values, exact installed file sets and every file hash against that recorded
extraction. It does not need the archives or registry at test time. Evidence
establishes equality with npm's bytes at acquisition, not independent publisher
identity/authenticity. Third-party dependency payloads are locked but not part
of the five-package byte comparison.

Installed family closure: durable depends on chord, ai and codemode at 1.3.0;
ai additionally depends on telemetry 1.3.0. No coding-agent package is installed
here. The full third-party dependency/version/SRI closure is in `bun.lock`;
notable direct edges are typebox 1.3.27, quickjs-wasi 3.6.2, photon 0.3.3 and
diff 8.0.4, plus ai's provider SDKs. Their presence is not a claim of execution
or provider/QuickJS qualification.

## Public API boundary

Only public chord/context, pi-ai (including utils/event-stream), pi-durable,
storage/sqlite and testing APIs are imported; no private dist imports. Instantiate
AssistantMessageEventStream from its value subpath, not the root type export.
Version checks read package.json by file URL, not an unexported package subpath.
Host imports resolve to this worktree's `runtime/`: canonical request hashing,
EffectIdentity, real service-work/terminal adapters and InMemoryEffectPayloadResolver.
Host and candidate graphs remain separate. The root terminal runtime has the
optional guard described below; no schema, root dependency/pin, production flag
or production registration changes.

## Verified evidence and limits

`/workspace/reviews/durable-1650/candidate-final.log`: **79 pass, 0 fail,
577 assertions / 4 files**: Memory/safety/provenance **13**, SQLite **33**,
host handoff **7**, migration **26**. Counts are tests, not parent acceptance gates.
Root EF-S02: **85 pass / 1,173 assertions** (`commit-fence-root-tests.log`). Root
full run: **6,960 pass, 74 skip, 1 fail**, unrelated note-retrieval release fixture
`limit_exceeded` (`root-ci.log`); focused rerun **1 pass / 94 assertions**
(`note-rerun.log`). Parent will repeat the full run; this is not a green full-suite claim.

- Memory coverage: synthetic owner check before allocation; paused open and
  read-only observers execute nothing; abort, scheduling, dispatch-time model/tool
  permission and synthetic effect gates. Host hashing rejects changed-content
  requestId reuse; upstream dedup alone does not. Cancelling wait leaves placed
  work alive; submission.abort withdraws queued, not already-placed work.
- SQLite: public storage conformance, async facade isolation/rollback/close, disk
  Harness answer/requestId/cancellation persistence and no unsafe-tool replay.
  Real host EF-S01/EF-S02 cover acceptance before submit, lost acknowledgements,
  dedup, one reply/frontier consumption, and cancellation beating a late answer.
  Held operation reads reject stale claim/bind after takeover.
- **Qualified narrow commit guard:** optional root
  `TerminalSettlementAdapterRuntime.validateOwnership` is synchronous before and
  after apply inside `BEGIN IMMEDIATE`; only exact `true` permits commit.
  False/nonboolean/throw yields owner_conflict and rollback. No-hook existing
  callers are unchanged; committed replay bypasses the guard as observational.
  Held **actual InMemoryEffectPayloadResolver** takeover with the guard has no
  SQL effects. Root tests cover rollback, throw/nonboolean and committed replay.
  This is an available adapter hook, **not production ownership registration**.
- **NOT ADMITTED negative controls:** bare and entry-`before_effect`-hook cases
  deliberately publish stale output during payload await; the entry hook runs
  before that await. A post-return fence cannot undo committed SQL. Passing these
  regressions is expected, not proof of production ownership safety.

## Bounded copied-history evidence

`migration.test.ts` uses copied public Pi 1.2.0 legacy JSONL and actual public
Pi 1.3.0 `Conversation.context().messages`, with **8 model-message equality
comparisons**: known baseline, compaction, two forks before/after continuation,
reset/replacement baseline and SQLite reopen. The original lane tests narrow
atomic import/retry/replay and fail-closed rejection; advanced support is a
separate selected-path fixture, not a general importer. Bounds are fixed small
fixtures (**1..10 records**), not full history. No add-on restore, arbitrary-depth
or multi-checkpoint tree, general context-edit/custom-message/extension-state
migration is qualified. Missing host-only baseline is explicitly **BLOCKED**;
JSONL-only equality must not invent or claim recovery of host instructions.

## Review decision

**Partial foundation only; D2 ownership remains NOT ADMITTED.** A persisted real
owner/lease must be acquired **before open** and gate all effectful progress,
including submit/wait and automatic scheduler dispatch. Current ownership is a
fixture: open precedes its generation row, same-generation callers both pass,
and generation takeover does not revoke the old synthetic dispatch boolean.
The commit hook does not supply that missing ownership framework.

Host DB disk reopen uses an actual new connection in the **original process**;
the payload resolver Map survives. Candidate hash Maps/counters are also in
memory. Reopen is graceful close/reopen, **not SIGKILL**, power-loss or
multi-process crash qualification; no exactly-once external-effect guarantee.
For verified 1.3.0 source, read-only `Conversation.commit` returns at
`writes.length === 0` before storage commit/publication: it neither publishes,
notifies listeners nor wakes the scheduler. Serialized status/answer reads are
not an atomic snapshot; Memory-only evidence is not host EF-S02.

No production registration, real owner-before-open lease, schema/pin changes,
live provider/effect, service restart, commit or push. No all-45-qualified or
goal-complete claim. Parent publication should explicitly scope a **partial
foundation**, use **Refs #1650**, not **Fixes #1650**; full implementation and
production migration approval remain open.

## Next slice: Linux owner-before-open prerequisite (separate scope)

The preceding first-slice verdict and evidence are retained unchanged. New
`ownership.test.ts`, `src/ownership.ts`, and `src/ownership-child.ts` qualify a
**disposable one-chat/file test backend**, not production ownership. The package
script now includes this fifth test file.

`TestOwner.acquire` uses a raw Bun SQLite connection and `BEGIN IMMEDIATE` to
acquire an owner row in the same candidate file **before** constructing public
storage/Harness. Identity includes Linux boot ID, PID, `/proc/PID/stat` start ID,
fresh nonce and generation. A live process (including SIGSTOP) is never stolen;
there is no TTL. Replacement requires explicit release after close/drain or
verified missing/reused PID/previous boot. Inaccessible `/proc` fails closed;
a zombie remains busy until reaped. This assumes one trusted Linux PID namespace,
local SQLite and no path aliases/untrusted raw owner-table mutation. It does not
choose production chat/store granularity.

`OwnedSqlite` reuses the existing facade queue. All SQL operations check the
owner in the same SQLite transaction before callback and before commit. A
read-locked snapshot cannot be replaced by a competing writer and still commit
stale writes; SQLite lock/snapshot conflicts fail rather than authorize takeover.
The end check also rolls back an owner-token change made inside the callback.
The prior `BunSqliteDatabase` and boolean fixture implementation are unchanged;
this backend supplies an authoritative getter to the existing dispatch gates.

Tests cover two actual child contenders (only one allocates/opens Harness),
SIGSTOP refusal, SIGKILL/reap recovery of an actual pending request, paused reopen
before explicit model resume, same-process duplicate rejection, exact-token
revocation, stale public storage open before migration/normalization, SQL rollback,
and held old synthetic model/tool denial at actual dispatch. Raw live revocation
is fault injection, **not** an admitted living-writer replacement API. Child
processes have a small environment allowlist, isolated path/argument guards and
only keyless synthetic provider/tool code; no real provider or environment tools.

Inspected existing user/session ownership, process-local MCP admission epochs,
EF-S05 outbox deadline leases and EF-S02 commit guard. None supplies exclusive
candidate storage ownership before open. Existing queue and dispatch gates are
reused; outbox scheduling is not replaced. The actual host EF-S02 optional guard
is still not registered in production, and this slice does **not** prove an owner
read in one file atomic with settlement in another. The transaction rollback test
uses a synthetic settlement table, not the actual EF-S02 publication path.

`/proc` must faithfully expose the same trusted PID namespace. Under hidepid,
mismatched proc mounts or namespace visibility restrictions, ENOENT cannot be
trusted as evidence of death; this fixture must not be used in those conditions.
Release remains a caller-enforced close/drain contract. Parent death is not proof
that arbitrary external tool children have exited.

**Partial prerequisite only: production D2 remains NOT ADMITTED.** Synthetic
synchronous dispatch checks do not make external model/tool effects atomic and
do not qualify arbitrary surviving child tools. Explicit release requires the
caller to close/drain Harness/storage first. No public protocol, native package,
platform abstraction, production schema/pins, root source, services or profile
changes. Detailed receipt: `/workspace/reviews/durable-1650/ownership-checkpoint.md`.

## Cross-store process-death qualification

`cross-store.test.ts` adds five cases. The combined package receipt is 90 tests,
698 assertions, zero failures across six files; strict typecheck passes.
Separate disposable host/candidate SQLite files survive SIGKILL after accepted,
submitted, answered and terminal/lost-ack boundaries. Recovery acquires the host
owner and binds the incarnation before opening the paused candidate. It verifies
one real EF-S02 terminal commit, one transcript answer, one outbox intent and no
re-execution of a committed synthetic answer. Revocation during held payload
resolution is checked inside the actual host settlement transaction.

These are post-boundary kill windows, not arbitrary mid-commit crash coverage.
The file counter records synthetic model admission, not paid-provider effects.
The outbox test proves intent persistence, not delivery. Host ownership is not
an atomic cross-file write fence: recovery refuses live-owner takeover and waits
for confirmed/reaped child death. Arbitrary surviving external tools, general
migration and production admission remain unqualified. Independent source review
cleared this increment within those boundaries; #1650 remains incomplete.

## Host model and tool policy ports (qualification only)

The combined candidate suite now passes 145 tests, 1,036 assertions across nine
files, plus strict TypeScript checks. These counts supersede earlier totals.

`host-models.ts` adapts only approved physical chat models through the actual
1.2 host ModelRuntime. Credentials, provider URLs/headers and auth mutations stay
with the host; the 1.3 catalog receives JSON metadata and static errors. Tests
exercise successful streaming/tool/thinking data, denied approval/budget, held
authentication revocation, logout and no alternative-account fallback. Deferred,
image/classifier and login-control operations deliberately reject. **Activation
blocker:** public `transformHeaders` is awaited before provider invocation; the
negative test demonstrates a revoked provider may still be invoked with an
aborted signal. This is not proof of a sent request, but the strict zero-call
admission contract remains unqualified.

`host-tools.ts` preserves prepared arguments, text/images, details, explicit
errors and progress acknowledgements. Throwing callbacks produce static errors
without private causes. Registration snapshots the schema and approved callbacks.
Replay defaults to unsafe; structured/nested tool definitions remain unsupported.
The host effect port must recheck authority at every actual effect after awaits;
a pre-tool check alone is not a security boundary.

The opt-in root tracked-bash `validateSpawn` check runs after asynchronous cwd,
environment/keychain work and immediately before each spawn, including fallback
candidates. Only synchronous literal true authorizes; invalid async results are
observed but never authorize. Existing callers are unchanged. `host-bash.ts`
uses invocation-local tracked operations; progress failures abort the owned child,
suppress later updates and expose only static errors. Tests use actual disposable
local shell effects, child cancellation and unsafe replay/reopen boundaries.
This does not qualify SSH, filesystem tools, MCP effects, arbitrary child trees
or provider dispatch. The untouched SDK local runner's late-spawn limitation is
retained as a negative control. No production port is registered.

## Actual Plan factory and hidden context lifecycle

Set `DURABLE_ADDONS_ROOT` to the pinned piclaw-addons source (commit
`de92bc95b5b3bb1505beec9617d3b8a5e4fa92d3`). CI checks out that source separately
without persisted credentials. `plan.test.ts` verifies Plan 0.1.25 and executable
source hashes; absent or mismatched source fails rather than silently skipping.

The combined suite now passes 148 tests, 1,146 assertions across ten files,
plus strict types. Actual Plan registration/preparation, existing-chat KV,
cross-chat denial, fork storage separation and fresh context are exercised.
A real Pi 1.2 SDK baseline demonstrates why request-local projection alone is not
hidden-message persistence, and why committing a hidden message after request
capture alone misses that request. The positive public-API path commits and
projects once per explicitly accepted run: two immutable snapshots across four
provider user-message histories match the SDK fixture; tool rounds do not
refresh snapshots. Persisted requestId-to-entry bookkeeping survives cooperative
interrupted-hook reopen using an externally retained submissionId. Fork and
SQLite reopen retain the snapshots.

This is a serial, explicitly correlated qualification fixture, not a generic
ExtensionAPI runtime. It does not discover unknown recovered operations, prove
concurrent admission, preserve every system/tool context, qualify SIGKILL in the
Plan hook, or support general add-on lifecycle migration. Model-provider final
admission and other activation blockers above remain open. No production Plan
adapter is registered.
