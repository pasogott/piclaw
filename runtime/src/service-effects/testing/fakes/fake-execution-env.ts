import {
  ExecutionError,
  FileError,
  Result,
  type ExecutionEnv,
  type FileInfo,
  type Result as ResultValue,
  type ShellExecOptions,
} from "@earendil-works/pi-agent-core";

export type FakeShellStep =
  | { readonly _tag: "result"; readonly stdout: string; readonly stderr: string; readonly exitCode: number }
  | { readonly _tag: "error"; readonly error: ExecutionError }
  | { readonly _tag: "disconnect"; readonly afterSubmission: boolean }
  | { readonly _tag: "wait_for_stop"; readonly started: () => void; readonly release: Promise<void> };

export class FakeExecutionEnv implements ExecutionEnv {
  readonly cwd: string;
  readonly routeId: string;
  readonly files = new Map<string, Uint8Array>();
  readonly symlinks = new Map<string, string>();
  readonly shellSteps: FakeShellStep[] = [];
  readonly observedShellEnvironments: Array<Record<string, string> | undefined> = [];
  readonly ownedGroups = new Set<number>();
  readonly killedGroups: number[] = [];
  cleanupCalls = 0;
  throwCleanup = false;
  rejectAllFiles = false;
  rejectAllFilesWithThrow = false;
  private nextGroup = 1;
  private cleaned = false;

  constructor(cwd: string, routeId = "local", private readonly defaultShellEnvironment: Readonly<Record<string, string>> = {}) {
    this.cwd = normaliseAbsolute(cwd);
    this.routeId = routeId;
  }

  putText(path: string, value: string): void { this.files.set(this.resolve(path), new TextEncoder().encode(value)); }
  link(path: string, target: string): void { this.symlinks.set(this.resolve(path), target); }
  script(...steps: readonly FakeShellStep[]): void { this.shellSteps.push(...steps); }

  absolutePath(path: string, signal?: AbortSignal) { return this.file(path, signal, () => this.resolve(path)); }
  joinPath(parts: string[], signal?: AbortSignal) { return this.file(undefined, signal, () => normaliseAbsolute(parts.join("/"))); }
  readTextFile(path: string, signal?: AbortSignal) { return this.file(path, signal, () => {
    const addressed = this.resolve(path); const bytes = this.files.get(addressed);
    if (!bytes) throw new FileError("not_found", "not found", addressed);
    return new TextDecoder().decode(bytes);
  }); }
  readTextLines(path: string, options?: { maxLines?: number; abortSignal?: AbortSignal }) { return this.file(path, options?.abortSignal, () => {
    const addressed = this.resolve(path); const bytes = this.files.get(addressed);
    if (!bytes) throw new FileError("not_found", "not found", addressed);
    return new TextDecoder().decode(bytes).split(/\r?\n/).slice(0, options?.maxLines);
  }); }
  readBinaryFile(path: string, signal?: AbortSignal) { return this.file(path, signal, () => {
    const addressed = this.resolve(path); const bytes = this.files.get(addressed);
    if (!bytes) throw new FileError("not_found", "not found", addressed);
    return new Uint8Array(bytes);
  }); }
  writeFile(path: string, content: string | Uint8Array, signal?: AbortSignal) { return this.file(path, signal, () => {
    this.files.set(this.resolve(path), typeof content === "string" ? new TextEncoder().encode(content) : new Uint8Array(content));
  }); }
  appendFile(path: string, content: string | Uint8Array, signal?: AbortSignal) { return this.file(path, signal, () => {
    const addressed = this.resolve(path); const existing = this.files.get(addressed) ?? new Uint8Array(); const next = typeof content === "string" ? new TextEncoder().encode(content) : content;
    const combined = new Uint8Array(existing.length + next.length); combined.set(existing); combined.set(next, existing.length); this.files.set(addressed, combined);
  }); }
  renameFile(source: string, destination: string, signal?: AbortSignal) { return this.file(source, signal, () => {
    const from = this.resolve(source); const bytes = this.files.get(from); if (!bytes) throw new FileError("not_found", "not found", from);
    this.files.delete(from); this.files.set(this.resolve(destination), bytes);
  }); }
  fileInfo(path: string, signal?: AbortSignal): Promise<ResultValue<FileInfo, FileError>> { return this.file(path, signal, () => {
    const addressed = this.resolve(path);
    if (this.symlinks.has(addressed)) return info(addressed, "symlink", 0);
    const bytes = this.files.get(addressed); if (bytes) return info(addressed, "file", bytes.length);
    if (this.isDirectory(addressed)) return info(addressed, "directory", 0);
    throw new FileError("not_found", "not found", addressed);
  }); }
  listDir(path: string, signal?: AbortSignal): Promise<ResultValue<FileInfo[], FileError>> { return this.file(path, signal, () => {
    const directory = this.resolve(path).replace(/\/$/, "");
    if (!this.isDirectory(directory)) throw new FileError("not_directory", "not directory", directory);
    const children = new Map<string, FileInfo>();
    for (const [file, bytes] of this.files) if (file.startsWith(`${directory}/`)) { const direct = file.slice(directory.length + 1).split("/")[0]; const child = `${directory}/${direct}`; children.set(child, info(child, child === file ? "file" : "directory", child === file ? bytes.length : 0)); }
    for (const link of this.symlinks.keys()) if (link.startsWith(`${directory}/`) && !link.slice(directory.length + 1).includes("/")) children.set(link, info(link, "symlink", 0));
    return [...children.values()];
  }); }
  canonicalPath(path: string, signal?: AbortSignal) { return this.file(path, signal, () => {
    const addressed = this.resolve(path); const target = this.symlinks.get(addressed); if (!target) {
      if (!this.files.has(addressed) && !this.isDirectory(addressed)) throw new FileError("not_found", "not found", addressed);
      return addressed;
    }
    return target.startsWith("/") ? normaliseAbsolute(target) : normaliseAbsolute(`${addressed.slice(0, addressed.lastIndexOf("/"))}/${target}`);
  }); }
  exists(path: string, signal?: AbortSignal) { return this.file(path, signal, () => { const addressed = this.resolve(path); return this.files.has(addressed) || this.symlinks.has(addressed) || this.isDirectory(addressed); }); }
  createDir(path: string, options?: { recursive?: boolean; abortSignal?: AbortSignal }) { return this.file(path, options?.abortSignal, () => { this.files.set(`${this.resolve(path)}/.dir`, new Uint8Array()); }); }
  remove(path: string, options?: { recursive?: boolean; force?: boolean; abortSignal?: AbortSignal }) { return this.file(path, options?.abortSignal, () => {
    const addressed = this.resolve(path); const existed = this.files.delete(addressed) || this.symlinks.delete(addressed);
    if (options?.recursive) for (const file of [...this.files.keys()]) if (file.startsWith(`${addressed}/`)) this.files.delete(file);
    if (!existed && !options?.force && !options?.recursive) throw new FileError("not_found", "not found", addressed);
  }); }
  createTempDir(prefix = "tmp-", signal?: AbortSignal) { return this.file(undefined, signal, () => `${this.cwd}/${prefix}dir`); }
  createTempFile(options?: { prefix?: string; suffix?: string; abortSignal?: AbortSignal }) { return this.file(undefined, options?.abortSignal, () => {
    const path = `${this.cwd}/${options?.prefix ?? ""}file${options?.suffix ?? ""}`; this.files.set(path, new Uint8Array()); return path;
  }); }

  async exec(command: string, options: ShellExecOptions = {}): Promise<ResultValue<{ stdout: string; stderr: string; exitCode: number }, ExecutionError>> {
    if (options.abortSignal?.aborted) return Result.err(new ExecutionError("aborted", "aborted"));
    const observedEnvironment = { ...this.defaultShellEnvironment, ...(options.env ?? {}) };
    this.observedShellEnvironments.push(Object.keys(observedEnvironment).length > 0 ? observedEnvironment : undefined);
    const group = this.nextGroup++; this.ownedGroups.add(group);
    const stop = () => { if (this.ownedGroups.delete(group)) this.killedGroups.push(group); };
    const onAbort = () => stop(); options.abortSignal?.addEventListener("abort", onAbort, { once: true });
    const step = this.shellSteps.shift() ?? { _tag: "result", stdout: command, stderr: "", exitCode: 0 };
    try {
      if (step._tag === "wait_for_stop") {
        step.started();
        let timedOut = false; let timer: Timer | undefined;
        if (options.timeout) timer = setTimeout(() => { timedOut = true; stop(); }, options.timeout * 1000);
        await step.release; if (timer) clearTimeout(timer);
        if (timedOut) return Result.err(new ExecutionError("timeout", `timeout:${options.timeout}`));
        if (options.abortSignal?.aborted) return Result.err(new ExecutionError("aborted", "aborted"));
        return Result.err(new ExecutionError("unknown", "stopped"));
      }
      this.ownedGroups.delete(group);
      if (step._tag === "error") return Result.err(step.error);
      if (step._tag === "disconnect") return Result.err(new ExecutionError(step.afterSubmission ? "unknown" : "spawn_error", step.afterSubmission ? "Remote execution acknowledgement was lost." : "Remote execution was not submitted."));
      options.onStdout?.(step.stdout); options.onStderr?.(step.stderr);
      return Result.ok({ stdout: step.stdout, stderr: step.stderr, exitCode: step.exitCode });
    } finally { options.abortSignal?.removeEventListener("abort", onAbort); }
  }

  async cleanup(): Promise<void> {
    if (this.cleaned) return;
    this.cleaned = true;
    this.cleanupCalls += 1;
    for (const group of [...this.ownedGroups]) { this.ownedGroups.delete(group); this.killedGroups.push(group); }
    if (this.throwCleanup) return; // deterministic best-effort cleanup fault
  }

  private async file<T>(path: string | undefined, signal: AbortSignal | undefined, run: () => T): Promise<ResultValue<T, FileError>> {
    const addressed = path ? this.resolve(path) : undefined;
    if (signal?.aborted) return Result.err(new FileError("aborted", "aborted", addressed));
    if (this.rejectAllFiles) {
      if (this.rejectAllFilesWithThrow) throw new Error("backend rejection");
      return Result.err(new FileError("unknown", "fake filesystem fault", addressed));
    }
    try { return Result.ok(run()); } catch (error) { return Result.err(error instanceof FileError ? error : new FileError("unknown", "fake filesystem fault", addressed, error as Error)); }
  }
  private resolve(path: string): string { return path.startsWith("/") ? normaliseAbsolute(path) : normaliseAbsolute(`${this.cwd}/${path}`); }
  private isDirectory(path: string): boolean { return path === this.cwd || [...this.files.keys(), ...this.symlinks.keys()].some((entry) => entry.startsWith(`${path.replace(/\/$/, "")}/`)); }
}

function normaliseAbsolute(path: string): string {
  const parts: string[] = [];
  for (const part of path.split("/")) { if (!part || part === ".") continue; if (part === "..") parts.pop(); else parts.push(part); }
  return `/${parts.join("/")}`;
}
function info(path: string, kind: FileInfo["kind"], size: number): FileInfo { return Object.freeze({ name: path.slice(path.lastIndexOf("/") + 1), path, kind, size, mtimeMs: 0 }); }
