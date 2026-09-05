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
