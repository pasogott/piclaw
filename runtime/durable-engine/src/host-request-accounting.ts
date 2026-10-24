import { createHash, randomUUID } from "node:crypto";
import type Database from "bun:sqlite";
import type { AssistantMessage, Api, Model } from "../../src/durable-legacy-sdk.js";
import { modelRequestAccounting } from "../../src/budget/model-request-accounting.js";
import { boundHostRequestCost } from "../../src/budget/request-cost-bound.js";
import { ensureBudgetWork, getBudgetWork, setBudgetWorkStatus } from "../../src/db/budget-limits.js";
import { readStoredProviderUsageAccountRef } from "../../src/agent-pool/provider-usage.js";

export const operationBudgetWorkId = (operationId: string) => `durable-operation:${operationId}`;
export function sidePromptSourceId(chatJid: string, retryId: string): string {
  const digest = createHash("sha256").update(JSON.stringify([chatJid, retryId])).digest("hex");
  return `side-prompt:${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

/** Reconcile only already-committed host terminals. Never clear uncertain holds. */
export function completeMaintenanceBudgetWork(database: Database, workId: string): void {
  database.transaction(() => {
    const work = getBudgetWork(workId, database);
    if (work?.status !== "active" || work.execution_kind !== "side_prompt" || work.parent_work_id !== null || database.query(`SELECT 1 FROM budget_request_reservations r JOIN budget_work w ON w.id=r.work_id
      WHERE w.parent_work_id=? AND r.state NOT IN ('settled','released') LIMIT 1`).get(workId)) return;
    setBudgetWorkStatus(workId, "completed", { boundary: "maintenance_settled" }, database);
  }).immediate();
}

export function reconcileOperationBudgetWork(database: Database, operationId?: string): void {
  const terminals = database.query("SELECT operation_id FROM service_effect_s02_commits WHERE (? IS NULL OR operation_id=?)").all(operationId ?? null, operationId ?? null) as { operation_id: string }[];
  database.transaction(() => {
    for (const terminal of terminals) {
      const id = operationBudgetWorkId(terminal.operation_id);
      if (getBudgetWork(id, database)?.status !== "active") continue;
      if (!database.query(`SELECT 1 FROM budget_request_reservations r JOIN budget_work w ON w.id=r.work_id
        WHERE w.parent_work_id=? AND r.state NOT IN ('settled','released') LIMIT 1`).get(id))
      {
        setBudgetWorkStatus(id, "completed", { boundary: "operation_settled" }, database);
        const work = getBudgetWork(id, database);
        const parent = work?.parent_work_id ? getBudgetWork(work.parent_work_id, database) : null;
        const source = database.query(`SELECT s.source_id FROM service_effect_s01_operations o
          JOIN service_effect_s01_sources s ON s.chat_jid=o.chat_jid AND s.source_seq=o.primary_source_seq
          WHERE o.operation_id=? AND s.kind='internal'`).get(terminal.operation_id) as { source_id: string } | null;
        if (parent?.status === "active" && parent.execution_kind === "side_prompt" && parent.chat_jid === work?.chat_jid &&
          source?.source_id === sidePromptSourceId(parent.chat_jid, parent.id) &&
          !database.query("SELECT 1 FROM budget_work WHERE parent_work_id=? AND id<>? LIMIT 1").get(parent.id, id))
          setBudgetWorkStatus(parent.id, "completed", { boundary: "side_prompt_settled" }, database);
      }
    }
  }).immediate();
}

/** Stored-identity, uncapped host model requests.
 * Unsupported requests remain on the existing uncapped path; caps still deny.
 * One fresh request ID per actual invocation, including a recovery resend. A
 * dispatched unknown outcome retains its old hold; it is never called free.
 */
export async function reserveHostRequest(options: {
  database: Database; operationId: string; chatJid: string; authPath: string;
  model: Model<Api>; maxTokens?: number; executionKind?: "interactive" | "delegate" | "scheduled" | "side_prompt"; scheduledTaskId?: string;
  maintenanceWorkId?: string; signal: AbortSignal; assertCurrent(): void;
}) {
  const { database, model, signal, assertCurrent } = options;
  assertCurrent(); signal.throwIfAborted();
  const accountRef = readStoredProviderUsageAccountRef(model.provider, options.authPath);
  if (!accountRef) return undefined;
  const amount = boundHostRequestCost(model, options.maxTokens ?? model.maxTokens);
  if (amount.amountMicros === null) return undefined;
  const operationWork = options.maintenanceWorkId ?? operationBudgetWorkId(options.operationId);
  const id = randomUUID();
  const workId = `durable-request:${id}`;
  const sidePrompt = database.query(`SELECT 1 FROM service_effect_s01_operations o
    JOIN service_effect_s01_sources s ON s.chat_jid=o.chat_jid AND s.source_seq=o.primary_source_seq
    WHERE o.operation_id=? AND o.chat_jid=? AND s.kind='internal' AND s.source_id LIKE 'side-prompt:%'`).get(options.operationId, options.chatJid);
  const existingSide = sidePrompt ? getBudgetWork(operationWork, database) : null;
  ensureBudgetWork({ id: operationWork, chatJid: options.chatJid, executionKind: options.maintenanceWorkId || sidePrompt ? "side_prompt" : options.scheduledTaskId ? "scheduled" : "interactive",
    parentWorkId: existingSide?.parent_work_id, scheduledTaskId: options.scheduledTaskId }, database);
  ensureBudgetWork({ id: workId, chatJid: options.chatJid, executionKind: options.executionKind === "delegate" ? "delegate" : sidePrompt ? "side_prompt" : options.executionKind ?? "interactive", parentWorkId: operationWork }, database);
  const current = () => {
    assertCurrent(); signal.throwIfAborted();
    if (readStoredProviderUsageAccountRef(model.provider, options.authPath) !== accountRef) throw Error("Native request account changed");
  };
  const accounting = modelRequestAccounting({ authorise: current, documentedFree: false, usageSource: options.maintenanceWorkId ? "compaction" : "assistant" }, database);
  const binding = { id, workId, chatJid: options.chatJid, providerId: model.provider, modelId: model.id, accountRef, amountMicros: amount.amountMicros };
  let dispatchStarted = false;
  let settled = false;
  let settlementHash: string | undefined;
  // A rejected reservation may have committed before an ACK/storage failure.
  // Keep work active; never retire authority needed to reconcile that hold.
  await accounting.reserve(binding, signal);
  return {
    async dispatch() {
      current();
      if (dispatchStarted) throw Error("Native request already dispatched");
      dispatchStarted = true;
      await accounting.dispatch(binding, signal);
      current();
    },
    async settle(message: AssistantMessage) {
      // Settlement uses original host evidence even after cancellation/revocation.
      const hash = JSON.stringify(message);
      if (settled) { if (hash !== settlementHash) throw Error("Native request terminal changed"); return; }
      const row = await accounting.settle(binding, message);
      if (row.state !== "settled") throw Error("Native request settlement unresolved");
      setBudgetWorkStatus(workId, "completed", { boundary: "request_settled" }, database);
      settled = true; settlementHash = hash;
    },
    async abandon() {
      if (settled) return;
      const row = await accounting.abandon(binding);
      if (row?.state === "released") setBudgetWorkStatus(workId, "stopped", { boundary: "request_not_sent" }, database);
      if (row?.state === "settled") setBudgetWorkStatus(workId, "completed", { boundary: "request_settled" }, database);
    },
  };
}
