import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createTempWorkspace } from "../helpers.js";
import { killProcessTree } from "../../src/utils/process-tracker.js";

for (const mode of ["small-busy", "stdout-busy", "stderr-busy", "stdout-healthy", "stderr-healthy", "exit-seven", "timeout", "abort", "ownership-denied"]) {
  test(`Bun runner contains finalisation and settles once: ${mode}`, async () => {
    const ws = createTempWorkspace("bun-settlement-host-");
    const child = Bun.spawn([process.execPath, "--no-env-file", fileURLToPath(new URL("../fixtures/bun-runner-settlement.ts", import.meta.url)), mode], {
      env: { ...process.env, PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data, PICLAW_DB_IN_MEMORY: "0", PICLAW_TOOL_OUTPUT_STORE_BYTES: "1024", PICLAW_TOOL_OUTPUT_STORE_LINES: "20" },
      stdout: "pipe", stderr: "pipe",
    });
    let hardTimer: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      hardTimer = setTimeout(() => child.kill("SIGKILL"), 1000);
    }, 10_000);
    try {
      const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      expect(code, err || out).toBe(0);
      expect(err).toBe("");
      const receipt = out.split("\n").find(line => line.startsWith("BUN_SETTLEMENT="));
      expect(receipt).toBeDefined();
      expect(JSON.parse(receipt!.slice("BUN_SETTLEMENT=".length))).toEqual({ mode, settled: 1, tracked: 0, executions: 1 });
    } finally {
      clearTimeout(timer); clearTimeout(hardTimer);
      if (child.exitCode === null) child.kill("SIGTERM");
      const pidFile = join(ws.workspace, "script.pid");
      if (existsSync(pidFile)) {
        const pid = Number(readFileSync(pidFile, "utf8"));
        if (Number.isSafeInteger(pid) && pid > 0) {
          let alive = false;
          try { process.kill(pid, 0); alive = true; } catch { alive = false; }
          if (alive) killProcessTree(pid);
        }
      }
      if (child.exitCode === null) child.kill("SIGKILL");
      await child.exited;
      ws.cleanup();
    }
  }, 15_000);
}
