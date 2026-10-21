import { repoRoot } from "./src/repo-root.js";
import { isolatedApplicationTest } from "./src/isolated-application-test.js";
import "./src/test-guard.js";
import { cpSync, symlinkSync, realpathSync, readlinkSync } from "node:fs";
import { applicationAddonSourceProfiles } from "../../runtime/durable-engine/src/host-extension-catalog.js";
const applicationTest = isolatedApplicationTest(import.meta.url);
import { expect } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { digest, selectRecent } from "../../runtime/scripts/helpers/recent-context.js";
import { captureLegacyTimeline } from "../../runtime/durable-engine/src/application-legacy-timeline.js";
const packageRoot = process.env.DURABLE_REHEARSAL_PACKAGE_ROOT;
const runtimeRoot = packageRoot ? join(realpathSync(packageRoot),"runtime") : join(import.meta.dir,"../../runtime");
const artifactReceipt = process.env.DURABLE_REHEARSAL_ARTIFACT_RECEIPT;
const cli = join(runtimeRoot,"scripts/migrate-recent-context.ts");
// Fixture-only helpers may use source, but never a different revision's bytes.
if (packageRoot) for (const relative of ["scripts/helpers/recent-context.ts", "durable-engine/src/application-legacy-timeline.ts", "durable-engine/src/host-extension-catalog.ts"]) {
 const source = join(import.meta.dir,"../../runtime",relative), packaged = join(runtimeRoot,relative);
 if (!existsSync(packaged) || digest(readFileSync(source)) !== digest(readFileSync(packaged))) throw Error(`Packaged helper mismatch: ${relative}`);
}
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
 const init=Bun.spawnSync([process.execPath,"-e",`const d=await import(${JSON.stringify(join(runtimeRoot,"src/db.ts"))}); d.initDatabase();d.storeChatMetadata("web:fixture",new Date().toISOString());const media=d.createMedia("historic.bin","application/octet-stream",new Uint8Array([0,255,1,10]),null,{fixture:true});
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
// Dependency trees are immutable references, never followed or copied into rollback backups.
function rollbackInventory(root:string):any[] {
 return readdirSync(root,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)).flatMap(e=>{
  const p=join(root,e.name);
  if(e.isSymbolicLink()) return [{path:e.name,ref:readlinkSync(p)}];
  if(e.name==="node_modules") return [{path:e.name,ref:realpathSync(p)}];
  if(e.isDirectory()) return [{path:e.name,directory:true},...rollbackInventory(p).map(x=>({...x,path:e.name+"/"+x.path}))];
  return [{path:e.name,sha256:digest(readFileSync(p))}];
 });
}
function restoreTree(baseline:string,target:string) {
 for(const e of readdirSync(target,{withFileTypes:true})) {
  if(e.name==="node_modules")continue;
  const p=join(target,e.name), b=join(baseline,e.name);
  if(!existsSync(b))rmSync(p,{recursive:true,force:true});
  else if(e.isDirectory()&&!e.isSymbolicLink())restoreTree(b,p);
 }
 cpSync(baseline,target,{recursive:true,dereference:false});
}
applicationTest('failed runtime initialization reports unknown commit/retained lock and exact archive location',async()=>{
 const f=fixture();try{
 const sessions=join(f.workspace,'.piclaw/data/sessions');mkdirSync(sessions,{recursive:true});writeFileSync(join(sessions,'original.jsonl'),'synthetic retained archive');f.manifest.archives=[{path:'original.jsonl',sha256:digest('synthetic retained archive')}];f.save();
 const dest=join(f.root,'retained'),wrapper=join(f.root,'fail-models.ts');writeFileSync(wrapper,`const{main}=await import(${JSON.stringify(cli)});try{await main(process.argv.slice(2),{getModels:async()=>{throw Error('synthetic model metadata failure')}});}catch{process.exitCode=1;}`);
 const r=Bun.spawnSync([process.execPath,'--preload',join(import.meta.dir,'src/test-guard.ts'),wrapper,'--workspace',f.workspace,'--agent-dir',f.agent,'--manifest',join(f.root,'manifest.json'),'--apply','--relocate-archives',dest],{env:{...process.env,HOME:join(f.root,'home'),PI_CODING_AGENT_DIR:f.agent},stdout:'pipe',stderr:'pipe',timeout:30000});
 expect(r.exitCode).toBe(1);const report=JSON.parse(r.stderr.toString().split('\n').find(l=>l.startsWith('{')&&l.includes('recovery-required'))!);expect(report).toMatchObject({phase:'runtime-initialization',runtimeInitializationStarted:true,commitCertainty:'unknown',runtimeLock:'retained',archives:{relocated:true,verified:true,original:sessions,retained:dest}});expect(existsSync(f.lock)).toBe(true);expect(readFileSync(join(dest,'original.jsonl'),'utf8')).toBe('synthetic retained archive');expect(existsSync(sessions)).toBe(false);
 }finally{rmSync(f.root,{recursive:true,force:true});}
});

applicationTest("actual CLI apply: all 23 installed, synthetic built-in OAuth, archive preservation and retry", async()=>{
 const f=fixture(); try {
  mkdirSync(join(f.root,"home"));
  if(packageRoot) {
  if(!artifactReceipt) throw Error("DURABLE_REHEARSAL_ARTIFACT_RECEIPT is required for packaged rehearsal");
  const receipt=JSON.parse(readFileSync(artifactReceipt,"utf8"));
  if(receipt.status!=="passed" || realpathSync(receipt.installedRoot)!==realpathSync(packageRoot)) throw Error("Artifact receipt root/status mismatch");
  const extensions=join(f.workspace,".pi/extensions");mkdirSync(extensions,{recursive:true});
  const rootManifest=JSON.parse(readFileSync(join(packageRoot,"package.json"),"utf8"));
  const dependencies:Record<string,string>={};
  for(const name of ["@earendil-works/pi-ai","@earendil-works/pi-agent-core","@earendil-works/pi-coding-agent","@sinclair/typebox"]) dependencies[name]=rootManifest.dependencies[name];
  expect(receipt.addons).toHaveLength(23);
  for(const addon of receipt.addons) {
   const archive=addon.archive ?? addon.path;
   if(!archive || !existsSync(archive) || digest(readFileSync(archive))!==addon.sha256) throw Error(`Invalid archive: ${addon.name}`);
   dependencies[addon.name]="file:"+archive;
  }
  writeFileSync(join(extensions,"package.json"),JSON.stringify({private:true,type:"module",dependencies}));
  const install=Bun.spawnSync([process.execPath,"install","--ignore-scripts"],{cwd:extensions,env:{...process.env,BUN_INSTALL:join(f.root,"bun")},stdout:"pipe",stderr:"pipe",timeout:90000});
  if(install.exitCode) throw Error(install.stderr.toString()+install.stdout.toString());
 } else {
 const source=repoRoot("ADDONS");
  const rootModules=realpathSync(join(repoRoot("CORE"),"node_modules"));
  const catDeps=realpathSync(process.env.DURABLE_CATALOG_DEPENDENCIES ?? join(source,"node_modules"));
  expect(Object.keys(applicationAddonSourceProfiles)).toHaveLength(23);
  for(const profile of Object.values(applicationAddonSourceProfiles)) {
   const pkg=join(f.workspace,".pi/extensions/node_modules",profile.name);
   cpSync(join(source,"addons",profile.name.replace("@rcarmo/piclaw-addon-","")),pkg,{recursive:true,filter:p=>!p.split("/").includes("node_modules")});
   const deps=join(pkg,"node_modules");mkdirSync(deps,{recursive:true});
   for(const modules of [rootModules, catDeps, ...Object.values(applicationAddonSourceProfiles).map(profile => join(source, "addons", profile.name.replace("@rcarmo/piclaw-addon-", ""), "node_modules")).filter(path => existsSync(path))]) for(const entry of readdirSync(modules)) {
    if(entry.startsWith("."))continue;
    if(entry.startsWith("@")){mkdirSync(join(deps,entry),{recursive:true});for(const child of readdirSync(join(modules,entry)))if(!existsSync(join(deps,entry,child)))symlinkSync(join(modules,entry,child),join(deps,entry,child));}
    else if(!existsSync(join(deps,entry)))symlinkSync(join(modules,entry),join(deps,entry));
   }
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
  // Exclusive synthetic checkpoint: every prior subprocess and SQLite handle has closed.
  const checkpoint=new Database(f.dbPath);
  checkpoint.exec("PRAGMA wal_checkpoint(TRUNCATE)");checkpoint.exec("PRAGMA journal_mode=DELETE");checkpoint.exec("BEGIN EXCLUSIVE");checkpoint.exec("COMMIT");checkpoint.close();
  const quiescent=()=>{expect(existsSync(f.lock)).toBe(false);for(const suffix of ["-wal","-shm"])expect(existsSync(f.dbPath+suffix)).toBe(false);};
  quiescent();
  const baseline=join(f.root,"immutable-baseline");mkdirSync(baseline);
  const roots={workspace:f.workspace,agent:f.agent};
  const inventories=Object.fromEntries(Object.entries(roots).map(([name,path])=>[name,rollbackInventory(path)]));
  for(const [name,path] of Object.entries(roots))cpSync(path,join(baseline,name),{recursive:true,dereference:false,filter:p=>!p.split("/").includes("node_modules")});
  for(const name of ["source.jsonl","manifest.json"])cpSync(join(f.root,name),join(baseline,name));
  writeFileSync(join(baseline,"inventories.json"),JSON.stringify(inventories));
  const baselineDBHash=digest(readFileSync(f.dbPath));
  const baselineSchema=f.manifest.schemaSHA256;
  const baselineInputs=[f.path,join(f.root,"manifest.json")].map(p=>digest(readFileSync(p)));
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
const base=${JSON.stringify(runtimeRoot)};
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
 backend=await createDefaultApplicationRuntime(owner,async()=>services,undefined,{offlineMaintenance:true});
 backend.stop();await backend.close();backend=undefined;
 const privateImport=(specifier)=>import(import.meta.resolve(specifier,base+"/durable-engine/src/default-application-runtime.ts"));
 const {Harness,AgentDoc,createRegistry,defineDoc}=await ${packageRoot ? 'privateImport("@earendil-works/pi-durable")' : 'import(base+"/durable-engine/qualification/durable.ts")'};
 const {createModels}=await ${packageRoot ? 'privateImport("@earendil-works/pi-ai")' : 'import(base+"/durable-engine/qualification/ai.ts")'};
 const {BACKGROUND_CONTEXT:context}=await ${packageRoot ? 'privateImport("@earendil-works/chord/context")' : 'import(base+"/durable-engine/qualification/context.ts")'};
 const {SqliteStorage}=await ${packageRoot ? 'privateImport("@earendil-works/pi-durable/storage/sqlite")' : 'import(base+"/durable-engine/qualification/sqlite.ts")'};
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
  // No controller survives spawnSync; no owned DB handle remains. Never clear a lock to force rollback.
  quiescent();
  const forensic=join(f.root,"post-native-forensic.db");cpSync(f.dbPath,forensic);
  const forensicHash=digest(readFileSync(forensic));
  const postNative=new Database(forensic,{readonly:true});
  expect(postNative.query("SELECT count(*) AS n FROM entries").get()).not.toEqual({n:0});postNative.close();
  const relocatedInventory=inventory(dest);
  writeFileSync(join(f.root,"relocated-inventory.json"),JSON.stringify(relocatedInventory));
  for(const [name,path] of Object.entries(roots))restoreTree(join(baseline,name),path);
  quiescent();
  expect(digest(readFileSync(f.dbPath))).toBe(baselineDBHash);
  for(const [name,path] of Object.entries(roots))expect(rollbackInventory(path)).toEqual(inventories[name]);
  expect([f.path,join(f.root,"manifest.json")].map(p=>digest(readFileSync(p)))).toEqual(baselineInputs);
  expect(inventory(archives)).toEqual(f.manifest.archives);
  expect(inventory(dest)).toEqual(relocatedInventory);
  expect(digest(readFileSync(forensic))).toBe(forensicHash);
  const restored=new Database(f.dbPath,{readonly:true});
  expect(digest(JSON.stringify(restored.query("SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name").all()))).toBe(baselineSchema);
  expect(snapshot(restored)).toEqual(historic);
  expect(digest(JSON.stringify(snapshot(restored)))).toBe(historicHash);
  expect(captureLegacyTimeline(restored,()=>{})).toEqual(timeline);
  expect(restored.query("SELECT name FROM sqlite_master WHERE name='entries'").all()).toEqual([]);
  restored.close();
  const preflight=f.run(["--preflight"]);
  expect(preflight.exitCode,preflight.stderr.toString()+preflight.stdout.toString()).toBe(0);
  const restoredReceipt=JSON.parse(preflight.stdout.toString().trim().split("\n").at(-1)!);
  expect(restoredReceipt).toMatchObject({mode:"preflight",writes:0,copies:1,validation:"immutable-offline-data-and-installed-sources-not-runtime-construction"});
  console.log("RESTORED_PREFLIGHT",JSON.stringify(restoredReceipt));
  for(const [name,path] of Object.entries(roots))expect(rollbackInventory(path)).toEqual(inventories[name]);
  expect(digest(readFileSync(f.dbPath))).toBe(baselineDBHash);
  quiescent();

 }finally{rmSync(f.root,{recursive:true,force:true});}
},packageRoot ? 180000 : 60000);
