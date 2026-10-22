import "./src/test-guard.js";
import { expect, test } from "bun:test";
import { classifyModelFailure, modelFailureDetail, modelFailureNotice, parseModelFailure } from "../../runtime/durable-engine/src/host-model-failure.js";

const secret = "SYNTHETIC-PRIVATE-CREDENTIAL";
for (const [message, category, status] of [
  ["HTTP 504 timeout", "timeout", 504], ["HTTP 401 unauthorized", "authentication", 401],
  ["HTTP 429 too many requests", "rate_limit", 429], ["context_length_exceeded", "context_limit", undefined],
  ["ECONNRESET", "transport", undefined], ["HTTP 503 unavailable", "unavailable", 503],
  ["unrecognised failure", "unknown", undefined],
] as const) test(`private ${category} errors produce only bounded diagnostics`, () => {
  const failure = classifyModelFailure("provider", new Error(`${message} Authorization: Bearer ${secret} https://private.invalid/request`));
  expect(failure).toEqual({ phase: "provider", category, ...(status === undefined ? {} : { httpStatus: status }) });
  const detail = modelFailureDetail(failure);
  expect(parseModelFailure(detail)).toEqual(failure);
  expect(detail).not.toContain(secret);
  expect(detail).not.toContain("private.invalid");
  expect(modelFailureNotice(detail, 2935)).not.toContain(secret);
});

test("aborted terminals and structured HTTP status survive without exporting raw reasons", () => {
  expect(classifyModelFailure("provider", { stopReason: "aborted", errorMessage: secret })).toEqual({ phase: "provider", category: "aborted" });
  expect(classifyModelFailure("admission", { status: 403, message: secret })).toEqual({ phase: "admission", category: "authentication", httpStatus: 403 });
  expect(classifyModelFailure("provider", { status: secret, message: secret })).toEqual({ phase: "provider", category: "unknown" });
  expect(classifyModelFailure("provider", { get message() { throw Error(secret); } })).toEqual({ phase: "provider", category: "unknown" });
});

test("arbitrary, legacy and forged diagnostics cannot enter the timeline", () => {
  for (const detail of [undefined, secret, `Host model request failed [phase=provider; category=${secret}]`,
    "Host model request failed [phase=provider; category=timeout; http=999]", { message: secret }]) {
    expect(parseModelFailure(detail)).toBeUndefined();
    const notice = modelFailureNotice(detail, 2935);
    expect(notice).toContain("underlying reason was not recorded");
    expect(notice).not.toContain(secret);
    expect(notice).toContain("Tool actions may already have completed");
    expect(notice).toContain("will not be retried automatically");
    expect(notice).toContain("Reference: native submission 2935.");
  }
});

test("timeout, conversion and accounting notices explain different failure stages", () => {
  expect(modelFailureNotice(modelFailureDetail({ phase: "provider", category: "timeout" }), 1)).toContain("model request timed out");
  expect(modelFailureNotice(modelFailureDetail({ phase: "conversion", category: "unknown" }), 1)).toContain("response could not be processed safely");
  expect(modelFailureNotice(modelFailureDetail({ phase: "accounting", category: "unknown" }), 1)).toContain("outcome may be uncertain");
});
