import type { EffectClock } from "../contracts/common.js";
import type { DeliveryBoundary, DeliveryBoundaryAttempt, DeliveryBoundarySuccess, DeliveryDriverError, WebPushDeliveryCounts } from "../contracts/delivery-driver.js";

export interface TimelineBroadcastCallback { (eventType: string, data: unknown): void; }
export interface ChannelSendCallback { (jid: string, text: string): Promise<void>; }
export interface StoredWebPushSendResult { attempted: number; sent: number; removed: number; failed: number; }
export interface WebPushCallback { (payload: unknown): Promise<StoredWebPushSendResult>; }
export interface WakeCallback { (chatJid: string): void | Promise<void>; }
export type TypedDeliveryErrorClassifier = (error: unknown) => DeliveryDriverError | null;

export function createTimelineBroadcastBoundary(clock: EffectClock, broadcastEvent: TimelineBroadcastCallback, eventType: string, data: (input: DeliveryBoundaryAttempt) => unknown): DeliveryBoundary {
  return { async attempt(input) { const result = broadcastEvent(eventType, data(input)) as unknown; if (result !== undefined) throw new Error("timeline broadcast must be synchronous"); return success(clock, { kind: "timeline_broadcast", providerMessageId: null, eventId: input.request.deliveryIdentity }); } };
}

export function createChannelDeliveryBoundary(clock: EffectClock, sendMessage: ChannelSendCallback): DeliveryBoundary {
  return { async attempt(input) { await sendMessage(requireDestination(input), decode(input)); return success(clock, { kind: "channel_delivery", providerMessageId: null }); } };
}

export function createWebPushBoundary(clock: EffectClock, send: WebPushCallback, payload: (input: DeliveryBoundaryAttempt) => unknown): DeliveryBoundary {
  return { async attempt(input) { const counts = await send(payload(input)); return success(clock, { kind: "web_push", providerMessageId: null, counts: freezeCounts(counts) }); } };
}

export function createPushoverBoundary(clock: EffectClock, sendMessage: ChannelSendCallback, classifyError?: TypedDeliveryErrorClassifier): DeliveryBoundary {
  return { async attempt(input) { await sendMessage(requireDestination(input), decode(input)); return success(clock, { kind: "pushover", providerMessageId: null }); }, ...(classifyError ? { classifyError } : {}) };
}

export function createWakeBoundary(clock: EffectClock, wake: WakeCallback): DeliveryBoundary {
  return { async attempt(input) { await wake(requireDestination(input)); return success(clock, { kind: "wake_chat", providerMessageId: null, wakeId: input.request.deliveryIdentity }); } };
}

function success(clock: EffectClock, detail: DeliveryBoundarySuccess["detail"]): DeliveryBoundarySuccess {
  return Object.freeze({ acceptedAt: clock.now().toISOString(), receiptRef: null, detail: Object.freeze(detail) });
}
function decode(input: DeliveryBoundaryAttempt): string { return new TextDecoder().decode(input.payload.bytes); }
function requireDestination(input: DeliveryBoundaryAttempt): string { return input.request.destinationRef!; }
function freezeCounts(value: StoredWebPushSendResult): WebPushDeliveryCounts { return Object.freeze({ attempted: value.attempted, sent: value.sent, removed: value.removed, failed: value.failed }); }
