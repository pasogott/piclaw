# Unified upload limit and large chat files

Chat and workspace uploads now share one configured file-size limit. Single-user chat files above 32 MiB are stored under workspace `uploads/` and referenced in the message instead of becoming database blobs.

## Contract

- **Settings → General → Upload limit (MB)** controls both surfaces, with a 1–1024 MiB range. Existing explicit workspace limits win over conflicting legacy compose values. Compose-only legacy configuration is a fallback; the compose settings API remains an alias. No live configuration was changed during development.
- Files up to 32 MiB keep the existing media-ID path, subject to the shared limit. Existing media rows and attachments are not migrated.
- Larger files use sequential 8 MiB raw requests to `/media/upload-chunk`. The final path is `uploads/upload-<opaque-id>/<filename>` relative to the workspace. The message receives a `Files:` reference only after completion and size/path validation.
- Both skins render the resulting reference as a download link. Mixed uploads retain each small file's media ID and each large file's workspace path. The agent receives the same relative path in the message content.
- Uploads never overwrite a completed attachment. Only the final rename publishes the file; partial bytes remain in the existing private chunk staging directory. Completed files are ordinary workspace files and survive message deletion.
- Failure leaves the composer draft/attachments recoverable and does not send a broken reference. Retry starts a new upload. Resume and deduplication after a lost final acknowledgement are not implemented; a completed but unacknowledged file may remain for manual cleanup.

## Safety and resource bounds

The new route goes through the normal authentication, CSRF and rate-limit guards. It accepts single-user mode only. Family uploads retain their owner-scoped media endpoint and cannot spill into the shared workspace; their storage ceiling remains 32 MiB. Enabling owner-private large-file storage for family mode would require a separate storage/authorisation design.

Filename checks reject path separators, control/bidi/line-separator characters, trailing dots/spaces and Windows device names. IDs are constrained; paths are constructed by the server. Destination and staging paths are checked for symlinks and unsafe types before the existing synchronous append/final-rename sequence. Local malicious processes that can replace filesystem components concurrently remain outside the web-request security boundary.

At most four chunks can be received concurrently, and one request per upload ID. Each body is bounded to its expected size (at most 8 MiB); a 120-second deadline cancels stalled reads and releases the slot. The client deadline is slightly longer. The route uses the existing 240-chunks/minute rate class. Abandoned staging files use existing lazy 24-hour cleanup. The shared filesystem has no new aggregate quota; disk exhaustion is surfaced as an upload failure.

## Evidence

Base: `9f9c673df`. Isolated worktree: `/workspace/piclaw-worktrees/unified-uploads`.

- Full local `make ci-fast`: **5,765 runtime passes, 7 skips, zero failures; 25 feature checks; 9 build tests**.
- An actual 512 MiB server upload completes in bounded chunks and its final size is verified without inserting file data into SQLite.
- Backend cases cover threshold/maximum, exact body sizes, ordering, duplicate IDs, metadata mismatch, family rejection, symlink destinations/staging, concurrency and stalled-body cancellation. Fresh child processes isolate bootstrap config paths and temporary files.
- Post-build shipped Classic/Visual shells in Chromium and WebKit: **4 passes, 118 assertions**, including mixed small/large attachments, submitted IDs/path, download links, rejected chunks preserving drafts without sending messages, and the single shared Settings control. Chunk bytes are also checked by the direct backend and transfer tests; WebKit omits routed Blob bodies from its debugging protocol.
- Configuration fixtures were updated to assert the shared limit and canonical persistence. The old separate-limit expectations failed the first full gate, then passed after correction. No unrelated timeouts were relaxed.
- Authentication/CSRF and existing family provenance tests pass. Five repository typecheck projects pass, with the existing 95 frontend transitive diagnostics unchanged.
- Bounded final source review found no blockers. An earlier incomplete review raised retry/quota/TOCTOU concerns; the behaviour and limits above are explicit. Additional controls added during review include safe Unicode names, staging checks, concurrency and a chunk deadline.

No live upload, settings change, database migration, installation, merge or restart was performed. Browser tests intercept APIs and backend tests write only under owned temporary workspaces.
