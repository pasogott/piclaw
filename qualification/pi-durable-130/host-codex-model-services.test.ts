import { test, expect } from 'bun:test';
import { createHostModels } from '../../runtime/durable-engine/src/host-models.ts';
import { HostCodexModelServices } from '../../runtime/durable-engine/src/host-codex-model-services.ts';
import { ModelRuntime } from '../../node_modules/@earendil-works/pi-coding-agent/dist/index.js';
import { createProvider, createAssistantMessageEventStream } from '../../node_modules/@earendil-works/pi-ai/dist/index.js';

test('public Root 1.2 registration precedes private 1.3 selection and denies caller callbacks', async () => {
 const root = await ModelRuntime.create({ modelsPath: null, refreshOnCreate: false, credentials: {get: async()=>undefined, set:async()=>{}, delete:async()=>{}, list:async()=>[]} as any });
 const service = new HostCodexModelServices({capture:async()=>{throw Error('No owned request')}, assertAccount(){}, observe:async()=>{},flush:async()=>{}}, {createNativeCodexHooks(){throw Error("unused")}});
 const model:any = {provider:'openai-codex', id:'qualified-codex', api:'openai-codex-responses', name:'fixture', baseUrl:'https://fixture.invalid', type:'chat', reasoning:false,input:['text','image'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:100,maxTokens:10};
 const provider = createProvider({id:'openai-codex',auth:{},models:[model],api:{stream:()=>createAssistantMessageEventStream(),streamSimple:()=>createAssistantMessageEventStream()}});
 service.register(root,provider);
 expect(root.getPhysicalModel(model.provider,model.id)?.id).toBe(model.id);
 const models = createHostModels(root,[model],{signal:new AbortController().signal,authorize:async()=>{},assertCurrent(){},codex:service});
 const selected = models.getModel(model.provider,model.id)!;
 let called=false;
 expect(()=>models.streamSimple(selected,{messages:[]},{onPayload:()=>{called=true}})).toThrow('Unqualified request option');
 expect(called).toBe(false);
});

const fixtureModel: any = {provider:'openai-codex', id:'fixture', api:'openai-codex-responses'};
const factories = {createNativeCodexHooks: () => ({request:(p:unknown)=>p, headers:(h:any)=>h, context:(m:any)=>m, systemPrompt:(p:string)=>p})};
test('fetch delivers partial bytes before observer finishes and finish joins it', async () => {
 let release!:()=>void, writes=0, requests=0;
 const gate=new Promise<void>(r=>release=r);
 const service=new HostCodexModelServices({
  capture:async(signal)=>({id:'op',sessionId:'s',cwd:'/synthetic',model:fixtureModel,signal,assertCurrent(){}}),
  assertAccount(){}, async observe(_op,response,check){ await response.text(); await gate; check(); writes++; }, async flush(){},
  fetch:(async()=>{requests++; return new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('partial'));c.close();}}));}) as typeof fetch,
 },factories);
 const bound=(await service.bind(fixtureModel,new AbortController().signal))!;
 const response=await bound.options.fetch('https://synthetic.invalid');
 expect(await response.text()).toBe('partial'); expect(writes).toBe(0);
 let finished=false; const finishing=bound.finish().then(()=>{finished=true});
 await Promise.resolve(); expect(finished).toBe(false); release(); await finishing;
 expect(writes).toBe(1); expect(requests).toBe(1);
});
test('queued artifact write is fenced after revocation and observer rejection is joined', async()=>{
 let release!:()=>void, current=true, writes=0;
 const gate=new Promise<void>(r=>release=r);
 const service=new HostCodexModelServices({
 capture:async(signal)=>({id:'op',sessionId:'s',cwd:'/synthetic',model:fixtureModel,signal,assertCurrent(){if(!current)throw Error('revoked')}}),
 assertAccount(){},async observe(_op,_response,check){await gate; check(); writes++},async flush(){},
 fetch:(async()=>new Response('partial')) as typeof fetch,
 },factories);
 const bound=(await service.bind(fixtureModel,new AbortController().signal))!;
 await bound.options.fetch('https://synthetic.invalid'); current=false;release();
 await expect(bound.finish()).rejects.toThrow('revoked'); expect(writes).toBe(0);
});

test('provider success settles actual spend before failed output; unknown hold is not abandoned', async()=>{
 const root=await ModelRuntime.create({modelsPath:null,refreshOnCreate:false,credentials:{read:async()=>undefined,get:async()=>undefined,set:async()=>{},delete:async()=>{},list:async()=>[]} as any});
 const order:string[]=[];
 const model:any={...fixtureModel,name:'fixture',type:'chat',baseUrl:'https://synthetic.invalid',reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:100,maxTokens:10};
 const spent={input:3,output:2,cacheRead:0,cacheWrite:0,totalTokens:5,cost:{input:1,output:1,cacheRead:0,cacheWrite:0,total:2}};
 const message:any={role:'assistant',provider:model.provider,model:model.id,api:model.api,content:[],timestamp:1,stopReason:'stop',usage:spent};
 const stream=()=>{const s=createAssistantMessageEventStream(); queueMicrotask(()=>{s.push({type:'done',reason:'stop',message});s.end(message)});return s};
 const provider=createProvider({id:model.provider,auth:{apiKey:{name:'synthetic',resolve:async()=>({auth:{apiKey:'synthetic'},source:'fixture'})}},models:[model],api:{stream,streamSimple:stream}});
 const service=new HostCodexModelServices({capture:async(signal)=>({id:'o',sessionId:'s',cwd:'/synthetic',model,signal,assertCurrent(){}}),assertAccount(){},observe:async()=>{},flush:async()=>{order.push('flush');throw Error('output failed')}},factories);
 service.register(root,provider);
 const models=createHostModels(root,[model],{signal:new AbortController().signal,authorize:async()=>{},assertCurrent(){},codex:service,
 prepareRequest:async()=>({dispatch:async()=>{order.push('dispatch')},settle:async(m:any)=>{expect(m.usage.totalTokens).toBe(5);order.push('settle')},abandon:async()=>{order.push('abandon')}})});
 const result=await models.streamSimple(models.getModel(model.provider,model.id)!,{messages:[]}).result();
 expect(result.stopReason).toBe('error');expect(result.usage.totalTokens).toBe(5);
 expect(order.indexOf('settle')).toBeLessThan(order.indexOf('flush'));expect(order).not.toContain('abandon');
});
