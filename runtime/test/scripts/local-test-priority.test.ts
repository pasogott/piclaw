import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
    expect(planLocalTestCommand(["bun", "test"], {}, "linux", { processGroupAvailable: true, currentNice: 0 })).toEqual({
      command: ["nice", "-n", "10", "bun", "test"], applied: true, niceValue: 10, niceAdjustment: 10, diagnostic: null,
    });
    expect(planLocalTestCommand(["bun", "test"], {}, "linux", { processGroupAvailable: true, currentNice: 10 })).toMatchObject({ command: ["bun", "test"], niceValue: 10, niceAdjustment: 0 });
    expect(planLocalTestCommand(["bun", "test"], {}, "linux", { processGroupAvailable: true, currentNice: 15 })).toMatchObject({ command: ["bun", "test"], niceValue: 10, niceAdjustment: 0 });
    expect(planLocalTestCommand(["bun", "test"], { PICLAW_LOCAL_TEST_NICE: "0" }, "linux", { processGroupAvailable: true, currentNice: 0 })).toMatchObject({ command: ["bun", "test"], niceValue: 0, niceAdjustment: 0 });
    expect(planLocalTestCommand(["bun", "test"], { PICLAW_LOCAL_TEST_NICE: "17" }, "linux", { processGroupAvailable: true, currentNice: 10 }).command)
      .toEqual(["nice", "-n", "7", "bun", "test"]);
    expect(() => planLocalTestCommand(["bun"], { PICLAW_LOCAL_TEST_NICE: "-1" }, "linux", true)).toThrow("0 through 19");
    expect(() => planLocalTestCommand(["bun"], { PICLAW_LOCAL_TEST_NICE: "20" }, "linux", true)).toThrow("0 through 19");
    expect(() => planLocalTestCommand(["bun"], { PICLAW_LOCAL_TEST_NICE: "abc" }, "linux", true)).toThrow("0 through 19");
  });

  test("hosted CI, nested launchers, and unsupported platforms execute directly", () => {
    const available = { processGroupAvailable: true, currentNice: 0 };
    expect(planLocalTestCommand(["bun", "test"], { CI: "true" }, "linux", available).applied).toBe(false);
    expect(planLocalTestCommand(["bun", "test"], { CI: "1" }, "linux", available).applied).toBe(false);
    expect(planLocalTestCommand(["bun", "test"], { GITHUB_ACTIONS: "true" }, "linux", available).applied).toBe(false);
    expect(planLocalTestCommand(["bun", "test"], { GITHUB_ACTIONS: "1" }, "linux", available).applied).toBe(false);
    expect(planLocalTestCommand(["bun", "test"], { CI: "false", GITHUB_ACTIONS: "0" }, "linux", available).applied).toBe(true);
    expect(planLocalTestCommand(["bun", "test"], { PICLAW_LOCAL_TEST_PRIORITY_ACTIVE: "1" }, "linux", available).applied).toBe(false);
    const unsupported = planLocalTestCommand(["bun", "test"], {}, "darwin", available);
    expect(unsupported.command).toEqual(["bun", "test"]);
    expect(unsupported.diagnostic).toContain("running test command directly");
    expect(planLocalTestCommand(["bun", "test"], {}, "linux", { processGroupAvailable: false, currentNice: 0 }).applied).toBe(false);
  });
});

describe("local test priority process behavior", () => {
  test("Linux child and descendant inherit default niceness relative to their parent", () => {
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
        env: { ...process.env, CI: undefined, GITHUB_ACTIONS: undefined, PICLAW_LOCAL_TEST_NICE: undefined, PICLAW_LOCAL_TEST_PRIORITY_ACTIVE: undefined },
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(run.exitCode, run.stderr.toString()).toBe(0);
      expect(JSON.parse(run.stdout.toString().trim())).toEqual({ self: DEFAULT_LOCAL_TEST_NICE, descendant: DEFAULT_LOCAL_TEST_NICE });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("hosted CI executes the command directly", () => {
    const run = Bun.spawnSync([process.execPath, LAUNCHER, "--", process.execPath, "-e", "console.log(process.env.PICLAW_LOCAL_TEST_PRIORITY_ACTIVE ?? 'direct')"], {
      cwd: ROOT,
      env: { ...process.env, CI: "true", GITHUB_ACTIONS: undefined, PICLAW_LOCAL_TEST_PRIORITY_ACTIVE: undefined },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(run.exitCode, run.stderr.toString()).toBe(0);
    expect(run.stdout.toString().trim()).toBe("direct");
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
      let pids: number[] = [];
      for (let tries = 0; tries < 100; tries += 1) {
        if (existsSync(pidsFile)) {
          pids = readFileSync(pidsFile, "utf8").trim().split(/\s+/).map(Number);
          if (pids.length === 2 && pids.every((pid) => Number.isInteger(pid) && pid > 0)) break;
        }
        await Bun.sleep(10);
      }
      expect(pids).toHaveLength(2);
      const [childPid, descendantPid] = pids;
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

  test("detects raw test commands in arbitrary nested scripts, package manifests, and Makefiles", async () => {
    const directory = mkdtempSync(join(tmpdir(), "piclaw-entrypoint-audit-"));
    try {
      mkdirSync(join(directory, "arbitrary/deep"), { recursive: true });
      writeFileSync(join(directory, "arbitrary/deep/nested-test.sh"), "#!/bin/sh\nbun test runtime/test/example.test.ts\n");
      writeFileSync(join(directory, "package.json"), "{\"scripts\":{\"test\":\"playwright test\"}}\n");
      writeFileSync(join(directory, "Makefile"), "test:\n\tbun test\n");
      expect(await auditLocalTestEntrypoints(directory, ["arbitrary/deep/nested-test.sh", "package.json", "Makefile"])).toEqual([
        "Makefile:2:bun test",
        "arbitrary/deep/nested-test.sh:2:bun test runtime/test/example.test.ts",
        "package.json:1:{\"scripts\":{\"test\":\"playwright test\"}}",
      ]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
