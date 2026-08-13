import "../helpers.js";
import { describe, expect, test } from "bun:test";
import type { ProjectionAuthority, ProjectionOwner, PublicAgentProjection } from "../../src/service-effects/contracts/agent-projection-sink.js";
import type { DeliveryBoundaryAttempt } from "../../src/service-effects/contracts/delivery-driver.js";
import { CurrentPiclawAgentProjectionSink } from "../../src/service-effects/current-piclaw/agent-projection-sink.js";
import { ManualEffectClock, SequenceEffectIdSource } from "../../src/service-effects/testing/deterministic-controls.js";
import { DeterministicFaultPlan } from "../../src/service-effects/testing/fault-plan.js";
import { TestingCurrentPiclawAdapterRuntime } from "../../src/service-effects/testing/current-piclaw-adapter-runtime.js";
import { createChannelDeliveryBoundary, createPushoverBoundary, createTimelineBroadcastBoundary, createWakeBoundary, createWebPushBoundary } from "../../src/service-effects/current-piclaw/delivery-boundaries.js";

const clock = new ManualEffectClock("2026-08-12T00:00:00.000Z");
const input = (): DeliveryBoundaryAttempt => ({ request: { outboxId: "o", idempotencyKey: "k", payloadRef: "p", destinationRef: "web:chat", deliveryIdentity: "identity-1", attempt: 1, signal: new AbortController().signal }, payload: { ref: "p", sha256: "a".repeat(64), byteLength: 5, mediaType: "text/plain", redactionClass: "private", bytes: new TextEncoder().encode("hello") } });

describe("current Piclaw delivery boundary factories", () => {
  test("timeline forwards exact synchronous broadcastEvent shape", async () => {
    const calls: unknown[] = []; const boundary = createTimelineBroadcastBoundary(clock, (eventType, data) => { calls.push([eventType, data]); }, "agent_projection", ({ request }) => ({ chat_jid: request.destinationRef }));
    const result = await boundary.attempt(input()); expect(calls).toEqual([["agent_projection", { chat_jid: "web:chat" }]]); expect(result.detail).toEqual({ kind: "timeline_broadcast", providerMessageId: null, eventId: "identity-1" });
  });
  test("channel and wake forward current callback arguments", async () => {
    const sent: unknown[] = []; await createChannelDeliveryBoundary(clock, async (...args) => { sent.push(args); }).attempt(input()); expect(sent).toEqual([["web:chat", "hello"]]);
    const wakes: string[] = []; const wake = await createWakeBoundary(clock, (jid) => { wakes.push(jid); }).attempt(input()); expect(wakes).toEqual(["web:chat"]); expect(wake.detail).toEqual({ kind: "wake_chat", providerMessageId: null, wakeId: "identity-1" });
  });
  test("Web Push preserves StoredWebPushSendResult counts", async () => {
    const result = await createWebPushBoundary(clock, async () => ({ attempted: 3, sent: 1, removed: 1, failed: 1 }), () => ({ title: "public" })).attempt(input());
    expect(result.detail).toEqual({ kind: "web_push", providerMessageId: null, counts: { attempted: 3, sent: 1, removed: 1, failed: 1 } });
  });
  test("Pushover forwards its current sendMessage arguments without inventing receipts", async () => {
    const sent: unknown[] = []; const result = await createPushoverBoundary(clock, async (...args) => { sent.push(args); }).attempt(input());
    expect(sent).toEqual([["web:chat", "hello"]]); expect(result.detail).toEqual({ kind: "pushover", providerMessageId: null });
  });
  test("projection adapter accepts current synchronous broadcastEvent shape and sends a frozen DTO", async () => {
    const owner: ProjectionOwner = { chatJid: "web:chat", operationId: "operation-1", harnessOperationId: "harness-1" };
    const calls: unknown[] = []; const authority: ProjectionAuthority = { isCurrentOwner: () => true, isCommittedTerminalRef: () => false };
    const runtime = new TestingCurrentPiclawAdapterRuntime({ clock, ids: new SequenceEffectIdSource("boundary"), faults: new DeterministicFaultPlan() });
    const sink = new CurrentPiclawAgentProjectionSink(authority, { publish(value) { const broadcastEvent: (eventType: string, data: unknown) => void = (eventType, data) => { calls.push([eventType, data, Object.isFrozen(data), Object.isFrozen((data as { activeToolNames: unknown }).activeToolNames)]); }; return broadcastEvent(value.type, value); } }, runtime);
    const dto: PublicAgentProjection = { ...owner, watchGeneration: 1, receiptSeq: 1, type: "agent_snapshot", phase: "running", modelLabel: "model", activeToolNames: [], cancellationRequested: false };
    expect((await sink.publishSnapshot(dto)).ok).toBe(true); expect(calls).toEqual([["agent_snapshot", expect.any(Object), true, true]]);
  });
});
