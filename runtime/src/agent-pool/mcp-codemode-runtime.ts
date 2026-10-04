import { createCodemodeExtension, type AgentSession, type AgentSessionRuntime, type ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { randomUUID } from "node:crypto";
import { commitMcpInstancePolicy, readMcpInstancePolicy } from "../core/config-mcp.js";
import { getMcpBridgeReadSnapshot } from "../secure/mcp-keychain.js";
import { planMcpEnginePolicy } from "./mcp-engine-plan.js";
import { parseMcpEnginePolicy, type McpEnginePolicy } from "./mcp-engine-policy.js";

const READINESS = Object.freeze({ adapter: true, native: false, codemode: true });
let selected: Readonly<McpEnginePolicy> | null = null;
let blocked = false;

export function selectedMcpPolicy(): Readonly<McpEnginePolicy> {
  return selected ??= readMcpInstancePolicy().policy;
}

export function assertSelectedMcpOwner(): void {
  if (blocked || selectedMcpPolicy().engine !== "adapter") {
    throw new Error("Selected MCP runtime is blocked or unavailable; explicit instance recovery is required.");
  }
}

function codemodeEnabled(): boolean {
  return !blocked && selectedMcpPolicy().engine === "adapter" && selectedMcpPolicy().codemode === "on";
}

type CodemodeSession = Pick<AgentSession, "getAllTools" | "getActiveToolNames" | "setActiveToolsByName">;

function syncMcpCodemodeSession(session: CodemodeSession, policy: Readonly<McpEnginePolicy>): void {
  if (!session.getAllTools().some(tool => tool.name === "codemode")) {
    throw new Error("Codemode extension did not load.");
  }
  const names = session.getActiveToolNames().filter(name => name !== "codemode");
  if (policy.codemode === "on") names.push("codemode");
  session.setActiveToolsByName(names);
}

/** Fence already-captured sessions too, not only pool admission/new creation. */
export function bindMcpCodemodePolicy(session: CodemodeSession & Pick<AgentSession, "prompt">): void {
  syncMcpCodemodeSession(session, selectedMcpPolicy());
  const prompt = session.prompt.bind(session);
  session.prompt = (...args) => {
    assertSelectedMcpOwner();
    return prompt(...args);
  };
}

/** Public built-in tool, with model execution disabled until its budget seam is qualified. */
export const mcpCodemodeExtension: ExtensionFactory = async pi => {
  await createCodemodeExtension({ models: false })(pi);
  const sync = () => {
    const names = pi.getActiveTools().filter(name => name !== "codemode");
    if (codemodeEnabled()) names.push("codemode");
    pi.setActiveTools(names);
  };
  pi.on("session_start", sync);
  pi.on("before_agent_start", sync);
  pi.on("tool_result", sync);
  pi.on("tool_call", event => {
    if (blocked) return { block: true, reason: "MCP instance settings are transitioning or blocked." };
    if (event.toolName === "codemode" && !codemodeEnabled()) {
      return { block: true, reason: "Codemode is disabled by the instance MCP policy." };
    }
  });
};

export const MCP_NATIVE_BLOCK_REASON = "Native Apply is blocked: transport shutdown acknowledgement and the Piclaw credential/exposure lifecycle are not qualified. Adapter remains the supported owner.";

/** Exact 1.0.1 public-contract probe gaps plus the separate close-failure probe. */
export const MCP_NATIVE_BLOCKERS = Object.freeze([
  "Transport shutdown failures can be suppressed; authoritative closure is not qualified.",
  "lazy: host-owned lazy connection lifecycle is not supported.",
  "statusObserver: host connection status observation is not supported.",
  "resourceFilter: host resource filtering is not supported.",
  "authStart: headless host-owned authentication initiation is not supported.",
  "appRenderer: host-owned MCP app rendering is not supported.",
  "absoluteDeadlineMs: Piclaw absolute operation deadlines are not supported.",
  "McpOAuthCredentialStore: the approved Piclaw credential contract is incompatible.",
  "socket: Unix socket transport configuration is not supported.",
  "listPrompts: public prompt listing is not supported.",
  "getPrompt: public prompt retrieval is not supported.",
]);

export class McpPolicyApplyError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

interface Revision {
  config: string;
  bridge: string;
  expires: number;
}

interface CodemodeHost {
  blockMcpAdmissions(): void;
  fenceMcpAndSnapshot(signal: AbortSignal): Promise<readonly AgentSessionRuntime[]>;
  resumeMcpAdmissions(): void;
  quarantineMcpRuntime(runtime: AgentSessionRuntime): Promise<void>;
}

/** Codemode-only changes do not replace or reload the existing MCP owner. */
export class McpCodemodeController {
  private phase: "ready" | "applying" | "blocked" = "ready";
  private readonly revisions = new Map<string, Revision>();

  constructor(private readonly manager: CodemodeHost, private readonly timeoutMs = 30_000) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new Error("Invalid MCP update deadline.");
  }

  inspect(policy?: unknown) {
    const persisted = readMcpInstancePolicy();
    const snapshot = getMcpBridgeReadSnapshot();
    const plan = planMcpEnginePolicy(policy ?? persisted.policy, snapshot, READINESS);
    if (plan.policy.engine === "native") {
      const issue = plan.issues.find(issue => issue.field === "engine");
      if (issue) issue.message = MCP_NATIVE_BLOCK_REASON;
    }
    const now = Date.now();
    for (const [key, value] of this.revisions) {
      if (value.expires <= now) this.revisions.delete(key);
    }
    while (this.revisions.size >= 128) this.revisions.delete(this.revisions.keys().next().value!);
    const revision = randomUUID();
    this.revisions.set(revision, { config: persisted.revision, bridge: snapshot.revision, expires: now + 300_000 });
    const { bridgeRevision: _private, ...publicPlan } = plan;
    const available = this.phase === "ready" && !blocked && selectedMcpPolicy().engine === "adapter";
    return {
      ok: true,
      persisted: { policy: persisted.policy },
      revision,
      runtime: {
        configuredFactory: "adapter",
        observedPolicy: blocked || selectedMcpPolicy().engine !== "adapter" ? null : { ...selectedMcpPolicy() },
        connectionStatus: "unknown",
        applyAvailable: available,
        phase: this.phase,
      },
      readiness: READINESS,
      servers: snapshot.dryRun.rows.map(row => ({ name: row.serverName, nativeProjectionStatus: row.status })),
      plan: publicPlan,
      applyAvailable: available && plan.applicable,
      effect: "abort_active_turns_and_update_codemode",
      nativeBlockReason: MCP_NATIVE_BLOCK_REASON,
      nativeBlockers: MCP_NATIVE_BLOCKERS,
    };
  }

  async apply(input: { policy: unknown; revision: string; acknowledgeInterruptions: boolean }, authorise: () => void) {
    authorise();
    const policy = parseMcpEnginePolicy(input.policy);
    if (input.acknowledgeInterruptions !== true) {
      throw new McpPolicyApplyError(400, "Confirm that active turns may be interrupted before applying.");
    }
    if (this.phase !== "ready" || blocked) throw new McpPolicyApplyError(409, "MCP settings are busy or blocked.");
    const token = this.revisions.get(input.revision);
    if (!token || token.expires <= Date.now()) {
      throw new McpPolicyApplyError(409, "MCP settings changed or expired; refresh and preview again.");
    }
    const snapshot = getMcpBridgeReadSnapshot();
    const current = readMcpInstancePolicy();
    if (token.config !== current.revision || token.bridge !== snapshot.revision) {
      throw new McpPolicyApplyError(409, "MCP settings changed; refresh and preview again.");
    }
    const plan = planMcpEnginePolicy(policy, snapshot, READINESS);
    if (!plan.applicable) {
      throw new McpPolicyApplyError(422, policy.engine === "native" ? MCP_NATIVE_BLOCK_REASON : "MCP configuration is incompatible with this policy; preview the rejection reasons.");
    }
    if (selectedMcpPolicy().engine !== "adapter") {
      throw new McpPolicyApplyError(422, "Engine replacement is unavailable until authoritative shutdown is qualified.");
    }
    if (policy.codemode === selectedMcpPolicy().codemode && current.policy.codemode === policy.codemode) return this.inspect();
    this.phase = "applying";
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        abort.abort();
        reject(new Error("MCP policy update timed out."));
      }, this.timeoutMs);
    });
    const bounded = <T>(promise: Promise<T>) => Promise.race([promise, deadline]);
    let fenced = false, committed = false;
    let sessions: readonly AgentSessionRuntime[] = [];
    try {
      authorise();
      fenced = true;
      blocked = true;
      this.manager.blockMcpAdmissions();
      const pending = this.manager.fenceMcpAndSnapshot(abort.signal);
      // A timed-out snapshot may still deliver captured runtimes later.
      void pending.then(late => {
        if (abort.signal.aborted) {
          for (const runtime of late) void this.manager.quarantineMcpRuntime(runtime).catch(() => undefined);
        }
      }, () => undefined);
      sessions = [...new Set(await bounded(pending))];
      await bounded(Promise.all(sessions.map(runtime => runtime.session.abort())));
      authorise();
      if (abort.signal.aborted) throw new Error("MCP policy update cancelled.");
      if (getMcpBridgeReadSnapshot().revision !== token.bridge) throw new Error("MCP configuration changed during update.");
      if (sessions.some(runtime => !runtime.session.getAllTools().some(tool => tool.name === "codemode"))) {
        throw new Error("Codemode tool is missing from an existing session.");
      }
      commitMcpInstancePolicy(policy, token.config);
      committed = true;
      selected = policy;
      for (const runtime of sessions) syncMcpCodemodeSession(runtime.session, policy);
      this.manager.resumeMcpAdmissions();
      blocked = false;
      this.phase = "ready";
      this.revisions.clear();
      return this.inspect();
    } catch {
      abort.abort();
      if (fenced) {
        blocked = true;
        this.phase = "blocked";
        this.manager.blockMcpAdmissions();
        for (const runtime of sessions) void this.manager.quarantineMcpRuntime(runtime).catch(() => undefined);
      } else {
        this.phase = "ready";
      }
      const message = committed
        ? "Policy saved, but session activation failed. New operations remain blocked; restart or repair the instance."
        : fenced ? "MCP update failed; new operations remain blocked. No automatic fallback was selected."
        : "MCP update rejected before mutation; refresh and retry with current owner authority.";
      throw new McpPolicyApplyError(committed ? 503 : 409, message);
    } finally {
      clearTimeout(timer!);
    }
  }
}

export function resetMcpCodemodeRuntimeForTests(): void {
  selected = null;
  blocked = false;
}
