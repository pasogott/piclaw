import "./src/test-guard.js";
import { test, expect } from "bun:test";
import { cpSync, symlinkSync } from "node:fs";
import { DATA_DIR } from "../../runtime/src/core/config.js";
import { join } from "node:path";
import { initDatabase, getDb, closeDatabase } from "../../runtime/src/db/connection.js";
import { getDeferredQueuedFollowups, storeChatMetadata } from "../../runtime/src/db.js";
import { acquireRuntimeLock } from "../../runtime/src/runtime/single-instance.js";
import { createDefaultApplicationRuntime } from "../../runtime/durable-engine/src/default-application-runtime.js";

import { createAssistantMessageEventStream } from "../../node_modules/@earendil-works/pi-ai";
import { createTestCredentialStore } from "../../runtime/test/model-services-fixture.js";
import { AgentPool } from "../../runtime/src/agent-pool.js";
import { createRuntimeBaseServices } from "../../runtime/src/runtime/composition.js";
import { WebChannel } from "../../runtime/src/channels/web.js";
import { admitWebUserMessage } from "../../runtime/src/channels/web/messaging/message-store.js";

test("Remote Peer actual factory uses network-free transport, executes status and closes/reopens", async () => {
  const workspace = process.env.PICLAW_WORKSPACE!;
  const source = process.env.DURABLE_ADDONS_ROOT!;
  const pkg = join(workspace, ".pi/extensions/node_modules/@rcarmo/piclaw-addon-remote-peer");
  cpSync(join(source, "addons/remote-peer"), pkg, { recursive: true, filter: p => !p.split("/").includes("node_modules") });
  symlinkSync(join(source, "node_modules"), join(pkg, "node_modules"));
  process.env.PICLAW_DB_IN_MEMORY = "0"; initDatabase();
  const owner = acquireRuntimeLock({ lockPath: join(workspace, "peer-owner.lock"), strictOwnership: true, disabled: false });
  const model = { provider: "synthetic", id: "approved", name: "Approved", api: "openai-completions", baseUrl: "https://invalid.invalid", input: ["text"], reasoning: false, contextWindow: 100000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
  const iroh = await import(join(source, "node_modules/@number0/iroh/index.js"));
  const remoteId = iroh.SecretKey.fromBytes(Array(32).fill(7)).public();
  const remoteTicket = iroh.EndpointTicket.fromAddr(new iroh.EndpointAddr(remoteId)).toString();
  let ingress: any;
  let params: Record<string, unknown> = { action: "status" };
  let calls = 0, result = "", starts = 0, closes = 0;
  const peerOptions = { transportFactory: (options: any) => { ingress = options.handler; return ({ id: "fixture-native-id", status: () => ({ id: "fixture-native-id", active: true }), ticket: () => "fixture-ticket", async start() { starts++; }, async request() { return { body: { ok: true } }; }, async close() { closes++; } }); },
    discoveryFactory: () => { throw Error("mDNS must remain disabled in fixture"); } };
  const services = { modelRegistry: { getAvailable: () => [model] }, modelRuntime: {
    getPhysicalModel: () => model,
    streamSimple(_model: unknown, input: any) {
      calls++;
      const last = input.messages.at(-1);
      const tool = last?.role === "toolResult" ? last : undefined;
      if (tool) result = JSON.stringify(tool);
      const message = { role: "assistant", api: model.api, provider: model.provider, model: model.id, timestamp: Date.now(),
        content: tool ? [{ type: "text", text: "review complete" }] : [{ type: "toolCall", id: "regrets-call", name: "remote_peer", arguments: params }],
        stopReason: tool ? "stop" : "toolUse", usage: { input: 5, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 10, cost: { ...model.cost, total: 0 } } } as any;
      const stream = createAssistantMessageEventStream(); stream.push({ type: "done", reason: message.stopReason, message }); stream.end(message); return stream;
    },
    completeSimple() { throw Error("Default decision-off must not request a nested model"); },
  } } as any;
  const { PeerState } = await import(join(pkg, "state.ts"));
  const state = new PeerState(join(DATA_DIR, "addons", "remote-peer"));
  state.saveConfig({ ...state.config(), enabled: true, mdnsEnabled: false }); state.close();
  let backend: Awaited<ReturnType<typeof createDefaultApplicationRuntime>> | undefined;
  try {
    backend = await createDefaultApplicationRuntime(owner, async () => services, undefined, peerOptions);
    expect(calls).toBe(0);
    const base = createRuntimeBaseServices({ dataDir: workspace });
    const pool = new AgentPool({ credentialStore: createTestCredentialStore({}), modelRuntime: services.modelRuntime, modelRegistry: services.modelRegistry, ...backend.sessionOptions } as any);
    const bound = backend.bind({ queue: base.queue, agentPool: pool });
    const channel = new WebChannel(bound);
    const admitted = await admitWebUserMessage(channel, { chatJid: "web:default", content: "Review recent exchanges", mediaIds: [], isBot: false, agentId: "default", agentName: "Fixture" },
      { acceptSource: bound.getInputSourceAdmission!("web:default") }, () => owner.assertCurrentOwner(), new AbortController().signal);
    expect(admitted).not.toBeNull();
    const id = (getDb().query("SELECT id FROM messages WHERE rowid=?").get(admitted!.id) as any).id;
    expect(await bound.dispatchAcceptedInput!("web:default", id, admitted!.id)!()).toBe("settled");
    expect(result).not.toContain('"isError":true');
    expect(result).toContain("fixture-native-id");
    expect(calls).toBe(2);
    await ingress(remoteId.toString(), { op: "pair", body: { request: "fixture-pair", epoch: "fixture-epoch", name: "Synthetic peer", ticket: remoteTicket, expires: Date.now() + 60000 } }, new Uint8Array());
    params = { action: "accept", peer: remoteId.toString(), confirmation: remoteId.toString() };
    const accepted = await admitWebUserMessage(channel, { chatJid: "web:default", content: "Accept synthetic peer", mediaIds: [], isBot: false, agentId: "default", agentName: "Fixture" },
      { acceptSource: bound.getInputSourceAdmission!("web:default") }, () => owner.assertCurrentOwner(), new AbortController().signal);
    const acceptedId = (getDb().query("SELECT id FROM messages WHERE rowid=?").get(accepted!.id) as any).id;
    expect(await bound.dispatchAcceptedInput!("web:default", acceptedId, accepted!.id)!()).toBe("settled");
    expect(result).not.toContain('"isError":true');
    const body = { epoch: "fixture-epoch", messageId: "synthetic-message", semantic: { target: "inbox", content: "Actual authenticated peer queue ingress", mode: "queue", files: [] } };
    expect(await ingress(remoteId.toString(), { op: "message", body }, new Uint8Array())).toBeTruthy();
    const queued = getDeferredQueuedFollowups("web:default");
    expect(queued).toHaveLength(1);
    expect(queued[0]!.queuedContent).toContain("Actual authenticated peer queue ingress");
    expect(getDb().query("SELECT source_id FROM service_effect_s01_sources WHERE source_id=?").get(queued[0]!.source_id!)).toBeTruthy();
    await expect(ingress(remoteId.toString(), { op: "message", body: { ...body, epoch: "stale" } }, new Uint8Array())).rejects.toThrow();
    await backend.close(); backend = undefined;
    expect(closes).toBe(1);
    backend = await createDefaultApplicationRuntime(owner, async () => services, undefined, peerOptions);
    expect(calls).toBe(4);
    expect(getDeferredQueuedFollowups("web:default")[0]!.source_id).toBe(queued[0]!.source_id);
    await backend.close(); backend = undefined;
    expect(closes).toBe(2);
  } finally { await backend?.close(); owner.release(); closeDatabase(); }
});
