import type { WebChannelLike } from "../core/web-channel-contracts.js";
import { canPrincipalAct, type AuthenticatedPrincipal } from "../auth/principal.js";
import { readAccessConfig } from "../../../core/config-access.js";
import { parseMcpEnginePolicy } from "../../../agent-pool/mcp-engine-policy.js";
import { McpPolicyApplyError } from "../../../agent-pool/mcp-codemode-runtime.js";
import { createLogger, debugSuppressedError } from "../../../utils/logger.js";

const log = createLogger("web.mcp-settings");
const BASE = "/agent/settings/mcp";
const MAX_BODY_BYTES = 2048;

class RequestFailure extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
function reply(body: object, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "private, no-store", Vary: "Cookie" } });
}
function owner(channel: WebChannelLike, req: Request): AuthenticatedPrincipal {
  const principal = channel.authGateway.getPrincipal?.(req, true);
  if (!principal || principal.mode !== "single-user" || !canPrincipalAct(principal, "instance.configure") || readAccessConfig().mode !== "single-user") {
    throw new RequestFailure(403, "MCP instance settings are owner-only.");
  }
  return principal;
}
function ownerKey(principal: AuthenticatedPrincipal): string {
  return JSON.stringify([principal.kind, principal.userId, principal.role, principal.mode, principal.authentication]);
}
type ApplyInput = { policy: ReturnType<typeof parseMcpEnginePolicy>; revision: string; acknowledgeInterruptions: boolean };
async function readPolicy(req: Request, apply: true): Promise<ApplyInput>;
async function readPolicy(req: Request, apply: false): Promise<ReturnType<typeof parseMcpEnginePolicy>>;
async function readPolicy(req: Request, apply: boolean): Promise<ApplyInput | ReturnType<typeof parseMcpEnginePolicy>> {
  if (!req.body) throw new RequestFailure(400, "A JSON policy body is required.");
  const reader = req.body.getReader();
  const bytes = new Uint8Array(MAX_BODY_BYTES); let used = 0;
  let reject!: (error: RequestFailure) => void;
  const interrupted = new Promise<never>((_resolve, fail) => { reject = fail; });
  const abort = () => reject(new RequestFailure(400, "MCP preview request cancelled."));
  const timer = setTimeout(() => reject(new RequestFailure(408, "MCP preview body timed out.")), 5000);
  req.signal.addEventListener("abort", abort, { once: true });
  if (req.signal.aborted) abort();
  try {
    for (;;) {
      const chunk = await Promise.race([reader.read().catch(() => { throw new RequestFailure(400, "Could not read MCP preview body."); }), interrupted]);
      if (chunk.done) break;
      if (used + chunk.value.length > bytes.length) throw new RequestFailure(413, "MCP preview body exceeds 2 KiB.");
      bytes.set(chunk.value, used); used += chunk.value.length;
    }
    try {
      const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, used)));
      if (!apply) return parseMcpEnginePolicy(value);
      if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !["policy", "revision", "acknowledgeInterruptions"].includes(key))
        || typeof value.revision !== "string" || value.revision.length > 128 || value.acknowledgeInterruptions !== true) throw new Error("Invalid apply body.");
      return { policy: parseMcpEnginePolicy(value.policy), revision: value.revision, acknowledgeInterruptions: true };
    }
    catch { throw new RequestFailure(400, "Expected only engine (adapter/native) and codemode (auto/on/off)."); }
  } finally {
    clearTimeout(timer); req.signal.removeEventListener("abort", abort);
    void reader.cancel().catch(error => debugSuppressedError(log, "MCP preview reader cancellation failed.", error));
    try { reader.releaseLock(); } catch (error) { debugSuppressedError(log, "MCP preview reader release deferred.", error); }
  }
}

/** Owner-only preview and revision-fenced codemode application. */
export async function handleMcpSettings(channel: WebChannelLike, req: Request, url: URL): Promise<Response> {
  try {
    const identity = ownerKey(owner(channel, req));
    const check = () => {
      if (ownerKey(owner(channel, req)) !== identity) throw new RequestFailure(403, "MCP instance settings are owner-only.");
      if (req.signal.aborted) throw new RequestFailure(400, "MCP preview request cancelled.");
    };
    // The initial owner resolution already authenticated this synchronous
    // boundary. Re-resolve only after body I/O and before publishing.
    if (req.signal.aborted) throw new RequestFailure(400, "MCP preview request cancelled.");
    if (url.search) throw new RequestFailure(400, "MCP instance settings do not accept query parameters.");
    const preview = req.method === "POST" && url.pathname === `${BASE}/preview`;
    const apply = req.method === "POST" && url.pathname === `${BASE}/apply`;
    if (!preview && !apply && !(req.method === "GET" && url.pathname === BASE)) throw new RequestFailure(405, "Method not allowed.");
    const policy = apply ? await readPolicy(req, true) : preview ? await readPolicy(req, false) : undefined;
    check();
    const payload = apply ? await channel.agentPool.applyMcpSettings(policy as ApplyInput, check) : channel.agentPool.inspectMcpSettings(policy);
    check();
    return reply(payload);
  } catch (error) {
    if (error instanceof RequestFailure) return reply({ ok: false, error: error.message }, error.status);
    if (error instanceof McpPolicyApplyError) return reply({ ok: false, error: error.message }, error.status);
    return reply({ ok: false, error: "MCP settings are unavailable; check instance configuration." }, 503);
  }
}
