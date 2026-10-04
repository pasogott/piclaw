import {expect,test} from 'bun:test';
import {createProvider, type AssistantMessage, type ModelsSimpleStreamOptions} from '@earendil-works/pi-ai';
import {createAssistantMessageEventStream} from '@earendil-works/pi-ai/utils/event-stream';
import {captureChildProvider} from '../../src/addons/child-request-captured-provider.js';
const model={id:'fixture',provider:'fixture',api:'openai-completions' as const,name:'fixture',baseUrl:'https://synthetic.invalid',reasoning:false,input:['text' as const],contextWindow:100,maxTokens:10,cost:{input:1,output:1,cacheRead:0,cacheWrite:0}};
const message:AssistantMessage={role:'assistant',content:[],api:model.api,provider:model.provider,model:model.id,stopReason:'stop',timestamp:1,usage:{input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:1e-6,output:1e-6,cacheRead:0,cacheWrite:0,total:2e-6}}};
test('captured composed provider uses complete scoped options once without auth lookup or ambient child data',async()=>{
 let calls=0;let observed:ModelsSimpleStreamOptions|undefined;
 const provider=createProvider({id:'fixture',name:'fixture',models:[model],auth:{apiKey:{label:'fixture',async resolve(){throw Error('auth must not be resolved twice');}}},
 api:{api:model.api,stream(){throw Error('wrong API');},streamSimple(_model,_context,options){calls++;observed=options;const stream=createAssistantMessageEventStream();stream.push({type:'done',reason:'stop',message});stream.end();return stream;}}});
 const headers={authorization:'synthetic',suppressed:null};const env={SYNTHETIC_SCOPE:'value'};
 const captured=captureChildProvider({model,provider,options:{headers,env},context:{messages:[]},request:{maxTokens:5},authorise(){},rawSettlement:()=>Promise.resolve()});
 headers.authorization='mutated';env.SYNTHETIC_SCOPE='mutated';const execution=captured.start({signal:new AbortController().signal,maxRetries:0});for await(const _event of execution.events){/* synthetic */}await execution.settled;
 expect(calls).toBe(1);expect(observed?.headers).toEqual({authorization:'synthetic',suppressed:null});expect(observed?.env).toEqual({SYNTHETIC_SCOPE:'value'});expect(observed?.apiKey).toBeUndefined();expect(observed?.maxRetries).toBe(0);expect(observed?.maxTokens).toBe(5);
});
test('synchronous provider setup failure still returns separately tracked raw tail',async()=>{
 let resolve!:()=>void;const raw=new Promise<void>(done=>{resolve=done;});const provider=createProvider({id:'fixture',name:'fixture',models:[model],auth:{apiKey:{label:'fixture',async resolve(){throw Error('unused');}}},api:{api:model.api,stream(){throw Error('unused');},streamSimple(){throw Error('PRIVATE');}}});
 const captured=captureChildProvider({model,provider,options:{},context:{messages:[]},request:{},authorise(){},rawSettlement:()=>raw});const execution=captured.start({});await expect((async()=>{for await(const _event of execution.events){/* expected rejected iterator */}})()).rejects.toThrow('execution_failed');let finished=false;void execution.settled.then(()=>{finished=true;});await Bun.sleep(0);expect(finished).toBe(false);resolve();await execution.settled;
});
test('captured provider rejects mismatched identity and authority before provider start',()=>{
 let calls=0;const provider=createProvider({id:'fixture',name:'fixture',models:[model],auth:{apiKey:{label:'fixture',async resolve(){return{apiKey:'synthetic'};}}},api:{api:model.api,stream(){throw Error('unused');},streamSimple(){calls++;return createAssistantMessageEventStream();}}});
 const input={model,provider,options:{},context:{messages:[]},request:{},authorise(){throw Error('revoked');},rawSettlement:()=>Promise.resolve()};
 expect(()=>captureChildProvider({...input,model:{...model,provider:'other'}})).toThrow('unavailable');expect(()=>captureChildProvider(input).start({})).toThrow('revoked');expect(calls).toBe(0);
});
