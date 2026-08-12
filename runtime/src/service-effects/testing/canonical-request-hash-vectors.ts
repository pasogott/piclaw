import type { CanonicalJsonValue } from "../contracts/common.js";

export interface CanonicalRequestHashVector {
  readonly name: string;
  readonly requests: readonly CanonicalJsonValue[];
  readonly canonical: string;
  readonly sha256: string;
}

/** Fixed vectors intended for independent fake and adapter implementations. */
export const CANONICAL_REQUEST_HASH_VECTORS: readonly CanonicalRequestHashVector[] = Object.freeze([
  {
    name: "equal objects ignore insertion order",
    requests: [{ b: 2, a: 1 }, { a: 1, b: 2 }],
    canonical: '{"a":1,"b":2}',
    sha256: "43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777",
  },
  {
    name: "nested null and boolean values",
    requests: [{ nested: { z: null, a: true }, kind: "draft" }],
    canonical: '{"kind":"draft","nested":{"a":true,"z":null}}',
    sha256: "c35a7f1027982b1a5f7352c588c616cf963ce989ca12a553bf6f7b8f36b4694e",
  },
  {
    name: "Unicode remains UTF-8 JSON",
    requests: [{ items: ["α", "雪", null, 3] }],
    canonical: '{"items":["α","雪",null,3]}',
    sha256: "c7f7888213d90278c98e347fb565ad97f223a1e6cb1d8285d5232e18c6a85f1e",
  },
  {
    name: "array order is significant ascending",
    requests: [{ items: [1, 2] }],
    canonical: '{"items":[1,2]}',
    sha256: "02d21651bf4a0c676159456cd47d09d4ac585db5ed1324ac191f3e98640846a3",
  },
  {
    name: "array order is significant descending",
    requests: [{ items: [2, 1] }],
    canonical: '{"items":[2,1]}',
    sha256: "999e7876bd6caa905b1c5fd6e9a875224c9523c3f71d792d62de83fb5201ade1",
  },
  {
    name: "attempt lease and tracing metadata are omitted recursively",
    requests: [
      {
        payloadRef: "sha256:abc",
        attempt: 7,
        leaseToken: "lease-secret",
        traceId: "trace-secret",
        tracing: { spanId: "span-secret" },
        effect: {
          idempotencyKey: "k",
          requestHash: "self-reference",
          attemptNumber: 9,
          telemetry: { secret: "not-hashed" },
        },
      },
      { effect: { idempotencyKey: "k" }, payloadRef: "sha256:abc" },
    ],
    canonical: '{"effect":{"idempotencyKey":"k"},"payloadRef":"sha256:abc"}',
    sha256: "4b9f7dd78fd2cc4a6d1b086e732e9290c4ce022cf82e59914e5f72de080b64e6",
  },
]);
