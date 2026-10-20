import { isolatedApplicationTest } from "./src/isolated-application-test.js";
import "./src/test-guard.js";
import { cpSync, symlinkSync, realpathSync } from "node:fs";
import { applicationAddonSourceProfiles } from "../../runtime/durable-engine/src/host-extension-catalog.js";
const applicationTest = isolatedApplicationTest(import.meta.url);
import { expect } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { digest, selectRecent } from "../../runtime/scripts/helpers/recent-context.js";
import { captureLegacyTimeline } from "../../runtime/durable-engine/src/application-legacy-timeline.js";
const cli = join(import.meta.dir,"../../runtime/scripts/migrate-recent-context.ts");
const asOf = "2026-01-02T00:00:00.000Z", timestamp = Date.parse(asOf);
const assistant = (text = "answer", stopReason = "stop") => ({role:"assistant",content:[{type:"text",text}],api:"openai-completions",provider:"fixture",model:"fixture",stopReason,timestamp,usage:{input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}});
const entries: any[] = [{type:"message",id:"u",parentId:null,timestamp:asOf,message:{role:"user",content:"question",timestamp}}, {type:"message",id:"a",parentId:"u",timestamp:asOf,message:assistant()}];
function fixture() {
 const root = mkdtempSync(join(process.env.PICLAW_WORKSPACE!,"operator-context-")), workspace = join(root,"workspace"), agent = join(root,"agent");
 mkdirSync(join(workspace,".piclaw/store"),{recursive:true}); mkdirSync(agent);
 const dbPath = join(workspace,".piclaw/store/messages.db");
 const path = join(root,"source.jsonl"); writeFileSync(path,[{type:"session",id:"source",version:3,cwd:workspace,timestamp:asOf},...entries].map(e=>JSON.stringify(e)).join("\n")+"\n");
 const selected = selectRecent(entries,"a",asOf);
 const manifest:any = {version:1,workspace,agentDir:agent,schemaSHA256:"",timeline:null,sources:[{chatJid:"web:fixture",branchId:"branch",path,sha256:digest(readFileSync(path)),sourceSessionId:"source",selectedLeaf:"a",asOf,payloadSHA256:digest(JSON.stringify(selected.messages)),sourceEntryIds:selected.sourceEntryIds}],archives:[]};
 const env={...process.env,PICLAW_WORKSPACE:workspace,PICLAW_PI_AGENT_DIR:agent,PI_CODING_AGENT_DIR:agent};
 for(const key of ["PICLAW_STORE","PICLAW_DATA","PICLAW_RUNTIME_ROOT","PICLAW_DB_IN_MEMORY"]) delete env[key];
 const init=Bun.spawnSync([process.execPath,"-e",`const d=await import(${JSON.stringify(join(import.meta.dir,"../../runtime/src/db.ts"))}); d.initDatabase();d.storeChatMetadata("web:fixture",new Date().toISOString());const media=d.createMedia("historic.bin","application/octet-stream",new Uint8Array([0,255,1,10]),null,{fixture:true});
for(const [id,content,bot] of [["historic-user","historic question",false],["historic-assistant","historic answer",true]]) {
 const row=d.storeMessage({id,chat_jid:"web:fixture",sender:bot?"assistant":"user",sender_name:bot?"Assistant":"User",content,timestamp:${JSON.stringify(asOf)},is_from_me:bot,is_bot_message:bot});
 if(!bot)d.attachMediaToMessage(row,[media]);
}d.closeDatabase();`],{env,stdout:"pipe",stderr:"pipe",timeout:15000});
 if(init.exitCode) throw Error(init.stderr.toString());
 const actual=new Database(dbPath);
 manifest.sources[0].branchId=(actual.query("SELECT branch_id FROM chat_branches WHERE chat_jid='web:fixture'").get() as any).branch_id;
 manifest.schemaSHA256=digest(JSON.stringify(actual.query("SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name").all()));
 manifest.timeline=captureLegacyTimeline(actual,()=>{});actual.close();
 const manifestPath = join(root,"manifest.json"), save = () => writeFileSync(manifestPath,JSON.stringify(manifest)); save();
 const args = ["--workspace",workspace,"--agent-dir",agent,"--manifest",manifestPath];
 const run = (more:string[] = []) => Bun.spawnSync([process.execPath,"--preload",join(import.meta.dir,"src/test-guard.ts"),cli,...args,...more],{env:{...process.env,PICLAW_STORE:join(root,"shadow-store"),PICLAW_DATA:join(root,"shadow-data"),PICLAW_DB_IN_MEMORY:"1",HOME:join(root,"home"),PI_CODING_AGENT_DIR:agent},stdout:"pipe",stderr:"pipe",timeout:15000});
 return {root,workspace,agent,dbPath,path,manifest,save,run,lock:join(workspace,".piclaw/store/runtime.lock")};
}


function inventory(root:string):any[] { return readdirSync(root,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)).flatMap(e=>e.isDirectory()?inventory(join(root,e.name)).map(x=>({path:e.name+"/"+x.path,sha256:x.sha256})):[{path:e.name,sha256:digest(readFileSync(join(root,e.name)))}]); }
applicationTest("actual CLI apply: all 23 installed, synthetic built-in OAuth, archive preservation and retry", async()=>{
 const f=fixture(); try {
  mkdirSync(join(f.root,"home"));
  const source=realpathSync("/workspace/tmp/durable-smith-addons");
  const rootModules=realpathSync(join(import.meta.dir,"../../node_modules"));
  const catDeps=realpathSync("/tmp/durable-catalog-test-deps/node_modules");
  const nativeDeps=realpathSync(join(import.meta.dir,"node_modules"));
  expect(Object.keys(applicationAddonSourceProfiles)).toHaveLength(23);
  for(const profile of Object.values(applicationAddonSourceProfiles)) {
   const pkg=join(f.workspace,".pi/extensions/node_modules",profile.name);
   cpSync(join(source,"addons",profile.name.replace("@rcarmo/piclaw-addon-","")),pkg,{recursive:true,filter:p=>!p.split("/").includes("node_modules")});
   const deps=join(pkg,"node_modules");mkdirSync(deps,{recursive:true});
   for(const modules of [nativeDeps,catDeps,rootModules]) for(const entry of readdirSync(modules)) {
    if(entry.startsWith("."))continue;
    if(entry.startsWith("@")){mkdirSync(join(deps,entry),{recursive:true});for(const child of readdirSync(join(modules,entry)))if(!existsSync(join(deps,entry,child)))symlinkSync(join(modules,entry,child),join(deps,entry,child));}
    else if(!existsSync(join(deps,entry)))symlinkSync(join(modules,entry),join(deps,entry));
   }
  }
  writeFileSync(join(f.agent,"auth.json"),JSON.stringify({"openai-codex":{type:"oauth",access:"synthetic-only-not-a-vendor-token",refresh:"synthetic-refresh",accountId:"fixture-account",expires:Date.now()+86400000}}));
  writeFileSync(join(f.workspace,"AGENTS.md"),"Current synthetic operator instructions. Never use recorded historical policy.");
  const archives=join(f.workspace,".piclaw/data/sessions");mkdirSync(join(archives,"nested"),{recursive:true});
  cpSync(f.path,join(archives,"nested","source.jsonl"));
  writeFileSync(join(archives,"retained.bin"),Buffer.from([0,255,1,10]));
  f.manifest.archives=inventory(archives);f.save();
  const before=new Database(f.dbPath);const timeline=captureLegacyTimeline(before,()=>{});
  const snapshot=(db:Database)=>Object.fromEntries(["messages","media","message_media","chat_branches"].map(table=>[table,db.query(`SELECT rowid,* FROM ${table}${table==="chat_branches"?" WHERE chat_jid='web:fixture'":""} ORDER BY rowid`).all()]));
  const historic=snapshot(before);
  expect(historic.messages).toHaveLength(2);expect(historic.media).toHaveLength(1);expect(historic.message_media).toHaveLength(1);
  const historicHash=digest(JSON.stringify(historic));before.close();
  const dest=join(f.root,"relocated");
  const result=Bun.spawnSync([process.execPath,"--preload",join(import.meta.dir,"src/test-guard.ts"),cli,"--workspace",f.workspace,"--agent-dir",f.agent,"--manifest",join(f.root,"manifest.json"),"--apply","--relocate-archives",dest],{env:{...process.env,HOME:join(f.root,"home"),PICLAW_STORE:join(f.root,"shadow-store"),PICLAW_DATA:join(f.root,"shadow-data"),PI_CODING_AGENT_DIR:f.agent},stdout:"pipe",stderr:"pipe",timeout:30000});
  // Preservation and cleanup-uncertainty receipts are useful even if construction blocks.
  expect(inventory(dest)).toEqual(f.manifest.archives);
  expect(existsSync(archives)).toBe(false);
  if(result.exitCode){expect(existsSync(f.lock)).toBe(true);}

  expect(result.exitCode,result.stderr.toString()+result.stdout.toString()).toBe(0);
  expect(JSON.parse(result.stdout.toString().trim().split("\n").at(-1)!)).toMatchObject({mode:"applied",copies:1,timelinePreserved:true});
  expect(inventory(dest)).toEqual(f.manifest.archives);expect(existsSync(archives)).toBe(false);
  expect(digest(readFileSync(f.path))).toBe(f.manifest.sources[0].sha256);
  expect(existsSync(f.lock)).toBe(false);
  const after=new Database(f.dbPath);expect(captureLegacyTimeline(after,()=>{})).toEqual(timeline);
  expect(snapshot(after)).toEqual(historic);expect(digest(JSON.stringify(snapshot(after)))).toBe(historicHash);
  const history=()=>after.query("SELECT * FROM entries WHERE json_extract(record,'$.kind') IN ('app.recent-history-copy','app.operator-migration') ORDER BY id").all();
  const imported=history();expect(imported).toHaveLength(3);
  expect(after.query("SELECT count(*) AS n FROM entries WHERE json_extract(record,'$.kind')='app.recent-history-copy'").get()).toEqual({n:2});
  after.close();
  const reopen=join(f.root,"reopen.ts");
  writeFileSync(reopen,`
const base=${JSON.stringify(join(import.meta.dir,"../../runtime"))};
const d=await import(base+"/src/db.ts");d.initDatabase();
const {acquireRuntimeLock}=await import(base+"/src/runtime/single-instance.ts");
const owner=acquireRuntimeLock({lockPath:${JSON.stringify(f.lock)},strictOwnership:true,disabled:false,maintenance:true});
let backend;
try {
 const {createRuntimeModelServices}=await import(base+"/src/agent-pool/model-services.ts");
 const services=await createRuntimeModelServices({agentDir:${JSON.stringify(f.agent)}});
 const {installRuntimeModelExecutor}=await import(base+"/src/extensions/model-execution-runtime.ts");installRuntimeModelExecutor(services.modelRuntime);
 const {registerGitHubCopilotDynamicModels}=await import(base+"/src/extensions/github-copilot-dynamic-models.ts");registerGitHubCopilotDynamicModels(services.modelRuntime);
 const {createDefaultApplicationRuntime}=await import(base+"/durable-engine/src/default-application-runtime.ts");
 backend=await createDefaultApplicationRuntime(owner,async()=>services);
 backend.stop();await backend.close();backend=undefined;
 const {Harness,AgentDoc,createRegistry,defineDoc}=await import(base+"/durable-engine/qualification/durable.ts");
 const {createModels}=await import(base+"/durable-engine/qualification/ai.ts");
 const {BACKGROUND_CONTEXT:context}=await import(base+"/durable-engine/qualification/context.ts");
 const {SqliteStorage}=await import(base+"/durable-engine/qualification/sqlite.ts");
 const {BunSqliteDatabase}=await import(base+"/durable-engine/src/bun-sqlite.ts");
 const root=d.getDb();
 const h=await Harness.open(await SqliteStorage.open(new BunSqliteDatabase(${JSON.stringify(f.dbPath)},{root,assertOwner:()=>owner.assertCurrentOwner(),fenceTransactions:true})),{models:createModels(),registry:createRegistry()},context);
 try {
 const token=defineDoc({kind:"app.application-conversations",version:1,scope:"conversation",history:"latest",fork:"initial",initial:()=>({version:1,domain:"",bindings:[]})});
 const mapping=await h.commit(async tx=>JSON.parse(JSON.stringify(await tx.doc(token,1))),context);
 const binding=mapping.bindings.find(b=>b.chatJid==="web:fixture" && b.branchId===${JSON.stringify(f.manifest.sources[0].branchId)});
 const conversation=await h.conversation(binding.conversationId,context);
 const messages=(await conversation.context(context)).messages;
 const doc=await h.commit(async tx=>JSON.parse(JSON.stringify(await tx.doc(AgentDoc,binding.conversationId))),context);
 console.log(JSON.stringify({messages,doc}));
 } finally {await h.close(context);}
} finally {if(backend){backend.stop();await backend.close();}d.closeDatabase();owner.assertCurrentOwner();owner.markSafeReleaseOnExit();owner.release();}
`);
  const opened=Bun.spawnSync([process.execPath,"--preload",join(import.meta.dir,"src/test-guard.ts"),reopen],{env:{...process.env,PICLAW_WORKSPACE:f.workspace,PICLAW_PI_AGENT_DIR:f.agent,PI_CODING_AGENT_DIR:f.agent,PICLAW_STORE:join(f.workspace,".piclaw/store"),PICLAW_DATA:join(f.workspace,".piclaw/data"),PICLAW_DB_IN_MEMORY:"0",HOME:join(f.root,"home")},stdout:"pipe",stderr:"pipe",timeout:30000});
  expect(opened.exitCode,opened.stderr.toString()).toBe(0);
  const receipt=JSON.parse(opened.stdout.toString().trim().split("\n").at(-1)!);
  expect(receipt.messages).toEqual(selectRecent(entries,"a",asOf).messages);
  expect(JSON.stringify(receipt.doc)).toContain("Current synthetic operator");
  expect(existsSync(f.lock)).toBe(false);
  const reopened=new Database(f.dbPath);expect(snapshot(reopened)).toEqual(historic);
  expect(reopened.query("SELECT * FROM entries WHERE json_extract(record,'$.kind') IN ('app.recent-history-copy','app.operator-migration') ORDER BY id").all()).toEqual(imported);reopened.close();
  expect(inventory(dest)).toEqual(f.manifest.archives);
  const retry=f.run(["--apply"]);expect(retry.exitCode).toBe(1);expect(retry.stderr.toString()).toMatch(/Schema digest mismatch|fresh SDK target/);expect(existsSync(f.lock)).toBe(false);
 }finally{rmSync(f.root,{recursive:true,force:true});}
},60000);
