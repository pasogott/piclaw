import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
    expect(planLocalTestCommand(["bun", "test"], { CI: "1" }, "linux", true).applied).toBe(false);
    expect(planLocalTestCommand(["bun", "test"], { GITHUB_ACTIONS: "true" }, "linux", true).applied).toBe(false);
    expect(planLocalTestCommand(["bun", "test"], { GITHUB_ACTIONS: "1" }, "linux", true).applied).toBe(false);
    expect(planLocalTestCommand(["bun", "test"], { CI: "false", GITHUB_ACTIONS: "0" }, "linux", true).applied).toBe(true);
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
        env: { ...process.env, CI: undefined, GITHUB_ACTIONS: undefined, PICLAW_LOCAL_TEST_NICE: "0", PICLAW_LOCAL_TEST_PRIORITY_ACTIVE: undefined },
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(run.exitCode, run.stderr.toString()).toBe(0);
      expect(JSON.parse(run.stdout.toString().trim())).toEqual({ self: 10, descendant: 10 });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("terminating the launcher removes child and uncooperative descendant process group", async () => {
    if (process.platform !== "linux") return;
    const directory = mkdtempSync(join(tmpdir(), "piclaw-signal-probe-"));
    const childScript = join(directory, "child.sh");
    const pidsFile = join(directory, "pids.txt");
    try {
      writeFileSync(childScript, [
        "#!/bin/sh",
        "pids_file=$1",
        "bun -e 'setTimeout(() => {}, 30000)' &",
        "descendant=$!",
        "printf '%s %s' \"$$\" \"$descendant\" > \"$pids_file\"",
        "wait \"$descendant\"",
      ].join("\n"));
      chmodSync(childScript, 0o755);
      const run = Bun.spawn([process.execPath, LAUNCHER, "--", childScript, pidsFile], {
        cwd: ROOT,
        env: { ...process.env, CI: undefined, GITHUB_ACTIONS: undefined, PICLAW_LOCAL_TEST_PRIORITY_ACTIVE: undefined },
        stdout: "pipe",
        stderr: "pipe",
      });
      for (let tries = 0; tries < 100 && !existsSync(pidsFile); tries += 1) await Bun.sleep(10);
      const [childPid, descendantPid] = readFileSync(pidsFile, "utf8").trim().split(" ").map(Number);
      run.kill("SIGTERM");
      await run.exited;
      for (let tries = 0; tries < 300 && (processExists(childPid) || processExists(descendantPid)); tries += 1) await Bun.sleep(10);
      expect(processExists(childPid)).toBe(false);
      expect(processExists(descendantPid)).toBe(false);
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
      ], { cwd: ROOT, env: { ...process.env, CI: undefined, GITHUB_ACTIONS: undefined, PICLAW_LOCAL_TEST_PRIORITY_ACTIVE: undefined }, stdout: "pipe", stderr: "pipe" });
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

function processExists(pid: number): boolean {
  const statPath = `/proc/${pid}/stat`;
  if (!existsSync(statPath)) return false;
  const fields = readFileSync(statPath, "utf8").split(" ");
  return fields[2] !== "Z";
}

describe("local test entrypoint audit", () => {
  test("repository test entrypoints use the launcher or explicit nested allowlist", async () => {
    expect(await auditLocalTestEntrypoints()).toEqual([]);
  });

  test("detects a raw Bun test command in a root script", async () => {
    const directory = mkdtempSync(join(tmpdir(), "piclaw-entrypoint-audit-"));
    try {
      writeFileSync(join(directory, "raw-test.sh"), "#!/bin/sh\nbun test runtime/test/example.test.ts\n");
      expect(await auditLocalTestEntrypoints(directory)).toEqual([
        "raw-test.sh:2:bun test runtime/test/example.test.ts",
      ]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
