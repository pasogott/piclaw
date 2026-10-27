import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const source = resolve(import.meta.dir, "../../src");
const fixture = resolve(import.meta.dir, "../model-services-fixture.ts");

for (const mode of ["bound", "empty"] as const) {
  test(`durable service-factory ${mode} scope does not evaluate legacy construction modules`, async () => {
    const root = mkdtempSync(resolve(tmpdir(), "durable-service-factory-boundary-"));

    const script = `
      import { plugin } from "bun";
      const source = ${JSON.stringify(source)};
      const attempts = [];
      plugin({ name: "durable-service-factory-fence", setup(build) {
        build.onLoad({ filter: /\\/agent-pool\\/(session-manager|session-binder|tool-factory|turn-coordinator)\\.(ts|js)$/ }, args => {
          if (!args.path.startsWith(source + "/")) return;
          attempts.push(args.path);
          throw new Error("DURABLE_SERVICE_FACTORY_FENCE:" + args.path);
        });
      }});

      const { SettingsManager, ModelRegistry } = await import("@earendil-works/pi-coding-agent");
      const { createAgentPoolModelOptions } = await import(${JSON.stringify(fixture)});
      const { createAgentPoolServices } = await import(source + "/agent-pool/service-factory.ts");

      const mode = ${JSON.stringify(mode)};
      const model = createAgentPoolModelOptions();
      const durablePort = mode === "bound"
        ? { sessionId: "durable", branchId: "main", readPosition: async () => "leaf", readModel: async () => "provider/model" }
        : undefined;

      const services = createAgentPoolServices({
        pool: new Map(),
        activeForkBaseLeafByChat: new Map(),
        authStorage: model.credentialStore,
        modelRuntime: model.modelRuntime,
        modelRegistry: new ModelRegistry(model.modelRuntime),
        settingsManager: SettingsManager.inMemory(),
        workspaceDir: process.env.PICLAW_WORKSPACE,
        getDurableSession: () => durablePort,
      });

      const snapshot = services.sessionManager.getInstrumentationSnapshot();
      if (snapshot.createInFlight !== 0 || snapshot.prewarmInFlight !== 0 || snapshot.branchSeedRealizationsInFlight !== 0) {
        throw new Error("Unexpected durable instrumentation");
      }
      if (services.sessionManager.prewarm("web:bound") !== false) throw new Error("Durable prewarm must fail closed");
      if (services.sessionManager.cancelPrewarm("web:bound") !== false) throw new Error("Durable prewarm cancellation must fail closed");
      if (services.sessionManager.hasPendingSessionWork("web:bound") !== false) throw new Error("Durable session work must stay empty");
      if (services.sessionManager.hasProtectedRun("web:bound") !== false) throw new Error("Durable protected run must stay false");
      if (services.sessionManager.hasActiveMemoryReclamationWork() !== false) throw new Error("Durable reclamation should stay inactive");
      if (services.toolFactory.createCustomToolOverrides("web:bound").length !== 0) throw new Error("Durable custom tools should stay empty");

      let getOrCreateBlocked = false;
      try { await services.sessionManager.getOrCreate("web:bound"); }
      catch (error) { getOrCreateBlocked = String(error).includes("Durable application does not construct legacy sessions"); }
      if (!getOrCreateBlocked) throw new Error("Durable getOrCreate must fail closed");

      let trackerBlocked = false;
      try { services.turnCoordinator.createTracker("web:bound"); }
      catch (error) { trackerBlocked = String(error).includes("Durable application does not construct legacy sessions"); }
      if (!trackerBlocked) throw new Error("Durable turn tracker must fail closed");

      await services.sessionManager.shutdown();
      console.log(JSON.stringify({ mode, attempts }));
    `;

    try {
      const child = Bun.spawn([process.execPath, "--eval", script], {
        cwd: root,
        env: {
          PATH: process.env.PATH,
          HOME: root,
          PICLAW_WORKSPACE: resolve(root, "workspace"),
          PICLAW_STORE: resolve(root, "store"),
          PICLAW_DATA: resolve(root, "data"),
          PI_CODING_AGENT_DIR: resolve(root, "agent"),
          PICLAW_DB_IN_MEMORY: "1",
        },
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);

      expect({ exitCode, stderr: exitCode ? stderr : "" }).toEqual({ exitCode: 0, stderr: "" });
      const result = JSON.parse(stdout.trim().split("\n").at(-1)!);
      expect(result.mode).toBe(mode);
      expect(result.attempts).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30000);
}
