import type Database from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { Type } from "@earendil-works/pi-ai";
import { defineTool, defineExtension, type ConversationId, type TaskId } from "@earendil-works/pi-durable";
import { requestGracefulShutdown } from "../../src/runtime/shutdown-registry.js";
import { getSessionIsolationLevel } from "../../src/core/config.js";
import { createLogger } from "../../src/utils/logger.js";
import { operationBudgetWorkId } from "./host-request-accounting.js";
import { nativeExitNotice, type NativeExitReceipt } from "./host-process-receipt.js";
import type { AcceptedInput, HostConversationRuntime, NativeProcessSnapshot } from "./host-runtime.js";

export const nativeProcessToolNames = ["session_status", "exit_process"] as const;
export const nativeProcessInstructions = `## Native process controls
Use session_status before requesting a restart. exit_process must be the ONLY tool call in its round and the LAST action of the turn. It commits a visible conditional restart notice and terminates through the SDK; do not request another model or tool call. Other active, queued or uncertain native work denies the request. resume_message is not supported: never replay uncertain work. Shutdown occurs only after terminal persistence, a fresh global idle check and confirmed native cleanup.`;
const log = createLogger("native.process-controls");
type Scope = NonNullable<NativeProcessSnapshot["scope"]>;
type Options = {
  root: Database;
  runtime(): Pick<HostConversationRuntime, "inspectProcessControl" | "verifyProcessExitRound" | "assertCapturedSourceCurrent">;
  assertOwner(): void;
  /** Shared queue and asynchronous host controls are not SDK tasks. */
  assertHostIdle?(input?: AcceptedInput): void;
  /** The backend's existing idempotent close, not a second shutdown owner. */
  closeNative(): Promise<void>;
  requestShutdown?: (reason: string) => void;
  defer?: (run: () => Promise<void>) => void;
};

/** A process-local admission latch, never a recovered execution/restart queue.
 * Durable intent/result belongs to the SDK tool receipt. A new process can
 * project that receipt but CANNOT reconstruct this shutdown authorisation.
 */
export function createHostProcessControls(options: Options) {
  const root = options.root;
  let pending: NativeExitReceipt | undefined;
  let scheduled = false;
  let commandPending = false;
  const assertOwner = () => options.assertOwner();
  const assertAdmission = (input?: AcceptedInput) => {
    assertOwner();
    if (commandPending || (pending && (!input || Object.keys(pending.input).some(key => input[key as keyof AcceptedInput] !== pending!.input[key as keyof AcceptedInput]))))
      throw Error("Native shutdown admission is sealed; no new work accepted. Use the existing abort/reconciliation control if completion is uncertain.");
  };
  function assertSqlIdle(scope?: Scope) {
    assertOwner(); options.assertHostIdle?.(scope?.input);
    const allowedTasks = new Set<number>(scope ? [scope.taskId, scope.generationId] : []);
    const tasks = root.query("SELECT id,abort_requested FROM tasks WHERE status<>'terminal'").all() as { id: number; abort_requested: number }[];
    if (tasks.some(task => !allowedTasks.has(task.id) || task.abort_requested)) throw Error("Other or uncertain native tasks are active");
    const submissions = root.query("SELECT id FROM submissions WHERE status IN ('queued','placed')").all() as { id: number }[];
    if (submissions.some(row => !scope?.submissionIds.includes(row.id))) throw Error("Other native input is queued or placed");
    const operations = root.query("SELECT operation_id FROM service_effect_s01_operations WHERE phase<>'terminal'").all() as { operation_id: string }[];
    if (operations.some(row => row.operation_id !== scope?.input.operationId)) throw Error("Other host operations are active");
    const sources = root.query("SELECT chat_jid,source_seq FROM service_effect_s01_sources WHERE state NOT IN ('consumed','disposed')").all() as { chat_jid: string; source_seq: number }[];
    if (sources.some(row => row.chat_jid !== scope?.input.chatJid || row.source_seq !== scope?.input.sourceSeq)) throw Error("Other accepted host input is pending");
    if (root.query("SELECT 1 FROM service_effect_s07_occurrences WHERE state IN ('claimed','source_bound') LIMIT 1").get())
      throw Error("Scheduled execution is active or uncertain");
    if (root.query("SELECT 1 FROM service_effect_s01_queued_inputs WHERE state NOT IN ('consumed','disposed') LIMIT 1").get())
      throw Error("Host queued input is pending");
    const queues = root.query("SELECT queued_followups_json FROM chat_cursors WHERE queued_followups_json IS NOT NULL").all() as { queued_followups_json: string }[];
    for (const row of queues) {
      const value = JSON.parse(row.queued_followups_json);
      if (!Array.isArray(value) || value.length) throw Error("Deferred host input is pending or unreadable");
    }
    if (scope) {
      if (!scope.singleton || scope.submissionIds.length !== 1 || tasks.length !== 2 || submissions.length !== 1 || operations.length !== 1 || sources.length !== 1)
        throw Error("A singleton root tool round with one accepted input is required");
      options.runtime().assertCapturedSourceCurrent([{ ...scope.input, submissionId: scope.submissionIds[0]! as import("@earendil-works/pi-durable").SubmissionId }]);
    }
    assertOwner();
  }
  async function inspect(call?: { conversationId: ConversationId; taskId: TaskId; callId: string }, requireIdle = true) {
    assertOwner();
    const snapshot = await options.runtime().inspectProcessControl(call);
    assertOwner();
    const allowed = new Set(snapshot.scope ? [snapshot.scope.taskId, snapshot.scope.generationId] : []);
    if (requireIdle && (snapshot.inspection.scheduling === "closing" || snapshot.inspection.tasks.some(task => !allowed.has(task.record.id)) ||
        snapshot.inspection.submissions.some(record => !snapshot.scope?.submissionIds.includes(record.id))))
      throw Error("Other native work is active");
    return snapshot;
  }
  const tools = nativeProcessToolNames.map(name => defineTool({
    name, description: name === "session_status" ? "Check authoritative global native activity and whether a restart can be requested. Read-only; no legacy sessions."
      : "Request graceful Piclaw exit after this exact operation is persisted and native cleanup is confirmed. Must be the only tool in the round. Other work refuses the request; no replay or forced interruption.",
    parameters: name === "session_status" ? Type.Object({ action: Type.Optional(Type.Union([Type.Literal("list"), Type.Literal("check")])) })
      : Type.Object({ reason: Type.String({ minLength: 1, maxLength: 512, pattern: "\\S" }), resume_message: Type.Optional(Type.String()) }),
    callers: ["model"], replay: "unsafe", executionMode: "sequential",
    async execute(args: any, api, context) {
      const fail = (message: string) => ({ output: [{ type: "text" as const, text: message }], isError: true,
        details: { scheduled: false, pending: false, safe_to_restart: false } });
      if (name === "exit_process" && args.resume_message !== undefined) return fail("Native resume_message is unsupported; no shutdown scheduled.");
      if (pending || commandPending) return fail("A native shutdown request is already pending; no additional request scheduled.");
      try {
        assertOwner(); context.abortSignal?.throwIfAborted();
        const snapshot = await inspect({ conversationId: api.conversationId, taskId: api.taskId, callId: api.callId }, name !== "session_status");
        context.abortSignal?.throwIfAborted(); assertOwner();
        const scope = snapshot.scope!;
        if (name === "session_status") {
          if (getSessionIsolationLevel() === "full") return fail("Session isolation prevents global activity disclosure; restart safety was not granted.");
          let safe = true;
          try { assertSqlIdle(scope); } catch { safe = false; }
          return { output: [{ type: "text" as const, text: JSON.stringify({ safe_to_restart: safe,
            active_tasks: snapshot.inspection.tasks.length, unsettled_submissions: snapshot.inspection.submissions.length,
            chat_jid: scope.input.chatJid, current_operation_id: scope.input.operationId }) }] };
        }
        const reason = typeof args.reason === "string" ? args.reason.trim() : "";
        if (!reason || reason.length > 512) return fail("A bounded non-empty exit reason is required; no shutdown scheduled.");
        const receipt: NativeExitReceipt = { kind: "native_process_exit", version: 1, nonce: randomUUID(), reason,
          taskId: scope.taskId, assistantId: scope.assistantId, input: scope.input };
        // Final revalidation and latch have no asynchronous gap and share the
        // writer exclusion used by native/host admission. COMMIT uncertainty
        // remains sealed until a committed failed round or operator reconcile.
        root.transaction(() => { assertSqlIdle(scope); context.abortSignal?.throwIfAborted(); pending = receipt; }).immediate();
        return { output: [{ type: "text" as const, text: nativeExitNotice(reason) }], details: { ...receipt, input: { ...receipt.input } },
          control: { terminate: true as const } };
      } catch {
        return fail("Native activity/ownership could not prove a safe singleton exit. No shutdown scheduled; finish or reconcile other work and request again.");
      }
    },
  }));
  const extension = defineExtension({ name: "app.host-process-controls", hooks: [{ task: "pi.generation", handlers: {
    async afterTools(assistant: import("@earendil-works/pi-durable").EntryId) {
      const request = pending;
      if (!request || request.assistantId !== assistant) return;
      const result = await options.runtime().verifyProcessExitRound(assistant, request.input);
      assertOwner();
      if (!result || result.nonce !== request.nonce) pending = undefined; // Known committed failure; never retry the unsafe call.
    },
  } }] });
  const onOperationSettled = (operationId: string, receipt?: NativeExitReceipt) => {
    const request = pending;
    if (!request || request.input.operationId !== operationId || scheduled) return;
    assertOwner();
    const terminal = root.query("SELECT phase,terminal_disposition FROM service_effect_s01_operations WHERE operation_id=?").get(operationId) as
      { phase: string; terminal_disposition: string | null } | null;
    if (terminal?.phase !== "terminal") throw Error("Native exit terminal persistence is unavailable");
    if (!receipt || receipt.nonce !== request.nonce || terminal.terminal_disposition !== "completed") { pending = undefined; return; }
    const work = root.query("SELECT status FROM budget_work WHERE id=?").get(operationBudgetWorkId(operationId)) as { status: string } | null;
    if (work && work.status !== "completed") throw Error("Native exit accounting settlement is uncertain");
    scheduleExit(request.reason);
  };
  function scheduleExit(reason: string) {
    scheduled = true;
    const finish = async () => {
      let closing = false;
      try {
        assertOwner();
        const snapshot = await inspect();
        if (snapshot.inspection.tasks.length || snapshot.inspection.submissions.length) throw Error("Native work is not quiescent");
        assertSqlIdle();
        closing = true;
        await options.closeNative(); // An uncertain cleanup MUST NOT request process shutdown.
        assertSqlIdle(); // Uses the original application owner, not the now-closed SDK lease.
        (options.requestShutdown ?? requestGracefulShutdown)(reason);
      } catch {
        if (!closing) {
          try { assertOwner(); pending = undefined; commandPending = false; scheduled = false; } catch { /* Lost ownership cannot unseal admission. */ }
        }
        // Refusal is terminal for this request. No delayed retry can bypass new
        // work or uncertain cleanup; a new request needs fresh authorisation.
        log.warn("Native exit final safety/cleanup check failed; shutdown was not requested", { operation: "native_exit.refused" });
      }
    };
    (options.defer ?? (run => { setTimeout(() => { void run(); }, 1500); }))(finish);
  }
  /** Direct user slash control: no SDK round or receipt. Only globally idle
   * host ownership can enter. Seal before inspection to fence racing input. */
  async function requestCommandExit(reason: string) {
    assertAdmission();
    if (!reason.trim() || reason.length > 512) throw Error("A short exit reason is required");
    root.transaction(() => { assertSqlIdle(); commandPending = true; }).immediate();
    try {
      await inspect();
      assertSqlIdle();
      scheduleExit(reason.trim());
    } catch (error) {
      try { assertOwner(); commandPending = false; } catch { /* Lost ownership remains sealed. */ }
      throw error;
    }
  }
  return { tools, extension, assertAdmission, onOperationSettled, requestCommandExit,
    pending: () => pending !== undefined || commandPending,
    ownsOperation: (operationId: string) => pending?.input.operationId === operationId };
}
