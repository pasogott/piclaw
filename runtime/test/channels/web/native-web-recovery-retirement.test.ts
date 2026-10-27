import { expect, test } from "bun:test";
import { WebChannel } from "../../../src/channels/web.js";
import { initDatabase, getDb, storeChatMetadata } from "../../../src/db.js";
import { handleAgentMessage } from "../../../src/channels/web/handlers/agent.js";
import { buildAgentStatusSnapshot } from "../../../src/channels/web/agent/agent-status.js";
import { runWebStartupRecoveryBootstrap } from "../../../src/runtime/startup.js";
import { WebChannelRuntimeStateService } from "../../../src/channels/web/runtime/runtime-state-service.js";
import { AgentStatusStore } from "../../../src/channels/web/agent/agent-status-store.js";
import { WebAgentControlPlaneService } from "../../../src/channels/web/agent/agent-control-plane-service.js";

test("model selection cannot rewind a native cursor or consume historical failed markers", async () => {
  initDatabase(); const chat="web:model-no-legacy-retry";
  storeChatMetadata(chat,"2026-01-01T00:00:00.000Z","Web");
  getDb().query(`INSERT INTO chat_cursors(chat_jid,cursor_ts,failed_prev_ts,failed_ts,failed_message_id)
    VALUES(?,'2026-01-01T00:00:05.000Z','','2026-01-01T00:00:05.000Z','old-input')`).run(chat);
  const before=getDb().query("SELECT * FROM chat_cursors WHERE chat_jid=?").get(chat);
  let queued=0;
  const web=new WebChannel({queue:{enqueue(){queued++;}},agentPool:{isDurableRuntime:()=>true,
    applyControlCommand:async()=>({status:"success",message:"Model selected",model_label:"synthetic/test"}),
    getAvailableModels:async()=>({current:"synthetic/test",thinking_level:null,supports_thinking:false})} as any} as any);
  const response=await handleAgentMessage(web as any,new Request("http://fixture/agent/default/message",{
    method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({content:"/model synthetic/test"}),
  }),"/agent/default/message",chat,"default");
  expect(response.status).toBe(200);
  expect(getDb().query("SELECT * FROM chat_cursors WHERE chat_jid=?").get(chat)).toEqual(before);
  expect(queued).toBe(0);
});

test("web startup never consults a legacy inflight-recovery capability", () => {
  let nativeHandoff=0,resumed=0; const scheduled:(()=>void)[]=[];
  const web={updateAgentStatus(){},resumePendingChats(){resumed++;},
    get recoverInflightRuns(){throw Error("Legacy startup recovery accessed");}};
  expect(()=>runWebStartupRecoveryBootstrap(web as any,()=>{nativeHandoff++;},resume=>scheduled.push(resume))).not.toThrow();
  expect(nativeHandoff).toBe(1);expect(scheduled).toHaveLength(1);expect(resumed).toBe(0);
  scheduled[0]();expect(resumed).toBe(1);
});

test("status observation never asks legacy recovery to mutate a missing status", () => {
  const context={getAgentStatus:()=>null,getExtensionWorkingState:()=>null,
    get recoverStaleInflightRun(){throw Error("Legacy recovery accessed from status GET");}};
  expect(buildAgentStatusSnapshot("web:idle",context as any,{includeDiagnostics:false}))
    .toMatchObject({status:"idle",state:"idle",data:null});
});

test("historical inflight markers cannot manufacture an active restart status", () => {
  initDatabase(); const chat="web:no-marker-status";
  storeChatMetadata(chat,"2026-01-01T00:00:00.000Z","Web");
  getDb().query("INSERT INTO chat_cursors(chat_jid,cursor_ts,inflight_prev_ts,inflight_message_id,inflight_started_at) VALUES(?,'','','old-input','2026-01-01T00:00:00.000Z')").run(chat);
  const before=getDb().serialize();
  const store=new AgentStatusStore({load(){},save(){},setAgentStatus(){},getAgentStatuses:()=>({})});
  expect(store.get(chat)).toBeNull();
  expect(getDb().serialize()).toEqual(before);
});

test("run inventory and stale clearing cannot use or mutate legacy execution markers", async () => {
  initDatabase(); const chat="web:operator-no-mirrors";
  storeChatMetadata(chat,"2026-01-01T00:00:00.000Z","Web");
  getDb().query("INSERT INTO chat_cursors(chat_jid,cursor_ts,inflight_prev_ts,inflight_message_id,inflight_started_at) VALUES(?,'','','old-input','2026-01-01T00:00:00.000Z')").run(chat);
  const before=getDb().serialize(); let updates=0;
  const control=new WebAgentControlPlaneService({defaultChatJid:chat,defaultAgentId:"default",json:(body:unknown,status=200)=>Response.json(body,{status}),
    agentPool:{listActiveChats:()=>[]},queuedFollowupLifecycle:{listQueuedStateItems:()=>[]},getAgentStatus:()=>({type:"thinking",turn_id:"native-turn"}),
    updateAgentStatus(){updates++;}} as any);
  const listed=await (await control.handleAgentRuns(new Request("http://fixture/agent/runs?chat_jid="+encodeURIComponent(chat)))).json();
  expect(listed.inflight).toEqual([]);expect(listed.preflight).toEqual([]);
  expect(listed.runs[0].inflight).toBeNull();
  const response=await control.handleAgentRunClearStale(new Request("http://fixture/agent/runs/clear-stale",{
    method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({chat_jid:chat})}));
  expect(response.status).toBe(409);expect(updates).toBe(0);
  expect(getDb().serialize()).toEqual(before);
});

test("retired web recovery methods are absent instead of no-op forwarding layers", () => {
  for(const name of ["skipFailedOnModelSwitch","retryFailedOnModelSwitch","recoverInflightRuns","recoverStaleInflightRun"])
    expect((WebChannel.prototype as any)[name]).toBeUndefined();
});

test("live draft buffers never persist a second restart-recovery payload", () => {
  let writes=0; const buffers=new Map<string,any>();
  const state={load(){},save(){writes++;},getAgentStatuses:()=>({}),setAgentStatus(){},setContextUsage(){},getContextUsage:()=>null,
    setDraftRecovery(){writes++;},getDraftRecovery(){throw Error("Legacy draft read");}};
  const service=new WebChannelRuntimeStateService({getAssistantName:()=>"Test",getChatCursor:()=>"",enqueue(){},async processChat(){}},
    {defaultAgentId:"default",stateKey:"draft-no-recovery"},{state,agentStatusStore:{load(){},update(){},get:()=>null,clearPersistedStatuses(){}},
      agentBuffers:{setPanelExpanded(){},isPanelExpanded:()=>false,updateBuffer:(id,panel,text,totalLines)=>buffers.set(id+panel,{text,totalLines}),
        getBuffer:(id,panel)=>buffers.get(id+panel)}});
  service.updateAgentStatus("web:chat",{type:"thinking",turn_id:"turn"});
  service.updateDraftBuffer("turn","live draft",1);
  expect(service.getBuffer("turn","draft")).toEqual({text:"live draft",totalLines:1});
  expect(writes).toBe(0);
  service.updateAgentStatus("web:chat",{type:"done",turn_id:"turn"});
  expect(writes).toBe(0);
});
