import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { parseStatusRetryAt, getStatusRetryCountdownLabel } from "../../../web/src/ui/status-duration.js";
import { createNativeTurnView } from "../../../src/channels/web/agent/native-turn-view.js";

test("public conversation frames feed existing thought, draft and nested tool UI events", () => {
  const database = new Database(":memory:");
  try {
    database.exec(`CREATE TABLE piclaw_durable_bindings_v1(operation_id,source_seq,source_id,chat_jid,conversation_id,submission_id);
      CREATE TABLE service_effect_s01_operations(operation_id,primary_source_seq);
      CREATE TABLE messages(id,chat_jid,thread_id);
      INSERT INTO service_effect_s01_operations VALUES('op',1);
      INSERT INTO messages VALUES('input','chat',NULL);
      INSERT INTO piclaw_durable_bindings_v1 VALUES('op',1,'input','chat',2,3);`);
    const events: { event: string; data: Record<string, unknown> }[] = [];
    const buffers: string[] = [];
    const render = createNativeTurnView(database, { broadcastEvent(event, data) { events.push({ event, data }); }, updateThoughtBuffer(_turn, text) { buffers.push(text); } }, "chat");
    const view = { conversation: { id: 2 }, entries: [], docs: { "pi.live": { run: { taskId: 4, inputs: [3] }, generation: { message: { content: [{ type: "thinking", thinking: "visible reasoning" }, { type: "text", text: "partial reply" }] } }, nestedTools: [{ callId: "parent/read", name: "read", status: "running", output: "progress", arguments: { path: "fixture" } }] } } };
    render(view);
    expect(events.some(e => e.event === "agent_thought" && e.data.text === "visible reasoning")).toBe(true);
    expect(events.some(e => e.event === "agent_draft" && e.data.text === "partial reply")).toBe(true);
    expect(events.some(e => e.event === "agent_status" && e.data.tool_name === "read" && e.data.output_preview === "progress")).toBe(true);
    expect(buffers).toEqual(["visible reasoning"]);
    expect(events.every(e => e.data.chat_jid === "chat" && e.data.turn_id === "durable:1")).toBe(true);
    const size = events.length;
    render(view);
    expect(events.length).toBe(size);
  } finally { database.close(); }
});


test("coalesced completed entries recover thoughts and final tool output without clearing the pane", () => {
  const database = new Database(":memory:");
  try {
    database.exec(`CREATE TABLE piclaw_durable_bindings_v1(operation_id,source_seq,source_id,chat_jid,conversation_id,submission_id);
      CREATE TABLE service_effect_s01_operations(operation_id,primary_source_seq); CREATE TABLE messages(id,chat_jid,thread_id);
      INSERT INTO service_effect_s01_operations VALUES('op',1); INSERT INTO messages VALUES('input','chat',NULL);
      INSERT INTO piclaw_durable_bindings_v1 VALUES('op',1,'input','chat',2,3);`);
    const events: any[] = [];
    const render = createNativeTurnView(database, { broadcastEvent(event, data) { events.push({event,data}); } }, "chat");
    const view: any = { conversation: {id:2}, entries: [
      {kind:"host.accepted",data:{operationId:"op"}},
      {kind:"pi.assistant",model:[{role:"assistant",content:[{type:"thinking",thinking:"Recorded public thought"},{type:"toolCall",id:"call",name:"bash",arguments:{command:"printf pane-proof"}}]}]},
      {kind:"pi.tool-result",model:[{role:"toolResult",toolCallId:"call",toolName:"bash",content:[{type:"text",text:"pane-proof"}]}]}
    ], docs:{"pi.live":{run:{taskId:4,inputs:[3]},generation:{attempt:0}}}};
    render(view);
    expect(events.some(e => e.event === "agent_thought" && e.data.text === "Recorded public thought")).toBe(true);
    const statuses = events.filter(e => e.event === "agent_status");
    expect(statuses.at(-1).data.tool_name).toBe("bash");
    expect(statuses.at(-1).data.tool_args).toEqual({command:"printf pane-proof"});
    expect(statuses.at(-1).data.output_preview).toBe("pane-proof");
    expect(statuses.at(-1).data.last_activity).toBe(true);
    const size = events.length;
    render(view);
    expect(events.length).toBe(size);
  } finally {database.close();}
});

test("native retries use the existing intent/countdown panel after tool output and clear cleanly", () => {
  const database=new Database(":memory:");
  try {
    database.exec(`CREATE TABLE piclaw_durable_bindings_v1(operation_id,source_seq,source_id,chat_jid,conversation_id,submission_id);
      CREATE TABLE service_effect_s01_operations(operation_id,primary_source_seq);
      CREATE TABLE messages(id,chat_jid,thread_id);
      INSERT INTO service_effect_s01_operations VALUES('op',1);
      INSERT INTO messages VALUES('input','chat',NULL);
      INSERT INTO piclaw_durable_bindings_v1 VALUES('op',1,'input','chat',2,3);`);
    const events:any[]=[],channel:any={updateAgentStatus:(...v:any[])=>events.push(["status",...v]),broadcastEvent:()=>{},setThoughtBuffer:()=>{},setDraftBuffer:()=>{}};
    const render=createNativeTurnView(database,channel,"chat");
    const pi:any={run:{taskId:1,inputs:[3]},generation:{attempt:1}};
    const view:any={conversation:{id:2},docs:{"pi.live":pi},entries:[]};
    render(view);
    pi.tools=[{callId:"tool",name:"bash",arguments:{command:"true"},status:"done",output:"kept tool output"}];
    render(view);
    pi.tools=[];
    pi.generation={attempt:1,retry:{at:Date.now()+2000,error:"private provider payload must never reach UI"}};
    render(view);
    const retry=events.filter(v=>v[0]==="status").at(-1)[2];
    expect(retry.type).toBe("intent");
    expect(retry.title).toContain("retry 1");
    expect(retry.retry_at).toBe(new Date(pi.generation.retry.at).toISOString());
    expect(parseStatusRetryAt(retry)).toBe(pi.generation.retry.at);
    expect(getStatusRetryCountdownLabel(retry,pi.generation.retry.at-1000)).toBeTruthy();
    expect(JSON.stringify(retry)).not.toContain("private provider payload");
    expect(retry.output_preview).toContain("kept tool output");
    const n=events.length;render(view);expect(events.length).toBe(n);
    pi.generation={attempt:2};render(view);
    const resumed=events.filter(v=>v[0]==="status").at(-1)[2];
    expect(resumed.retry_at).toBeUndefined();
    expect(resumed.output_preview).toContain("kept tool output");
    delete pi.run;render(view);
    expect(events.filter(v=>v[0]==="status").at(-1)[2].retry_at).toBeUndefined();
  } finally {database.close();}
});

test("native retry projection tolerates unavailable delay metadata before the first tool",()=>{
  const database=new Database(":memory:");
  try {
    database.exec(`CREATE TABLE piclaw_durable_bindings_v1(operation_id,source_seq,source_id,chat_jid,conversation_id,submission_id);
      CREATE TABLE service_effect_s01_operations(operation_id,primary_source_seq);
      CREATE TABLE messages(id,chat_jid,thread_id);
      INSERT INTO service_effect_s01_operations VALUES('op',1);
      INSERT INTO messages VALUES('input','chat',NULL);
      INSERT INTO piclaw_durable_bindings_v1 VALUES('op',1,'input','chat',2,3);`);
    const events:any[]=[],render=createNativeTurnView(database,{broadcastEvent:(event,data)=>events.push({event,data})},"chat");
    const pi:any={run:{taskId:1,inputs:[3]},generation:{attempt:1,retry:{at:NaN,error:"opaque signature never displayed"}}};
    render({conversation:{id:2},entries:[],docs:{"pi.live":pi}});
    let status=events.filter(e=>e.event==="agent_status").at(-1).data;
    expect(status.type).toBe("intent");expect(status.retry_at).toBeUndefined();
    expect(JSON.stringify(events)).not.toContain("opaque signature");
    pi.generation={attempt:2};render({conversation:{id:2},entries:[],docs:{"pi.live":pi}});
    status=events.filter(e=>e.event==="agent_status").at(-1).data;
    expect(status.type).toBe("thinking");expect(status.retry_at).toBeUndefined();
  } finally {database.close();}
});
