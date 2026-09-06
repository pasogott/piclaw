import type Database from 'bun:sqlite';
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, resolve, sep } from 'node:path';
import type { AuthenticatedPrincipal } from '../core/access-types.js';
import { readAccessConfig } from '../core/config-access.js';
import { getDataDir, getStoreDir, getWorkspaceDir } from '../core/config-context.js';
import { getExecutionIdentity } from '../core/execution-context.js';
import { requireAccountActor } from '../db/account-administration.js';
import { getDb } from '../db/connection.js';
import { ChatAccessDenied } from '../db/session-ownership.js';
import { createLogger,debugSuppressedError } from '../utils/logger.js';

const MAX_DAYS=31,MAX_MESSAGES=5000,MAX_MESSAGE_BYTES=100*1024,MAX_TOTAL_BYTES=8*1024*1024;
const log=createLogger('agent-memory.family-dream');
const safeId=(value:string)=>/^[a-zA-Z0-9_-]{1,128}$/.test(value);
const wellFormed=(value:string)=>Buffer.from(value,'utf8').toString('utf8')===value;
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const json=(value:unknown)=>JSON.stringify(value).replaceAll('\u2028','\\u2028').replaceAll('\u2029','\\u2029');
interface Row {rowid:number;message_id:string;chat_jid:string;root_chat_jid:string;content:string;timestamp:string;sender_name:string;is_bot_message:number}
export interface FamilyDreamSnapshot {owner_user_id:string;generation:string;root:string;current_path:string;message_count:number;tree_count:number;days:string[]}

function ensureDirectory(path:string):void {
  mkdirSync(path,{recursive:true,mode:0o700});
  let current=path;
  while(current!==dirname(current)){
    const stat=lstatSync(current);if(stat.isSymbolicLink()||!stat.isDirectory())throw new ChatAccessDenied();
    if(current===getWorkspaceDir())break;current=dirname(current);
  }
}
function atomic(path:string,content:string,validate:()=>void):void {
  validate();ensureDirectory(dirname(path));const temp=`${path}.tmp-${randomUUID()}`;
  try{writeFileSync(temp,content,{encoding:'utf8',mode:0o600,flag:'wx'});validate();renameSync(temp,path);}
  finally{rmSync(temp,{force:true});}
}
function day(timestamp:string):string {const date=new Date(timestamp);if(!Number.isFinite(date.getTime())||date.toISOString()!==timestamp)throw new ChatAccessDenied();return timestamp.slice(0,10);}

/**
 * Materialise one owner-only Dream source generation. This does not invoke a model,
 * schedule Dream, update legacy notes, or publish family memory.
 */
export function prepareOwnFamilyDreamSnapshot(database:Database,principal:AuthenticatedPrincipal,options:{days?:number}={}):FamilyDreamSnapshot {
  const actor=Object.freeze({...principal,authentication:Object.freeze({...principal.authentication})});
  const mode=readAccessConfig().mode,workspace=getWorkspaceDir(),store=getStoreDir(),data=getDataDir();let denied=false;
  const validate=()=>{
    try{
      if(denied||mode!=='family-shared'||readAccessConfig().mode!==mode||getWorkspaceDir()!==workspace||getStoreDir()!==store||getDataDir()!==data
        ||database!==getDb()||getExecutionIdentity()||!safeId(actor.userId))throw new ChatAccessDenied();
      const live=requireAccountActor(database,actor,{recent:true});if(live.id!==actor.userId||live.role!==actor.role||live.home_chat_jid!==actor.homeChatJid)throw new ChatAccessDenied();
    }catch(error){denied=true;throw error;}
  };
  const requestedDays=options.days??7;if(!Number.isSafeInteger(requestedDays)||requestedDays<1||requestedDays>MAX_DAYS)throw new ChatAccessDenied();const days=requestedDays;
  validate();
  const root=resolve(workspace,'notes','users',actor.userId,'dream');
  if(!root.startsWith(resolve(workspace,'notes','users')+sep))throw new ChatAccessDenied();
  ensureDirectory(root);const lockPath=resolve(root,'.lock'),token=randomUUID();let fd:number|undefined;
  try{
    fd=openSync(lockPath,'wx',0o600);writeFileSync(fd,JSON.stringify({pid:process.pid,token,owner_user_id:actor.userId}));validate();
    const cutoff=new Date(Date.now()-days*86400000).toISOString();
    const rows=database.transaction(()=>{
      validate();const result=database.query(`SELECT m.rowid,m.id message_id,m.chat_jid,b.root_chat_jid,m.content,m.timestamp,m.sender_name,COALESCE(m.is_bot_message,0) is_bot_message
        FROM messages m JOIN chat_branches b ON b.chat_jid=m.chat_jid JOIN chat_branches r ON r.chat_jid=b.root_chat_jid AND r.parent_branch_id IS NULL
        JOIN session_roots o ON o.root_branch_id=r.branch_id WHERE o.owner_user_id=? AND m.chat_jid NOT LIKE 'dream:%' AND r.chat_jid NOT LIKE 'dream:%' AND m.timestamp>=?
        ORDER BY m.timestamp,m.rowid LIMIT ?`).all(actor.userId,cutoff,MAX_MESSAGES+1) as Row[];validate();return result;
    })();
    if(rows.length>MAX_MESSAGES)throw new ChatAccessDenied();let total=0;const byDay=new Map<string,Row[]>(),trees=new Set<string>();
    for(const row of rows){validate();if(!Number.isSafeInteger(row.rowid)||row.rowid<=0||!safeId(row.message_id)||!row.chat_jid||!row.root_chat_jid
        ||typeof row.content!=='string'||row.content.includes('\0')||!wellFormed(row.content)||Buffer.byteLength(row.content)>MAX_MESSAGE_BYTES
        ||typeof row.sender_name!=='string'||row.sender_name.includes('\0')||!wellFormed(row.sender_name)||Buffer.byteLength(row.sender_name)>512
        ||Buffer.byteLength(row.chat_jid)>512||Buffer.byteLength(row.root_chat_jid)>512||![0,1].includes(row.is_bot_message))throw new ChatAccessDenied();
      const emitted=`- ${row.timestamp} · ${row.is_bot_message?'assistant':'user'} · ${json(row.sender_name)} · ${json(row.chat_jid)} · row ${row.rowid} · message ${json(row.message_id)}\n  - ${json(row.content)}`;
      total+=Buffer.byteLength(emitted)+1;if(total>MAX_TOTAL_BYTES)throw new ChatAccessDenied();const key=day(row.timestamp);trees.add(row.root_chat_jid);const list=byDay.get(key)??[];list.push(row);byDay.set(key,list);
    }
    const generatedAt=new Date().toISOString(),generation=`${generatedAt.replace(/[:.]/g,'-')}-${randomUUID()}`;
    const stage=resolve(root,`.stage-${generation}`),final=resolve(root,'generations',generation);ensureDirectory(stage);
    try{
      const dates=[...byDay.keys()].sort();for(const date of dates){validate();const items=byDay.get(date)!;
        const lines=['---',`date: ${date}`,`owner_user_id: ${actor.userId}`,'scope_mode: owner-session-trees',`messages_total: ${items.length}`,`first_message: ${items[0]!.timestamp}`,`last_message: ${items.at(-1)!.timestamp}`,'---','',`# ${date}`,'','## Transcript evidence',''];
        for(const row of items)lines.push(`- ${row.timestamp} · ${row.is_bot_message?'assistant':'user'} · ${json(row.sender_name)} · ${json(row.chat_jid)} · row ${row.rowid} · message ${json(row.message_id)}`,`  - ${json(row.content)}`);
        atomic(resolve(stage,'daily',`${date}.md`),`${lines.join('\n')}\n`,validate);
      }
      const index=['# Owner Dream source index','',`Owner ID: ${json(actor.userId)}`,`Generated: ${generatedAt}`,'','This generation contains only transcript rows from session roots owned by this immutable account ID. It is source material awaiting explicit consolidation.','',...dates.map(date=>`- [${date}](daily/${date}.md)`)];
      atomic(resolve(stage,'MEMORY.md'),`${index.join('\n')}\n`,validate);
      const manifest={version:1,generation,owner_user_id:actor.userId,generated_at:generatedAt,days,source_scope:'owner-session-trees',message_count:rows.length,tree_count:trees.size,total_evidence_bytes:total,dates};
      const manifestText=`${JSON.stringify(manifest,null,2)}\n`;atomic(resolve(stage,'manifest.json'),manifestText,validate);validate();ensureDirectory(dirname(final));renameSync(stage,final);validate();
      const pointer={version:1,generation,owner_user_id:actor.userId,manifest_sha256:hash(manifestText),generated_at:generatedAt};
      atomic(resolve(root,'current.json'),`${JSON.stringify(pointer,null,2)}\n`,validate);
      return {owner_user_id:actor.userId,generation,root:final,current_path:resolve(root,'current.json'),message_count:rows.length,tree_count:trees.size,days:dates};
    }catch(error){rmSync(stage,{recursive:true,force:true});throw error;}
  } finally {
    if(fd!==undefined)try{closeSync(fd);}catch(error){debugSuppressedError(log,'failed to close family Dream owner lock',error,{ownerUserId:actor.userId});}
    try{if(existsSync(lockPath)){const value=JSON.parse(readFileSync(lockPath,'utf8'));if(value.token===token&&value.owner_user_id===actor.userId)rmSync(lockPath,{force:true});}}
    catch(error){debugSuppressedError(log,'failed to release family Dream owner lock',error,{ownerUserId:actor.userId});}
  }
}
