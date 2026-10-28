import { AgentQueue } from '../../src/queue.js';
import { getDb, getTaskRunLogs } from '../../src/db.js';
import { createCurrentPiclawScheduledRunStore } from '../../src/service-effects/current-piclaw/scheduled-run-store.js';
import { pollScheduledRunsOnce,type SchedulerDeps } from '../../src/task-scheduler.js';
import type { ScheduledTask } from '../../src/types.js';

/** Exercise a real S07 claim/queue/settlement around a caller-supplied native port. */
export async function runAdmittedScheduledTask(task:ScheduledTask,deps:SchedulerDeps){
  const database=getDb();
  database.exec('PRAGMA foreign_keys=ON');
  const built=createCurrentPiclawScheduledRunStore(database,{hitFault:()=>false,recordTrace:()=>{}});
  if(!built.ok)throw Error(built.error._tag);
  const queue=new AgentQueue();
  try {
    await pollScheduledRunsOnce({...deps,queue},built.value);
    await queue.shutdown();
    const log=getTaskRunLogs(task.id)[0];
    if(!log)throw Error('Admitted scheduled task did not settle');
    return log;
  }finally{await queue.shutdown();}
}
