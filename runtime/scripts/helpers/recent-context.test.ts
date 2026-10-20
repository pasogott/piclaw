import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { digest, selectRecent } from "./recent-context.js";
import { captureLegacyTimeline } from "../../durable-engine/src/application-legacy-timeline.js";
const cli = join(import.meta.dir,"../migrate-recent-context.ts");
const asOf = "2026-01-02T00:00:00.000Z", timestamp = Date.parse(asOf);
const assistant = (text = "answer", stopReason = "stop") => ({role:"assistant",content:[{type:"text",text}],api:"openai-completions",provider:"fixture",model:"fixture",stopReason,timestamp,usage:{input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}});
const entries: any[] = [{type:"message",id:"u",parentId:null,timestamp:asOf,message:{role:"user",content:"question",timestamp}}, {type:"message",id:"a",parentId:"u",timestamp:asOf,message:assistant()}];
function fixture() {
 const root = mkdtempSync(join(tmpdir(),"operator-context-")), workspace = join(root,"workspace"), agent = join(root,"agent");
 mkdirSync(join(workspace,".piclaw/store"),{recursive:true}); mkdirSync(agent);
 const dbPath = join(workspace,".piclaw/store/messages.db"), db = new Database(dbPath);
 db.exec("CREATE TABLE messages(id TEXT,chat_jid TEXT,content TEXT); INSERT INTO messages VALUES ('m','web:fixture','original'); CREATE TABLE chat_branches(chat_jid TEXT,branch_id TEXT,archived_at TEXT); INSERT INTO chat_branches VALUES ('web:fixture','branch',NULL)");
 const path = join(root,"source.jsonl"); writeFileSync(path,[{type:"session",id:"source",version:3,cwd:workspace,timestamp:asOf},...entries].map(e=>JSON.stringify(e)).join("\n")+"\n");
 const selected = selectRecent(entries,"a",asOf);
 const manifest:any = {version:1,workspace,agentDir:agent,schemaSHA256:digest(JSON.stringify(db.query("SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name").all())),timeline:captureLegacyTimeline(db,()=>{}),sources:[{chatJid:"web:fixture",branchId:"branch",path,sha256:digest(readFileSync(path)),sourceSessionId:"source",selectedLeaf:"a",asOf,payloadSHA256:digest(JSON.stringify(selected.messages)),sourceEntryIds:selected.sourceEntryIds}],archives:[]}; db.close();
 const manifestPath = join(root,"manifest.json"), save = () => writeFileSync(manifestPath,JSON.stringify(manifest)); save();
 const args = ["--workspace",workspace,"--agent-dir",agent,"--manifest",manifestPath];
 const run = (more:string[] = []) => Bun.spawnSync([process.execPath,cli,...args,...more],{env:{...process.env,PICLAW_STORE:"/must-not-use",PICLAW_DATA:"/must-not-use",PICLAW_DB_IN_MEMORY:"1"},stdout:"pipe",stderr:"pipe"});
 return {root,workspace,agent,dbPath,path,manifest,save,run,lock:join(workspace,".piclaw/store/runtime.lock")};
}
test("Root public projection: actual IDs, latest complete unit, no historical systems",()=>{
 const selected=selectRecent([...entries,{type:"message",id:"incomplete",parentId:"a",timestamp:asOf,message:{role:"user",content:"unfinished",timestamp}}] as any,"incomplete",asOf);
 expect(selected.sourceEntryIds).toEqual(["u","a"]); expect(selected.messages.length).toBe(2);
 expect(()=>selectRecent([entries[0],{...entries[1],message:assistant("x".repeat(8*1024*1024))}],"a",asOf)).toThrow("never truncate");
});
test("read-only default preflight leaves DB/source/manifest byte-identical and clears inherited paths",()=>{
 const f=fixture(); try { const paths=[f.dbPath,f.path,join(f.root,"manifest.json")], before=paths.map(p=>digest(readFileSync(p))); const result=f.run(); expect(result.exitCode).toBe(0); expect(paths.map(p=>digest(readFileSync(p)))).toEqual(before); expect(existsSync(f.lock)).toBe(false); }finally{rmSync(f.root,{recursive:true,force:true});}
});
for (const kind of ["source-tamper","payload-tamper","foreign-scope","live-owner","stale-owner","archive-path"]) test(kind+" fails closed preserving raw",()=>{
 const f=fixture(); try {
  const raw=readFileSync(f.path);
  if(kind==="source-tamper") writeFileSync(f.path,Buffer.concat([raw,Buffer.from(" ")]));
  if(kind==="payload-tamper") {f.manifest.sources[0].payloadSHA256="0".repeat(64);f.save();}
  if(kind==="foreign-scope") {f.manifest.sources[0].chatJid="web:foreign";f.save();}
  if(kind.endsWith("owner")) writeFileSync(f.lock,JSON.stringify({pid:kind==="live-owner"?process.pid:99999999}));
  const before=readFileSync(f.dbPath), sourceBefore=readFileSync(f.path);
  const result=f.run(kind==="archive-path"?["--apply","--relocate-archives",join(f.workspace,"bad")]:["--apply"]);
  expect(result.exitCode).toBe(1); expect(readFileSync(f.dbPath)).toEqual(before);expect(readFileSync(f.path)).toEqual(sourceBefore);
  if(kind.endsWith("owner"))expect(existsSync(f.lock)).toBe(true);
 }finally{rmSync(f.root,{recursive:true,force:true});}
});

test("real application fixture apply uses factory, current workspace instructions, and verified close",()=>{
 const f=fixture(); try {
  rmSync(f.dbPath);
  const env={...process.env,PICLAW_WORKSPACE:f.workspace,PICLAW_PI_AGENT_DIR:f.agent,PI_CODING_AGENT_DIR:f.agent};
  for(const key of ["PICLAW_STORE","PICLAW_DATA","PICLAW_RUNTIME_ROOT","PICLAW_DB_IN_MEMORY"]) delete env[key];
  const dbModule=join(import.meta.dir,"../../src/db.ts");
  const init=Bun.spawnSync([process.execPath,"-e",`const d=await import(${JSON.stringify(dbModule)}); d.initDatabase();d.storeChatMetadata("web:fixture",new Date().toISOString());d.closeDatabase();`],{env,stdout:"pipe",stderr:"pipe"});
  if(init.exitCode) throw Error(init.stderr.toString());
  writeFileSync(join(f.workspace,"AGENTS.md"),"OWNED_CURRENT_WORKSPACE_POLICY");
  const db=new Database(f.dbPath);
  f.manifest.sources[0].branchId=(db.query("SELECT branch_id FROM chat_branches WHERE chat_jid='web:fixture'").get() as any).branch_id;
  f.manifest.schemaSHA256=digest(JSON.stringify(db.query("SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name").all()));f.manifest.timeline=captureLegacyTimeline(db,()=>{});db.close();f.save();
  const args=["--workspace",f.workspace,"--agent-dir",f.agent,"--manifest",join(f.root,"manifest.json"),"--apply"];
  const model={provider:"synthetic",id:"approved",name:"Approved",api:"openai-completions",baseUrl:"https://invalid.invalid",input:["text"],reasoning:false,contextWindow:10000,maxTokens:1000,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}};
  const code=`const {main}=await import(${JSON.stringify(cli)}); const model=${JSON.stringify(model)}; await main(${JSON.stringify(args)},{getModels:async()=>({modelRuntime:{getPhysicalModel:()=>model},modelRegistry:{getAvailable:()=>[model]}})});`;
  const result=Bun.spawnSync([process.execPath,"-e",code],{env,stdout:"pipe",stderr:"pipe"});
  if(result.exitCode) throw Error(result.stderr.toString());
  expect(existsSync(f.lock)).toBe(false);
  const check=new Database(f.dbPath,{readonly:true});
  expect((check.query("SELECT count(*) AS n FROM entries WHERE json_extract(record,'$.kind')='app.recent-history-copy'").get() as any).n).toBe(2);
  expect(JSON.stringify(check.query("SELECT content FROM document_revisions").all())).toContain("OWNED_CURRENT_WORKSPACE_POLICY");check.close();
 }finally{rmSync(f.root,{recursive:true,force:true});}
},30000);

test("WAL-mode dry run creates no WAL/SHM; existing sidecars refuse",()=>{
 const f=fixture();try {
  const db=new Database(f.dbPath);db.exec("PRAGMA journal_mode=WAL");db.close();
  const dir=join(f.workspace,".piclaw/store"), before=readdirSync(dir), bytes=readFileSync(f.dbPath);
  expect(f.run().exitCode).toBe(0);expect(readdirSync(dir)).toEqual(before);expect(readFileSync(f.dbPath)).toEqual(bytes);
  writeFileSync(f.dbPath+"-wal","unverified"); expect(f.run().exitCode).toBe(1);expect(readFileSync(f.dbPath+"-wal","utf8")).toBe("unverified");
 }finally{rmSync(f.root,{recursive:true,force:true});}
});
test("explicit one-shot relocation preserves every raw archive when application initialization fails",()=>{
 const f=fixture(); try {
  const sessions=join(f.workspace,".piclaw/data/sessions"), archive=join(f.root,"retained-raw");mkdirSync(sessions,{recursive:true});
  const bytes=Buffer.from("incomplete/failed/raw original bytes\n");writeFileSync(join(sessions,"raw.jsonl"),bytes);
  f.manifest.archives=[{path:"raw.jsonl",sha256:digest(bytes)}];f.save();
  const result=f.run(["--apply","--relocate-archives",archive]);
  // Minimal preflight fixture deliberately cannot pass real application's schema init.
  expect(result.exitCode).toBe(1);expect(readFileSync(join(archive,"raw.jsonl"))).toEqual(bytes);expect(existsSync(f.lock)).toBe(true);
  const again=f.run(["--apply","--relocate-archives",archive]);expect(again.exitCode).toBe(1);expect(readFileSync(join(archive,"raw.jsonl"))).toEqual(bytes);
 }finally{rmSync(f.root,{recursive:true,force:true});}
});
test("latest public compaction checkpoint, twenty complete turns, seven days, actual provenance",()=>{
 const all:any[]=[...entries,{type:"compaction",id:"checkpoint",parentId:"a",timestamp:asOf,summary:"retained summary",firstKeptEntryId:"none",tokensBefore:100}];
 let parent="checkpoint";
 for(let n=0;n<23;n++) {
  const u={...entries[0],id:"u"+n,parentId:parent},a={...entries[1],id:"a"+n,parentId:u.id};all.push(u,a);parent=a.id;
 }
 const selected=selectRecent(all,parent,asOf);
 expect(selected.completedTurns).toBe(20);expect(selected.sourceEntryIds[0]).toBe("checkpoint");expect(selected.sourceEntryIds[1]).toBe("u3");
 expect(selected.messages.some(m=>m.role==="system")).toBe(false);
 const expired=entries.map(e=>({...e,message:{...e.message,timestamp:timestamp-8*86400000}}));expect(selectRecent(expired,"a",asOf).selection).toBe("empty");
});

for (const mutation of [
 (m:any)=>({...m,content:null}),
 (m:any)=>({...m,usage:{}}),
 (m:any)=>({...m,extra:NaN}),
 (m:any)=>({...m,content:[{type:"toolCall",id:"call",name:"tool",arguments:{}}],stopReason:"toolUse"}),
]) test("malformed/incomplete unit is isolated; later complete unit survives",()=>{
 const broken={...entries[1],message:mutation(assistant())};
 const later=[{...entries[0],id:"u2",parentId:"a"},{...entries[1],id:"a2",parentId:"u2"}];
 expect(selectRecent([entries[0],broken] as any,"a",asOf).messages).toEqual([]);
 expect(selectRecent([entries[0],broken,...later] as any,"a2",asOf).sourceEntryIds).toEqual(["u2","a2"]);
});
test("modern optional payload remains exact",()=>{
 const message={...assistant(),responseId:"opaque",content:[{type:"text",text:"unchanged",textSignature:"signature"}],extra:{retained:true}};
 expect(selectRecent([entries[0],{...entries[1],message}] as any,"a",asOf).messages[1]).toEqual(message);
});
