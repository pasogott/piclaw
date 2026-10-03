import { expect, test } from "bun:test";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

for (const mode of ["success", "failed-initial", "failed-reload", "commit-failure", "unbound", "overlap", "disposed-barrier", "failed-barrier", "shutdown-error", "runtime-dispose"]) {
  test(`public SDK MCP bridge ownership: ${mode}`, async () => {
    const root = mkdtempSync(join(tmpdir(), "mcp-bridge-driver-"));
    const child = Bun.spawn([process.execPath, "--no-env-file", join(import.meta.dir, "fixtures/mcp-bridge-reload.ts"), mode, "3", "plain", root], {
      env: { PATH: process.env.PATH, HOME: "/nonexistent", PI_OFFLINE: "1", PI_TELEMETRY: "0", OTEL_SDK_DISABLED: "true", PICLAW_DB_IN_MEMORY: "1" },
      stdin: "ignore", stdout: "pipe", stderr: "pipe",
    });
    const timer = setTimeout(() => child.kill(), 15_000);
    try {
      const [stdout, stderr, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      expect({ exit, stderr }).toEqual({ exit: 0, stderr: "" });
      const receipt = JSON.parse(stdout.trim().split("\n").at(-1)!);
      expect(receipt).toMatchObject({ mode, version: "1.0.0", adapterVersion: "2.31.0", status: "pass", network: 0 });
      expect(receipt.acquired).toBeGreaterThan(0);
      expect(receipt.released).toBe(receipt.acquired);
      expect(stdout + stderr).not.toContain("SYNTHETIC_BEARER_");
    } finally {
      clearTimeout(timer);
      try { if (child.exitCode === null) { child.kill(); await child.exited; } }
      finally { rmSync(root, { recursive: true, force: true }); }
    }
  }, 20_000);
}
