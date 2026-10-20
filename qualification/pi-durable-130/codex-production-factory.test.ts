import { repoRoot } from "./src/repo-root.js";
import { isolatedApplicationTest } from "./src/isolated-application-test.js";
import "./src/test-guard.js";
import { expect, spyOn } from "bun:test";
const applicationTest = isolatedApplicationTest(import.meta.url);
import { cpSync, symlinkSync, realpathSync, mkdirSync, readdirSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getPiclawAgentDir } from "../../runtime/src/core/agent-dir.js";
import { initDatabase, getDb, closeDatabase } from "../../runtime/src/db/connection.js";
import { acquireRuntimeLock } from "../../runtime/src/runtime/single-instance.js";
import { createDefaultApplicationRuntime } from "../../runtime/durable-engine/src/default-application-runtime.js";
import { createTestCredentialStore } from "../../runtime/test/model-services-fixture.js";
import { AgentPool } from "../../runtime/src/agent-pool.js";
import { createRuntimeBaseServices } from "../../runtime/src/runtime/composition.js";
import { WebChannel } from "../../runtime/src/channels/web.js";
import { admitWebUserMessage } from "../../runtime/src/channels/web/messaging/message-store.js";
import type { Model, AssistantMessage, CredentialStore } from "../../node_modules/@earendil-works/pi-ai";
import { HostConversationRuntime } from "../../runtime/durable-engine/src/host-runtime.js";
const rootUrl = new URL("../../package.json", import.meta.url).href;
const { ModelRuntime } = await import(import.meta.resolve("@earendil-works/pi-coding-agent", rootUrl));
const { createAssistantMessageEventStream, getCurrentTools } = await import(import.meta.resolve("@earendil-works/pi-ai", rootUrl));

for (const scenario of ["patch", "sse", "broken-sse"] as const) applicationTest(`Codex production factory ${scenario}: real public dispatch and reopen`, async () => {
  const source = realpathSync(process.env.DURABLE_ADDONS_ROOT!);
  const workspace = process.env.PICLAW_WORKSPACE!;
  const pkg = join(workspace, ".pi/extensions/node_modules/@rcarmo/piclaw-addon-codex-conversion");
  cpSync(join(source, "addons/codex-conversion"), pkg, { recursive: true, filter: p => !p.split("/").includes("node_modules") });
  // All links belong to this isolated package; neither dependency source is mutated.
  const dependencies = join(pkg, "node_modules");
  mkdirSync(dependencies, {recursive:true});
  for (const sourceModules of [join(repoRoot("CORE"), "node_modules"), process.env.DURABLE_CATALOG_DEPENDENCIES ?? join(source, "node_modules"), join(source, "addons/codex-conversion/node_modules")].filter(path => existsSync(path))) {
    for (const entry of readdirSync(sourceModules)) {
      if (entry.startsWith(".")) continue;
      if (entry.startsWith("@")) {
        mkdirSync(join(dependencies, entry), { recursive: true });
        for (const child of readdirSync(join(sourceModules, entry))) {
          const target = join(dependencies, entry, child);
          if (!existsSync(target)) symlinkSync(join(sourceModules, entry, child), target);
        }
      } else {
        const target = join(dependencies, entry);
        if (!existsSync(target)) symlinkSync(join(sourceModules, entry), target);
      }
    }
  }
  const model: Model<"openai-codex-responses"> = { provider: "openai-codex", id: "synthetic-codex", name: "Synthetic Codex", api: "openai-codex-responses", baseUrl: "https://fixture.invalid", input: ["text", "image"], reasoning: false, contextWindow: 100000, maxTokens: 1000, cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } };
  const credentials: CredentialStore = {
    async read(id) { if (id !== model.provider) throw Error("Ambient credentials forbidden: " + id); return { type: "api_key", key: "synthetic-only" }; },
    async list() { return [{ providerId: model.provider, type: "api_key" }]; },
    async modify(_id, fn) { return fn(undefined); }, async delete() {},
  };
  const runtime = await ModelRuntime.create({ credentials, modelsPath: null, modelsStore: { read: async () => undefined, write: async () => {}, delete: async () => {} }, allowModelNetwork: false, refreshOnCreate: false });
  let calls = 0;
  let fixtureError: unknown;
  let bodyFailed = false;
  let bodyPulls = 0;
  let joined = 0;
  const originalClose = HostConversationRuntime.prototype.close;
  const closeSpy = spyOn(HostConversationRuntime.prototype, "close").mockImplementation(async function(this: HostConversationRuntime) {
    await originalClose.call(this);
    joined++;
  });
  const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(async () => {
    if (scenario === "broken-sse") return new Response(new ReadableStream({
      async pull(controller) {
        bodyPulls++;
        if (bodyPulls === 1) controller.enqueue(new TextEncoder().encode('data: {"type":"response.created","response":{"id":"response-broken-fixture"}}\n\n'));
        else { await new Promise(resolve => setTimeout(resolve, 5)); bodyFailed = true; controller.error(new Error("PRIVATE_SYNTHETIC_CAPTURE_FAILURE")); }
      },
    }), { headers: { "content-type": "text/event-stream" } });
    const events = [{ type: "response.created", response: { id: "response-fixture" } }, { type: "response.output_item.done", item: { type: "image_generation_call", id: "image-fixture", result: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1cAAAAASUVORK5CYII=", output_format: "png" } }];
    const bytes = new TextEncoder().encode(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n");
    return new Response(new ReadableStream({ start(controller) { for (let i=0;i<bytes.length;i+=17) controller.enqueue(bytes.slice(i,i+17)); controller.close(); } }), { headers: { "content-type": "text/event-stream" } });
  });
  const names = ["exec_command", "write_stdin", "apply_patch", "view_image", "web_search", "image_generation"];
  const run: Parameters<typeof runtime.registerNativeProvider>[0]["streamSimple"] = (actual, context, options) => {
    calls++;
    expect(actual.provider).toBe(model.provider); expect(actual.id).toBe(model.id); expect(actual.api).toBe(model.api);
    const tools = getCurrentTools(context.messages);
    for (const name of names) expect(tools.some(t => t.name === name)).toBe(true);
    expect(options?.onPayload).toBeFunction();
    const stream = createAssistantMessageEventStream();
    void (async () => {
      try {
    if (scenario === "patch" && calls === 2) {
      const result = context.messages.findLast(m => m.role === "toolResult");
      expect(result).toBeDefined();
      expect((result as any).details.status).toBe("success");
      expect((result as any).details.result.createdFiles).toEqual(["codex-factory-proof.txt"]);
      expect(JSON.stringify((result as any).content)).toContain("Applied patch successfully.");
      expect(context.messages.some(m => m.role === "assistant" && m.content.some((c:any) => c.type === "toolCall" && c.id === "patch-fixture"))).toBe(true);
    }

        // Public Root consumes transformHeaders before entering the native provider.
        expect(options?.headers?.["x-fixture"]).toBe("owned");
        const payload = await options!.onPayload!({ model: model.id, input: [], tools: tools.map(t => ({type: "function", name: t.name, description: t.description, parameters: t.parameters})) }, actual);
        expect(payload).toBeDefined();
        if (scenario !== "patch") {
          for (const name of ["image_generation", "web_search"]) {
            const declaration = tools.find(t => t.name === name)!;
            expect(declaration.parameters).toEqual({type: "object", additionalProperties: false});
            const native = (payload as any).tools.find((t:any) => t.type === name);
            expect(native).toBeDefined();
            expect(native.parameters).toBeUndefined();
            expect((payload as any).tools.some((t:any) => t.type === "function" && t.name === name)).toBe(false);
          }
          expect(options?.fetch).toBeFunction();
          const response = await options!.fetch!("https://fixture.invalid/responses", {method: "POST", body: JSON.stringify(payload)});
          expect(await response.text()).toContain("image_generation_call");
        }
        const message: AssistantMessage = { role: "assistant", provider: model.provider, model: model.id, api: model.api, timestamp: Date.now(), content: [{ type: "text", text: "owned synthetic codex terminal" }], stopReason: "stop", usage: { input: 3, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 5, cost: { input: 0.000003, output: 0.000002, cacheRead: 0, cacheWrite: 0, total: 0.000005 } } };
        if (scenario === "patch" && calls === 1) {
          message.content = [{type: "toolCall", id: "patch-fixture", name: "apply_patch", arguments: {input: "*** Begin Patch\n*** Add File: codex-factory-proof.txt\n+factory patch proof\n*** End Patch"}}];
          message.stopReason = "toolUse";
        }
        stream.push({ type: "done", reason: message.stopReason, message }); stream.end(message);
      } catch (error) {
        fixtureError = error;
        const message: AssistantMessage = { role: "assistant", provider: model.provider, model: model.id, api: model.api, timestamp: Date.now(), content: [], stopReason: "error", errorMessage: String(error), usage: { input: 3, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 5, cost: { input: 0.000003, output: 0.000002, cacheRead: 0, cacheWrite: 0, total: 0.000005 } } };
        stream.push({ type: "error", reason: "error", error: message }); stream.end(message);

      }
    })();
    return stream;
  };
  const provider: Parameters<typeof runtime.registerNativeProvider>[0] = { id: model.provider, name: "Synthetic Codex", getModels: () => [model], auth: { apiKey: { name: "Synthetic", resolve: async () => ({ auth: { apiKey: "synthetic-only", headers: { "x-fixture": "owned" } }, source: "fixture" }) } }, stream: run, streamSimple: run };
  runtime.registerNativeProvider(provider);
  expect(runtime.getRegisteredNativeProvider(model.provider)).toBe(provider);
  const services = { modelRuntime: runtime, modelRegistry: { getAvailable: () => [model] } };
  mkdirSync(getPiclawAgentDir(), { recursive: true });
  writeFileSync(join(getPiclawAgentDir(), "auth.json"), JSON.stringify({ "openai-codex": { type: "oauth", access: "synthetic-only", refresh: "synthetic-refresh", expires: Date.now() + 3600000, accountId: "synthetic-account" } }));
  process.env.PICLAW_DB_IN_MEMORY = "0"; initDatabase();
  const owner = acquireRuntimeLock({ lockPath: join(workspace, "codex-production-owner.lock"), strictOwnership: true, disabled: false });
  let backend: Awaited<ReturnType<typeof createDefaultApplicationRuntime>> | undefined;
  try {
    backend = await createDefaultApplicationRuntime(owner, async () => services as never);
    expect(calls).toBe(0);
    expect(runtime.getRegisteredNativeProvider(model.provider)).toBe(provider);
    const base = createRuntimeBaseServices({ dataDir: workspace });
    const pool = new AgentPool({ credentialStore: createTestCredentialStore({}), modelRuntime: runtime, modelRegistry: services.modelRegistry, ...backend.sessionOptions } as never);
    const bound = backend.bind({ queue: base.queue, agentPool: pool });
    const channel = new WebChannel(bound);
    const priorReservations = new Set((getDb().query("SELECT id FROM budget_request_reservations").all() as {id:string}[]).map(r=>r.id));
    const priorBotCount = (getDb().query("SELECT count(*) AS n FROM messages WHERE is_bot_message=1").get() as {n:number}).n;
    const admitted = await admitWebUserMessage(channel, { chatJid: "web:default", content: "Reply with a short synthetic result", mediaIds: [], isBot: false, agentId: "default", agentName: "Fixture" }, { acceptSource: bound.getInputSourceAdmission!("web:default") }, () => owner.assertCurrentOwner(), new AbortController().signal);
    expect(admitted).not.toBeNull();
    const row = getDb().query("SELECT id FROM messages WHERE rowid=?").get(admitted!.id) as { id: string };
    const outcome = await bound.dispatchAcceptedInput!("web:default", row.id, admitted!.id)!();
    if (scenario === "broken-sse") {
      expect(bodyFailed).toBe(true);
      expect(bodyPulls).toBe(2);
      expect(calls).toBe(1);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(outcome).not.toBe("settled");
      const reservations = (getDb().query("SELECT * FROM budget_request_reservations").all() as any[]).filter(r => !priorReservations.has(r.id));
      expect(reservations).toHaveLength(1);
      expect(reservations[0].state).toBe("settled");
      const usage = getDb().query("SELECT u.input_tokens, u.output_tokens, e.api_usd_micros FROM budget_usage_events e JOIN token_usage u ON u.id=e.token_usage_id WHERE e.usage_event_id=?").get(reservations[0].usage_event_id) as any;
      expect(usage).toEqual({ input_tokens: 3, output_tokens: 2, api_usd_micros: 5 });
      const workBefore = getDb().query("SELECT * FROM budget_work WHERE id=?").get(reservations[0].work_id);
      const before = JSON.stringify(reservations);
      const tree = JSON.stringify(await backend.sessionOptions.getDurableSession!("web:default")!.readTree!());
      expect(tree).not.toContain("owned synthetic codex terminal");
      expect(tree).not.toContain("PRIVATE_SYNTHETIC_CAPTURE_FAILURE");
      expect(tree).not.toContain("Files:");
      expect(outcome).toBe("pending");
      const records = JSON.stringify(getDb().query("SELECT record FROM entries ORDER BY id").all());
      expect(records).toContain("Host model request denied or failed");
      expect(records).not.toContain("PRIVATE_SYNTHETIC_CAPTURE_FAILURE");
      expect(records).not.toContain("owned synthetic codex terminal");
      expect(records).not.toContain("Files:");
      expect(getDb().query("SELECT * FROM extension_kv WHERE value LIKE '%openai-codex-images%' OR value LIKE '%image-fixture%'").all()).toHaveLength(0);
      expect(existsSync(join(workspace, ".pi/openai-codex-images"))).toBe(false);
      const bots = getDb().query("SELECT content FROM messages WHERE is_bot_message=1 AND chat_jid=?").all("web:default");
      expect(bots).toHaveLength(priorBotCount);
      await backend.stop();
      const closing = backend.close();
      const firstError = await closing.catch(error => error);
      expect(joined).toBe(1);
      expect(backend.close()).toBe(closing);
      expect(await backend.close().catch(error => error)).toBe(firstError);
      expect(joined).toBe(1);
      expect(getDb().query("SELECT * FROM budget_work WHERE id=?").get(reservations[0].work_id)).toEqual(workBefore);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(JSON.stringify((getDb().query("SELECT * FROM budget_request_reservations").all() as any[]).filter(r => !priorReservations.has(r.id)))).toBe(before);
      backend = undefined;
      return;
    }
    if (fixtureError) throw fixtureError;
    expect(outcome).toBe("settled");
    expect(calls).toBe(scenario === "patch" ? 2 : 1);
    const reservations = (getDb().query("SELECT * FROM budget_request_reservations").all() as any[]).filter(r => !priorReservations.has(r.id));
    expect(reservations).toHaveLength(calls);
    for (const reservation of reservations) {
      expect(reservation.state).toBe("settled");
      expect(reservation.provider_id).toBe(model.provider);
      expect(reservation.model_id).toBe(model.id);
      expect(reservation.account_ref).toBeTruthy();
      expect(reservation.settlement_sha256).toHaveLength(64);
      expect((getDb().query("SELECT status FROM budget_work WHERE id=?").get(reservation.work_id) as any).status).toBe("completed");
    }
    if (scenario === "patch") expect(readFileSync(join(workspace, "codex-factory-proof.txt"), "utf8")).toBe("factory patch proof\n");
    else {
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const bots = getDb().query("SELECT content FROM messages WHERE is_bot_message=1 AND chat_jid=?").all("web:default") as {content:string}[];
      expect(bots).toHaveLength(priorBotCount + 1);
      expect(bots.at(-1)!.content).toContain("Files:\n- .pi/openai-codex-images/");
    }
    const position = backend.sessionOptions.getDurableSession!("web:default")!;
    const treeBefore = await position.readTree!();
    expect(JSON.stringify(treeBefore)).toContain("owned synthetic codex terminal");
    expect(JSON.stringify(treeBefore)).not.toContain("Files:");
    await backend.close(); backend = undefined;
    backend = await createDefaultApplicationRuntime(owner, async () => services as never);
    expect(calls).toBe(scenario === "patch" ? 2 : 1);
    const treeAfter = await backend.sessionOptions.getDurableSession!("web:default")!.readTree!();
    expect(treeAfter).toEqual(treeBefore);
    expect(runtime.getRegisteredNativeProvider(model.provider)).toBe(provider);
  } finally { fetchSpy.mockRestore(); try { await backend?.close(); } finally { closeSpy.mockRestore(); owner.release(); closeDatabase(); } }
}, 60000);
