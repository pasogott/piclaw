/** Deliberately excludes exception text, request bodies and queued content. */
export function queuedSteeringRejectionReason(error: unknown): string {
  const known = new Map([
    ['Accepted steering unavailable', 'intent_unsupported'],
    ['No active host operation', 'no_active_operation'],
    ['No running host binding', 'no_running_binding'],
    ['Host harness binding conflict', 'binding_conflict'],
    ['Accepted queue item unavailable', 'queue_item_unavailable'],
    ['Accepted queue identity conflict', 'queue_identity_conflict'],
    ['Payload validation must be synchronous', 'async_payload_validation'],
    ['Missing accepted source', 'source_missing'],
    ['Accepted steering materialization failed', 'materialization_failed'],
    ['Invalid durable operation request', 'invalid_operation_request'],
    ['Unknown durable operation binding', 'unknown_operation_binding'],
    ['Unknown or ambiguous durable conversation binding', 'conversation_binding_conflict'],
    ['Unknown recovered candidate authority', 'unknown_candidate_authority'],
  ]);
  const tags = ['idempotency_conflict', 'frontier_mismatch', 'version_mismatch', 'owner_conflict',
    'invalid_transition', 'not_found', 'corrupt_state', 'storage_unavailable'];
  if (error && typeof error === 'object') {
    const tag = Object.getOwnPropertyDescriptor(error, '_tag')?.value;
    if (typeof tag === 'string' && tags.includes(tag)) return tag;
  }
  if (error instanceof Error) return known.get(error.message) ?? 'unclassified';
  return 'unclassified';
}
