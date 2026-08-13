import {
  Result,
  type ExecutionEnv,
  type Result as ResultValue,
} from "@earendil-works/pi-agent-core";

import type {
  ExecutionContextError,
  ExecutionContextResolver,
  PiclawToolContext,
  ResolveExecutionContextRequest,
} from "../contracts/execution-context-resolver.js";
import type {
  ExecutionRouteSnapshot,
  ExecutionRouteSnapshotLookup,
  LocalExecutionEnvFactory,
  ServiceOperationSnapshot,
  ServiceOperationSnapshotLookup,
  SshExecutionEnvFactory,
  SshExecutionProfileSnapshot,
  SshExecutionProfileSnapshotLookup,
} from "./execution-context-types.js";

export class CurrentPiclawExecutionContextResolver implements ExecutionContextResolver {
  constructor(
    private readonly operations: ServiceOperationSnapshotLookup,
    private readonly routes: ExecutionRouteSnapshotLookup,
    private readonly profiles: SshExecutionProfileSnapshotLookup,
    private readonly localEnvironments: LocalExecutionEnvFactory,
    private readonly sshEnvironments: SshExecutionEnvFactory,
  ) {}

  async resolve(candidate: ResolveExecutionContextRequest): Promise<ResultValue<PiclawToolContext, ExecutionContextError>> {
    const request = normaliseRequest(candidate);
    if (!request) return Result.err(error("environment_unavailable", false));

    const operation = await this.lookupOperation(request);
    if (!operation.ok) return operation;
    if (!operation.value || operation.value.chatJid !== request.chatJid || operation.value.operationId !== request.operationId) {
      return Result.err(error("operation_not_found", false));
    }
    if (operation.value.version !== request.expectedOperationVersion) return Result.err(error("version_mismatch", false));

    if (request.requestedRoute === "local") {
      const local = await this.createLocal();
      return local.ok ? Result.ok(context(request, local.value, local.value)) : local;
    }

    const route = await this.lookupRoute(request.chatJid);
    if (!route.ok) return route;
    if (!route.value) return Result.err(error("route_unavailable", true));
    if (route.value.kind === "local") {
      const local = await this.createLocal();
      return local.ok ? Result.ok(context(request, local.value, local.value)) : local;
    }

    const profile = await this.lookupProfile(route.value.profileId);
    if (!profile.ok) return profile;
    if (!profile.value) return Result.err(error("invalid_ssh_profile", false));

    const local = await this.createLocal();
    if (!local.ok) return local;
    const remote = await this.createSsh(profile.value);
    if (!remote.ok) {
      await safeCleanup(local.value);
      return remote;
    }
    return Result.ok(context(request, remote.value, local.value));
  }

  private async lookupOperation(request: Readonly<ResolveExecutionContextRequest>): Promise<ResultValue<ServiceOperationSnapshot | null, ExecutionContextError>> {
    try {
      const value = await Promise.resolve(this.operations.getOperationSnapshot(request.chatJid, request.operationId));
      if (value === null) return Result.ok(null);
      const snapshot = normaliseOperation(value);
      return snapshot ? Result.ok(snapshot) : Result.err(error("environment_unavailable", false));
    } catch { return Result.err(error("environment_unavailable", true)); }
  }

  private async lookupRoute(chatJid: string): Promise<ResultValue<ExecutionRouteSnapshot | null, ExecutionContextError>> {
    try {
      const value = await Promise.resolve(this.routes.getCurrentRoute(chatJid));
      if (value === null) return Result.ok(null);
      const snapshot = normaliseRoute(value);
      return snapshot ? Result.ok(snapshot) : Result.err(error("route_unavailable", false));
    } catch { return Result.err(error("route_unavailable", true)); }
  }

  private async lookupProfile(profileId: string): Promise<ResultValue<SshExecutionProfileSnapshot | null, ExecutionContextError>> {
    try {
      const value = await Promise.resolve(this.profiles.getSshProfile(profileId));
      if (value === null) return Result.ok(null);
      const snapshot = normaliseProfile(value);
      return snapshot && snapshot.profileId === profileId ? Result.ok(snapshot) : Result.err(error("invalid_ssh_profile", false));
    } catch { return Result.err(error("invalid_ssh_profile", true)); }
  }

  private async createLocal(): Promise<ResultValue<ExecutionEnv, ExecutionContextError>> {
    try { return normaliseFactoryResult(await Promise.resolve(this.localEnvironments.createLocalEnv()), "environment_unavailable"); }
    catch { return Result.err(error("environment_unavailable", true)); }
  }

  private async createSsh(profile: SshExecutionProfileSnapshot): Promise<ResultValue<ExecutionEnv, ExecutionContextError>> {
    try { return normaliseFactoryResult(await Promise.resolve(this.sshEnvironments.createSshEnv(profile)), "environment_unavailable"); }
    catch { return Result.err(error("environment_unavailable", true)); }
  }
}

function normaliseRequest(value: unknown): Readonly<ResolveExecutionContextRequest> | null {
  try {
    if (!recordValue(value)) return null;
    const chatJid = stable(value, "chatJid"); const operationId = stable(value, "operationId");
    const expectedOperationVersion = stable(value, "expectedOperationVersion"); const requestedRoute = stable(value, "requestedRoute");
    if (!nonBlank(chatJid) || !nonBlank(operationId) || !Number.isSafeInteger(expectedOperationVersion) || (expectedOperationVersion as number) < 1 || (requestedRoute !== "current" && requestedRoute !== "local")) return null;
    return Object.freeze({ chatJid, operationId, expectedOperationVersion: expectedOperationVersion as number, requestedRoute });
  } catch { return null; }
}

function normaliseOperation(value: unknown): ServiceOperationSnapshot | null {
  try {
    if (!recordValue(value)) return null;
    const chatJid = stable(value, "chatJid"); const operationId = stable(value, "operationId"); const version = stable(value, "version");
    if (!nonBlank(chatJid) || !nonBlank(operationId) || !Number.isSafeInteger(version) || (version as number) < 1) return null;
    return Object.freeze({ chatJid, operationId, version: version as number });
  } catch { return null; }
}

function normaliseRoute(value: unknown): ExecutionRouteSnapshot | null {
  try {
    if (!recordValue(value)) return null;
    const kind = stable(value, "kind");
    if (kind === "local") return Object.freeze({ kind });
    const profileId = stable(value, "profileId");
    return kind === "ssh" && nonBlank(profileId) ? Object.freeze({ kind, profileId }) : null;
  } catch { return null; }
}

function normaliseProfile(value: unknown): SshExecutionProfileSnapshot | null {
  try {
    if (!recordValue(value)) return null;
    const profileId = stable(value, "profileId"); const transportRef = stable(value, "transportRef"); const cwd = stable(value, "cwd");
    if (!nonBlank(profileId) || !nonBlank(transportRef) || !nonBlank(cwd) || !cwd.startsWith("/")) return null;
    return Object.freeze({ profileId, transportRef, cwd });
  } catch { return null; }
}

function normaliseFactoryResult(value: unknown, tag: ExecutionContextError["_tag"]): ResultValue<ExecutionEnv, ExecutionContextError> {
  try {
    if (!recordValue(value)) return Result.err(error(tag, true));
    const ok = stable(value, "ok");
    if (ok === false) return Result.err(normaliseError(stable(value, "error"), tag));
    if (ok !== true) return Result.err(error(tag, true));
    const captured = captureExecutionEnv(stable(value, "value"));
    return captured ? Result.ok(captured) : Result.err(error(tag, true));
  } catch { return Result.err(error(tag, true)); }
}

function normaliseError(value: unknown, fallback: ExecutionContextError["_tag"]): ExecutionContextError {
  try {
    if (!recordValue(value)) return error(fallback, true);
    const tag = stable(value, "_tag"); const certainty = stable(value, "certainty"); const retryable = stable(value, "retryable");
    return TAGS.has(tag as ExecutionContextError["_tag"]) && certainty === "not_applied" && typeof retryable === "boolean"
      ? error(tag as ExecutionContextError["_tag"], retryable)
      : error(fallback, true);
  } catch { return error(fallback, true); }
}
function captureExecutionEnv(value: unknown): ExecutionEnv | null {
  try {
    if (!recordValue(value)) return null;
    const cwd = stable(value, "cwd"); if (!nonBlank(cwd) || !cwd.startsWith("/")) return null;
    const methods = Object.fromEntries(METHODS.map((name) => {
      const method = stable(value, name); if (typeof method !== "function") throw new TypeError("Invalid environment method.");
      return [name, method.bind(value)];
    })) as unknown as Omit<ExecutionEnv, "cwd">;
    return Object.freeze({ cwd, ...methods });
  } catch { return null; }
}
function context(request: Readonly<ResolveExecutionContextRequest>, env: ExecutionEnv, localEnv: ExecutionEnv): PiclawToolContext { return Object.freeze({ chatJid: request.chatJid, operationId: request.operationId, env, localEnv }); }
function recordValue(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
function stable(record: Record<string, unknown>, key: string): unknown { const value = record[key]; return record[key] === value ? value : UNSTABLE; }
function nonBlank(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }
async function safeCleanup(env: ExecutionEnv): Promise<void> { try { await env.cleanup(); } catch { /* best effort */ } }
function error(_tag: ExecutionContextError["_tag"], retryable: boolean): ExecutionContextError { return Object.freeze({ _tag, certainty: "not_applied", retryable }); }
const UNSTABLE = Symbol("unstable");
const TAGS = new Set<ExecutionContextError["_tag"]>(["operation_not_found", "version_mismatch", "route_unavailable", "invalid_ssh_profile", "credential_unavailable", "environment_unavailable"]);
const METHODS = ["absolutePath", "joinPath", "readTextFile", "readTextLines", "readBinaryFile", "writeFile", "appendFile", "renameFile", "fileInfo", "listDir", "canonicalPath", "exists", "createDir", "remove", "createTempDir", "createTempFile", "exec", "cleanup"] as const;
