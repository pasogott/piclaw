#!/usr/bin/env bun
/** Replay the frozen 0.99.1 evidence under Bun, outside current dependency resolution. */
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { ensureTestFilesystemIsolation } from "../runtime/scripts/test-filesystem-isolation.js";

const fixture = resolve(import.meta.dir, "../historical/earendil-0.99.1");
const manifest = JSON.parse(readFileSync(resolve(fixture, "manifest.json"), "utf8")) as {
  archive: string; archiveSha256: string; retiredFiles: Record<string, string>; tests: string[];
};
const archive = resolve(fixture, "source.tar.gz");
const expectedArchiveSha256 = "5e83b74bd25e0843cf3a080ae778dd160750c435979ba62cd813e90773447b53";
const digest = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");
if (manifest.archive !== "source.tar.gz" || manifest.archiveSha256 !== expectedArchiveSha256 || digest(readFileSync(archive)) !== expectedArchiveSha256) throw new Error("Historical source archive changed");
// Pin the bytes independently of the descriptive manifest before tar sees them.
// The only archive symlink is runtime/extensions/node_modules -> ../../node_modules,
// which resolves inside the extracted consumer. There are no installed modules.
const expectedTestsSha256 = "246a1e0b03e4f89f7874a50a0f25072077de51d095a7a0b76736eaf70798b4cd";
if (manifest.tests.length !== 45 || new Set(manifest.tests).size !== 45 || digest(Buffer.from(JSON.stringify(manifest.tests))) !== expectedTestsSha256) throw new Error("Historical test list changed");
const isolation = ensureTestFilesystemIsolation();
const root = mkdtempSync(resolve(tmpdir(), "earendil-0991-history-"));
const env = { ...process.env, BUN_INSTALL_CACHE_DIR: resolve(root, "cache") };
async function run(args: string[], cwd = root): Promise<void> {
  const child = Bun.spawn(args, { cwd, env, stdout: "inherit", stderr: "inherit" });
  const stop = () => { child.kill("SIGTERM"); };
  process.once("SIGTERM", stop); process.once("SIGINT", stop);
  try { const code = await child.exited; if (code !== 0) throw new Error(`Historical command failed (${code}): ${args[0]}`); }
  finally { process.off("SIGTERM", stop); process.off("SIGINT", stop); }
}
try {
  await run(["tar", "-xzf", archive, "-C", root]);
  for (const [path, expected] of Object.entries(manifest.retiredFiles)) {
    if (digest(readFileSync(resolve(root, path))) !== expected) throw new Error(`Historical source differs: ${path}`);
  }
  await run([process.execPath, "install", "--ignore-scripts", "--frozen-lockfile"]);
  for (const name of ["chord", "pi-agent-core", "pi-ai", "pi-coding-agent", "pi-mcp", "pi-codemode", "pi-telemetry", "pi-tui"]) {
    const installed = JSON.parse(readFileSync(resolve(root, `node_modules/@earendil-works/${name}/package.json`), "utf8"));
    if (installed.version !== "0.99.1") throw new Error(`Historical dependency drift: ${name}`);
  }
  await run([process.execPath, "node_modules/typescript/bin/tsc", "--noEmit", "-p", "runtime/tsconfig.json"]);
  // Call the existing launcher with an explicit list: a directory is not a file filter.
  const command = `import {runLocalTestCommand} from "./runtime/scripts/local-test-priority.ts"; await runLocalTestCommand(${JSON.stringify([process.execPath, "runtime/scripts/controlled-test-runner.ts", "--", ...manifest.tests])});`;
  await run([process.execPath, "--eval", command]);
  console.log(`Historical 0.99.1 evidence passed: ${manifest.tests.length} files. Not 1.0.0 qualification.`);
} finally {
  rmSync(root, { recursive: true, force: true });
  if (isolation.createdRoot) isolation.cleanup();
}
