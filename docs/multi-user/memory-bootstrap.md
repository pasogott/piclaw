# Memory bootstrap selection

The built-in `workspaceMemoryBootstrap` hook selects files from the current configured workspace on every invocation. Family and isolated deployment startup remains gated; this boundary is covered by disposable tests, not a live migration or activation.

## Single-user compatibility

With valid single-user configuration, legacy callers without execution identity keep `notes/memory/MEMORY.md`, `notes/index.md` and optional `notes/preferences/agent.md`, including existing missing-file and truncation behaviour. An explicitly supplied single-user default-account identity uses those same paths and retains its runtime identity label. A stale family identity in single-user mode cannot select family files or fall back to legacy memory.

## Family sources and authority

Family mode requires a matching immutable runtime execution identity, provenance and optional preference snapshot. The source chat, live account, role, original root and login or private scheduled-dispatch authority must validate before any memory read. Absent identity, unsupported isolated mode, malformed configuration, wrong chat/root/role and revoked authority reject the hook. Scheduled work uses the existing durable dispatcher checks and does not require its owner's old browser login.

Only these fixed paths are selected:

- `notes/users/<immutable-user-id>/MEMORY.md` — selected owner context;
- `notes/users/<immutable-user-id>/preferences.md` — selected owner preferences;
- `notes/family/MEMORY.md` — separately labelled shared family reference.

The owner ID comes from runtime identity, not username or message text. Missing or unreadable files remain missing; they never select another user or legacy global notes. Each family file retains its 8,000-character output cap. The existing reader reads the full file before truncating; this change does not add file-size or filesystem resource limits. Account response guidance retains its per-run immutable snapshot.

Mode, workspace and identity are rechecked around reads and before returning the assembled system prompt. An observed denial is latched for that invocation, even if configuration changes back inside optional-file handling. Read errors cannot swallow an authority denial. No filesystem writes, shared publication, search-index refresh, model call or timer is added.

## Limits

Memory text is labelled reference data, not identity or permission authority. Family reference is not automatically attributed to the selected owner. The hook does not recursively load linked notes or publish personal context into shared memory. This is automatic prompt-source selection, not filesystem confidentiality: explicit permitted reads, symlinks, writable shared code and privileged installed extensions remain within the shared-machine trust boundary.

The SDK may catch extension-hook errors and continue without this hook's addition. This change guarantees that denied bootstrap text is not returned; it is not a new model-cancellation boundary. The runtime's existing admission and scheduled-scope checks still govern execution. Other system-prompt extensions, generic workspace indexing/search, per-user Dream source/output coordination and explicit shared-memory publication require separate integration before family activation.
