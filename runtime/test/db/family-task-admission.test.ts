import { afterEach,beforeEach,expect,test,spyOn } from "bun:test";
import Database from "bun:sqlite";
import { mkdirSync,writeFileSync } from "node:fs";
import { join } from "node:path";
import { createTempWorkspace,setEnv,waitFor } from "../helpers.js";
import { closeDatabase,getDb,initDatabase } from "../../src/db/connection.js";
import { createWebSession } from "../../src/db/web-sessions.js";
import { prepareOwnFamilyTask as prepare,listOwnFamilyTasks,readOwnFamilyTask } from "../../src/db/family-task-admission.js";
import { createFamilyScheduledTask,revokeFamilyScheduledGrant } from "../../src/db/family-scheduled-grants.js";
import { provisionFamilyAccount,updateManagedAccount } from "../../src/db/account-administration.js";
import { getUser } from "../../src/db/users.js";
import { getTaskById,updateTask } from "../../src/db/tasks.js";
import { updateAdminToolPolicy } from "../../src/db/family-tool-restrictions.js";
import { createOwnedRoot,archiveOwnedSession } from "../../src/db/owned-session-lifecycle.js";
import { RequestRouterService } from "../../src/channels/web/request-router-service.js";
import { WebAuthGateway } from "../../src/channels/web/auth/auth-gateway.js";
import { WebauthnChallengeTracker } from "../../src/channels/web/auth/webauthn-challenges.js";
import { TotpFailureTracker } from "../../src/channels/web/auth/totp-failure-tracker.js";
import { resetRateLimiterStateForTests } from "../../src/channels/web/http/rate-limit.js";
import type { AuthenticatedPrincipal } from "../../src/core/access-types.js";

let ws:ReturnType<typeof createTempWorkspace>,restore:()=>void,admin:AuthenticatedPrincipal,alice:AuthenticatedPrincipal,bob:AuthenticatedPrincipal;
function actor(id:string):AuthenticatedPrincipal{const u=getUser(getDb(),id)!,s=createWebSession(`token-${id}`,id,3600,"passkey");return {kind:"user",mode:"family-shared",userId:id,username:u.username,displayName:u.display_name,role:u.role,homeChatJid:u.home_chat_jid,authentication:{method:"passkey",sessionId:s.session_id!,expiresAt:s.expires_at}};}
beforeEach(()=>{ws=createTempWorkspace("task-admission-");restore=setEnv({PICLAW_WORKSPACE:ws.workspace,PICLAW_STORE:ws.store,PICLAW_DATA:ws.data});mkdirSync(join(ws.workspace,".piclaw"));writeFileSync(join(ws.workspace,".piclaw/config.json"),JSON.stringify({domains:{access:{mode:"family-shared"}}}));closeDatabase();initDatabase();resetRateLimiterStateForTests();admin=actor("default");
  [alice,bob]=["alice","bob"].map(name=>{const u=provisionFamilyAccount(getDb(),admin,{username:name,displayName:name});getDb().query("INSERT INTO webauthn_credentials(user_id,rp_id,credential_id,public_key) VALUES (?,'family.local',?,'key')").run(u.id,name);updateManagedAccount(getDb(),admin,u.id,{enabled:true},{totp:false,passkey:true,rpId:"family.local"});return actor(u.id);});
});
afterEach(()=>{closeDatabase();resetRateLimiterStateForTests();restore();ws.cleanup();});
const input=(request_id="request-one")=>({request_id,chat_jid:alice.homeChatJid!,prompt:"private prompt\nexact whitespace ",scheduled_for:new Date(Date.now()+60000).toISOString(),allowed_tools:["read","messages"]});
const count=(table:string)=>(getDb().query(`SELECT count(*) n FROM ${table}`).get() as any).n;
function router(){const json=(v:unknown,status=200)=>Response.json(v,{status});const authGateway=new WebAuthGateway({accessMode:"family-shared",passkeyMode:"",totpSecret:"",internalSecret:"",hasTls:true,sessionTtlSeconds:3600},{json,challenges:new WebauthnChallengeTracker(),failureTracker:new TotpFailureTracker()});return new RequestRouterService({json,authGateway} as any,"family-shared");}
function req(path:string,method="GET",body?:BodyInit,who=alice,headers:Record<string,string>={},signal?:AbortSignal){return new Request("https://family.local"+path,{method,body,signal,headers:{cookie:`piclaw_session=token-${who.userId}`,origin:"https://family.local","x-piclaw-account-id":who.userId,"x-piclaw-login-id":who.authentication.sessionId!,...headers}});}

test("admission creates paused task exactly once, canonicalises tool ordering, supports owner reauth and past-due retry",()=>{
  const db=getDb(),data=input(),created=prepare(db,alice,data);expect(created).toMatchObject({created:true,state:"paused"});
  expect(prepare(db,alice,{...data,allowed_tools:["messages","read"]})).toEqual({...created,created:false});expect(count("scheduled_tasks")).toBe(1);
  const login=alice.authentication.sessionId;alice=actor(alice.userId);expect(prepare(db,alice,data).created).toBe(false);
  expect(db.query("SELECT login_session_id FROM family_task_admissions").get()).toEqual({login_session_id:login});
  const real=Date.now;try{Date.now=()=>Date.parse(data.scheduled_for)+1000;expect(prepare(db,alice,data).created).toBe(false);}finally{Date.now=real;}
  expect(getTaskById(created.task_id)?.status).toBe("paused");expect(()=>updateTask(created.task_id,{status:"active"})).toThrow();
  expect(count("family_scheduled_occurrences")).toBe(0);expect(count("family_scheduled_dispatches")).toBe(0);
});

test("conflicting request reuse, stale/revoked login, foreign target and changed or revoked grant deny without replacement",()=>{
  const db=getDb(),data=input(),created=prepare(db,alice,data);
  for(const altered of [{...data,prompt:data.prompt+" "},{...data,allowed_tools:[]},{...data,chat_jid:bob.homeChatJid!},{...data,scheduled_for:new Date(Date.now()+120000).toISOString()}])expect(()=>prepare(db,alice,altered)).toThrow();
  expect(()=>prepare(db,admin,data)).toThrow();expect(()=>prepare(db,bob,data)).toThrow();
  revokeFamilyScheduledGrant(db,alice,created.grant_id);expect(()=>prepare(db,alice,data)).toThrow();expect(count("scheduled_tasks")).toBe(1);
  const other=input("other"),changed=prepare(db,alice,other);updateTask(changed.task_id,{prompt:"changed"});expect(()=>prepare(db,alice,other)).toThrow();
  db.query("UPDATE web_sessions SET created_at=? WHERE session_id=?").run(new Date(Date.now()-600000).toISOString(),alice.authentication.sessionId!);expect(()=>prepare(db,alice,input("stale"))).toThrow();
  db.query("DELETE FROM web_sessions WHERE session_id=?").run(alice.authentication.sessionId!);expect(()=>prepare(db,alice,input("revoked"))).toThrow();
});

test("identical retry tolerates live policy narrowing but rejects drift in the immutable issued set",()=>{
  const db=getDb(),data=input(),first=prepare(db,alice,data);
  updateAdminToolPolicy(db,admin,alice.userId,{confirm_username:"alice",expected_revision:0,denied_tools:["read"]});
  expect(prepare(db,alice,data)).toEqual({...first,created:false});
  expect(readOwnFamilyTask(db,alice,first.grant_id).preparation?.allowed_tools).toEqual(["messages"]);
  db.exec("DROP TRIGGER family_scheduled_grant_immutable");db.query("UPDATE family_scheduled_grants SET allowed_tools=? WHERE id=?").run(JSON.stringify(["read","ls","messages"]),first.grant_id);
  expect(()=>prepare(db,alice,data)).toThrow();expect(count("scheduled_tasks")).toBe(1);
});

test("receipt insertion failure rolls task and grant back and shared-key races resolve to one durable record",()=>{
  const db=getDb(),data=input();db.exec("CREATE TRIGGER fail_admission BEFORE INSERT ON family_task_admissions BEGIN SELECT RAISE(ABORT,'admission failed'); END");
  expect(()=>prepare(db,alice,data)).toThrow("admission failed");expect(count("scheduled_tasks")).toBe(0);expect(count("family_scheduled_grants")).toBe(0);db.exec("DROP TRIGGER fail_admission");
  const path=join(ws.workspace,"admission.sqlite");db.query("VACUUM INTO ?").run(path);const a=new Database(path),b=new Database(path);
  try{a.exec("PRAGMA journal_mode=WAL");b.exec("PRAGMA busy_timeout=100");a.exec("BEGIN IMMEDIATE");try{expect(()=>prepare(b,alice,data)).toThrow();}finally{a.exec("ROLLBACK");}
    const first=prepare(a,alice,data);expect(prepare(b,alice,data)).toEqual({...first,created:false});expect(count("scheduled_tasks")).toBe(0);
  }finally{a.close();b.close();}
  const reopened=new Database(path);try{expect(prepare(reopened,alice,data).created).toBe(false);expect(()=>reopened.exec("DELETE FROM family_task_admissions")).toThrow("cannot be replayed");}finally{reopened.close();}
});

test("quota is owner-local, counts internal unrevoked grants and allows exact retry at the cap",()=>{
  const db=getDb(),data=input(),first=prepare(db,alice,data);
  for(let i=1;i<100;i++)createFamilyScheduledTask(db,alice,alice.homeChatJid!,{prompt:`task ${i}`,scheduled_for:data.scheduled_for,allowed_tools:[]});
  expect(prepare(db,alice,data).created).toBe(false);expect(()=>prepare(db,alice,input("over"))).toThrow();
  expect(prepare(db,bob,{...data,chat_jid:bob.homeChatJid!}).created).toBe(true);
  revokeFamilyScheduledGrant(db,alice,first.grant_id);expect(prepare(db,alice,input("after-revoke")).created).toBe(true);expect(()=>prepare(db,alice,data)).toThrow();
});

test("validation rejects ambiguous shapes, unsupported operations and policy escalation",()=>{
  const db=getDb(),data=input();
  for(const altered of [{...data,confirm:true},{...data,request_id:""},{...data,chat_jid:" "+data.chat_jid},{...data,allowed_tools:["read","read"]},{...data,allowed_tools:["bash"]},{...data,prompt:"é".repeat(51201)},
    {...data,scheduled_for:"tomorrow"},{...data,scheduled_for:new Date(Date.now()-1000).toISOString()},{...data,allowed_tools:null}])expect(()=>prepare(db,alice,altered as any)).toThrow();
  updateAdminToolPolicy(db,admin,alice.userId,{confirm_username:"alice",expected_revision:0,denied_tools:["read"]});expect(()=>prepare(db,alice,data)).toThrow();
  expect(count("family_task_admissions")).toBe(0);
});

test("metadata and detail reads are owner scoped, bounded, redact revoked prompts and omit archived targets",()=>{
  const db=getDb(),data=input(),own=prepare(db,alice,data);prepare(db,bob,{...data,chat_jid:bob.homeChatJid!});
  const root=createOwnedRoot(db,alice,"archive-task"),archived=prepare(db,alice,{...input("archive"),chat_jid:root.chat_jid});archiveOwnedSession(db,alice,root.chat_jid);
  const listed=listOwnFamilyTasks(db,alice);expect(listed.items).toHaveLength(1);expect(listed.items[0].grant_id).toBe(own.grant_id);expect(JSON.stringify(listed)).not.toContain(data.prompt);expect(listOwnFamilyTasks(db,admin).items).toEqual([]);
  expect(readOwnFamilyTask(db,alice,own.grant_id).preparation?.prompt).toBe(data.prompt);expect(()=>readOwnFamilyTask(db,bob,own.grant_id)).toThrow();expect(()=>readOwnFamilyTask(db,alice,archived.grant_id)).toThrow();
  revokeFamilyScheduledGrant(db,alice,own.grant_id);expect(readOwnFamilyTask(db,alice,own.grant_id)).toMatchObject({revoked:true,preparation:null,activation_available:false});
  for(let i=0;i<51;i++)prepare(db,alice,input(`window-${i}`));expect(listOwnFamilyTasks(db,alice).items).toHaveLength(50);
});

test("HTTP pinned preparation/list/detail/revoke leaves tasks paused without queue or model work",async()=>{
  const r=router(),path="/agent/scheduled-tasks",data=input();
  const first=await r.handle(req(path,"POST",JSON.stringify({...data,confirm:true})));expect(first.status).toBe(201);expect(first.headers.get("cache-control")).toBe("private, no-store");const created=await first.json();
  expect(created.request_id).toBe(data.request_id);
  const retried=await r.handle(req(path,"POST",JSON.stringify({...data,confirm:true})));expect(retried.status).toBe(200);expect(await retried.json()).toEqual({...created,created:false});
  const list=await r.handle(req(path));expect((await list.json()).items).toHaveLength(1);
  const detail=await r.handle(req(`${path}/${created.grant_id}`));expect((await detail.json()).preparation.prompt).toBe(data.prompt);
  expect((await r.handle(req(`${path}/${created.grant_id}`,"GET",undefined,bob))).status).toBe(403);
  expect((await r.handle(req(`${path}/${created.grant_id}/revoke`,"POST",'{"confirm":true}'))).status).toBe(200);
  expect((await r.handle(req(`${path}/${created.grant_id}/revoke`,"POST",'{"confirm":true}'))).status).toBe(200);
  expect((await r.handle(req(path,"POST",JSON.stringify({...data,confirm:true})))).status).toBe(403);
  expect(count("family_scheduled_occurrences")).toBe(0);expect(count("messages")).toBe(0);expect(getTaskById(created.task_id)?.status).toBe("paused");
});

test("HTTP applies the 128KiB bound to encoded JSON including escaping, with exact-boundary acceptance",async()=>{
  const r=router(),path="/agent/scheduled-tasks",data={...input(),prompt:'"'.repeat(70000),confirm:true};
  expect(Buffer.byteLength(data.prompt)).toBeLessThan(102400);expect(Buffer.byteLength(JSON.stringify(data))).toBeGreaterThan(128*1024);
  expect((await r.handle(req(path,"POST",JSON.stringify(data)))).status).toBe(403);expect(count("scheduled_tasks")).toBe(0);
  const json=JSON.stringify({...data,prompt:"bounded prompt"}),atLimit=json+" ".repeat(128*1024-Buffer.byteLength(json));
  expect((await r.handle(req(path,"POST",atLimit))).status).toBe(201);
  expect((await r.handle(req(path,"POST",atLimit+" "))).status).toBe(403);expect(count("scheduled_tasks")).toBe(1);
});

test("HTTP rejects missing pins/Origin, forged fields, alternate methods, selectors and stale authentication",async()=>{
  const r=router(),path="/agent/scheduled-tasks",data={...input(),confirm:true};
  const unpinned=req(path);unpinned.headers.delete("x-piclaw-account-id");unpinned.headers.delete("x-piclaw-login-id");expect((await r.handle(unpinned)).status).toBe(403);
  expect((await r.handle(req(path,"GET",undefined,alice,{"x-piclaw-account-id":bob.userId}))).status).toBe(409);
  for(const origin of ["","null","https://foreign.local"])expect((await r.handle(req(path,"POST",JSON.stringify(data),alice,{origin}))).status).toBe(403);
  for(const value of [{...data,confirm:false},{...data,owner_user_id:bob.userId},{...data,task_kind:"shell"},{...data,token:"forged"}])expect((await r.handle(req(path,"POST",JSON.stringify(value)))).status).toBe(403);
  for(const method of ["PATCH","DELETE","PUT"])expect((await r.handle(req(path,method,"{}"))).status).toBe(403);
  expect((await r.handle(req(path+"?owner=bob"))).status).toBe(403);
  getDb().query("UPDATE web_sessions SET created_at=? WHERE session_id=?").run(new Date(Date.now()-600000).toISOString(),alice.authentication.sessionId!);
  expect((await r.handle(req(path,"POST",JSON.stringify(data)))).status).toBe(403);expect(count("scheduled_tasks")).toBe(0);
});

test("HTTP malformed field types deny without 500, side effects or type coercion",async()=>{
  const r=router(),path="/agent/scheduled-tasks",data={...input(),confirm:true};
  for(const patch of [{request_id:123},{chat_jid:null},{prompt:42},{scheduled_for:0},{allowed_tools:"read"},{allowed_tools:[null]},{allowed_tools:["read","read"]}]) {
    expect((await r.handle(req(path,"POST",JSON.stringify({...data,...patch})))).status).toBe(403);
  }
  expect(count("scheduled_tasks")).toBe(0);expect(count("family_task_admissions")).toBe(0);
});

test("mode changes, account disable and archive fence existing request retries; revocation works for archived targets",()=>{
  const db=getDb(),root=createOwnedRoot(db,alice,"paused-admission"),data={...input(),chat_jid:root.chat_jid},first=prepare(db,alice,data);
  archiveOwnedSession(db,alice,root.chat_jid);expect(()=>prepare(db,alice,data)).toThrow();revokeFamilyScheduledGrant(db,alice,first.grant_id);
  expect(db.query("SELECT reason FROM family_scheduled_grant_revocations WHERE grant_id=?").get(first.grant_id)).toEqual({reason:"owner_revoked"});
  const other=input("disabled"),second=prepare(db,alice,other);db.query("UPDATE users SET enabled=0 WHERE id=?").run(alice.userId);expect(()=>prepare(db,alice,other)).toThrow();
  db.query("UPDATE users SET enabled=1 WHERE id=?").run(alice.userId);expect(()=>prepare(db,alice,other)).toThrow();
  writeFileSync(join(ws.workspace,".piclaw/config.json"),JSON.stringify({domains:{access:{mode:"single-user"}}}));
  expect(()=>prepare(db,alice,input("single"))).toThrow();expect(()=>listOwnFamilyTasks(db,alice)).toThrow();expect(()=>readOwnFamilyTask(db,alice,second.grant_id)).toThrow();
});

test("body revocation, cancellation, invalid JSON and oversized chunks cannot commit; storage failures return500",async()=>{
  const db=getDb(),r=router(),path="/agent/scheduled-tasks",data={...input(),confirm:true};
  expect((await r.handle(req(path,"POST","{"))).status).toBe(403);expect((await r.handle(req(path,"POST"," ".repeat(128*1024+1)))).status).toBe(403);
  const abort=new AbortController();abort.abort();expect((await r.handle(req(path,"POST",JSON.stringify(data),alice,{},abort.signal))).status).toBe(403);
  let stream!:ReadableStreamDefaultController;const body=new ReadableStream({start(c){stream=c;}}),pending=r.handle(req(path,"POST",body as any));await Bun.sleep(5);
  db.query("DELETE FROM web_sessions WHERE session_id=?").run(alice.authentication.sessionId!);stream.enqueue(new TextEncoder().encode(JSON.stringify(data)));stream.close();expect((await pending).status).toBe(403);expect(count("scheduled_tasks")).toBe(0);
  alice=actor(alice.userId);db.exec("CREATE TRIGGER fail_http_admit BEFORE INSERT ON family_task_admissions BEGIN SELECT RAISE(ABORT,'storage failure'); END");
  expect((await r.handle(req(path,"POST",JSON.stringify(data)))).status).toBe(500);expect(count("scheduled_tasks")).toBe(0);
});

test("stalled body times out and read requests do not consume shared mutation quota",async()=>{
  const r=router(),path="/agent/scheduled-tasks",data={...input(),confirm:true};let expire:(()=>void)|undefined,cancelled=false;
  const original=setTimeout,spy=spyOn(globalThis,"setTimeout").mockImplementation(((fn:any,ms:number,...args:any[])=>{if(ms===10000){expire=fn;return {unref(){}} as any;}return original(fn,ms,...args);}) as any);
  try{const body=new ReadableStream({cancel(){cancelled=true;}}),pending=r.handle(req(path,"POST",body as any));await waitFor(()=>!!expire);expire!();expect((await pending).status).toBe(403);expect(cancelled).toBe(true);}finally{spy.mockRestore();}
  resetRateLimiterStateForTests();
  for(let i=0;i<20;i++){expect((await r.handle(req(path))).status).toBe(200);expect([200,201]).toContain((await r.handle(req(path,"POST",JSON.stringify(data)))).status);}
  expect((await r.handle(req(path,"POST",JSON.stringify(data)))).status).toBe(429);
});
