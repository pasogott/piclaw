import {
  ExecutionError,
  FileError,
  Result,
  type ExecutionEnv,
  type Result as ResultValue,
  type ShellExecOptions,
} from "@earendil-works/pi-agent-core";

export type ShellEnvironmentPreparer = (
  command: string,
  options: Readonly<ShellExecOptions>,
) => Promise<Record<string, string>> | Record<string, string>;

/** Defensive Earendil boundary around one captured environment instance. */
export class PiclawExecutionEnv implements ExecutionEnv {
  readonly cwd: string;
  readonly #delegate: ExecutionEnv;
  readonly #prepareShellEnvironment: ShellEnvironmentPreparer;
  #cleanupPromise: Promise<void> | null = null;

  constructor(delegate: ExecutionEnv, prepareShellEnvironment: ShellEnvironmentPreparer) {
    this.cwd = delegate.cwd;
    this.#delegate = delegate;
    this.#prepareShellEnvironment = prepareShellEnvironment;
  }

  absolutePath(path: string, abortSignal?: AbortSignal) { return this.file(path, abortSignal, () => this.#delegate.absolutePath(path, abortSignal)); }
  joinPath(parts: string[], abortSignal?: AbortSignal) { return this.file(undefined, abortSignal, () => this.#delegate.joinPath([...parts], abortSignal)); }
  readTextFile(path: string, abortSignal?: AbortSignal) { return this.file(path, abortSignal, () => this.#delegate.readTextFile(path, abortSignal)); }
  readTextLines(path: string, options?: { maxLines?: number; abortSignal?: AbortSignal }) { const snapshot = options ? { ...options } : undefined; return this.file(path, snapshot?.abortSignal, () => this.#delegate.readTextLines(path, snapshot)); }
  readBinaryFile(path: string, abortSignal?: AbortSignal) { return this.file(path, abortSignal, () => this.#delegate.readBinaryFile(path, abortSignal)); }
  writeFile(path: string, content: string | Uint8Array, abortSignal?: AbortSignal) { const snapshot = typeof content === "string" ? content : new Uint8Array(content); return this.file(path, abortSignal, () => this.#delegate.writeFile(path, snapshot, abortSignal)); }
  appendFile(path: string, content: string | Uint8Array, abortSignal?: AbortSignal) { const snapshot = typeof content === "string" ? content : new Uint8Array(content); return this.file(path, abortSignal, () => this.#delegate.appendFile(path, snapshot, abortSignal)); }
  renameFile(sourcePath: string, destinationPath: string, abortSignal?: AbortSignal) { return this.file(sourcePath, abortSignal, () => this.#delegate.renameFile(sourcePath, destinationPath, abortSignal)); }
  fileInfo(path: string, abortSignal?: AbortSignal) { return this.file(path, abortSignal, () => this.#delegate.fileInfo(path, abortSignal)); }
  listDir(path: string, abortSignal?: AbortSignal) { return this.file(path, abortSignal, () => this.#delegate.listDir(path, abortSignal)); }
  canonicalPath(path: string, abortSignal?: AbortSignal) { return this.file(path, abortSignal, () => this.#delegate.canonicalPath(path, abortSignal)); }
  exists(path: string, abortSignal?: AbortSignal) { return this.file(path, abortSignal, () => this.#delegate.exists(path, abortSignal)); }
  createDir(path: string, options?: { recursive?: boolean; abortSignal?: AbortSignal }) { const snapshot = options ? { ...options } : undefined; return this.file(path, snapshot?.abortSignal, () => this.#delegate.createDir(path, snapshot)); }
  remove(path: string, options?: { recursive?: boolean; force?: boolean; abortSignal?: AbortSignal }) { const snapshot = options ? { ...options } : undefined; return this.file(path, snapshot?.abortSignal, () => this.#delegate.remove(path, snapshot)); }
  createTempDir(prefix?: string, abortSignal?: AbortSignal) { return this.file(undefined, abortSignal, () => this.#delegate.createTempDir(prefix, abortSignal)); }
  createTempFile(options?: { prefix?: string; suffix?: string; abortSignal?: AbortSignal }) { const snapshot = options ? { ...options } : undefined; return this.file(undefined, snapshot?.abortSignal, () => this.#delegate.createTempFile(snapshot)); }

  async exec(command: string, options: ShellExecOptions = {}): Promise<ResultValue<{ stdout: string; stderr: string; exitCode: number }, ExecutionError>> {
    if (options.abortSignal?.aborted) return Result.err(new ExecutionError("aborted", "aborted"));
    const snapshot = snapshotShellOptions(options);
    try {
      const prepared = await Promise.resolve(this.#prepareShellEnvironment(command, snapshot));
      const env = normaliseEnvironment(prepared);
      if (!env) return Result.err(new ExecutionError("unknown", "Shell environment preparation returned an invalid environment."));
      if (snapshot.abortSignal?.aborted) return Result.err(new ExecutionError("aborted", "aborted"));
      const result = await this.#delegate.exec(command, { ...snapshot, env, inheritEnv: false });
      return validExecutionResult(result) ? result : Result.err(new ExecutionError("unknown", "Execution environment returned a malformed result."));
    } catch (error) {
      return Result.err(new ExecutionError("unknown", "Shell environment preparation or execution failed.", toError(error)));
    }
  }

  cleanup(): Promise<void> {
    if (!this.#cleanupPromise) this.#cleanupPromise = (async () => { try { await this.#delegate.cleanup(); } catch { /* best effort */ } })();
    return this.#cleanupPromise;
  }

  private async file<T>(path: string | undefined, abortSignal: AbortSignal | undefined, effect: () => Promise<ResultValue<T, FileError>>): Promise<ResultValue<T, FileError>> {
    const addressedPath = this.addressedPath(path);
    if (abortSignal?.aborted) return Result.err(new FileError("aborted", "aborted", addressedPath));
    try {
      const result = await effect();
      return validFileResult(result) ? result : Result.err(new FileError("unknown", "Filesystem environment returned a malformed result.", addressedPath));
    } catch (error) { return Result.err(new FileError("unknown", "Filesystem environment failed.", addressedPath, toError(error))); }
  }

  private addressedPath(path: string | undefined): string | undefined {
    if (!path) return undefined;
    try { return path.startsWith("/") ? path : `${this.cwd.replace(/\/$/, "")}/${path}`; } catch { return undefined; }
  }
}

function snapshotShellOptions(options: ShellExecOptions): ShellExecOptions {
  return Object.freeze({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }), ...(options.timeout === undefined ? {} : { timeout: options.timeout }),
    ...(options.abortSignal === undefined ? {} : { abortSignal: options.abortSignal }), ...(options.onStdout === undefined ? {} : { onStdout: options.onStdout }),
    ...(options.onStderr === undefined ? {} : { onStderr: options.onStderr }), env: Object.freeze({ ...(options.env ?? {}) }), inheritEnv: options.inheritEnv ?? true,
  });
}
function normaliseEnvironment(value: unknown): Record<string, string> | null {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const output: Record<string, string> = {};
    for (const key of Object.keys(value)) { const first = (value as Record<string, unknown>)[key]; if ((value as Record<string, unknown>)[key] !== first || typeof first !== "string") return null; output[key] = first; }
    return output;
  } catch { return null; }
}
function validFileResult<T>(value: unknown): value is ResultValue<T, FileError> {
  try { if (!value || typeof value !== "object" || typeof (value as { ok?: unknown }).ok !== "boolean") return false; return (value as { ok: boolean }).ok || (value as { error?: unknown }).error instanceof FileError; } catch { return false; }
}
function validExecutionResult(value: unknown): value is ResultValue<{ stdout: string; stderr: string; exitCode: number }, ExecutionError> {
  try {
    if (!value || typeof value !== "object" || typeof (value as { ok?: unknown }).ok !== "boolean") return false;
    if (!(value as { ok: boolean }).ok) return (value as { error?: unknown }).error instanceof ExecutionError;
    const result = (value as { value?: unknown }).value as Record<string, unknown> | undefined;
    return Boolean(result && typeof result.stdout === "string" && typeof result.stderr === "string" && Number.isInteger(result.exitCode));
  } catch { return false; }
}
function toError(value: unknown): Error { return value instanceof Error ? value : new Error(String(value)); }
