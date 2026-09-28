import {test,expect} from 'bun:test';
import {join} from 'node:path';
import {createTempWorkspace} from '../helpers.js';
test('release workflow: same-store reopen, 516 normal notes, incremental refresh and cited context',async()=>{
 const ws=createTempWorkspace('note-release-');
 const reports:any[]=[];
 try{
  for(const phase of ['build','reopen','incremental']){
   const child=Bun.spawn([process.execPath,join(import.meta.dir,'../fixtures/note-retrieval/release-probe.ts'),'forward','500',phase],{
    env:{...process.env,PICLAW_WORKSPACE:ws.workspace,PICLAW_STORE:ws.store,PICLAW_DATA:ws.data,PICLAW_DB_IN_MEMORY:'0',PICLAW_DISABLE_BACKGROUND_WORKSPACE_INDEX:'1'},stdout:'pipe',stderr:'pipe'});
   const timer=setTimeout(()=>child.kill(),120000);
   try{
    const[out,err,code]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);
    if(code!==0)throw Error(err.slice(-6000));
    const line=out.split('\n').find(l=>l.startsWith('RELEASE_REPORT='));expect(line).toBeDefined();
    reports.push(JSON.parse(line!.slice('RELEASE_REPORT='.length)));
   }finally{clearTimeout(timer);}
  }
  const stable=(r:any)=>r.summary.map(({elapsedMs,queryMs,bytes,...row}:any)=>row);
  for(const r of reports){
   expect(r.summary).toHaveLength(22);expect(r.summary.every((s:any)=>['ok','partial'].includes(s.status)&&s.bytes<=16384)).toBe(true);
   expect(r.summary.filter((s:any)=>s.answerable&&s.contextCoverage)).toHaveLength(12);
   expect(r.metrics.files).toBe(516);expect(r.metrics.sourceBytes).toBeGreaterThan(3*1024*1024);
   expect(r.references).toEqual(reports[0].references);expect(stable(r)).toEqual(stable(reports[0]));
  }
  console.log('RELEASE_MEASUREMENTS='+JSON.stringify(reports.map(r=>({phase:r.phase,metrics:r.metrics,queryMs:r.summary.map((s:any)=>s.queryMs),maxResponseBytes:Math.max(...r.summary.map((s:any)=>s.bytes)),covered:r.summary.filter((s:any)=>s.contextCoverage).length}))));
 }finally{ws.cleanup();}
},370000);
