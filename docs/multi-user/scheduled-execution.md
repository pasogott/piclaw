# Scheduled execution records

Piclaw supports **single-user deployments only**. Family and isolated modes cannot start. The following internal APIs support development testing; they have no HTTP or transport route and do not invoke models or deliver results. See [access modes](README.md) and the [paused task-grant foundation](README.md#paused-task-grant-foundation).

## Internal occurrence reservations

The internal occurrence API can reserve one due occurrence for a valid prepared grant. It uses server time, a 60-second lease and a random token whose SHA-256 hash is stored. Worker IDs are non-secret correlation labels of at most 32 lower-case letters, digits or hyphens, starting with a letter; possession of a valid current token is required for renewal or consumption. These functions are for trusted internal callers. They do not activate the paused task or create a runnable legacy scheduler occurrence.

Claim, renewal, reclaim and consumption use immediate SQLite transactions with matching row/version checks and an atomic audit event. Renewal rotates the token and increments the version. Only expired, unconsumed reservations can be reclaimed; reclaim increments the attempt and version and replaces the token. Old workers/tokens cannot renew or consume. The first claim's tool ceiling can only narrow across renewals and reclaims, and consumption intersects it with the current grant policy. Every operation revalidates the live grant, owner, target and payload. Logout alone does not revoke it; account disable, explicit revocation and task changes do.

Consumption is terminal: it clears the stored token hash and cannot be replayed or reclaimed, even if returning the result was interrupted. It returns validated task/owner/service data for future integration, with no model, tool or delivery call. A consumed reservation is still insufficient to pass family model admission. This reservation store does not provide exactly-once external effects.

## Durable handoff and owner results

`beginFamilyScheduledExecution` consumes the current reservation and inserts an immutable execution record and begin audit in one transaction. Failure rolls back all three changes. It binds the exact consumed attempt/version/time, grant, task, owner, initiating user, scheduler service, target/root JIDs and branch IDs, prompt hash and tool ceiling, with an owner-label snapshot. A separate random settlement token is returned once; only its hash is stored. It expires after 15 minutes and cannot be renewed or recovered. Losing the response leaves a non-replayable handoff; the task stays paused.

`settleFamilyScheduledExecution` accepts exactly `{execution_id,token}` and `{status,text}`. Status is `success` or `error`; text is capped at 100 KiB UTF-8 and cannot contain NUL. It rechecks the live grant, consumed occurrence, exact target/payload, capability expiry and current tools. If current policy removes an issued tool, settlement denies. It atomically stores one immutable result and settle audit. An identical status/text retry acknowledges the existing row; changed bytes or status deny. Retries after expiry or revocation also deny, even if the result was previously committed. This conservative policy can leave completed work unrecorded after authority changes.

`readOwnFamilyScheduledResult` is an internal owner-only read using a live family login and active owned target. It returns `unsettled`, `expired-unsettled` or `settled`, with no token. Expiry changes the reported state without a background write, budget reservation or automatic retry. Settled history remains readable by its owner after grant revocation, with the original labels; account disable or target archive blocks access. No HTTP route, model call, timeline publication, push delivery or task activation is connected to these APIs.

Dispatcher integration, execution policy, recovery and process-kill proof still need implementation. Stop all writers before changing modes. Raw database writers and installed code remain trusted.
