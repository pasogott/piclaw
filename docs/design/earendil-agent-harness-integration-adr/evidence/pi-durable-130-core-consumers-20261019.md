# Seven native core consumers — 19 October 2026

Cold-source qualification admits all seven bundled add-ons and runs Restic
configuration through native SDK execution. This follows the packaged-seed
rejection recorded at `b33f20e96`.

## Adoption

Observability registers its existing handlers without starting process effects.
Native startup calls its public, idempotent preparation function with the runtime
owner check. The SDK's `pi.generation.beforeRequest` hook refreshes its prompt for
every request. Static skill metadata stays unchanged. Legacy clients retain their
real `session_start` handler; the native host never invokes it.

The host binds Observability's single global configuration key through an
owner-checked reader and transactional writer. Startup, request prompts and the
existing Settings API share that port. Released or denied reads throw. The
chat-scoped KV policy is unchanged.

Restic exports the existing configuration tool as a public factory. Its native
port captures the actual tool source and checks operation authority, cancellation
and startup-service identity. `setConfigWithAuthority` checks again after the
legacy-scheduler query and before acquiring the job lock or changing configuration.
An older service that lacks this method rejects the native write. Configuration
uses the existing startup service; these changes create no backup scheduler.

Installed source qualification checks both new profiles, their public exports,
exact registrations and source hashes. Observability has no tool declaration; its
metadata is checked without inserting a dummy tool. Foreign tools, handlers,
commands, changed exports or changed source still reject admission.

## Results

- Companion versions: Observability `0.1.18`, Restic `0.1.5`.
- Domain tests: 34 pass, 1 explicit real-backup integration skip, 203 assertions.
- Actual cold-process default factory: all seven add-ons installed; four synthetic
  provider requests; Restic read, configuration write and status; persisted result.
- Existing Settings GET/POST: persisted enabled configuration, non-default instance
  name and disabled Live Metrics; each model request receives the updated name.
- Legacy SDK constructors `SessionManager.create`, `open` and `inMemory`: zero calls.
- Bounded review found a global-KV routing error. The configuration port above fixes
  it; the follow-up review found no remaining blocker within that scope.

The first fixture linked Code Review to the add-on repository's incomplete test
module tree. Linking to the actual host dependencies, as the existing fixtures do,
fixed extension loading without a production change.

The earlier `b33f20e96` archive does not contain these consumers. A refreshed public
seed, fresh archive/global-layout admission, current-source broad gates and hosted
checks are still required. Whole-real-history and public-API acceptance gaps are
unchanged. No managed runtime installation, restart or live migration occurred.
