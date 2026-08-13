import "../helpers.js";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PushoverChannel } from "../../src/channels/pushover.js";
import type { WebChannelLike } from "../../src/channels/web/core/web-channel-contracts.js";
import { WebNotificationPresenceService } from "../../src/channels/web/push/web-notification-presence-service.js";
import { sendStoredWebPushNotification, type WebPushNotificationPayload } from "../../src/channels/web/push/web-push-service.js";
import { upsertStoredWebPushSubscription } from "../../src/channels/web/push/web-push-store.js";
import { broadcastEvent, type SseClientContainer } from "../../src/channels/web/sse/sse.js";
import type { ProjectionAuthority, ProjectionOwner, PublicAgentProjection } from "../../src/service-effects/contracts/agent-projection-sink.js";
import type { DeliveryBoundaryAttempt, DeliveryDriverError } from "../../src/service-effects/contracts/delivery-driver.js";
import { CurrentPiclawAgentProjectionSink } from "../../src/service-effects/current-piclaw/agent-projection-sink.js";
import { createChannelDeliveryBoundary, createPushoverBoundary, createTimelineBroadcastBoundary, createWakeBoundary, createWebPushBoundary, type ChannelSendCallback, type WakeCallback } from "../../src/service-effects/current-piclaw/delivery-boundaries.js";
import { CurrentPiclawDeliveryDriver } from "../../src/service-effects/current-piclaw/delivery-driver.js";
import { TestingCurrentPiclawAdapterRuntime } from "../../src/service-effects/testing/current-piclaw-adapter-runtime.js";
import { ManualEffectClock, SequenceEffectIdSource } from "../../src/service-effects/testing/deterministic-controls.js";
import { DeterministicFaultPlan } from "../../src/service-effects/testing/fault-plan.js";
import { InMemoryEffectPayloadResolver } from "../../src/service-effects/testing/in-memory-payload-resolver.js";

const clock = new ManualEffectClock("2026-08-12T00:00:00.000Z");
const tempDirs: string[] = [];
afterEach(() => { while (tempDirs.length) rmSync(tempDirs.pop()!, { recursive: true, force: true }); });
const input = (bytes = new TextEncoder().encode("hello")): DeliveryBoundaryAttempt => ({ request: { outboxId: "o", idempotencyKey: "k", payloadRef: "p", destinationRef: "web:chat", deliveryIdentity: "identity-1", attempt: 1, signal: new AbortController().signal }, payload: { ref: "p", sha256: "a".repeat(64), byteLength: bytes.byteLength, mediaType: "text/plain", redactionClass: "private", bytes } });

describe("current Piclaw delivery boundary factories", () => {
  test("real SSE broadcastEvent synchronously preserves event, data, and chat scope", async () => {
    const webFrames: Uint8Array[] = []; const otherFrames: Uint8Array[] = [];
    const container: SseClientContainer = { clients: new Set([
      { chatJid: "web:chat", heartbeat: setInterval(() => {}, 60_000), controller: { enqueue(value: Uint8Array) { webFrames.push(value); } } as ReadableStreamDefaultController<Uint8Array> },
      { chatJid: "web:other", heartbeat: setInterval(() => {}, 60_000), controller: { enqueue(value: Uint8Array) { otherFrames.push(value); } } as ReadableStreamDefaultController<Uint8Array> },
    ]) };
    try {
      const callback = ((eventType, data) => broadcastEvent(container, eventType, data)) satisfies (eventType: string, data: unknown) => void;
      const boundary = createTimelineBroadcastBoundary(clock, callback, "agent_status", ({ request }) => ({ chat_jid: request.destinationRef, value: "ready" }));
      expect((await boundary.attempt(input())).detail).toEqual({ kind: "timeline_broadcast", providerMessageId: null, eventId: "identity-1" });
      expect(new TextDecoder().decode(webFrames[0])).toBe('event: agent_status\ndata: {"chat_jid":"web:chat","value":"ready"}\n\n'); expect(otherFrames).toEqual([]);
    } finally { for (const client of container.clients) clearInterval(client.heartbeat); }
  });

  test("channel and wake callbacks satisfy current signatures and forward arguments", async () => {
    const sent: unknown[] = []; const channelMethod: Pick<WebChannelLike, "sendMessage">["sendMessage"] = async (...args) => { sent.push(args); };
    const send = channelMethod satisfies ChannelSendCallback; await createChannelDeliveryBoundary(clock, send).attempt(input()); expect(sent).toEqual([["web:chat", "hello"]]);
    const wakes: string[] = []; const currentResume: (chatJid: string, threadRootId?: number | null) => void = (jid) => { wakes.push(jid); };
    const wake = currentResume satisfies WakeCallback; const result = await createWakeBoundary(clock, wake).attempt(input()); expect(wakes).toEqual(["web:chat"]); expect(result.detail).toEqual({ kind: "wake_chat", providerMessageId: null, wakeId: "identity-1" });
  });

  test("real stored Web Push service preserves partial aggregate counts without network", async () => {
    const baseDir = mkdtempSync(join(tmpdir(), "piclaw-delivery-boundary-")); tempDirs.push(baseDir);
    for (const id of [1, 2, 3]) upsertStoredWebPushSubscription({ endpoint: `https://push.example.test/${id}`, expirationTime: null, keys: { auth: `auth-${id}`, p256dh: `key-${id}` } }, { baseDir, deviceId: `device-${id}` });
    const presence = new WebNotificationPresenceService(); const send = ((payload: WebPushNotificationPayload) => sendStoredWebPushNotification(payload, { baseDir, presenceService: presence, sendNotification: async (subscription) => { if (subscription.endpoint.endsWith("/1")) throw { statusCode: 410 }; if (subscription.endpoint.endsWith("/2")) throw new Error("temporary"); } })) satisfies (payload: WebPushNotificationPayload) => Promise<import("../../src/channels/web/push/web-push-service.js").StoredWebPushSendResult>;
    const result = await createWebPushBoundary(clock, send, () => ({ title: "Public", body: "Body" })).attempt(input());
    expect(result.detail).toEqual({ kind: "web_push", providerMessageId: null, counts: { attempted: 3, sent: 1, removed: 1, failed: 1 } });
  });

  test("real PushoverChannel truncates to 1024 with stub fetch and returns no receipt", async () => {
    const previousFetch = globalThis.fetch; const bodies: Record<string, string>[] = [];
    globalThis.fetch = (async (_url, init) => { bodies.push(JSON.parse(String(init?.body))); return new Response("ok", { status: 200 }); }) as typeof fetch;
    try {
      const channel = new PushoverChannel({ appToken: "app", userKey: "user" }); const text = "x".repeat(1100); const bytes = new TextEncoder().encode(text);
      const result = await createPushoverBoundary(clock, channel.sendMessage.bind(channel)).attempt(input(bytes));
      expect(bodies[0]?.message).toHaveLength(1024); expect(bodies[0]?.message.endsWith("...")).toBe(true); expect(result.detail).toEqual({ kind: "pushover", providerMessageId: null });
    } finally { globalThis.fetch = previousFetch; }
  });

  test("Pushover HTTP/generic throws stay unknown unless a typed classifier proves rejection", async () => {
    const classified: DeliveryDriverError = { _tag: "rejected", certainty: "not_applied", retryable: false };
    const generic = createPushoverBoundary(clock, async () => { throw new Error("transport"); }); expect(generic.classifyError?.(new Error("transport"))).toBeNull();
    const typed = createPushoverBoundary(clock, async () => { throw new Error("HTTP 400"); }, () => classified); expect(typed.classifyError?.(new Error("HTTP 400"))).toEqual(classified);
  });

  test("payload mappers and fatal UTF-8 failures classify pre-effect invalid_payload", async () => {
    let calls = 0; const text = createChannelDeliveryBoundary(clock, async () => { calls += 1; }); const invalidBytes = new Uint8Array([0xc3, 0x28]);
    await expect(text.attempt(input(invalidBytes))).rejects.toThrow(); expect(text.classifyError?.(await captureError(() => text.attempt(input(invalidBytes))))?._tag).toBe("invalid_payload"); expect(calls).toBe(0);
    const push = createWebPushBoundary(clock, async () => { calls += 1; return { attempted: 0, sent: 0, removed: 0, failed: 0 }; }, () => { throw new Error("mapper"); });
    expect(push.classifyError?.(await captureError(() => push.attempt(input())))?._tag).toBe("invalid_payload"); expect(calls).toBe(0);
  });

  test("projection adapter accepts current synchronous broadcastEvent shape and sends a frozen DTO", async () => {
    const owner: ProjectionOwner = { chatJid: "web:chat", operationId: "operation-1", harnessOperationId: "harness-1" }; const calls: unknown[] = [];
    const authority: ProjectionAuthority = { isCurrentOwner: () => true, isCommittedTerminalRef: () => false }; const runtime = new TestingCurrentPiclawAdapterRuntime({ clock, ids: new SequenceEffectIdSource("boundary"), faults: new DeterministicFaultPlan() });
    const sink = new CurrentPiclawAgentProjectionSink(authority, { publish(value) { const callback: (eventType: string, data: unknown) => void = (eventType, data) => { calls.push([eventType, data, Object.isFrozen(data), Object.isFrozen((data as { activeToolNames: unknown }).activeToolNames)]); }; return callback(value.type, value); } }, runtime);
    const dto: PublicAgentProjection = { ...owner, watchGeneration: 1, receiptSeq: 1, type: "agent_snapshot", phase: "running", modelLabel: "model", activeToolNames: [], cancellationRequested: false };
    expect((await sink.publishSnapshot(dto)).ok).toBe(true); expect(calls).toEqual([["agent_snapshot", expect.any(Object), true, true]]);
  });

  test("driver maps fatal decode before callback to bounded invalid_payload", async () => {
    const payloads = new InMemoryEffectPayloadResolver(); payloads.putBytes("p", new Uint8Array([0xc3, 0x28]), "text/plain");
    const boundary = createChannelDeliveryBoundary(clock, async () => { throw new Error("must not run"); }); const runtime = new TestingCurrentPiclawAdapterRuntime({ clock, ids: new SequenceEffectIdSource("boundary"), faults: new DeterministicFaultPlan() });
    const driver = new CurrentPiclawDeliveryDriver("channel_delivery", payloads, () => true, boundary, runtime); const result = await driver.deliver(input().request); expect(result.ok).toBe(false); if (!result.ok) expect(result.error).toEqual({ _tag: "invalid_payload", certainty: "not_applied", retryable: false });
  });
});

async function captureError(run: () => Promise<unknown>): Promise<unknown> { try { await run(); return null; } catch (error) { return error; } }
