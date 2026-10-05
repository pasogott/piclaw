/** Real scheduled claim/store/queue, synthetic agent and outbound sinks only. */
import assert from 'node:assert/strict';
import Database from 'bun:sqlite';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {performance,monitorEventLoopDelay} from 'node:perf_hooks';
import {initDatabase,getDb,closeDatabase} from '../../src/db/connection.js';
import {createTask,getTaskById,getTaskRunLogs,updateTask} from '../../src/db/tasks.js';
import {AgentQueue} from '../../src/queue.js';
import {pollScheduledRunsOnce,startSchedulerLoop,stopSchedulerLoop,resetSchedulerMetricsForTests,getSchedulerMetrics} from '../../src/task-scheduler.js';
import {createCurrentPiclawScheduledRunStore} from '../../src/service-effects/current-piclaw/scheduled-run-store.js';
import {assertPathWithinTestFilesystemIsolation} from '../../scripts/test-filesystem-isolation.js';
const workspace=process.env.PICLAW_WORKSPACE!,store=process.env.PICLAW_STORE!;
assertPathWithinTestFilesystemIsolation(workspace,process.env,{allowRoot:false});assert.equal(process.env.PICLAW_DB_IN_MEMORY,'0');
mkdirSync(join(workspace,'.piclaw'),{recursive:true});writeFileSync(join(workspace,'.piclaw/config.json'),JSON.stringify({domains:{access:{mode:'single-user'}}}));
const originalFetch=globalThis.fetch;let fetchAttempts=0;const deny=()=>{fetchAttempts++;throw Error('No external fetch')};globalThis.fetch=Object.assign(deny,{preconnect:deny})as typeof fetch;
initDatabase();const primary=getDb(),scheduled=new Database(join(store,'messages.db'));
scheduled.exec('PRAGMA journal_mode=WAL;PRAGMA synchronous=FULL;PRAGMA busy_timeout=5000;PRAGMA foreign_keys=ON');
const built=createCurrentPiclawScheduledRunStore(scheduled,{hitFault:()=>false,recordTrace:()=>undefined});assert(built.ok);if(!built.ok)throw Error('store');
const due='2026-01-01T00:00:00.000Z',taskCount=12;
primary.transaction(()=>{for(let n=0;n<taskCount;n++)createTask({id:'claim-probe-'+n,chat_jid:'web:claim-lane-'+n%4,prompt:'Synthetic scheduled fixture',schedule_type:'interval',schedule_value:'3600000',next_run:due,status:'active',notify_on_complete:false,created_at:due})}).immediate();
resetSchedulerMetricsForTests();const queue=new AgentQueue(),activeByChat=new Map<string,number>();let peak=0,agentCalls=0,sends=0,restores=0,saves=0,nudges=0;
let release!:()=>void;const gate=new Promise<void>(r=>release=r);
const deps={queue,agentPool:{saveSessionPosition:async()=>{saves++;return'synthetic-leaf'},restoreSessionPosition:async()=>{restores++},getCurrentModelLabel:async()=>null,runAgent:async(_prompt:string,chat:string)=>{
 const live=(activeByChat.get(chat)??0)+1;activeByChat.set(chat,live);assert.equal(live,1);agentCalls++;peak=Math.max(peak,[...activeByChat.values()].reduce((a,b)=>a+b,0));
 const bound=primary.query("SELECT count(*) AS n FROM service_effect_s07_occurrences WHERE state='source_bound'").get()as{n:number};assert(bound.n>0);
 try{await gate;await Bun.sleep(5);return{status:'success',result:'Synthetic no-provider result'}}finally{activeByChat.set(chat,live-1)}
}},sendMessage:async()=>{sends++},sendNudge:async()=>{nudges++}}as any;
const loop=monitorEventLoopDelay({resolution:1});loop.enable();const phases:unknown[]=[],cpu=process.cpuUsage(),start=performance.now();
async function phase(name:string,fn:()=>Promise<void>){const at=performance.now();await fn();phases.push({name,wallMs:performance.now()-at})}
try{
 await phase('start-real-claim-loop-and-queue',async()=>{
  startSchedulerLoop(deps);
  const claimDeadline=performance.now()+10000;while(queue.getMetrics().enqueued<taskCount&&performance.now()<claimDeadline)await Bun.sleep(5);
  assert.equal(queue.getMetrics().enqueued,taskCount);
 });
 await phase('repeat-poll-no-duplicate',()=>pollScheduledRunsOnce(deps,built.value));
 assert.equal(queue.getMetrics().enqueued,taskCount);
 // Gate all four lane heads so paused pending work cannot run before mutation.
 const startedDeadline=performance.now()+10000;while(agentCalls<4&&performance.now()<startedDeadline)await Bun.sleep(5);
 assert.equal(agentCalls,4);updateTask('claim-probe-8',{status:'paused'});release();
 const deadline=performance.now()+15000;while(queue.getMetrics().succeeded<taskCount&&performance.now()<deadline)await Bun.sleep(10);
 assert.equal(queue.getMetrics().failed,0);assert.equal(queue.getMetrics().succeeded,taskCount);await queue.shutdown();
 const rows=primary.query('SELECT task_id,state,attempt,task_revision FROM service_effect_s07_occurrences ORDER BY task_id').all()as Array<{task_id:string;state:string;attempt:number}>;
 assert.equal(rows.length,taskCount);assert.equal(rows.filter(r=>r.state==='completed').length,11);assert.equal(rows.find(r=>r.task_id==='claim-probe-8')?.state,'abandoned');assert(rows.every(r=>r.attempt===1));
 for(let n=0;n<taskCount;n++){const paused=n===8;assert.equal(getTaskRunLogs('claim-probe-'+n).length,paused?0:1);if(!paused)assert.notEqual(getTaskById('claim-probe-'+n)?.next_run,due);}
 const sources=primary.query("SELECT s.state,o.phase FROM service_effect_s01_sources s JOIN service_effect_s01_operations o ON o.chat_jid=s.chat_jid AND o.primary_source_seq=s.source_seq WHERE s.kind='scheduled_agent'").all()as Array<{state:string;phase:string}>;
 assert.equal(sources.length,11);assert(sources.every(r=>r.state==='consumed'&&r.phase==='terminal'));assert.deepEqual({agentCalls,sends,nudges,saves,restores},{agentCalls:11,sends:11,nudges:0,saves:11,restores:11});assert.equal(peak,4);
 await phase('post-completion-poll',()=>pollScheduledRunsOnce(deps,built.value));assert.equal(queue.getMetrics().enqueued,taskCount);
 assert.deepEqual(primary.query('PRAGMA quick_check').get(),{quick_check:'ok'});assert.equal(fetchAttempts,0);await Bun.sleep(10);loop.disable();
 console.log(JSON.stringify({runtime:Bun.version,taskCount,completed:11,pausedAbandoned:1,claimsDeduplicated:true,sourceSettlementVerified:true,queue:queue.getMetrics(),scheduler:getSchedulerMetrics(),peakConcurrentLanes:peak,wallMs:performance.now()-start,cpu:process.cpuUsage(cpu),phases,eventLoop:{samples:loop.count,resolutionMs:1,maxMs:loop.max/1e6,meanMs:loop.mean/1e6},memory:process.memoryUsage(),settings:{journal:scheduled.query('PRAGMA journal_mode').get(),synchronous:scheduled.query('PRAGMA synchronous').get(),foreignKeys:scheduled.query('PRAGMA foreign_keys').get()},fetchAttempts,scope:'Actual startSchedulerLoop initial poll plus repeat pollScheduledRunsOnce + disk EF-S07 stores + AgentQueue lane/dedup + source bind/complete/abandon/recurrence. Agent execution/restore and outbound sinks are injected; no inference, real SDK history restoration, live scheduler or real delivery. CPU excludes seed; external whole-child CPU includes it.'}));
}finally{release?.();await queue.shutdown();stopSchedulerLoop();loop.disable();scheduled.close();globalThis.fetch=originalFetch;closeDatabase()}
