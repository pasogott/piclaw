/** Release regression/measurement probe. No provider/model calls or live data. */
import { mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { assertPathWithinTestFilesystemIsolation, getActiveTestFilesystemIsolationRoot } from '../../../scripts/test-filesystem-isolation.js';
if (!getActiveTestFilesystemIsolationRoot()) throw Error('Isolated test launcher required');
const workspace=process.env.PICLAW_WORKSPACE!,store=process.env.PICLAW_STORE!;
const direction=process.argv[2]??'forward', scale=process.argv[3]??'0';
const phase=process.argv[4]??'build';
if(!['build','reopen','incremental'].includes(phase))throw Error('Unknown phase');
if(!['forward','reverse'].includes(direction)||!['0','500'].includes(scale))throw Error('Unknown evaluation options');
for (const p of [workspace,store,process.env.PICLAW_DATA!]) assertPathWithinTestFilesystemIsolation(p);
process.env.PICLAW_DB_IN_MEMORY='0';process.env.PICLAW_DISABLE_BACKGROUND_WORKSPACE_INDEX='1';
const frozen=join(import.meta.dir,'independent-v3');
const manifest=JSON.parse(readFileSync(join(frozen,'manifest.json'),'utf8'));
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
for (const [file,expected] of Object.entries({ 'evaluation.json':manifest.files['evaluation.json'], 'policy.json':manifest.files['policy.json'], ...manifest.files.notes } as Record<string,string>)) {
 const actual=hash(readFileSync(join(frozen,file)));
 if(actual!==expected)throw Error(`Frozen corpus changed: ${file}`);
}
const fixtureFiles=16+Number(scale);
if(phase==='build'){
 mkdirSync(join(workspace,'.piclaw'),{recursive:true});mkdirSync(join(workspace,'notes'),{recursive:true});
 writeFileSync(join(workspace,'.piclaw/config.json'),JSON.stringify({domains:{access:{mode:'single-user'}}}));
 const names=readdirSync(join(frozen,'notes')).sort();
 for(const name of direction==='reverse'?[...names].reverse():names)writeFileSync(join(workspace,'notes',name),readFileSync(join(frozen,'notes',name)));
 // 500 * ~8 KiB of normal complete lines, not overlong excluded fillers.
 for(let i=0;i<Number(scale);i++)writeFileSync(join(workspace,'notes',`neutral-${String(i).padStart(4,'0')}.md`),`# Neutral ledger ${i}\n\n`+Array.from({length:64},(_,j)=>`Unrelated filler zqxv${i} item ${j}: ${'neutral material '.repeat(6)}\n`).join(''));
}
const {initDatabase,closeDatabase}=await import('../../../src/db/connection.js');initDatabase();
const {captureNoteIndexBinding}=await import('../../../src/note-retrieval/access.js');
if(phase==='incremental'){
 const {markNoteIndexDirty}=await import('../../../src/note-retrieval/coordinator.js');
 const file=join(workspace,'notes/neutral-0000.md');writeFileSync(file,readFileSync(file,'utf8')+'Additional unrelated material.\n');
 markNoteIndexDirty(['notes/neutral-0000.md']);
}
let refreshMs:number|null=null;
if(phase!=='reopen'){
 const started=performance.now();
 const worker=spawn(process.execPath,['-e',"const {runNoteIndexPhase}=await import('./src/note-retrieval/coordinator.ts');await runNoteIndexPhase();"],{
 cwd:join(import.meta.dir,'../../..'),env:process.env,stdio:['ignore','ignore','pipe','pipe']});
 const done=once(worker,'exit');let errors='';worker.stderr!.on('data',b=>errors+=b);(worker.stdio[3] as any).end(JSON.stringify(captureNoteIndexBinding()));
 const [exit]=await done;if(exit!==0)throw Error(errors);refreshMs=performance.now()-started;
}
// A fresh independent SQLite connection verifies the completed publication,
// rather than reusing any writer-side in-memory row state.
const reader=new Database(join(store,'messages.db'),{readonly:true});
const publication=reader.query('SELECT published,namespace FROM note_retrieval_state WHERE id=1').get() as {published:number;namespace:string};
if(!publication.published||!publication.namespace)throw Error('Missing committed publication');
const measured=reader.query('SELECT count(*) files,sum(bytes) sourceBytes FROM note_retrieval_sources WHERE generation=?').get(publication.published) as {files:number;sourceBytes:number};
if(measured.files!==fixtureFiles)throw Error('Excluded scale sources');
const footprint=reader.query("SELECT sum(pgsize) bytes FROM dbstat WHERE name IN (SELECT name FROM sqlite_schema WHERE tbl_name LIKE 'note_retrieval_%')").get() as {bytes:number};
reader.close();
const {createMemorySearchExtension}=await import('../../../src/extensions/memory-search.js');
const {createFakeExtensionApi}=await import('../../extensions/fake-extension-api.js');
const {withChatContext}=await import('../../../src/core/chat-context.js');
const fake=createFakeExtensionApi({activeTools:['memory_query','memory_get']});createMemorySearchExtension('web:coverage')(fake.api);
const ctx:any={cwd:workspace,sessionManager:{getSessionId:()=> 'coverage-session'}};
await fake.handlers.find(h=>h.event==='session_start')!.handler({},ctx);
const queryTool=fake.tools.get('memory_query'),getTool=fake.tools.get('memory_get');
const policy=JSON.parse(readFileSync(join(frozen,'policy.json'),'utf8'));
const data=JSON.parse(readFileSync(join(frozen,'evaluation.json'),'utf8')) as { queries: Array<{id:string;query:string;relevant:Array<{path:string;lineStart:number;lineEnd:number;quote:string}>,conflictingPaths?:string[]}> };
const ids=new Set<string>();
for(const item of data.queries){
 if(ids.has(item.id))throw Error(`Duplicate query: ${item.id}`);ids.add(item.id);
 for(const ref of item.relevant){
  if(!Object.hasOwn(manifest.files.notes,ref.path))throw Error(`Unlisted source: ${ref.path}`);
  const text=readFileSync(join(frozen,ref.path),'utf8').split(/\r?\n/).slice(ref.lineStart-1,ref.lineEnd).join('\n');
  if(text!==ref.quote)throw Error(`Label mismatch: ${item.id}`);
 }
}
const summary:any[]=[];
// Keep the frozen policy intact as historical evidence. The candidate API was
// rejected in #1428; do not import it into main just to reproduce that variant.
for(const variant of ['ranked']){
 for(const item of data.queries){
   const started=performance.now();
   const query=item.query;
   const response=await withChatContext('web:coverage','web',()=>queryTool.execute('q',{query,limit:5},undefined,undefined,ctx));
   const result=JSON.parse(response.content[0].text);
   const queryMs=performance.now()-started;
   const hits=result.hits??[];
   const covers=item.relevant.map(ref=>hits.some((hit:any)=>hit.path===ref.path && hit.snippet.includes(ref.quote)));
   const chunks: Array<{path:string;text:string}> = [];
   for(const hit of hits){
     const full=await withChatContext('web:coverage','web',()=>getTool.execute('g',{chunk_id:hit.chunk_id,source_revision:hit.source_revision},undefined,undefined,ctx));
     const got=JSON.parse(full.content[0].text);
     if(got.status!=='ok'||got.path!==hit.path||!got.text.includes(hit.snippet))throw Error(`Broken reference: ${item.id}`);
     let context='';
     for(const ref of hit.context??[]){
       const parent=await withChatContext('web:coverage','web',()=>getTool.execute('context',{chunk_id:ref.chunk_id,source_revision:ref.source_revision},undefined,undefined,ctx));
       const verified=JSON.parse(parent.content[0].text);
       if(verified.status!=='ok'||verified.path!==ref.path||verified.text!==ref.text)throw Error('Broken parent citation');
       context+=ref.text;
     }
     chunks.push({path:got.path,text:context+got.text});
   }
   const chunkCoverage=item.relevant.length>0 && item.relevant.every(ref=>chunks.some(chunk=>chunk.path===ref.path && chunk.text.includes(ref.quote)));
   summary.push({variant,id:item.id,query,answerable:item.relevant.length>0,
     contextCoverage:item.relevant.length>0&&item.relevant.every(ref=>hits.some((hit:any)=>hit.path===ref.path&&((hit.context??[]).map((p:any)=>p.text).join('')+hit.snippet).includes(ref.quote))),snippetCoverage:item.relevant.length>0&&covers.every(Boolean),chunkCoverage,
     stableHits:hits.map((hit:any)=>({path:hit.path,revision:hit.source_revision,first:hit.first_byte,last:hit.after_last_byte,snippet:hit.snippet,signals:hit.signals,
       context:(hit.context??[]).map((p:any)=>({path:p.path,revision:p.source_revision,first:p.first_byte,last:p.after_last_byte,text:p.text}))})),
     hits:hits.length,status:result.status,reasons:result.reasons??[],conflictingHits:hits.filter((hit:any)=>(item.conflictingPaths??[]).includes(hit.path)).length,
     bytes:Buffer.byteLength(JSON.stringify(response)),queryMs,elapsedMs:Math.round(performance.now()-started)});
 }
}
const referenceIds=new Map<string,string>();
// Stable source refs are asserted directly by the parent across same-store reopen.
const {getDb}=await import('../../../src/db/connection.js');
for(const row of getDb().query('SELECT chunk_id,revision,path,first_byte FROM note_retrieval_chunks WHERE generation=? ORDER BY path,first_byte').all(publication.published) as any[])if(!row.path.startsWith('notes/neutral-'))referenceIds.set(row.path+':'+row.first_byte,row.chunk_id+':'+row.revision);
console.log('RELEASE_REPORT='+JSON.stringify({phase,direction,scale:Number(scale),policy,summary,references:[...referenceIds],metrics:{...measured,refreshMs,indexBytes:footprint.bytes,totalDatabaseBytes:statSync(join(store,'messages.db')).size,rssBytes:process.memoryUsage().rss}}));closeDatabase();
