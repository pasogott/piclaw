import { Result, type ExecutionEnv, type Result as ResultValue } from "@earendil-works/pi-agent-core";

import type { ExecutionContextError } from "../contracts/execution-context-resolver.js";
import { PiclawExecutionEnv, type ShellEnvironmentPreparer } from "./execution-env-adapter.js";
import type { SshExecutionEnvFactory, SshExecutionProfileSnapshot } from "./execution-context-types.js";

export type CapturedSshExecutionEnvFactory = (
  profile: SshExecutionProfileSnapshot,
) => Promise<ResultValue<ExecutionEnv, ExecutionContextError>> | ResultValue<ExecutionEnv, ExecutionContextError>;

/** Constructs one full remote Earendil environment from a non-secret profile snapshot. */
export class CurrentPiclawSshExecutionEnvFactory implements SshExecutionEnvFactory {
  constructor(
    private readonly connect: CapturedSshExecutionEnvFactory,
    private readonly prepareShellEnvironment: ShellEnvironmentPreparer,
  ) {}

  async createSshEnv(profile: SshExecutionProfileSnapshot): Promise<ResultValue<ExecutionEnv, ExecutionContextError>> {
    const snapshot = normaliseProfile(profile);
    if (!snapshot) return Result.err(error("invalid_ssh_profile", false));
    let connected: unknown;
    try { connected = await Promise.resolve(this.connect(snapshot)); }
    catch { return Result.err(error("environment_unavailable", true)); }
    const result = normaliseConnectionResult(connected);
    if (!result.ok) return result;
    try {
      const captured = new PiclawExecutionEnv(result.value, this.prepareShellEnvironment);
      if (captured.cwd !== snapshot.cwd) {
        await cleanupUnknown(result.value);
        return Result.err(error("invalid_ssh_profile", false));
      }
      return Result.ok(captured);
    } catch {
      await cleanupUnknown(result.value);
      return Result.err(error("environment_unavailable", true));
    }
  }
}

function normaliseConnectionResult(value: unknown): ResultValue<ExecutionEnv, ExecutionContextError> {
  try {
    if (!record(value)) return Result.err(error("environment_unavailable", true));
    const ok = stable(value, "ok");
    if (ok === false) return Result.err(normaliseError(stable(value, "error")));
    if (ok !== true) return Result.err(error("environment_unavailable", true));
    const environment = stable(value, "value");
    return record(environment) ? Result.ok(environment as unknown as ExecutionEnv) : Result.err(error("environment_unavailable", true));
  } catch { return Result.err(error("environment_unavailable", true)); }
}
function normaliseError(value: unknown): ExecutionContextError {
  try {
    if (!record(value)) return error("environment_unavailable", true);
    const tag = stable(value, "_tag"); const certainty = stable(value, "certainty"); const retryable = stable(value, "retryable");
    return TAGS.has(tag as ExecutionContextError["_tag"]) && certainty === "not_applied" && typeof retryable === "boolean"
      ? error(tag as ExecutionContextError["_tag"], retryable)
      : error("environment_unavailable", true);
  } catch { return error("environment_unavailable", true); }
}
function normaliseProfile(value: unknown): SshExecutionProfileSnapshot | null {
  try {
    if (!record(value)) return null;
    const profileId = stable(value, "profileId"); const transportRef = stable(value, "transportRef"); const cwd = stable(value, "cwd");
    if (!nonBlank(profileId) || !nonBlank(transportRef) || !nonBlank(cwd) || !cwd.startsWith("/")) return null;
    return Object.freeze({ profileId, transportRef, cwd });
  } catch { return null; }
}
async function cleanupUnknown(value: unknown): Promise<void> {
  try {
    if (!record(value)) return;
    const cleanup = stable(value, "cleanup");
    if (typeof cleanup === "function") await cleanup.call(value);
  } catch { /* best effort */ }
}
function record(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
function stable(value: Record<string, unknown>, key: string): unknown { const first = value[key]; return value[key] === first ? first : CHANGED; }
function nonBlank(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }
function error(_tag: ExecutionContextError["_tag"], retryable: boolean): ExecutionContextError { return Object.freeze({ _tag, certainty: "not_applied", retryable }); }
const CHANGED = Symbol("changed");
const TAGS = new Set<ExecutionContextError["_tag"]>(["operation_not_found", "version_mismatch", "route_unavailable", "invalid_ssh_profile", "credential_unavailable", "environment_unavailable"]);
