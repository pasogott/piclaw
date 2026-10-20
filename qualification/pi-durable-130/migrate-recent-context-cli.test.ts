import { test, expect } from "bun:test";
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
 const root = mkdtempSync(join(tmpdir(),"operator-context-")), workspace = join(root,"workspace"), agent = join(root,"agent");
 mkdirSync(join(workspace,".piclaw/store"),{recursive:true}); mkdirSync(agent);
 const dbPath = join(workspace,".piclaw/store/messages.db"), db = new Database(dbPath);
 db.exec("CREATE TABLE messages(id TEXT,chat_jid TEXT,content TEXT); INSERT INTO messages VALUES ('m','web:fixture','original'); CREATE TABLE chat_branches(chat_jid TEXT,branch_id TEXT,archived_at TEXT); INSERT INTO chat_branches VALUES ('web:fixture','branch',NULL)");
 const path = join(root,"source.jsonl"); writeFileSync(path,[{type:"session",id:"source",version:3,cwd:workspace,timestamp:asOf},...entries].map(e=>JSON.stringify(e)).join("\n")+"\n");
 const selected = selectRecent(entries,"a",asOf);
 const manifest:any = {version:1,workspace,agentDir:agent,schemaSHA256:digest(JSON.stringify(db.query("SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name").all())),timeline:captureLegacyTimeline(db,()=>{}),sources:[{chatJid:"web:fixture",branchId:"branch",path,sha256:digest(readFileSync(path)),sourceSessionId:"source",selectedLeaf:"a",asOf,payloadSHA256:digest(JSON.stringify(selected.messages)),sourceEntryIds:selected.sourceEntryIds}],archives:[]}; db.close();
 const env={...process.env,PICLAW_WORKSPACE:workspace,PICLAW_PI_AGENT_DIR:agent,PI_CODING_AGENT_DIR:agent};
 for(const key of ["PICLAW_STORE","PICLAW_DATA","PICLAW_RUNTIME_ROOT","PICLAW_DB_IN_MEMORY"]) delete env[key];
 rmSync(dbPath);
 const init=Bun.spawnSync([process.execPath,"-e",`const d=await import(${JSON.stringify(join(import.meta.dir,"../../runtime/src/db.ts"))}); d.initDatabase();d.storeChatMetadata("web:fixture",new Date().toISOString());d.closeDatabase();`],{env,stdout:"pipe",stderr:"pipe",timeout:15000});
 if(init.exitCode) throw Error(init.stderr.toString());
 const actual=new Database(dbPath);
 manifest.sources[0].branchId=(actual.query("SELECT branch_id FROM chat_branches WHERE chat_jid='web:fixture'").get() as any).branch_id;
 manifest.schemaSHA256=digest(JSON.stringify(actual.query("SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name").all()));
 manifest.timeline=captureLegacyTimeline(actual,()=>{});actual.close();
 const manifestPath = join(root,"manifest.json"), save = () => writeFileSync(manifestPath,JSON.stringify(manifest)); save();
 const args = ["--workspace",workspace,"--agent-dir",agent,"--manifest",manifestPath];
 const run = (more:string[] = []) => Bun.spawnSync([process.execPath,cli,...args,...more],{env:{...process.env,PICLAW_STORE:"/must-not-use",PICLAW_DATA:"/must-not-use",PICLAW_DB_IN_MEMORY:"1"},stdout:"pipe",stderr:"pipe",timeout:15000});
 return {root,workspace,agent,dbPath,path,manifest,save,run,lock:join(workspace,".piclaw/store/runtime.lock")};
}

function snapshot(root:string):any { return readdirSync(root,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)).flatMap(e=>e.isDirectory()?snapshot(join(root,e.name)).map((x:any)=>[e.name+"/"+x[0],x[1]]):[[e.name,digest(readFileSync(join(root,e.name)))]]); }
test("CLI help without runtime imports",()=>{const r=Bun.spawnSync([process.execPath,cli,"--help"],{timeout:15000});expect(r.exitCode).toBe(0);expect(r.stdout.toString()).toContain("No force");});
for(const kind of ["valid","source-tamper","binding","schema","payload","live-lock","stale-lock","archive-plan","unsafe-destination","existing-destination","sidecar"]) test("isolated actual application DB CLI: "+kind,()=>{
 const f=fixture();try {
 if(kind==="source-tamper")writeFileSync(f.path,readFileSync(f.path,"utf8")+" ");
 if(kind==="binding") f.manifest.sources[0].branchId="wrong";
 if(kind==="schema") f.manifest.schemaSHA256="0".repeat(64);
 if(kind==="payload") f.manifest.sources[0].payloadSHA256="0".repeat(64);
 if(kind.endsWith("lock"))writeFileSync(f.lock,JSON.stringify({pid:kind==="live-lock"?process.pid:99999999}));
 if(kind==="sidecar")writeFileSync(f.dbPath+"-wal","uncheckpointed");
 if(kind==="archive-plan") {const dir=join(f.workspace,".piclaw/data/sessions");mkdirSync(dir,{recursive:true});writeFileSync(join(dir,"raw.jsonl"),"raw retained bytes");f.manifest.archives=[{path:"raw.jsonl",sha256:digest("raw retained bytes")}];}
 f.save();const before=snapshot(f.root);
 const extra=kind==="unsafe-destination"?["--apply","--relocate-archives",join(f.workspace,"bad")]:kind==="existing-destination"?["--apply","--relocate-archives",f.agent]:[];
 const r=f.run(extra); if(["valid","archive-plan"].includes(kind)){if(r.exitCode)throw Error(r.stderr.toString());expect(r.exitCode).toBe(0);const report=JSON.parse(r.stdout.toString().trim().split("\n").at(-1)!);expect(report.writes).toBe(0);expect(report.validation).toBe("immutable-offline-data-only-not-resident-ownership");if(kind==="archive-plan")expect(report.archivePlan.files).toEqual(f.manifest.archives);}else expect(r.exitCode).toBe(1);
 expect(snapshot(f.root)).toEqual(before);
 }finally{rmSync(f.root,{recursive:true,force:true});}
},25000);

test("projection rejects malformed tool round; inclusive seven-day boundary",()=>{
 const call={...entries[1],message:{...assistant(),stopReason:"toolUse",content:[{type:"toolCall",id:"call",name:"read",arguments:{}}]}};
 const result={type:"message",id:"result",parentId:"a",timestamp:asOf,message:{role:"toolResult",toolCallId:"wrong",toolName:"read",content:[{type:"text",text:"bad"}],isError:false,timestamp}};
 const final={...entries[1],id:"final",parentId:"result"};
 expect(()=>selectRecent([entries[0],call,result,final] as any,"final",asOf)).toThrow("No complete");
 const boundary=entries.map(e=>({...e,message:{...e.message,timestamp:timestamp-7*86400000}}));
 expect(selectRecent(boundary,"a",asOf).completedTurns).toBe(1);
 expect(()=>selectRecent(boundary.map(e=>({...e,message:{...e.message,timestamp:e.message.timestamp-1}})),"a",asOf)).toThrow("No complete");
});
