import type { StoredWebPushSendResult, WebPushNotificationPayload } from "../../channels/web/push/web-push-service.js";
import type { EffectClock } from "../contracts/common.js";
import type { DeliveryBoundary, DeliveryBoundaryAttempt, DeliveryBoundarySuccess, DeliveryDriverError, WebPushDeliveryCounts } from "../contracts/delivery-driver.js";

export interface TimelineBroadcastCallback { (eventType: string, data: unknown): void; }
export interface TimelineDeliveryEnvelope { readonly chat_jid: string; readonly delivery_id: string; readonly [key: string]: unknown; }
export interface ChannelSendCallback { (jid: string, text: string): Promise<void>; }
export interface WebPushCallback { (payload: WebPushNotificationPayload): Promise<StoredWebPushSendResult>; }
export interface WakeCallback { (chatJid: string, threadRootId?: number | null): void | Promise<void>; }
export type TypedDeliveryErrorClassifier = (error: unknown) => DeliveryDriverError | null;

export function createTimelineBroadcastBoundary(clock: EffectClock, broadcastEvent: TimelineBroadcastCallback, eventType: string, data: (input: DeliveryBoundaryAttempt) => TimelineDeliveryEnvelope): DeliveryBoundary {
  return { async attempt(input) { const envelope = mapTimelineEnvelope(data, input); const result = broadcastEvent(eventType, envelope) as unknown; if (result !== undefined) throw new Error("timeline broadcast must be synchronous"); return success(clock, { kind: "timeline_broadcast", providerMessageId: null, eventId: input.request.deliveryIdentity }); }, classifyError: classifyPayloadMappingError };
}

export function createChannelDeliveryBoundary(clock: EffectClock, sendMessage: ChannelSendCallback): DeliveryBoundary {
  return textBoundary(clock, "channel_delivery", sendMessage);
}

export function createWebPushBoundary(clock: EffectClock, send: WebPushCallback, payload: (input: DeliveryBoundaryAttempt) => WebPushNotificationPayload): DeliveryBoundary {
  return { async attempt(input) { const mapped = mapPayload(payload, input); const counts = await send(mapped); return success(clock, { kind: "web_push", providerMessageId: null, counts: freezeCounts(counts) }); }, classifyError: classifyPayloadMappingError };
}

export function createPushoverBoundary(clock: EffectClock, sendMessage: ChannelSendCallback, classifyError?: TypedDeliveryErrorClassifier): DeliveryBoundary {
  const boundary = textBoundary(clock, "pushover", sendMessage);
  return { ...boundary, classifyError(error) { return classifyPayloadMappingError(error) ?? classifyError?.(error) ?? null; } };
}

export function createWakeBoundary(clock: EffectClock, wake: WakeCallback): DeliveryBoundary {
  return { async attempt(input) { await wake(requireDestination(input)); return success(clock, { kind: "wake_chat", providerMessageId: null, wakeId: input.request.deliveryIdentity }); } };
}

function success(clock: EffectClock, detail: DeliveryBoundarySuccess["detail"]): DeliveryBoundarySuccess {
  return Object.freeze({ acceptedAt: clock.now().toISOString(), receiptRef: null, detail: Object.freeze(detail) });
}
function textBoundary(clock: EffectClock, kind: "channel_delivery" | "pushover", sendMessage: ChannelSendCallback): DeliveryBoundary {
  return { async attempt(input) { const text = decode(input); await sendMessage(requireDestination(input), text); return success(clock, { kind, providerMessageId: null }); }, classifyError: classifyPayloadMappingError };
}
class InvalidBoundaryPayloadError extends Error {}
function decode(input: DeliveryBoundaryAttempt): string { try { return new TextDecoder("utf-8", { fatal: true }).decode(input.payload.bytes); } catch { throw new InvalidBoundaryPayloadError("delivery payload is not valid UTF-8"); } }
function mapTimelineEnvelope(mapper: (input: DeliveryBoundaryAttempt) => TimelineDeliveryEnvelope, input: DeliveryBoundaryAttempt): TimelineDeliveryEnvelope {
  try {
    const value = mapper(input); if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid timeline envelope");
    const candidate = value as Record<string, unknown>; const entries = Object.entries(candidate); const chatJid = candidate.chat_jid; const deliveryId = candidate.delivery_id;
    if (candidate.chat_jid !== chatJid || candidate.delivery_id !== deliveryId || chatJid !== input.request.destinationRef || deliveryId !== input.request.deliveryIdentity) throw new Error("invalid timeline envelope");
    const snapshot = Object.fromEntries(entries); if (snapshot.chat_jid !== chatJid || snapshot.delivery_id !== deliveryId) throw new Error("changing timeline envelope");
    return Object.freeze(snapshot) as TimelineDeliveryEnvelope;
  } catch (error) { if (error instanceof InvalidBoundaryPayloadError) throw error; throw new InvalidBoundaryPayloadError("timeline envelope mapper failed"); }
}
function mapPayload(mapper: (input: DeliveryBoundaryAttempt) => WebPushNotificationPayload, input: DeliveryBoundaryAttempt): WebPushNotificationPayload {
  try {
    const value = mapper(input); if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid mapped payload");
    const title = value.title; const body = value.body; const url = value.url; const tag = value.tag; const sourceLabel = value.sourceLabel;
    if (value.title !== title || value.body !== body || value.url !== url || value.tag !== tag || value.sourceLabel !== sourceLabel || typeof title !== "string" || typeof body !== "string" || !optionalString(url) || !optionalString(tag) || !optionalString(sourceLabel)) throw new Error("invalid mapped payload");
    return Object.freeze({ title, body, ...(url === undefined ? {} : { url }), ...(tag === undefined ? {} : { tag }), ...(sourceLabel === undefined ? {} : { sourceLabel }) });
  } catch (error) { if (error instanceof InvalidBoundaryPayloadError) throw error; throw new InvalidBoundaryPayloadError("delivery payload mapper failed"); }
}
function optionalString(value: unknown): boolean { return value === undefined || typeof value === "string"; }
function classifyPayloadMappingError(error: unknown): DeliveryDriverError | null { return error instanceof InvalidBoundaryPayloadError ? Object.freeze({ _tag: "invalid_payload", certainty: "not_applied", retryable: false }) : null; }
function requireDestination(input: DeliveryBoundaryAttempt): string { return input.request.destinationRef!; }
function freezeCounts(value: StoredWebPushSendResult): WebPushDeliveryCounts { return Object.freeze({ attempted: value.attempted, sent: value.sent, removed: value.removed, failed: value.failed }); }
