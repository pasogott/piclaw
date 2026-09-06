import { afterEach,beforeEach,expect,test,spyOn } from 'bun:test';
import * as fs from 'node:fs';
import { join,dirname } from 'node:path';
import { createTempWorkspace,setEnv } from '../helpers.js';
import { workspaceMemoryBootstrap } from '../../src/extensions/workspace-memory-bootstrap.js';
import { withExecutionIdentity,type ExecutionIdentity } from '../../src/core/execution-context.js';
import { withChatContext } from '../../src/core/chat-context.js';
import { initDatabase,getDb,closeDatabase } from '../../src/db/connection.js';
import { provisionFamilyAccount,updateManagedAccount } from '../../src/db/account-administration.js';
import { createWebSession } from '../../src/db/web-sessions.js';
import { getUser } from '../../src/db/users.js';
import { authoriseExecutionIdentity } from '../../src/agent-pool/execution-identity.js';
import { ChatAccessDenied } from '../../src/db/session-ownership.js';
import type { AuthenticatedPrincipal } from '../../src/core/access-types.js';
import * as accessConfig from '../../src/core/config-access.js';

let ws:ReturnType<typeof createTempWorkspace>,restore:()=>void,alice:ExecutionIdentity,bob:ExecutionIdentity,handler:(event:any)=>Promise<any>;
const config=(mode:string)=>fs.writeFileSync(join(ws.workspace,'.piclaw/config.json'),mode==='invalid'?'{':JSON.stringify({domains:{access:{mode}}}));
function file(path:string,text:string){const absolute=join(ws.workspace,path);fs.mkdirSync(dirname(absolute),{recursive:true});fs.writeFileSync(absolute,text);}
function actor(id:string):AuthenticatedPrincipal {
  const user=getUser(getDb(),id)!,login=createWebSession(`memory-${id}`,id,3600,'passkey');return {kind:'user',mode:'family-shared',userId:id,username:user.username,displayName:user.display_name,role:user.role,homeChatJid:user.home_chat_jid,authentication:{method:'passkey',sessionId:login.session_id!,expiresAt:login.expires_at}};
}
const call=(identity:ExecutionIdentity|null=alice,event:any={systemPrompt:'base'},chat=identity?.provenance.chatJid??'web:default')=>withExecutionIdentity(identity,()=>withChatContext(chat,'web',()=>handler(event)));
beforeEach(()=>{
  ws=createTempWorkspace('memory-boundary-');restore=setEnv({PICLAW_WORKSPACE:ws.workspace,PICLAW_STORE:ws.store,PICLAW_DATA:ws.data});
  fs.mkdirSync(join(ws.workspace,'.piclaw'));config('family-shared');closeDatabase();initDatabase();const admin=actor('default');
  [alice,bob]=['alice','bob'].map(name=>{
    const user=provisionFamilyAccount(getDb(),admin,{username:name,displayName:name});getDb().query("INSERT INTO webauthn_credentials(user_id,rp_id,credential_id,public_key) VALUES (?,'family.local',?,'key')").run(user.id,name);
    updateManagedAccount(getDb(),admin,user.id,{enabled:true},{totp:false,passkey:true,rpId:'family.local'});const principal=actor(user.id);
    return authoriseExecutionIdentity(getDb(),'family-shared',principal.homeChatJid!,{actorUserId:user.id,ownerUserId:user.id,chatJid:principal.homeChatJid!,kind:'interactive',authenticationSessionId:principal.authentication.sessionId!})!;
  });
  for(const identity of [alice,bob]){file(`notes/users/${identity.provenance.ownerUserId}/MEMORY.md`,`${identity.username.toUpperCase()}_PERSONAL`);file(`notes/users/${identity.provenance.ownerUserId}/preferences.md`,`${identity.username.toUpperCase()}_PREFERENCE`);}
  file('notes/family/MEMORY.md','SHARED_REFERENCE');file('notes/memory/MEMORY.md','LEGACY_MEMORY');file('notes/index.md','LEGACY_INDEX');file('notes/preferences/agent.md','LEGACY_PREFERENCE');
  workspaceMemoryBootstrap({on:(event:string,fn:any)=>{expect(event).toBe('before_agent_start');handler=fn;}} as any);
});
afterEach(()=>{closeDatabase();restore();ws.cleanup();});

test('concurrent owner prompts contain actual selected files and shared reference, never another owner or legacy notes',async()=>{
  const [a,b]=await Promise.all([call(alice),call(bob)]);
  for(const [own,other,out] of [[alice,bob,a],[bob,alice,b]] as const){
    expect(out.systemPrompt).toContain(`Username: "${own.username}"`);expect(out.systemPrompt).toContain(`${own.username.toUpperCase()}_PERSONAL`);expect(out.systemPrompt).toContain(`${own.username.toUpperCase()}_PREFERENCE`);
    expect(out.systemPrompt).toContain('Shared family reference');expect(out.systemPrompt).toContain('SHARED_REFERENCE');expect(out.systemPrompt).toContain('not identity or permission grants');
    expect(out.systemPrompt).not.toContain(other.provenance.ownerUserId);expect(out.systemPrompt).not.toContain(`${other.username.toUpperCase()}_PERSONAL`);expect(out.systemPrompt).not.toContain('LEGACY_');expect(out.message).toBeUndefined();
  }
  file(`notes/users/${alice.provenance.ownerUserId}/MEMORY.md`,'ALICE_UPDATED');expect((await call(alice)).systemPrompt).toContain('ALICE_UPDATED');expect((await call(bob)).systemPrompt).not.toContain('ALICE_UPDATED');
});

test('missing or stale identity and invalid/isolated mode deny before event or memory access',async()=>{
  const event=new Proxy({}, {get(){throw Error('Event read before authority');}});
  await expect(call(null,event)).rejects.toBeInstanceOf(ChatAccessDenied);
  for(const mode of ['single-user','isolated-containers','invalid']){config(mode);await expect(call(alice,event)).rejects.toThrow();}
  config('family-shared');
  await expect(call(alice,event,bob.provenance.chatJid)).rejects.toBeInstanceOf(ChatAccessDenied);
  await expect(call({...alice,provenance:{...alice.provenance,ownerUserId:'../../bob'}},event)).rejects.toBeInstanceOf(ChatAccessDenied);
  await expect(call({...alice,mode:'single-user'},event)).rejects.toBeInstanceOf(ChatAccessDenied);
});

test('live account/login/root revalidation prevents old owner context from loading memory',async()=>{
  const wrongRoot=Object.freeze({...alice,rootChatJid:bob.rootChatJid});await expect(call(wrongRoot)).rejects.toBeInstanceOf(ChatAccessDenied);
  const wrongRole=Object.freeze({...alice,role:'admin' as const});await expect(call(wrongRole)).rejects.toBeInstanceOf(ChatAccessDenied);
  getDb().query('DELETE FROM web_sessions WHERE session_id=?').run(alice.provenance.authenticationSessionId!);await expect(call(alice)).rejects.toBeInstanceOf(ChatAccessDenied);
  getDb().query('UPDATE users SET enabled=0 WHERE id=?').run(bob.provenance.ownerUserId);await expect(call(bob)).rejects.toBeInstanceOf(ChatAccessDenied);
});

test('family bootstrap requires immutable runtime identity, provenance and preference snapshots before memory reads',async()=>{
  expect(Object.isFrozen(alice)).toBe(true);expect(Object.isFrozen(alice.provenance)).toBe(true);expect(Object.isFrozen(alice.preferences)).toBe(true);
  let reads=0;const original=fs.readFileSync;const spy=spyOn(fs,'readFileSync').mockImplementation(((path:any,...args:any[])=>{if(String(path).includes('/notes/'))reads++;return Reflect.apply(original,fs,[path,...args]);}) as any);
  try{
    for(const value of [{...alice},Object.freeze({...alice,provenance:{...alice.provenance}}),Object.freeze({...alice,preferences:{revision:0,theme:'system' as const,response_guidance:'mutable'}})])await expect(call(value)).rejects.toBeInstanceOf(ChatAccessDenied);
    expect(reads).toBe(0);
  }finally{spy.mockRestore();}
});

test('valid single-user with or without default identity retains legacy memory paths and content',async()=>{
  config('single-user');const legacy=await call(null);expect(legacy.systemPrompt).toContain('LEGACY_MEMORY');expect(legacy.systemPrompt).toContain('LEGACY_INDEX');expect(legacy.systemPrompt).toContain('LEGACY_PREFERENCE');expect(legacy.systemPrompt).not.toContain('Current user');expect(legacy.systemPrompt).not.toContain('SHARED_REFERENCE');
  const identity:ExecutionIdentity={mode:'single-user',username:'default',displayName:'Default',role:'admin',rootChatJid:'web:default',provenance:{actorUserId:'default',ownerUserId:'default',chatJid:'web:default',kind:'interactive'}};
  const scoped=await call(identity);expect(scoped.systemPrompt).toContain('LEGACY_MEMORY');expect(scoped.systemPrompt).not.toContain('notes/users/default');expect(scoped.systemPrompt).toContain('Current user');
});

test('read-time mode changes deny without optional-file fallback and legacy reads cannot continue after mode change',async()=>{
  const read=fs.readFileSync;const spy=spyOn(fs,'readFileSync').mockImplementation(((path:any,...args:any[])=>{
    const text=Reflect.apply(read,fs,[path,...args]);if(String(path).endsWith('/MEMORY.md'))config('single-user');return text;
  }) as any);
  try{await expect(call(alice)).rejects.toBeInstanceOf(ChatAccessDenied);}finally{spy.mockRestore();}
  config('single-user');const next=spyOn(fs,'readFileSync').mockImplementation(((path:any,...args:any[])=>{
    const text=Reflect.apply(read,fs,[path,...args]);if(String(path).endsWith('/MEMORY.md'))config('family-shared');return text;
  }) as any);
  try{await expect(call(null)).rejects.toBeInstanceOf(ChatAccessDenied);}finally{next.mockRestore();}
});

test('authority loss on read or during final event projection cannot release gathered personal text',async()=>{
  const read=fs.readFileSync;const spy=spyOn(fs,'readFileSync').mockImplementation(((path:any,...args:any[])=>{
    const text=Reflect.apply(read,fs,[path,...args]);if(String(path).endsWith('/MEMORY.md'))getDb().query('UPDATE users SET enabled=0 WHERE id=?').run(alice.provenance.ownerUserId);return text;
  }) as any);
  try{await expect(call(alice)).rejects.toBeInstanceOf(ChatAccessDenied);}finally{spy.mockRestore();}
  await expect(call(bob,{get systemPrompt(){config('single-user');return 'base';}})).rejects.toBeInstanceOf(ChatAccessDenied);
});

test('observed denial stays latched when configuration recovers inside optional-file handling',async()=>{
  const original=accessConfig.readAccessConfig;let reads=0;
  const spy=spyOn(accessConfig,'readAccessConfig').mockImplementation((...args)=>{
    const value=original(...args);reads++;
    // initial mode, first validation, live-owner validation, file validation, live-owner validation,
    // then the check inside readOptional's catchable region.
    return reads===6?{mode:'single-user',isolation:null}:value;
  });
  try{await expect(call(alice)).rejects.toBeInstanceOf(ChatAccessDenied);expect(reads).toBe(6);}finally{spy.mockRestore();}
});

test('missing family files never fall back to global notes and output stays character-bounded',async()=>{
  fs.rmSync(join(ws.workspace,'notes/users',alice.provenance.ownerUserId),{recursive:true});let out=await call(alice);expect(out.systemPrompt).toContain('(missing)');expect(out.systemPrompt).not.toContain('LEGACY_');
  file(`notes/users/${alice.provenance.ownerUserId}/MEMORY.md`,'a'.repeat(20000)+'END_SENTINEL');out=await call(alice);expect(out.systemPrompt).not.toContain('END_SENTINEL');expect(out.systemPrompt).toContain('…');
});
