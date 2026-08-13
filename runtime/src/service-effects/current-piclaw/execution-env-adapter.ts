import { homedir } from "node:os";
import { join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ExecutionError,
  FileError,
  Result,
  type ExecutionEnv,
  type ExecutionErrorCode,
  type FileErrorCode,
  type FileInfo,
  type Result as ResultValue,
  type ShellExecOptions,
} from "@earendil-works/pi-agent-core";

export type ShellEnvironmentPreparer = (
  command: string,
  options: Readonly<ShellExecOptions>,
) => Promise<Record<string, string>> | Record<string, string>;

type FileNormaliser<T> = (value: unknown) => T | null;
type ExecValue = { stdout: string; stderr: string; exitCode: number };

/** Defensive Earendil boundary around one captured environment instance. */
export class PiclawExecutionEnv implements ExecutionEnv {
  readonly cwd: string;
  readonly #absolutePath: ExecutionEnv["absolutePath"];
  readonly #joinPath: ExecutionEnv["joinPath"];
  readonly #readTextFile: ExecutionEnv["readTextFile"];
  readonly #readTextLines: ExecutionEnv["readTextLines"];
  readonly #readBinaryFile: ExecutionEnv["readBinaryFile"];
  readonly #writeFile: ExecutionEnv["writeFile"];
  readonly #appendFile: ExecutionEnv["appendFile"];
  readonly #renameFile: ExecutionEnv["renameFile"];
  readonly #fileInfo: ExecutionEnv["fileInfo"];
  readonly #listDir: ExecutionEnv["listDir"];
  readonly #canonicalPath: ExecutionEnv["canonicalPath"];
  readonly #exists: ExecutionEnv["exists"];
  readonly #createDir: ExecutionEnv["createDir"];
  readonly #remove: ExecutionEnv["remove"];
  readonly #createTempDir: ExecutionEnv["createTempDir"];
  readonly #createTempFile: ExecutionEnv["createTempFile"];
  readonly #exec: ExecutionEnv["exec"];
  readonly #cleanup: ExecutionEnv["cleanup"];
  readonly #prepareShellEnvironment: ShellEnvironmentPreparer;
  #cleanupPromise: Promise<void> | null = null;

  constructor(delegate: ExecutionEnv, prepareShellEnvironment: ShellEnvironmentPreparer) {
    this.cwd = requireStableCwd(delegate);
    this.#absolutePath = captureMethod(delegate, "absolutePath");
    this.#joinPath = captureMethod(delegate, "joinPath");
    this.#readTextFile = captureMethod(delegate, "readTextFile");
    this.#readTextLines = captureMethod(delegate, "readTextLines");
    this.#readBinaryFile = captureMethod(delegate, "readBinaryFile");
    this.#writeFile = captureMethod(delegate, "writeFile");
    this.#appendFile = captureMethod(delegate, "appendFile");
    this.#renameFile = captureMethod(delegate, "renameFile");
    this.#fileInfo = captureMethod(delegate, "fileInfo");
    this.#listDir = captureMethod(delegate, "listDir");
    this.#canonicalPath = captureMethod(delegate, "canonicalPath");
    this.#exists = captureMethod(delegate, "exists");
    this.#createDir = captureMethod(delegate, "createDir");
    this.#remove = captureMethod(delegate, "remove");
    this.#createTempDir = captureMethod(delegate, "createTempDir");
    this.#createTempFile = captureMethod(delegate, "createTempFile");
    this.#exec = captureMethod(delegate, "exec");
    this.#cleanup = captureMethod(delegate, "cleanup");
    if (typeof prepareShellEnvironment !== "function") throw new TypeError("Invalid shell environment preparer.");
    this.#prepareShellEnvironment = prepareShellEnvironment;
    Object.freeze(this);
  }

  async absolutePath(path: string, abortSignal?: AbortSignal) { return this.file(path, abortSignal, stringValue, () => this.#absolutePath(path, abortSignal)); }
  async joinPath(parts: string[], abortSignal?: AbortSignal) {
    return this.file(undefined, abortSignal, stringValue, () => {
      const snapshot = snapshotStringArray(parts);
      if (!snapshot) throw new TypeError("Invalid path parts.");
      return this.#joinPath(snapshot, abortSignal);
    });
  }
  async readTextFile(path: string, abortSignal?: AbortSignal) { return this.file(path, abortSignal, stringValue, () => this.#readTextFile(path, abortSignal)); }
  async readTextLines(path: string, options?: { maxLines?: number; abortSignal?: AbortSignal }) {
    try { const snapshot = snapshotReadOptions(options); return this.file(path, snapshot?.abortSignal, stringArrayValue, () => this.#readTextLines(path, snapshot)); }
    catch { return fileFailure("unknown", "Invalid filesystem options.", this.addressedPath(path)); }
  }
  async readBinaryFile(path: string, abortSignal?: AbortSignal) { return this.file(path, abortSignal, binaryValue, () => this.#readBinaryFile(path, abortSignal)); }
  async writeFile(path: string, content: string | Uint8Array, abortSignal?: AbortSignal) {
    return this.file(path, abortSignal, voidValue, () => this.#writeFile(path, snapshotContent(content), abortSignal));
  }
  async appendFile(path: string, content: string | Uint8Array, abortSignal?: AbortSignal) {
    return this.file(path, abortSignal, voidValue, () => this.#appendFile(path, snapshotContent(content), abortSignal));
  }
  async renameFile(sourcePath: string, destinationPath: string, abortSignal?: AbortSignal) { return this.file(sourcePath, abortSignal, voidValue, () => this.#renameFile(sourcePath, destinationPath, abortSignal)); }
  async fileInfo(path: string, abortSignal?: AbortSignal) { return this.file(path, abortSignal, (value) => fileInfoValue(value, this.cwd), () => this.#fileInfo(path, abortSignal)); }
  async listDir(path: string, abortSignal?: AbortSignal) { return this.file(path, abortSignal, (value) => fileInfoArrayValue(value, this.cwd), () => this.#listDir(path, abortSignal)); }
  async canonicalPath(path: string, abortSignal?: AbortSignal) { return this.file(path, abortSignal, stringValue, () => this.#canonicalPath(path, abortSignal)); }
  async exists(path: string, abortSignal?: AbortSignal) { return this.file(path, abortSignal, booleanValue, () => this.#exists(path, abortSignal)); }
  async createDir(path: string, options?: { recursive?: boolean; abortSignal?: AbortSignal }) {
    try { const snapshot = snapshotCreateOptions(options); return this.file(path, snapshot?.abortSignal, voidValue, () => this.#createDir(path, snapshot)); }
    catch { return fileFailure("unknown", "Invalid filesystem options.", this.addressedPath(path)); }
  }
  async remove(path: string, options?: { recursive?: boolean; force?: boolean; abortSignal?: AbortSignal }) {
    try { const snapshot = snapshotRemoveOptions(options); return this.file(path, snapshot?.abortSignal, voidValue, () => this.#remove(path, snapshot)); }
    catch { return fileFailure("unknown", "Invalid filesystem options.", this.addressedPath(path)); }
  }
  async createTempDir(prefix?: string, abortSignal?: AbortSignal) { return this.file(undefined, abortSignal, stringValue, () => this.#createTempDir(prefix, abortSignal)); }
  async createTempFile(options?: { prefix?: string; suffix?: string; abortSignal?: AbortSignal }) {
    try { const snapshot = snapshotTempOptions(options); return this.file(undefined, snapshot?.abortSignal, stringValue, () => this.#createTempFile(snapshot)); }
    catch { return fileFailure("unknown", "Invalid filesystem options."); }
  }

  async exec(command: string, options: ShellExecOptions = {}): Promise<ResultValue<ExecValue, ExecutionError>> {
    let snapshot: ShellExecOptions;
    try {
      snapshot = snapshotShellOptions(options);
      const aborted = readAborted(snapshot.abortSignal);
      if (aborted === null) return executionFailure("unknown", "Invalid abort signal.");
      if (aborted) return executionFailure("aborted", "aborted");
    } catch (error) { return error instanceof InvalidTimeoutError ? executionFailure("timeout", "Invalid timeout.") : executionFailure("unknown", "Invalid shell execution options."); }

    let prepared: unknown;
    try { prepared = await Promise.resolve(this.#prepareShellEnvironment(command, snapshot)); }
    catch { return executionFailure("unknown", "Shell environment preparation failed."); }
    const env = normaliseEnvironment(prepared);
    if (!env) return executionFailure("unknown", "Shell environment preparation returned an invalid environment.");
    const aborted = readAborted(snapshot.abortSignal);
    if (aborted === null) return executionFailure("unknown", "Invalid abort signal.");
    if (aborted) return executionFailure("aborted", "aborted");

    let callbackFault = false;
    const guardedStdout = guardCallback(snapshot.onStdout, () => { callbackFault = true; });
    const guardedStderr = guardCallback(snapshot.onStderr, () => { callbackFault = true; });
    try {
      const result = await this.#exec(command, { ...snapshot, env, inheritEnv: false, onStdout: guardedStdout, onStderr: guardedStderr });
      if (callbackFault) return executionFailure("callback_error", "Shell output callback failed.");
      return normaliseExecutionResult(result);
    } catch {
      return callbackFault
        ? executionFailure("callback_error", "Shell output callback failed.")
        : executionFailure("unknown", "Execution environment failed.");
    }
  }

  cleanup(): Promise<void> {
    if (!this.#cleanupPromise) this.#cleanupPromise = (async () => { try { await this.#cleanup(); } catch (error) { void error; /* cleanup is best effort by contract */ } })();
    return this.#cleanupPromise;
  }

  private async file<T>(path: string | undefined, signal: AbortSignal | undefined, normalise: FileNormaliser<T>, effect: () => Promise<unknown>): Promise<ResultValue<T, FileError>> {
    const addressed = this.addressedPath(path);
    const aborted = readAborted(signal);
    if (aborted === null) return fileFailure("unknown", "Invalid abort signal.", addressed);
    if (aborted) return fileFailure("aborted", "aborted", addressed);
    try { return normaliseFileResult(await effect(), addressed, normalise); }
    catch { return fileFailure("unknown", "Filesystem environment failed.", addressed); }
  }

  private addressedPath(path: string | undefined): string | undefined {
    try { return typeof path === "string" ? resolveSelectedPath(this.cwd, path) : undefined; } catch { return undefined; }
  }
}

function captureMethod<K extends keyof ExecutionEnv>(receiver: ExecutionEnv, key: K): ExecutionEnv[K] {
  const first = receiver[key]; const second = receiver[key];
  if (first !== second || typeof first !== "function") throw new TypeError(`Invalid ExecutionEnv method: ${key}`);
  return first.bind(receiver) as ExecutionEnv[K];
}
function requireStableCwd(value: ExecutionEnv): string {
  const cwd = value.cwd;
  if (value.cwd !== cwd || typeof cwd !== "string" || cwd.trim().length === 0 || !cwd.startsWith("/")) throw new TypeError("Invalid ExecutionEnv cwd.");
  return resolveSelectedPath("/", cwd);
}
function normaliseFileResult<T>(candidate: unknown, fallbackPath: string | undefined, normalise: FileNormaliser<T>): ResultValue<T, FileError> {
  try {
    if (!record(candidate)) return fileFailure("unknown", "Filesystem environment returned a malformed result.", fallbackPath);
    const ok = stable(candidate, "ok");
    if (ok === true) {
      const value = stable(candidate, "value"); const snapshot = normalise(value);
      return snapshot === null ? fileFailure("unknown", "Filesystem environment returned a malformed result.", fallbackPath) : Result.ok(snapshot);
    }
    if (ok !== false) return fileFailure("unknown", "Filesystem environment returned a malformed result.", fallbackPath);
    return normaliseFileError(stable(candidate, "error"), fallbackPath);
  } catch { return fileFailure("unknown", "Filesystem environment returned a malformed result.", fallbackPath); }
}
function normaliseFileError(value: unknown, fallbackPath: string | undefined): ResultValue<never, FileError> {
  try {
    if (!(value instanceof FileError)) return fileFailure("unknown", "Filesystem environment returned a malformed error.", fallbackPath);
    const code = stableObject(value, "code"); const message = stableObject(value, "message"); const path = stableObject(value, "path");
    if (!FILE_CODES.has(code as FileErrorCode) || typeof message !== "string" || (path !== undefined && typeof path !== "string")) return fileFailure("unknown", "Filesystem environment returned a malformed error.", fallbackPath);
    return fileFailure(code as FileErrorCode, `Filesystem operation failed (${code as string}).`, normaliseErrorPath(path as string | undefined, fallbackPath));
  } catch { return fileFailure("unknown", "Filesystem environment returned a malformed error.", fallbackPath); }
}
function normaliseExecutionResult(candidate: unknown): ResultValue<ExecValue, ExecutionError> {
  try {
    if (!record(candidate)) return executionFailure("unknown", "Execution environment returned a malformed result.");
    const ok = stable(candidate, "ok");
    if (ok === true) {
      const value = stable(candidate, "value"); if (!record(value)) return executionFailure("unknown", "Execution environment returned a malformed result.");
      const stdout = stable(value, "stdout"); const stderr = stable(value, "stderr"); const exitCode = stable(value, "exitCode");
      return typeof stdout === "string" && typeof stderr === "string" && Number.isSafeInteger(exitCode)
        ? Result.ok(Object.freeze({ stdout, stderr, exitCode: exitCode as number }))
        : executionFailure("unknown", "Execution environment returned a malformed result.");
    }
    if (ok !== false) return executionFailure("unknown", "Execution environment returned a malformed result.");
    const value = stable(candidate, "error");
    if (!(value instanceof ExecutionError)) return executionFailure("unknown", "Execution environment returned a malformed error.");
    const code = stableObject(value, "code"); const message = stableObject(value, "message");
    return EXECUTION_CODES.has(code as ExecutionErrorCode) && typeof message === "string"
      ? executionFailure(code as ExecutionErrorCode, `Execution failed (${code as string}).`)
      : executionFailure("unknown", "Execution environment returned a malformed error.");
  } catch { return executionFailure("unknown", "Execution environment returned a malformed result."); }
}
function snapshotShellOptions(value: unknown): ShellExecOptions {
  if (!record(value)) throw new TypeError("Invalid shell options.");
  const cwd = stable(value, "cwd"); const timeout = stable(value, "timeout"); const signal = stable(value, "abortSignal");
  const stdout = stable(value, "onStdout"); const stderr = stable(value, "onStderr"); const environment = stable(value, "env"); const inherit = stable(value, "inheritEnv");
  if (cwd !== undefined && typeof cwd !== "string") throw new TypeError("Invalid cwd.");
  if (timeout !== undefined && (typeof timeout !== "number" || !Number.isFinite(timeout) || timeout <= 0 || timeout > MAX_TIMEOUT_SECONDS)) throw new InvalidTimeoutError();
  if (signal !== undefined && !record(signal)) throw new TypeError("Invalid abort signal.");
  if (stdout !== undefined && typeof stdout !== "function" || stderr !== undefined && typeof stderr !== "function") throw new TypeError("Invalid callback.");
  if (inherit !== undefined && typeof inherit !== "boolean") throw new TypeError("Invalid inheritance option.");
  const env = environment === undefined ? {} : normaliseEnvironment(environment); if (!env) throw new TypeError("Invalid environment.");
  return Object.freeze({ ...(cwd === undefined ? {} : { cwd }), ...(timeout === undefined ? {} : { timeout }), ...(signal === undefined ? {} : { abortSignal: signal as unknown as AbortSignal }), ...(stdout === undefined ? {} : { onStdout: stdout as (chunk: string) => void }), ...(stderr === undefined ? {} : { onStderr: stderr as (chunk: string) => void }), env: Object.freeze(env), inheritEnv: inherit as boolean | undefined });
}
function snapshotReadOptions(value: unknown): { maxLines?: number; abortSignal?: AbortSignal } | undefined {
  if (value === undefined) return undefined; if (!record(value)) throw new TypeError("Invalid read options.");
  const maxLines = stable(value, "maxLines"); const signal = stable(value, "abortSignal");
  if (maxLines !== undefined && (!Number.isSafeInteger(maxLines) || (maxLines as number) < 0) || signal !== undefined && !record(signal)) throw new TypeError("Invalid read options.");
  return Object.freeze({ ...(maxLines === undefined ? {} : { maxLines: maxLines as number }), ...(signal === undefined ? {} : { abortSignal: signal as unknown as AbortSignal }) });
}
function snapshotCreateOptions(value: unknown): { recursive?: boolean; abortSignal?: AbortSignal } | undefined {
  if (value === undefined) return undefined; if (!record(value)) throw new TypeError("Invalid create options.");
  const recursive = stable(value, "recursive"); const signal = stable(value, "abortSignal");
  if (recursive !== undefined && typeof recursive !== "boolean" || signal !== undefined && !record(signal)) throw new TypeError("Invalid create options.");
  return Object.freeze({ ...(recursive === undefined ? {} : { recursive }), ...(signal === undefined ? {} : { abortSignal: signal as unknown as AbortSignal }) });
}
function snapshotRemoveOptions(value: unknown): { recursive?: boolean; force?: boolean; abortSignal?: AbortSignal } | undefined {
  if (value === undefined) return undefined; if (!record(value)) throw new TypeError("Invalid remove options.");
  const recursive = stable(value, "recursive"); const force = stable(value, "force"); const signal = stable(value, "abortSignal");
  if (recursive !== undefined && typeof recursive !== "boolean" || force !== undefined && typeof force !== "boolean" || signal !== undefined && !record(signal)) throw new TypeError("Invalid remove options.");
  return Object.freeze({ ...(recursive === undefined ? {} : { recursive }), ...(force === undefined ? {} : { force }), ...(signal === undefined ? {} : { abortSignal: signal as unknown as AbortSignal }) });
}
function snapshotTempOptions(value: unknown): { prefix?: string; suffix?: string; abortSignal?: AbortSignal } | undefined {
  if (value === undefined) return undefined; if (!record(value)) throw new TypeError("Invalid temp options.");
  const prefix = stable(value, "prefix"); const suffix = stable(value, "suffix"); const signal = stable(value, "abortSignal");
  if (prefix !== undefined && typeof prefix !== "string" || suffix !== undefined && typeof suffix !== "string" || signal !== undefined && !record(signal)) throw new TypeError("Invalid temp options.");
  return Object.freeze({ ...(prefix === undefined ? {} : { prefix }), ...(suffix === undefined ? {} : { suffix }), ...(signal === undefined ? {} : { abortSignal: signal as unknown as AbortSignal }) });
}
function snapshotContent(value: unknown): string | Uint8Array { if (typeof value === "string") return value; if (!(value instanceof Uint8Array)) throw new TypeError("Invalid content."); return new Uint8Array(value); }
function snapshotStringArray(value: unknown): string[] | null {
  try { if (!Array.isArray(value)) return null; const length = value.length; if (value.length !== length) return null; const output: string[] = []; for (let index = 0; index < length; index += 1) { const item = value[index]; if (value[index] !== item || typeof item !== "string") return null; output.push(item); } return output; } catch { return null; }
}
function normaliseEnvironment(value: unknown): Record<string, string> | null {
  try { if (!record(value)) return null; const output: Record<string, string> = {}; for (const key of Object.keys(value)) { const item = stable(value, key); if (typeof item !== "string") return null; output[key] = item; } return output; } catch { return null; }
}
function fileInfoValue(value: unknown, cwd: string): FileInfo | null {
  try { if (!record(value)) return null; const name = stable(value, "name"); const path = stable(value, "path"); const kind = stable(value, "kind"); const size = stable(value, "size"); const mtimeMs = stable(value, "mtimeMs"); if (typeof name !== "string" || typeof path !== "string" || !FILE_KINDS.has(kind as FileInfo["kind"]) || !Number.isSafeInteger(size) || (size as number) < 0 || typeof mtimeMs !== "number" || !Number.isFinite(mtimeMs) || mtimeMs < 0) return null; return Object.freeze({ name, path: resolveSelectedPath(cwd, path), kind: kind as FileInfo["kind"], size: size as number, mtimeMs }); } catch { return null; }
}
function fileInfoArrayValue(value: unknown, cwd: string): FileInfo[] | null { try { if (!Array.isArray(value)) return null; const output = value.map((entry) => fileInfoValue(entry, cwd)); return output.some((item) => item === null) ? null : Object.freeze(output) as FileInfo[]; } catch { return null; } }
function stringValue(value: unknown): string | null { return typeof value === "string" ? value : null; }
function stringArrayValue(value: unknown): string[] | null { const output = snapshotStringArray(value); return output ? Object.freeze(output) as string[] : null; }
function binaryValue(value: unknown): Uint8Array | null { try { return value instanceof Uint8Array ? new Uint8Array(value) : null; } catch { return null; } }
function booleanValue(value: unknown): boolean | null { return typeof value === "boolean" ? value : null; }
function voidValue(value: unknown): undefined | null { return value === undefined ? undefined : null; }
function readAborted(signal: unknown): boolean | null { try { if (signal === undefined) return false; if (!record(signal)) return null; const value = stable(signal, "aborted"); return typeof value === "boolean" ? value : null; } catch { return null; } }
function guardCallback(callback: ((chunk: string) => void) | undefined, fault: () => void): ((chunk: string) => void) | undefined { return callback ? (chunk) => { try { callback(chunk); } catch (error) { fault(); throw error; } } : undefined; }
function normaliseErrorPath(path: string | undefined, fallback: string | undefined): string | undefined { try { return path === undefined ? fallback : path.startsWith("/") || path === "~" || path.startsWith("~/") || path.startsWith("file://") ? resolveSelectedPath("/", path) : fallback; } catch { return fallback; } }
function fileFailure(code: FileErrorCode, message: string, path?: string): ResultValue<never, FileError> { return Result.err(new FileError(code, message, path)); }
function executionFailure(code: ExecutionErrorCode, message: string): ResultValue<never, ExecutionError> { return Result.err(new ExecutionError(code, message)); }
function record(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
function stable(value: Record<string, unknown>, key: string): unknown { const first = value[key]; return value[key] === first ? first : CHANGED; }
function stableObject(value: object, key: string): unknown { return stable(value as Record<string, unknown>, key); }
function resolveSelectedPath(cwd: string, path: string): string {
  let normalised = path;
  if (normalised === "~") normalised = homedir();
  else if (normalised.startsWith("~/")) normalised = join(homedir(), normalised.slice(2));
  else if (normalised.startsWith("file://")) {
    try { normalised = fileURLToPath(normalised); } catch (error) { void error; /* selected Earendil behavior treats malformed URLs as paths */ }
  }
  return resolvePath(cwd, normalised);
}
class InvalidTimeoutError extends Error {}
const MAX_TIMEOUT_SECONDS = 2_147_483_647 / 1000;
const CHANGED = Symbol("changed");
const FILE_CODES = new Set<FileErrorCode>(["aborted", "not_found", "permission_denied", "not_directory", "is_directory", "invalid", "not_supported", "unknown"]);
const EXECUTION_CODES = new Set<ExecutionErrorCode>(["aborted", "timeout", "shell_unavailable", "spawn_error", "callback_error", "unknown"]);
const FILE_KINDS = new Set<FileInfo["kind"]>(["file", "directory", "symlink"]);
