import { describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  DEFAULT_LOCAL_TEST_NICE,
  planLocalTestCommand,
} from "../../scripts/local-test-priority.js";
import { auditLocalTestEntrypoints } from "../../scripts/check-local-test-entrypoints.js";

const ROOT = resolve(import.meta.dir, "../../..");
const LAUNCHER = join(ROOT, "runtime/scripts/local-test-priority.ts");

describe("local test priority plan", () => {
  test("applies default and validated override only to supported local launches", () => {
    expect(planLocalTestCommand(["bun", "test"], {}, "linux", true)).toEqual({
      command: ["nice", "-n", String(DEFAULT_LOCAL_TEST_NICE), "bun", "test"],
      applied: true,
      niceValue: 10,
      diagnostic: null,
    });
    expect(planLocalTestCommand(["bun", "test"], { PICLAW_LOCAL_TEST_NICE: "17" }, "linux", true).command)
      .toEqual(["nice", "-n", "17", "bun", "test"]);
    expect(() => planLocalTestCommand(["bun"], { PICLAW_LOCAL_TEST_NICE: "-1" }, "linux", true)).toThrow("0 through 19");
    expect(() => planLocalTestCommand(["bun"], { PICLAW_LOCAL_TEST_NICE: "20" }, "linux", true)).toThrow("0 through 19");
    expect(() => planLocalTestCommand(["bun"], { PICLAW_LOCAL_TEST_NICE: "abc" }, "linux", true)).toThrow("0 through 19");
  });

  test("hosted CI, nested launchers, and unsupported platforms execute directly", () => {
    expect(planLocalTestCommand(["bun", "test"], { CI: "true" }, "linux", true).applied).toBe(false);
    expect(planLocalTestCommand(["bun", "test"], { GITHUB_ACTIONS: "true" }, "linux", true).applied).toBe(false);
    expect(planLocalTestCommand(["bun", "test"], { PICLAW_LOCAL_TEST_PRIORITY_ACTIVE: "1" }, "linux", true).applied).toBe(false);
    const unsupported = planLocalTestCommand(["bun", "test"], {}, "win32", false);
    expect(unsupported.command).toEqual(["bun", "test"]);
    expect(unsupported.diagnostic).toContain("running test command directly");
  });
});

describe("local test priority process behavior", () => {
  test("Linux child and descendant inherit the effective nice value", () => {
    if (process.platform !== "linux") return;
    const directory = mkdtempSync(join(tmpdir(), "piclaw-nice-probe-"));
    const script = join(directory, "probe.ts");
    try {
      writeFileSync(script, [
        "import { readFileSync } from 'node:fs';",
        "function nice(pid: number) { return Number(readFileSync(`/proc/${pid}/stat`, 'utf8').split(' ')[18]); }",
        "const child = Bun.spawn([process.execPath, '-e', `import { readFileSync } from 'node:fs'; console.log(readFileSync('/proc/self/stat','utf8').split(' ')[18]);`], { stdout: 'pipe' });",
        "const descendant = Number((await new Response(child.stdout).text()).trim());",
        "await child.exited;",
        "console.log(JSON.stringify({ self: nice(process.pid), descendant }));",
      ].join("\n"));
      const run = Bun.spawnSync([process.execPath, LAUNCHER, "--", process.execPath, script], {
        cwd: ROOT,
        env: { ...process.env, CI: undefined, GITHUB_ACTIONS: undefined, PICLAW_LOCAL_TEST_NICE: "10" },
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(run.exitCode, run.stderr.toString()).toBe(0);
      expect(JSON.parse(run.stdout.toString().trim())).toEqual({ self: 10, descendant: 10 });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("forwards termination and lets the child clean up its descendant group", async () => {
    if (process.platform !== "linux") return;
    const directory = mkdtempSync(join(tmpdir(), "piclaw-signal-probe-"));
    const childScript = join(directory, "child.sh");
    const marker = join(directory, "terminated.txt");
    try {
      writeFileSync(childScript, [
        "#!/bin/sh",
        "marker=$1",
        "sleep 30 &",
        "descendant=$!",
        "cleanup() { kill \"$descendant\" 2>/dev/null || true; wait \"$descendant\" 2>/dev/null || true; printf terminated > \"$marker\"; exit 0; }",
        "trap cleanup TERM INT HUP",
        "wait \"$descendant\"",
      ].join("\n"));
      chmodSync(childScript, 0o755);
      const run = Bun.spawn([process.execPath, LAUNCHER, "--", childScript, marker], {
        cwd: ROOT,
        env: { ...process.env, CI: undefined, GITHUB_ACTIONS: undefined },
        stdout: "pipe",
        stderr: "pipe",
      });
      await Bun.sleep(100);
      run.kill("SIGTERM");
      expect(await run.exited).toBe(0);
      expect(await Bun.file(marker).text()).toBe("terminated");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("preserves cwd, argv, environment, output, and exit status", () => {
    const directory = mkdtempSync(join(tmpdir(), "piclaw-launch-probe-"));
    const script = join(directory, "probe.ts");
    try {
      writeFileSync(script, "console.log(JSON.stringify({ cwd: process.cwd(), args: process.argv.slice(2), env: process.env.PROBE })); process.exit(7);\n");
      const run = Bun.spawnSync([
        process.execPath, LAUNCHER, "--cwd", directory, "--env", "PROBE=kept", "--",
        process.execPath, script, "argument with spaces", "literal-$value",
      ], { cwd: ROOT, env: { ...process.env, CI: undefined, GITHUB_ACTIONS: undefined }, stdout: "pipe", stderr: "pipe" });
      expect(run.exitCode).toBe(7);
      expect(JSON.parse(run.stdout.toString().trim())).toEqual({
        cwd: directory,
        args: ["argument with spaces", "literal-$value"],
        env: "kept",
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe("local test entrypoint audit", () => {
  test("repository test entrypoints use the launcher or explicit nested allowlist", async () => {
    expect(await auditLocalTestEntrypoints()).toEqual([]);
  });
});
