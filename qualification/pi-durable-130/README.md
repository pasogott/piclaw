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
