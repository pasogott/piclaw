import { randomUUID } from "node:crypto";
import type Database from "bun:sqlite";
import type { AssistantMessage, Api, Model } from "../../../node_modules/@earendil-works/pi-ai";
import { modelRequestAccounting } from "../../src/budget/model-request-accounting.js";
import { boundHostRequestCost } from "../../src/budget/request-cost-bound.js";
import { ensureBudgetWork, setBudgetWorkStatus } from "../../src/db/budget-limits.js";
import { readStoredProviderUsageAccountRef } from "../../src/agent-pool/provider-usage.js";

export const operationBudgetWorkId = (operationId: string) => `durable-operation:${operationId}`;

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
  try { await accounting.reserve(binding, signal); }
  catch (error) { setBudgetWorkStatus(workId, "stopped", { boundary: "reserve_denied" }, database); throw error; }
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
      settled = true; settlementHash = hash;
      setBudgetWorkStatus(workId, "completed", { boundary: "request_settled" }, database);
    },
    async abandon() {
      if (settled) return;
      const row = await accounting.abandon(binding);
      if (row?.state === "released") setBudgetWorkStatus(workId, "stopped", { boundary: "request_not_sent" }, database);
    },
  };
}
