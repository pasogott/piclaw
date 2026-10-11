import {expect,test}from'bun:test';
import {ComposerDictationController,type DictationDraft,type ComposerDictationProvider}from'../../web/src/ui/composer-dictation';
function fixture(){let draft:DictationDraft={text:'before selected after',revision:0,selectionStart:7,selectionEnd:15,chatJid:'web:test'};const states:string[]=[];const controller=new ComposerDictationController({readDraft:()=>({...draft}),writeDraft:(text,expected)=>{if(draft.revision!==expected)return false;draft={...draft,text,revision:draft.revision+1};return true;},state:s=>states.push(s)},1000);return{controller,states,read:()=>({...draft}),edit(text:string){const before={...draft};draft={...draft,text,revision:draft.revision+1};controller.draftChanged(before,draft);}};}
test('selection anchored partial/final updates preserve surroundings and final is idempotent',async()=>{
 const f=fixture();let ctx:any;let cancels=0;const provider:ComposerDictationProvider={id:'fixture',label:'fixture',availability:()=>({available:true}),start:async c=>{ctx=c;return{finish:async()=>({status:'finished'}),cancel:async()=>{cancels++;}};}};
 await f.controller.start(provider);expect(ctx.updateSegment({segmentId:'one',text:'hello',final:false})).toEqual({applied:true});expect(f.read().text).toBe('before hello after');
 ctx.updateSegment({segmentId:'one',text:'hello world',final:true});ctx.updateSegment({segmentId:'one',text:'hello world',final:true});expect(f.read().text).toBe('before hello world after');
 expect(ctx.updateSegment({segmentId:'one',text:'overwrite',final:false})).toEqual({applied:false});await f.controller.finish();expect(ctx.updateSegment({segmentId:'two',text:'late',final:true})).toEqual({applied:false});expect(cancels).toBe(0);
});
test('Send during loading waits final updates and repeated Send submits once',async()=>{
 const f=fixture();let ctx:any,resolve!:any;const start=new Promise<any>(r=>resolve=r);const provider:ComposerDictationProvider={id:'fixture',label:'fixture',availability:()=>({available:true}),start:c=>{ctx=c;return start;}};
 const starting=f.controller.start(provider);await Promise.resolve();await Promise.resolve();let sends=0;const send=()=>f.controller.submit(async()=>{sends++;expect(f.read().text).toBe('before final after');});const pending=send();expect(send()).toBe(pending);expect(sends).toBe(0);
 resolve({finish:async()=>{ctx.updateSegment({segmentId:'one',text:'final',final:true});return{status:'finished'};},cancel:async()=>{}});await starting;expect(await pending).toBe(true);expect(sends).toBe(1);
});
test('outside edits move anchor, inside edits cancel and reject stale callbacks',async()=>{
 const f=fixture();let ctx:any,cancels=0;await f.controller.start({id:'f',label:'f',availability:()=>({available:true}),start:async c=>{ctx=c;return{finish:async()=>({status:'finished'}),cancel:async()=>{cancels++;}};}});
 ctx.updateSegment({segmentId:'one',text:'hello',final:false});f.edit('prefix before hello after');ctx.updateSegment({segmentId:'one',text:'world',final:false});expect(f.read().text).toBe('prefix before world after');
 f.edit('prefix before manual after');expect(ctx.updateSegment({segmentId:'one',text:'late',final:true})).toEqual({applied:false});await f.controller.cancel();expect(f.read().text).toBe('prefix before manual after');expect(cancels).toBe(1);
});
test('late start after cancel releases capture exactly once and suppresses callbacks',async()=>{
 const f=fixture();let resolve!:any,ctx:any,cancels=0;const acquired=new Promise<any>(r=>resolve=r);
 const starting=f.controller.start({id:'late',label:'late',availability:()=>({available:true}),start:c=>{ctx=c;return acquired;}});
 await Promise.resolve();await Promise.resolve();const cleanup=f.controller.cancel();expect(f.controller.active).toBe(true);
 expect(ctx.updateSegment({segmentId:'one',text:'late',final:true})).toEqual({applied:false});
 resolve({finish:async()=>({status:'finished'}),cancel:async()=>{cancels++;}});await starting;await cleanup;
 expect(cancels).toBe(1);expect(f.controller.active).toBe(false);expect(f.read().text).toBe('before selected after');
});
test('finish failure rejects pending Send and preserves the draft',async()=>{
 const f=fixture();let cancels=0,sends=0;
 await f.controller.start({id:'broken',label:'broken',availability:()=>({available:true}),start:async()=>({finish:async()=>{throw Error('private transcript failure');},cancel:async()=>{cancels++;}})});
 await expect(f.controller.submit(async()=>{sends++;})).rejects.toThrow('Dictation finish failed');
 await f.controller.cancel();expect(sends).toBe(0);expect(cancels).toBe(1);expect(f.read().text).toBe('before selected after');
});

test('start and finish failures remain terminal errors after cleanup completes',async()=>{
 for(const phase of ['start','finish']){
  const f=fixture();const c=f.controller;
  await c.start({id:'terminal',label:'Terminal',availability:()=>({available:true}),start:async()=>{if(phase==='start')throw Error('start');return{finish:async()=>{throw Error('finish');},cancel:async()=>{}};}});
  if(phase==='finish')await expect(c.finish()).rejects.toThrow('finish');
  await c.cancel();expect(f.states.at(-1)).toBe('error');
 }
});

test('provider-reported error aborts capture and rejects held Send',async()=>{
 const f=fixture();let context:any,release!:()=>void,cancels=0;const held=new Promise<void>(resolve=>{release=resolve;});
 await f.controller.start({id:'reported',label:'Reported',availability:()=>({available:true}),start:async c=>{context=c;return{finish:async()=>{await held;return{status:'finished'};},cancel:async()=>{cancels++;}};}});
 const pending=f.controller.submit(async()=>{throw Error('must not send');});context.setState('error');release();await expect(pending).rejects.toThrow('finish');await f.controller.cancel();expect(context.signal.aborted).toBe(true);expect(cancels).toBe(1);expect(f.states.at(-1)).toBe('error');
});
