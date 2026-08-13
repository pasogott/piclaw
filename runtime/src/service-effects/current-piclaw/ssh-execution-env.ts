import {
  Result,
  type ExecutionEnv,
  type Result as ResultValue,
} from "@earendil-works/pi-agent-core";

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
    try {
      const connected = await Promise.resolve(this.connect(snapshot));
      if (!recordValue(connected) || typeof connected.ok !== "boolean") return Result.err(error("environment_unavailable", true));
      if (!connected.ok) return validError(connected.error) ? Result.err(connected.error) : Result.err(error("environment_unavailable", true));
      if (!isExecutionEnv(connected.value)) {
        await cleanupUnknown(connected.value);
        return Result.err(error("environment_unavailable", true));
      }
      if (connected.value.cwd !== snapshot.cwd) {
        await cleanupUnknown(connected.value);
        return Result.err(error("invalid_ssh_profile", false));
      }
      return Result.ok(new PiclawExecutionEnv(connected.value, this.prepareShellEnvironment));
    } catch { return Result.err(error("environment_unavailable", true)); }
  }
}

function normaliseProfile(value: unknown): SshExecutionProfileSnapshot | null {
  try {
    if (!recordValue(value)) return null;
    const profileId = stable(value, "profileId"); const transportRef = stable(value, "transportRef"); const cwd = stable(value, "cwd");
    if (!nonBlank(profileId) || !nonBlank(transportRef) || !nonBlank(cwd) || !cwd.startsWith("/")) return null;
    return Object.freeze({ profileId, transportRef, cwd });
  } catch { return null; }
}
function validError(value: unknown): value is ExecutionContextError {
  try { return Boolean(recordValue(value) && TAGS.has(value._tag as ExecutionContextError["_tag"]) && value.certainty === "not_applied" && typeof value.retryable === "boolean"); }
  catch { return false; }
}
function isExecutionEnv(value: unknown): value is ExecutionEnv {
  try { return Boolean(recordValue(value) && nonBlank(value.cwd) && METHODS.every((name) => typeof value[name] === "function")); }
  catch { return false; }
}
async function cleanupUnknown(value: unknown): Promise<void> {
  try { if (recordValue(value) && typeof value.cleanup === "function") await (value.cleanup as () => Promise<void>)(); }
  catch { /* best effort */ }
}
function recordValue(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
function stable(record: Record<string, unknown>, key: string): unknown { const value = record[key]; return record[key] === value ? value : UNSTABLE; }
function nonBlank(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }
function error(_tag: ExecutionContextError["_tag"], retryable: boolean): ExecutionContextError { return Object.freeze({ _tag, certainty: "not_applied", retryable }); }
const UNSTABLE = Symbol("unstable");
const TAGS = new Set<ExecutionContextError["_tag"]>(["operation_not_found", "version_mismatch", "route_unavailable", "invalid_ssh_profile", "credential_unavailable", "environment_unavailable"]);
const METHODS = ["absolutePath", "joinPath", "readTextFile", "readTextLines", "readBinaryFile", "writeFile", "appendFile", "renameFile", "fileInfo", "listDir", "canonicalPath", "exists", "createDir", "remove", "createTempDir", "createTempFile", "exec", "cleanup"] as const;
