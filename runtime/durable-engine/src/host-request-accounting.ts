import { randomUUID } from "node:crypto";
import type Database from "bun:sqlite";
import type { AssistantMessage, Api, Model } from "../../../node_modules/@earendil-works/pi-ai";
import { modelRequestAccounting } from "../../src/budget/model-request-accounting.js";
import { boundHostRequestCost } from "../../src/budget/request-cost-bound.js";
import { ensureBudgetWork, getBudgetWork, setBudgetWorkStatus } from "../../src/db/budget-limits.js";
import { readStoredProviderUsageAccountRef } from "../../src/agent-pool/provider-usage.js";

export const operationBudgetWorkId = (operationId: string) => `durable-operation:${operationId}`;

/** Reconcile only already-committed host terminals. Never clear uncertain holds. */
export function reconcileOperationBudgetWork(database: Database, operationId?: string): void {
  const terminals = database.query("SELECT operation_id FROM service_effect_s02_commits WHERE (? IS NULL OR operation_id=?)").all(operationId ?? null, operationId ?? null) as { operation_id: string }[];
  database.transaction(() => {
    for (const terminal of terminals) {
      const id = operationBudgetWorkId(terminal.operation_id);
      if (getBudgetWork(id, database)?.status !== "active") continue;
      if (!database.query(`SELECT 1 FROM budget_request_reservations r JOIN budget_work w ON w.id=r.work_id
        WHERE w.parent_work_id=? AND r.state NOT IN ('settled','released') LIMIT 1`).get(id))
        setBudgetWorkStatus(id, "completed", { boundary: "operation_settled" }, database);
    }
  }).immediate();
}

/** First consumer: stored-identity, uncapped interactive parent requests only.
 * Unsupported requests remain on the existing uncapped path; caps still deny.
 * One fresh request ID per actual invocation, including a recovery resend. A
 * dispatched unknown outcome retains its old hold; it is never called free.
 */
export async function reserveHostRequest(options: {
  database: Database; operationId: string; chatJid: string; authPath: string;
  model: Model<Api>; maxTokens?: number; signal: AbortSignal; assertCurrent(): void;
}) {
  const { database, model, signal, assertCurrent } = options;
  assertCurrent(); signal.throwIfAborted();
  const accountRef = readStoredProviderUsageAccountRef(model.provider, options.authPath);
  if (!accountRef) return undefined;
  const amount = boundHostRequestCost(model, options.maxTokens ?? model.maxTokens);
  if (amount.amountMicros === null) return undefined;
  const operationWork = operationBudgetWorkId(options.operationId);
  const id = randomUUID();
  const workId = `durable-request:${id}`;
  ensureBudgetWork({ id: operationWork, chatJid: options.chatJid, executionKind: "interactive" }, database);
  ensureBudgetWork({ id: workId, chatJid: options.chatJid, executionKind: "interactive", parentWorkId: operationWork }, database);
  const current = () => {
    assertCurrent(); signal.throwIfAborted();
    if (readStoredProviderUsageAccountRef(model.provider, options.authPath) !== accountRef) throw Error("Native request account changed");
  };
  const accounting = modelRequestAccounting({ authorise: current, documentedFree: false }, database);
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
