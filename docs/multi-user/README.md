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

With authentication disabled in single-user mode, the endpoint returns the legacy local/default principal using the current configured user display name and `auth_enabled: false`. Authenticated requests resolve the cookie's user record and reject disabled, unknown or expired accounts. Dormant non-default cookies cannot activate another account in single-user mode. The gateway holds one immutable identity snapshot per Request and rechecks the next request; long-lived stream revocation is implemented separately before family activation.

Web sessions gain a random `session_id` unrelated to the bearer token/hash. Existing cookies retain their token and user handle; a missing login ID is populated on authenticated lookup. Per-user session listing excludes token material, and low-level revocation functions require both user and session IDs. Account API authorisation, service identities and connected-device revocation are subsequent #1124 work. The initial role helper denies unknown actions and does not grant administrators another owner's session content.

## Root ownership foundation

The additive `session_roots` table records the immutable owner and private policy against the stable root `branch_id`. Its current chat JID is resolved from the branch registry, so permitted internal JID maintenance preserves ownership. No ownership is inferred from username or JID prefixes, and schema installation does not assign legacy owners.

Internal provisioning helpers assign an existing root and a user's home atomically. Same-owner retries are idempotent; reassignment to another owner is rejected. The home must be an active root; archived roots remain owned but cannot execute. Database guards protect an assigned home from archive and an owned root from deletion; explicit safe cleanup is required before eventual root purge. Friendly renaming keeps IDs unchanged.

`resolveAuthorisedChat(database, principal, requestedChatJid, action)` checks live account status/role, root ownership and the whole stored parent chain before returning a target. Missing targets use the current owned home. Explicit empty, foreign, unknown, orphaned, cyclic or cross-root targets are denied uniformly. Admin role alone gives no access to another owner. This slice exposes the internal resolver; all route/tool/stream callers must integrate it before family mode becomes available.

`assignLegacyRootOwners` takes an explicit mapping for every registered root, including archived and non-web roots. It validates all parent chains and users, rejects unregistered chats or incomplete/duplicate mappings, and applies the assignments in one transaction. It never runs automatically or changes the activation marker. Full migration preflight, non-web service scope and dependent resource/queue handling remain release prerequisites.

## Account-factor foundation

Per-user TOTP factors and pending enrolments use dedicated `user_totp_factors` and `user_totp_enrolments` tables. They are absent from generic keychain listing and shell secret injection. Seeds use AES-256-GCM with a per-record salt/nonce, PBKDF2-SHA256 (150,000 iterations), bootstrap key material and user-bound associated data. Sharing the machine still permits a sufficiently privileged process to read state and keys; this separation prevents accidental tool exposure.

The internal enrolment service returns a newly generated seed once for a future QR ceremony; stores only encrypted seed and hashed token; expires tokens after five minutes; reserves at most five confirmation attempts; and consumes token plus confirmed factor atomically. Confirmation does not enable an account or assign its home. An existing factor cannot be overwritten through enrolment. Expired pending records are pruned during confirmation; periodic retention and account reset are subsequent lifecycle work.

Multi-user TOTP selects one normalised username, strictly validates its six-digit code, and atomically consumes the accepted 30-second step. Login reserves a persistent five-attempt account / twenty-attempt IP budget per five minutes before asynchronous cryptography. Reservations include successful and in-flight attempts and are not cleared by another concurrent success. Unknown/disabled accounts perform equivalent KDF work and receive the same invalid-code response. Cookie issuance rechecks current account enablement, home and verified factor revision. Legacy single-user verification behaviour is unchanged.

WebAuthn discoverable login resolves the verified credential owner and checks its user handle, account state and current credential before issuing a cookie. Multi-user ceremonies require user verification and capture the expected origin. Registration requires same-account recent authentication and origin checks; it uses the user's immutable ID/username/display name and cannot overwrite an existing credential. Legacy single-user ceremony settings remain supported.

Public invitation/reset routes, recovery and last-factor safeguards, enrolment challenge/browser lifecycle hardening and Settings are unfinished. No mode is enabled by these internal methods. Back up the factor tables and bootstrap key together. Changing the bootstrap key currently requires an offline reviewed re-encryption/recovery procedure; automatic rotation and mixed-key ciphertext are unsupported.

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
