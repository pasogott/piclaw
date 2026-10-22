import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
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
