import {beforeEach,afterEach,expect,test} from 'bun:test';
import Database from 'bun:sqlite';
import {createHash} from 'node:crypto';
import {chmodSync,existsSync,mkdirSync,readFileSync,statSync,symlinkSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createTempWorkspace,setEnv} from './helpers.js';
import {getDb,initDatabase,closeDatabase} from '../src/db/connection.js';
import {handleAccessMigration} from '../src/cli-access-migration.js';
import {handleCliOptions} from '../src/cli.js';
import {readAccessState} from '../src/db/access-state.js';
import {readAccessMigrationInventory} from '../src/db/access-migration-plan.js';
import {adoptedJsonl} from './agent-pool/adopted-session-fixture.js';

let ws:ReturnType<typeof createTempWorkspace>,restore:()=>void,source:string,dir:string,original:typeof console.log,logs:string[];
beforeEach(()=>{
  ws=createTempWorkspace('piclaw-copy-cli-');restore=setEnv({PICLAW_WORKSPACE:ws.workspace,PICLAW_STORE:ws.store,PICLAW_DATA:ws.data});
  mkdirSync(join(ws.workspace,'.piclaw'));writeFileSync(join(ws.workspace,'.piclaw/config.json'),JSON.stringify({domains:{access:{mode:'single-user'}}}));dir=join(ws.workspace,'private');mkdirSync(dir,{mode:0o700});
  closeDatabase();initDatabase();const db=getDb();db.exec("INSERT INTO chats(jid,name,last_message_time) VALUES ('web:default','main','now'); INSERT INTO chat_branches(branch_id,chat_jid,root_chat_jid,agent_name,created_at,updated_at) VALUES ('root','web:default','web:default','main','now','now');");
  db.query("INSERT INTO messages(id,chat_jid,sender,content,timestamp) VALUES ('message','web:default','user',?,'now')").run('PRIVATE_TRANSCRIPT');source=join(ws.store,'messages.db');db.query('VACUUM INTO ?').run(source);closeDatabase();logs=[];original=console.log;console.log=(...args:unknown[])=>{logs.push(args.map(String).join(' '));};
});
afterEach(()=>{console.log=original;restore();ws.cleanup();process.exitCode=0;});
const digest=()=>createHash('sha256').update(readFileSync(source)).digest('hex');
function preview(){handleAccessMigration(['preview','--output',join(dir,'inventory.json')]);const inventory=JSON.parse(readFileSync(join(dir,'inventory.json'),'utf8'));for(const row of inventory.plan.assignments)row.owner_user_id='default';writeFileSync(join(dir,'plan.json'),JSON.stringify(inventory.plan));return inventory;}
const args=()=>['prepare-copy','--plan',join(dir,'plan.json'),'--destination',join(dir,'prepared.sqlite'),'--writers-stopped','--backup-set-confirmed','--confirm','PREPARE OWNERSHIP COPY'];

test('CLI creates verified copy only, preserves source bytes and keeps transcript out of inventory/stdout',async()=>{
  const before=digest();preview();expect(readFileSync(join(dir,'inventory.json'),'utf8')).not.toContain('PRIVATE_TRANSCRIPT');
  expect(await handleCliOptions(['access-migration',...args()])).toBe(true);expect(process.exitCode??0).toBe(0);expect(digest()).toBe(before);
  const copy=new Database(join(dir,'prepared.sqlite'),{readonly:true}), originalDb=new Database(source,{readonly:true});
  try{expect(copy.query('SELECT content FROM messages').get()).toEqual({content:'PRIVATE_TRANSCRIPT'});expect(()=>readAccessState(copy)).toThrow('Prepared migration copy');expect(readAccessState(originalDb).activatedMode).toBe('single-user');expect(originalDb.query('SELECT * FROM session_roots').all()).toEqual([]);expect(copy.query('SELECT owner_user_id FROM session_roots').get()).toEqual({owner_user_id:'default'});}finally{copy.close();originalDb.close();}
  expect(statSync(join(dir,'prepared.sqlite')).mode&0o777).toBe(0o600);expect(statSync(join(dir,'inventory.json')).mode&0o777).toBe(0o600);expect(logs.join('\n')).not.toContain('PRIVATE_TRANSCRIPT');expect(existsSync(join(ws.store,'runtime.lock'))).toBe(false);
});
test('changed source or bad plan cannot prepare; existing/symlink/unsafe destinations are not overwritten',()=>{
  preview();const before=digest();expect(()=>handleAccessMigration(args().filter(value=>value!=='--writers-stopped'))).toThrow();
  const target=join(dir,'prepared.sqlite');symlinkSync(source,target);expect(()=>handleAccessMigration(args())).toThrow('already exists');expect(digest()).toBe(before);
  chmodSync(dir,0o755);expect(()=>handleAccessMigration(args())).toThrow('owner-only');chmodSync(dir,0o700);
  const db=new Database(source);db.exec("UPDATE chat_branches SET agent_name='newname'");db.close();
  expect(()=>handleAccessMigration(args().map(value=>value===target?join(dir,'new.sqlite'):value))).toThrow('changed');expect(existsSync(join(dir,'new.sqlite'))).toBe(false);
});
test('active lock, quarantined source and failed destination migration leave no partial output',()=>{
  preview();const before=digest();writeFileSync(join(ws.store,'runtime.lock'),JSON.stringify({pid:process.pid}));expect(()=>handleAccessMigration(args())).toThrow('already running');
  writeFileSync(join(ws.store,'runtime.lock'),JSON.stringify({pid:2147483647}));const db=new Database(source);db.exec("CREATE TRIGGER reject_copy BEFORE INSERT ON session_roots BEGIN SELECT RAISE(ABORT,'copy failed'); END");
  const revised=readAccessMigrationInventory(db).plan;revised.assignments[0]!.owner_user_id='default';writeFileSync(join(dir,'plan.json'),JSON.stringify(revised));db.close();
  expect(()=>handleAccessMigration(args())).toThrow('copy failed');expect(existsSync(join(dir,'prepared.sqlite'))).toBe(false);expect(existsSync(join(ws.store,'runtime.lock'))).toBe(false);
  const check=new Database(source,{readonly:true});try{expect(check.query('SELECT * FROM session_roots').all()).toEqual([]);expect(readAccessState(check).activatedMode).toBe('single-user');}finally{check.close();}
  expect(digest()).not.toBe(before); // Only the test's intentional trigger changed the source.
});

test('version-two plan captures a hash-checked child tree into copy provenance without changing source files or enabling startup',()=>{
  const db=new Database(source);db.exec("INSERT INTO chats(jid,name,last_message_time) VALUES ('web:child','child','now'); INSERT INTO chat_branches(branch_id,chat_jid,root_chat_jid,parent_branch_id,agent_name,created_at,updated_at) VALUES ('child','web:child','web:default','root','child','now','now')");db.close();
  const sessions=join(ws.data,'sessions'),parentDir=join(sessions,'web_default'),childDir=join(sessions,'web_child');mkdirSync(parentDir,{recursive:true});mkdirSync(childDir,{recursive:true});
  const parent=join(parentDir,'parent.jsonl');writeFileSync(parent,'parent');const fixture=adoptedJsonl(ws.workspace,parent),file=join(childDir,'child.jsonl');writeFileSync(file,fixture.jsonl);
  const inventory=preview();const plan={...inventory.plan,version:2,child_sessions:[{chat_jid:'web:child',file,sha256:fixture.sha256}]};writeFileSync(join(dir,'plan.json'),JSON.stringify(plan));const before=digest();
  handleAccessMigration(args());expect(digest()).toBe(before);expect(readFileSync(file,'utf8')).toBe(fixture.jsonl);
  const copy=new Database(join(dir,'prepared.sqlite'),{readonly:true});try{const row=copy.query("SELECT seed_json,materialised_at FROM owned_fork_operations WHERE target_branch_id='child'").get() as any;expect(JSON.parse(row.seed_json)).toEqual({version:1,mode:'adopted_jsonl',sha256:fixture.sha256,jsonl:fixture.jsonl});expect(row.materialised_at).toBeNull();expect(()=>readAccessState(copy)).toThrow();}finally{copy.close();}
  expect(logs.join('\n')).not.toContain('ADOPTED_PRIVATE');
});

test('child adoption refuses hash/path/parent/pending-seed mismatches and never leaves a partial copy',()=>{
  const db=new Database(source);db.exec("INSERT INTO chats(jid,name,last_message_time) VALUES ('web:child','child','now'); INSERT INTO chat_branches(branch_id,chat_jid,root_chat_jid,parent_branch_id,agent_name,created_at,updated_at) VALUES ('child','web:child','web:default','root','child','now','now')");db.close();
  const parentDir=join(ws.data,'sessions','web_default'),childDir=join(ws.data,'sessions','web_child');mkdirSync(parentDir,{recursive:true});mkdirSync(childDir,{recursive:true});const parent=join(parentDir,'parent.jsonl');writeFileSync(parent,'parent');
  const fixture=adoptedJsonl(ws.workspace,parent),file=join(childDir,'child.jsonl');writeFileSync(file,fixture.jsonl);const inventory=preview();
  for(const entry of [{chat_jid:'web:child',file,sha256:'0'.repeat(64)},{chat_jid:'web:default',file,sha256:fixture.sha256},{chat_jid:'web:child',file:parent,sha256:fixture.sha256}]){writeFileSync(join(dir,'plan.json'),JSON.stringify({...inventory.plan,version:2,child_sessions:[entry]}));expect(()=>handleAccessMigration(args())).toThrow();expect(existsSync(join(dir,'prepared.sqlite'))).toBe(false);}
  writeFileSync(join(dir,'plan.json'),JSON.stringify({...inventory.plan,version:2,child_sessions:[{chat_jid:'web:child',file,sha256:fixture.sha256}]}));writeFileSync(join(childDir,'.branch-seed.json'),'{}');expect(()=>handleAccessMigration(args())).toThrow('Pending legacy');
});
