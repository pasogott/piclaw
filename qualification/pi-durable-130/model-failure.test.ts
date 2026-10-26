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


test("private failure receipts retain original reasons without prompts, secrets or opaque signatures", async () => {
  const { retainModelFailureEvidence } = await import("../../runtime/durable-engine/src/host-model-failure-evidence.js");
  const {mkdtemp,readFile,stat,rm,mkdir}=await import("node:fs/promises");const {join}=await import("node:path");
  const directory=await mkdtemp(join(process.env.PICLAW_WORKSPACE!,"model-failure-evidence-"));
  try {
    const path=join(directory,"private");
    const id=retainModelFailureEvidence(path,{provider:"fixture",model:"fixture",requestId:"request-original",failure:{phase:"accounting",category:"unknown"},error:Error("Settlement unresolved"),providerError:{errorMessage:"server_error Authorization: Bearer token-should-be-redacted https://private.invalid/request signature:\"opaque-secret\"",content:[{type:"thinking",thinking:"private thought",signature:"opaque-secret"}]}});
    const text=await readFile(join(path,id+".json"),"utf8"),record=JSON.parse(text);
    expect(record.errors.providerError.errorMessage).toContain("server_error");
    for(const secret of ["token-should-be-redacted","private.invalid","opaque-secret","private thought"]) expect(text).not.toContain(secret);
    expect(record.requestId).toBe("request-original");expect(record.originalErrorSha256).toMatch(/^[a-f0-9]{64}$/);
    expect((await stat(path)).mode&0o777).toBe(0o700);expect((await stat(join(path,id+".json"))).mode&0o777).toBe(0o600);
    const failure={phase:"provider" as const,category:"transport" as const,evidenceId:id};
    expect(parseModelFailure(modelFailureDetail(failure))).toEqual(failure);expect(modelFailureNotice(modelFailureDetail(failure),27677)).toContain(id);
    const publicDir=join(directory,"public");await mkdir(publicDir,{mode:0o755});expect(()=>retainModelFailureEvidence(publicDir,{provider:"fixture",model:"fixture",failure:{phase:"provider",category:"unknown"},error:Error("no write")})).toThrow("not private");
  }finally{await rm(directory,{recursive:true,force:true});}
});


test("retained bounded failures preserve SDK transient retry and quota stop decisions", async () => {
  const {isRetryableAssistantError}=await import("../../runtime/durable-engine/node_modules/@earendil-works/pi-ai/dist/utils/retry.js");
  const evidenceId="b7e94df0-a012-40da-b950-29b1c1b0999b";
  for(const [reason,retry]of [["ECONNRESET",true],["HTTP 503 unavailable",true],["HTTP 504 timeout",true],["HTTP 401 unauthorized",false],["HTTP 429 insufficient_quota",false],["HTTP 429 subscription_sharing_usage_limit_exceeded",false],["unknown provider failure",false]] as const){
    const failure={...classifyModelFailure("provider",Error(reason)),evidenceId};
    const detail=modelFailureDetail(failure);expect(parseModelFailure(detail)).toEqual(failure);
    const message={stopReason:"error",errorMessage:detail} as Parameters<typeof isRetryableAssistantError>[0];
    expect(isRetryableAssistantError(message)).toBe(retry);
  }
  expect(classifyModelFailure("provider",Error("HTTP 429 insufficient_quota"))).toEqual({phase:"provider",category:"quota",httpStatus:429});
});
