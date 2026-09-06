# Access modes

Piclaw defaults to `single-user`. This foundation recognises future multi-user configuration and stores user/activation metadata, but **family and isolated modes cannot start yet**. Their authentication, ownership, Settings and integration work is tracked in [#1134](https://github.com/rcarmo/piclaw/issues/1134).

```json
{
  "domains": {
    "access": {
      "mode": "single-user"
    }
  }
}
```

An absent mode is equivalent to this setting on a fresh or legacy single-user store. Empty/unknown modes, malformed JSON and contradictory isolation settings cause startup failure. There is no access-mode environment variable or top-level `access` alias. Ordinary single-user authentication settings and optional unauthenticated use are unchanged.

## Planned profiles

| Profile | Workspace and skills | Authentication and execution | Availability |
|---|---|---|---|
| `single-user` | Existing workspace, skills and add-ons | Existing TOTP/WebAuthn or optional unauthenticated local access | Available |
| `family-shared` | Shared workspace and skills; personal memory selected by user | Individual accounts, owned session trees, forks and friendly renames | Disabled until the family gate |
| `isolated-containers` | Separate per-user volumes; optional read-only shared skills | Gateway authenticates and routes to dedicated backends | Disabled until the container gate |

Family mode is intended for trusted household members. Users with arbitrary shell or filesystem access can read shared files, runtime state and credentials; application capability controls do not provide filesystem confinement. Containers add process, volume and network boundaries but share a host kernel. Host administrators and deliberately shared writable volumes remain part of the trust model.

## Foundation storage

The existing `messages.db` gains two additive tables:

- `users`: immutable ID, normalised username, display name, role (`admin` or `member`), enabled flag, home chat reference and timestamps;
- `access_state`: singleton activated mode and access-schema version.

Initialisation seeds `default` as the existing local administrator with home `web:default`. It does not create a chat, rename an existing root, modify authentication tokens/passkey user handles, or change the existing configured model-visible identity. Subsequent initialisation does not overwrite user fields. New internal user records are disabled and have no home until a later provisioning workflow assigns one. These low-level store functions provide validation and transactions, not HTTP authorisation.

Usernames are trimmed, lowercased ASCII identifiers of 1–64 characters: an initial letter/digit followed by letters, digits, `_` or `-`. Disabled accounts retain their usernames. Public creation/rename reserves `default`, `admin`, `system`, `service` and `anonymous`. Display names are non-empty and at most 128 Unicode characters, without control characters/newlines. Public updates cannot change immutable IDs or home ownership and cannot disable/demote the last enabled administrator. Last-factor recovery checks belong to the authentication phase.

`previewAccessMigration(database)` is a read-only inventory of registered roots/descendants, archived branches, unregistered chats, topology faults and resource counts. Proposed default ownership of legacy web roots is a preview only. Non-web roots need explicit channel/service mappings. No preview output includes message contents, secrets or credentials; it does not assign ownership or enable a mode. Filesystem recordings/deferred queues and per-resource ownership are completed by the later ownership and execution phases.

## Request identity foundation

`GET /auth/me` returns the actor principal, authentication method and non-secret login ID, home destination and initial role capabilities. Responses use `Cache-Control: private, no-store` and `Vary: Cookie`. Missing credentials return 401 JSON; HEAD returns headers without a body. Client-supplied user/correlation headers and requested chat IDs cannot select the actor.

With authentication disabled in single-user mode, the endpoint returns the legacy local/default principal using the current configured user display name and `auth_enabled: false`. Authenticated requests resolve the cookie's user record and reject disabled, unknown or expired accounts. Dormant non-default cookies cannot activate another account in single-user mode. The gateway holds one immutable identity snapshot per Request and rechecks the next request. Family SSE subscriptions revalidate the login and owned target before event delivery and on each heartbeat.

Web sessions gain a random `session_id` unrelated to the bearer token/hash. Existing cookies retain their token and user handle; a missing login ID is populated on authenticated lookup. Per-user session listing excludes token material, and low-level revocation functions require both user and session IDs. Account API authorisation, service identities and connected-device revocation are subsequent #1124 work. The initial role helper denies unknown actions and does not grant administrators another owner's session content.

## Root ownership foundation

The additive `session_roots` table records the immutable owner and private policy against the stable root `branch_id`. Its current chat JID is resolved from the branch registry, so permitted internal JID maintenance preserves ownership. No ownership is inferred from username or JID prefixes, and schema installation does not assign legacy owners.

Internal provisioning helpers assign an existing root and a user's home atomically. Same-owner retries are idempotent; reassignment to another owner is rejected. The home must be an active root; archived roots remain owned but cannot execute. Database guards protect an assigned home from archive and an owned root from deletion; explicit safe cleanup is required before eventual root purge. Friendly renaming keeps IDs unchanged.

`resolveAuthorisedChat(database, principal, requestedChatJid, action)` checks live account status/role, root ownership and the whole stored parent chain before returning a target. Missing targets use the current owned home. Explicit empty, foreign, unknown, orphaned, cyclic or cross-root targets are denied uniformly. Admin role alone gives no access to another owner. This slice exposes the internal resolver; all route/tool/stream callers must integrate it before family mode becomes available.

`assignLegacyRootOwners` takes an explicit mapping for every registered root, including archived and non-web roots. It validates all parent chains and users, rejects unregistered chats or incomplete/duplicate mappings, and applies the assignments in one transaction. It never runs automatically or changes the activation marker. Full migration preflight, non-web service scope and dependent resource/queue handling remain release prerequisites.

## Owner-local handle storage

`chat_branches.handle_owner_id` separates the legacy namespace (empty string) from explicitly migrated owner namespaces. Existing single-user branches keep the empty namespace, existing names and legacy suffixing. The legacy active-name index covers only those rows. A second partial unique index enforces case-normalised `(handle_owner_id, agent_name)` uniqueness across each owner's active roots and descendants. Different owners can each claim `@research`; archive frees the name and restore must satisfy the same constraint.

`migrateOwnedSessionHandles(database)` is an explicit offline transaction. It validates ownership for every registered branch, including archived branches, then adopts namespaces without changing names or IDs. Any missing/mismatched ownership or collision rolls back the migration. It does not activate a mode or run at startup. Back up the store before eventual mode migration.

The owner-aware lookup/list/rename helpers validate live account and parent-chain ownership. Friendly rename updates only `agent_name` and `updated_at`; it preserves branch ID, chat JID, root, home, message references and filesystem paths. Owner-local misses never query another namespace. The legacy database lookup returns only legacy handles, and legacy ensure/rename/restore methods reject migrated rows.

Family branch listing, fork and friendly rename now use owner-bound controls. AgentBranchManager handle lookup and active/known lists use execution identity and have no cross-user active-session fallback. Chat tools, session control, schedules and peer ingress still need end-to-end owner propagation. Root creation, archive, restore, merge, purge and download stay disabled in the family router; corresponding destructive branch-manager operations also deny multi-user mode.

### Atomic family forks

`POST /agent/branch-fork` accepts `chat_jid` (omitted means the current home), `agent_name` and an owner-scoped `request_id` of 1–128 letters, digits, underscores or hyphens. The request needs a current account cookie and matching browser Origin; internal secrets cannot bypass either. The server supplies interactive execution identity before source hydration. Active sources require a recorded stable turn boundary. Capture rechecks identity before committing.

`owned_fork_operations` persists the captured JSON seed, source/target branch IDs and idempotency key in the same transaction as child chat/branch registration. The child inherits its root and namespace. Same-owner/source/key retries return the original child, including after rename; using the key with another source denies. New forks choose an available owner-local handle and an immutable UUID-based JID. Nested forks keep the same root. No filesystem branch seed is created for family forks.

On first use, session hydration validates live execution identity, the target and the seed's source before replay. It applies the current stored name, persists/reopens the session, then clears the seed payload while retaining the operation identity. Failure keeps the seed for retry and disposes the broken runtime. A crash before completion may replay into a fresh session again; the seed is retained until successful persistence. Legacy file seeds are rejected for family sessions. Existing migrated children without fork-operation provenance need an explicit adoption workflow before hydration.

Main/cached/side hydration now requires matching live family execution identity. Family background prewarm is disabled until its queue carries durable owner provenance. The session manager rechecks identity after asynchronous waits; callers still need integration across direct model/tool entry points. Fork and rename UI workflows, process-kill crash testing, per-user deployment and activation gates remain unfinished.

## HTTP and SSE enforcement

The family router makes a terminal decision before legacy, add-on and widget-state dispatch. Unsupported routes cannot fall through. Isolated mode returns 503 until its gateway exists. Startup still blocks both multi-user modes.

| Route class | Family policy |
|---|---|
| GET/HEAD login page; POST TOTP verify and WebAuthn login start/finish | Existing authentication handlers and rate limits; internal-secret bypass disabled |
| GET/HEAD login JS/CSS | Public packaged assets; source maps and other assets require login |
| GET/HEAD `/auth/me` | Account snapshot or JSON 401 |
| GET/HEAD index and `/static/*` | Authenticated packaged shell/assets; anonymous index serves login |
| GET `/timeline`, `/hashtag/:tag`, `/thread/:id` | Live owned home or validated owned target |
| GET `/search` | `current`, `root` and `all` search only authorised chats; filter before pagination |
| GET `/sse/stream` | Server-authorised chat subscription with live revalidation |
| GET `/agent/branches` | Active owned roots/descendants only; no runtime-global fallback |
| POST `/agent/branch-fork`, `/agent/branch-rename` | Owner-bound target, strict fields, browser Origin, cookie revalidation and branch rate limit |
| `/admin/users`, `/account`, `/account/sessions/*`, `/account/factors/*` | Explicit account methods below; live account/login checks, own-resource scope, recent authentication and Origin on mutations |
| All other routes and methods | JSON 401 without a browser principal; uniform 403 with one |

Missing `chat_jid` selects the current stored home; explicit empty, duplicate, unknown, unowned and foreign targets receive the same denial. An explicit `root_chat_jid` must resolve to the target's root. Role alone cannot select another owner's messages. Thread IDs are looked up within the authorised chat. Responses retain existing owner-message fields; media retrieval is still denied. No response is derived from a foreign chat's message contents. Family responses use `Cache-Control: private, no-store` and `Vary: Cookie`. Browser cache/storage namespacing still needs implementation.

An SSE subscription retains a non-secret login ID and target, without retaining bearer cookies. Login expiry/revocation, disabled accounts, changed roles and invalid/archived parent chains close it before the next event. Idle clients are checked every 30 seconds. Only known chat-scoped event types matching the authorised target are delivered; no global broadcast event is approved yet. The connection handshake omits global UI preferences. Cancellation and revocation clear the heartbeat and remove the client. Already delivered/queued bytes cannot be recalled.

Denied surfaces include add-on ingress/config APIs, widget state/snapshots, mutations other than fork/rename and the account methods below, E2E bootstrap, general factor registration, media/uploads, workspace, exports, recordings, terminal/VNC, other agent controls/metadata, push and Settings. Each needs an explicit policy and target validation before being enabled. Tool/non-web boundaries, per-user browser state, device notification routing and complete route/resource inventory remain #1127 work. Single-user routing and unscoped SSE behaviour are unchanged.

## Account-factor foundation

Per-user TOTP factors and pending enrolments use dedicated `user_totp_factors` and `user_totp_enrolments` tables. They are absent from generic keychain listing and shell secret injection. Seeds use AES-256-GCM with a per-record salt/nonce, PBKDF2-SHA256 (150,000 iterations), bootstrap key material and user-bound associated data. Sharing the machine still permits a sufficiently privileged process to read state and keys; this separation prevents accidental tool exposure.

The internal enrolment service returns a newly generated seed once for a future QR ceremony; stores only encrypted seed and hashed token; expires tokens after five minutes; reserves at most five confirmation attempts; and consumes token plus confirmed factor atomically. Confirmation does not enable an account or assign its home. An existing factor cannot be overwritten through enrolment. Expired pending records are pruned during confirmation; periodic retention and account reset are subsequent lifecycle work.

Multi-user TOTP selects one normalised username, strictly validates its six-digit code, and atomically consumes the accepted 30-second step. Login reserves a persistent five-attempt account / twenty-attempt IP budget per five minutes before asynchronous cryptography. Reservations include successful and in-flight attempts and are not cleared by another concurrent success. Unknown/disabled accounts perform equivalent KDF work and receive the same invalid-code response. Cookie issuance rechecks current account enablement, home and verified factor revision. Legacy single-user verification behaviour is unchanged.

WebAuthn discoverable login resolves the verified credential owner and checks its user handle, account state and current credential before issuing a cookie. Multi-user ceremonies require user verification and capture the expected origin. Registration requires same-account recent authentication and origin checks; it uses the user's immutable ID/username/display name and cannot overwrite an existing credential. Legacy single-user ceremony settings remain supported.

Reset/recovery routes, general WebAuthn enrolment lifecycle hardening and Settings are unfinished. The account service below protects factor removal, but the legacy factor-management tools still need owner-bound integration before family execution. No mode is enabled by these internal methods. Back up the factor tables and bootstrap key together. Changing the bootstrap key currently requires an offline reviewed re-encryption/recovery procedure; automatic rotation and mixed-key ciphertext are unsupported.

## Family account administration

All account operations re-read the login ID and enabled user/role. Mutations require a same-origin browser request, recent TOTP/passkey authentication (five minutes), and rate limiting. Internal secrets do not bypass these checks. Account responses contain profile/device/factor metadata only; no seed, public key, bearer token, token hash or conversation content is returned.

| Method and path | Scope |
|---|---|
| GET `/admin/users` | Enabled administrator lists account metadata |
| POST `/admin/users` | Recent administrator creates a disabled account and owned home root atomically |
| PATCH `/admin/users/:id` | Recent administrator changes username/displayName/role/enabled; immutable identity/home fields rejected |
| PATCH `/account` | Recent account owner changes only username/displayName |
| GET `/account/sessions` | Current owner's login metadata, excluding bearer material |
| DELETE `/account/sessions/:sessionId` | Revoke own device; foreign/missing IDs have the same response and no effect |
| GET `/account/factors` | Own TOTP presence and passkey metadata |
| DELETE `/account/factors/totp` or `/account/factors/passkey/:credentialId` | Remove an own factor only if another factor permitted by configured auth policy remains |

Provisioning creates the disabled user, immutable `web:user:<id>` home, root ownership and owner-local `home` handle in one transaction. Enabling requires an active owned root and at least one currently configured factor (passkeys must match the current RP ID). Disable, enable and role transitions revoke all target logins and pending enrolments; changing profile labels leaves devices active. The last enabled administrator cannot be disabled or demoted. Factor removal rolls back if it would remove the last configured factor, and otherwise revokes all target devices/enrolments. These transactions do not grant administrators access to another user's sessions.

These account APIs cannot display or replace stored TOTP seeds. Restricted invitations below bootstrap a new factor; authentication recovery is separate work. Full mode activation, migrated legacy factors, RP-specific UI inventory and legacy WebAuthn tool/ceremony isolation need integration testing before release.

## Restricted TOTP invitations

POST `/admin/users/:id/invitation` requires recent administrator authentication and creates a 15-minute random grant for a disabled account with an owned home and no factors. DELETE at the same path revokes it. Only hashes are stored. Reissue invalidates the previous grant and pending TOTP enrolment. Explicit disable (even already disabled), role transitions and factor removal revoke affected issued grants; issuer demotion/disable prevents grant use.

POST `/auth/invitation/claim` accepts only `{token}`. It requires matching browser Origin and a rate-limited client, but no account cookie. It consumes the claim before cryptography, returns the new seed and enrolment token once, and sets a five-minute HttpOnly/Secure/SameSite=Strict `piclaw_enrolment` cookie restricted to `/auth/invitation`. The persisted grant binds hashes of the browser cookie and enrolment token plus the origin. A lost claim response requires an administrator to issue another invitation.

POST `/auth/invitation/confirm` accepts only `{token,enrolment_token,code}` and needs that cookie and origin. Five guesses are allowed by the underlying enrolment record. Verification rechecks the grant and account after asynchronous cryptography. One transaction inserts the factor, enables the same invited account, revokes any account logins and consumes the grant; failure rolls everything back. Success clears the enrolment cookie and requires an ordinary login. The invitation grants no account-role/profile changes, factor deletion or transcript access. Responses are private/no-store. TOTP-disabled/passkey-only policy cannot issue or redeem these TOTP invitations.

The API has no invitation page or QR UI yet. Passkey-first invitations, reset/recovery, periodic expiry pruning and key rotation need separate implementation. Expired records are pruned on issue/claim and factor confirmation. General factor reset cannot reuse invitations for accounts with existing factors.

## Multiple passkeys per account

Each account can register multiple passkeys; adding one never replaces an existing credential. GET `/account/factors` lists each key separately, and the own-factor DELETE route removes one credential while retaining the last usable-factor protection. Counts used by removal/enablement are restricted to the current RP ID and configured auth methods.

POST `/account/passkeys/register/start` accepts an empty object and requires recent TOTP/passkey authentication, matching browser Origin and account mutation rate limits. It returns WebAuthn options with required resident key/user verification, plus a random ceremony token. Existing credentials for that user and RP are excluded from registration options. `user_passkey_registrations` stores the token hash, immutable user ID, initiating login ID, RP, origin, challenge and five-minute expiry. At most five pending ceremonies per user are allowed; this does not limit registered keys to one.

POST `/account/passkeys/register/finish` accepts `{token,credential}`. The same account/login/origin must consume the grant before verification; failed proofs and replay require a new ceremony. After cryptographic verification, the service rechecks current login/account status and expiry, then inserts the credential without replacement. No new login cookie is issued. Role/enable changes, own-device revocation and factor removal clear affected pending registrations. A second login on the same account cannot complete the first browser's ceremony.

Tests use real P-256/COSE keys, CBOR registration attestation and signed login assertions for two credentials. Passkey-first invitations, credential-label UI, physical authenticator browser tests and offline recovery are still unfinished. Legacy single-user ceremony routes are unchanged; the family account endpoints use the separate durable flow above.

## Model identity foundation

`RunAgentOptions.executionProvenance` is a server-owned contract containing initiating actor, session owner, chat, execution kind and optional non-secret login correlation. It must never be copied from a browser/model request body. The orchestrator validates it against live account/root records before hydration and holds the projected identity in AsyncLocalStorage through the run. Interactive provenance also needs a current matching login; owner-scheduled work may survive ordinary logout but cannot run for a disabled owner. Cross-user service actors are denied until explicit service grants exist.

The existing memory bootstrap hook appends runtime username, display name, actor/owner IDs, role and workspace profile to system context. It never creates a synthetic user message or emits login credentials. Personal context comes from `notes/users/<immutable-user-id>/MEMORY.md` and `preferences.md`, plus explicit shared `notes/family/MEMORY.md`. Missing files are reported as missing; another user's context or legacy global personal memory is not substituted. Paths remain on the deliberately shared filesystem.

Unmodified single-user callers keep their existing prompt/memory behaviour, and clear inherited execution identity. Browser ingress, durable queue/job attribution, direct side prompts, delegates and service grants must integrate this contract before family activation. The foundation tests the scoped authoriser, concurrent contexts and prompt hook; it does not yet claim identity propagation across every entry point.

## Activation and recovery

Access validation runs after database initialisation and before add-on runtime setup, background workers and listeners. This build permits only single-user configuration with a single-user activation marker. It never offers a flag to bypass the release gate.

A persisted multi-user marker with missing/reverted configuration fails closed. Missing marker rows, a removed marker table alongside existing users, and unknown access-schema versions also fail closed. The marker protects against accidental downgrade/config loss, not a malicious operator who can rewrite the database.

1. Back up configuration, `messages.db`, session files and credentials together before any eventual mode migration.
2. Do not remove activation state or edit it to bypass an error.
3. Recover matching configuration and a compatible binary from the verified backup, or use a future reviewed conversion workflow.
4. Never point a pre-multi-user binary at a family store: older binaries cannot enforce new ownership markers. Reverting to such a binary requires restoring its compatible single-user backup offline.

Changing a mode requires an explicit migration and managed restart. No mode conversion or activation occurs in this foundation. [#1133](https://github.com/rcarmo/piclaw/issues/1133) owns staged release enablement; [#1130](https://github.com/rcarmo/piclaw/issues/1130) owns the Settings controls.

## Reserved isolated configuration

`domains.access.isolation.component` selects `gateway` or `backend` only when `access.mode` is `isolated-containers`.

- Gateway: `signingKeyRef` and a non-empty `backends` registry of `{ id, ownerUserId, url }`. Backend and owner IDs must be unique.
- Backend: `backendId`, `ownerUserId`, `gatewayUrl` and `verificationKeyRef`.

References name future restricted control-plane key storage; never inline key material. URLs must use HTTPS without URL credentials, query or fragment. The parser validates component shape, not network reachability or cryptographic trust. Even a valid shape is rejected for execution in this foundation. The eventual gateway alone owns browser factors/sessions; tenant backends must never expose an anonymous single-user entry point.
