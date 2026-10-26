import { expect, test } from "bun:test";
import {
  createNativeBackgroundPayload,readNativeBackgroundPayload,readNativeBackgroundPolicy,
  nativeBackgroundSourceId,nativeBackgroundIdentity,nativeBackgroundContextKey,nativeBackgroundPolicyHash,
  assertNativeBackgroundRetry,assertNativeBackgroundDeadline,assertNativeBackgroundModel,type NativeBackgroundPolicyInput,
} from "../../src/agent-pool/background-operation-contract.js";
const input=():NativeBackgroundPolicyInput=>({
  origin:{kind:'addon',operationId:'op:fixture',addonId:'fixture-addon',principalId:'operator:fixture',target:'private-review',grantRevision:'rev:7',inputSequence:1},
  workId:'operation-work:fixture',parentWorkId:'parent-work:fixture',model:{provider:'qualification',modelId:'synthetic',api:'openai-completions'},
  allowedTools:['write','read'],maxToolCalls:3,acceptedAt:'2026-10-26T15:20:00.000Z',expiresAt:'2026-10-26T15:23:00.000Z',
  prompt:'PRIVATE_PROMPT π',instructions:'PRIVATE_INSTRUCTIONS',
});
test('background policy: frozen canonical snapshot preserves private content hashes and original owner identity',()=>{
  const request=input(),payload=createNativeBackgroundPayload(request),policy=payload.policy;
  expect(policy.allowedTools).toEqual(['read','write']);expect(Object.isFrozen(policy)).toBe(true);expect(Object.isFrozen(policy.origin)).toBe(true);expect(Object.isFrozen(policy.model)).toBe(true);expect(Object.isFrozen(policy.allowedTools)).toBe(true);
  (request as any).allowedTools=['bash'];(request.origin as any).grantRevision='changed';(request.model as any).modelId='changed';
  expect(policy.allowedTools).toEqual(['read','write']);expect(policy.model.modelId).toBe('synthetic');expect(policy.origin.kind==='addon'&&policy.origin.grantRevision).toBe('rev:7');
  expect(JSON.stringify(policy)).not.toContain('PRIVATE_PROMPT');expect(JSON.stringify(policy)).not.toContain('PRIVATE_INSTRUCTIONS');
  expect(readNativeBackgroundPayload(JSON.parse(JSON.stringify(payload)))).toEqual(payload);
  expect(nativeBackgroundIdentity(policy)).toMatchObject({sourceId:policy.sourceId,payloadRef:policy.sourceId,requestId:policy.sourceId,chatJid:'operation:op:fixture',operationId:'operation:'+policy.sourceId});
  expect(nativeBackgroundPolicyHash(createNativeBackgroundPayload({...input(),allowedTools:['read','write']}).policy)).toBe(nativeBackgroundPolicyHash(policy));
});
test('background policy: retry cannot mint another source or renew/widen its immutable execution choices',()=>{
  const request=input(),policy=createNativeBackgroundPayload(request).policy;
  const changes:Partial<NativeBackgroundPolicyInput>[]=[{prompt:'another input'},{instructions:'another system prompt'},{expiresAt:'2026-10-26T15:24:00.000Z'},
    {acceptedAt:'2026-10-26T15:21:00.000Z'},{maxToolCalls:4},{allowedTools:['bash']},{parentWorkId:'different-parent'},{workId:'different-work'},
    {model:{...request.model,api:'another-api'}},{origin:{...request.origin as Extract<typeof request.origin,{kind:'addon'}>,grantRevision:'rev:8'}},
    {origin:{...request.origin as Extract<typeof request.origin,{kind:'addon'}>,target:'another-target'}}];
  for(const change of changes){const candidate=createNativeBackgroundPayload({...input(),...change}).policy;expect(candidate.sourceId).toBe(policy.sourceId);expect(()=>assertNativeBackgroundRetry(policy,candidate)).toThrow('retry identity conflict');}
  expect(()=>assertNativeBackgroundRetry(policy,readNativeBackgroundPolicy(JSON.parse(JSON.stringify(policy))))).not.toThrow();
});
test('background policy: different principals and operations never share a source; Dream mode is a policy choice',()=>{
  const origin=input().origin as Extract<NativeBackgroundPolicyInput['origin'],{kind:'addon'}>,id=nativeBackgroundSourceId(origin);
  for(const changed of [{...origin,addonId:'other-addon'},{...origin,principalId:'other-principal'},{...origin,operationId:'other-operation'}])expect(nativeBackgroundSourceId(changed)).not.toBe(id);
  const dream={...input(),origin:{kind:'dream' as const,invocationId:'invocation:fixture',chatJid:'web:original',mode:'manual' as const},maxToolCalls:null};
  const manual=createNativeBackgroundPayload(dream).policy,auto=createNativeBackgroundPayload({...dream,origin:{...dream.origin,mode:'auto'}}).policy;
  expect(manual.sourceId).toBe(auto.sourceId);expect(()=>assertNativeBackgroundRetry(manual,auto)).toThrow('retry identity conflict');
  expect(nativeBackgroundIdentity(manual).chatJid).toStartWith('dream:');expect(nativeBackgroundIdentity(manual).branchId).toStartWith('background:');
});
test('background policy: explicit owner queue sequence creates another input without duplicating private context',()=>{
  const prior=input(),origin=prior.origin as Extract<typeof prior.origin,{kind:'addon'}>;
  const first=createNativeBackgroundPayload(prior).policy,next=createNativeBackgroundPayload({...prior,origin:{...origin,inputSequence:2}}).policy;
  expect(first.sourceId).not.toBe(next.sourceId);expect(nativeBackgroundContextKey(first.origin)).toBe(nativeBackgroundContextKey(next.origin));
  expect(nativeBackgroundIdentity(first).chatJid).toBe(nativeBackgroundIdentity(next).chatJid);expect(nativeBackgroundIdentity(first).branchId).toBe(nativeBackgroundIdentity(next).branchId);
  for(const inputSequence of [0,-1,NaN,1.5])expect(()=>createNativeBackgroundPayload({...prior,origin:{...origin,inputSequence}})).toThrow('Invalid native background');
});
test('background policy: payload decoding rejects changed content, schema, and binding identity instead of adopting it',()=>{
  const payload=createNativeBackgroundPayload(input());
  for(const changed of [{...payload,prompt:'modified'},{...payload,instructions:'modified'},{...payload,version:2},{...payload,extra:'untrusted'},
    {...payload,policy:{...payload.policy,sourceId:'background:'+'0'.repeat(64)}},{...payload,policy:{...payload.policy,allowedTools:['write','read']}},
    {...payload,policy:{...payload.policy,promptSha256:'bad'}}])expect(()=>readNativeBackgroundPayload(changed)).toThrow('Invalid native background');
});
test('background policy: malformed authority fields and unsupported unbounded add-on grants fail before construction',()=>{
  const request=input();
  for(const change of [{maxToolCalls:null},{maxToolCalls:-1},{maxToolCalls:101},{maxToolCalls:1.5},{allowedTools:['read','read']},{allowedTools:['read\n']},{allowedTools:['tool/alias']},
    {workId:request.parentWorkId!},{parentWorkId:''},{expiresAt:request.acceptedAt},{expiresAt:'not-a-time'},{acceptedAt:'2026-10-26'},
    {model:{...request.model,provider:'other/provider'}},{model:{...request.model,modelId:'not canonical'}},{origin:{...request.origin,grantRevision:''}},
    {extra:'untrusted'}])expect(()=>createNativeBackgroundPayload({...request,...change} as NativeBackgroundPolicyInput)).toThrow('Invalid native background');
});
test('background policy: caller-owned getters and sparse/aliased tool arrays are never evaluated as policy',()=>{
  let reads=0;const getter={...input()};Object.defineProperty(getter,'origin',{enumerable:true,get(){reads++;throw Error('must not evaluate');}});
  expect(()=>createNativeBackgroundPayload(getter)).toThrow('Invalid native background');
  const origin={...input().origin};Object.defineProperty(origin,'kind',{enumerable:true,get(){reads++;throw Error('must not evaluate');}});
  expect(()=>createNativeBackgroundPayload({...input(),origin} as NativeBackgroundPolicyInput)).toThrow('Invalid native background');
  const tools=['read'];Object.defineProperty(tools,'0',{get(){reads++;throw Error('must not evaluate');}});
  expect(()=>createNativeBackgroundPayload({...input(),allowedTools:tools})).toThrow('Invalid native background');
  expect(()=>createNativeBackgroundPayload({...input(),allowedTools:new Array(2)})).toThrow('Invalid native background');
  expect(reads).toBe(0);
});
test('background policy: physical provider/model/API identity is exact and never falls back',()=>{
  const policy=createNativeBackgroundPayload(input()).policy,physical={provider:policy.model.provider,id:policy.model.modelId,api:policy.model.api};
  expect(()=>assertNativeBackgroundModel(policy,physical)).not.toThrow();
  for(const changed of [{...physical,provider:'other'},{...physical,id:'other'},{...physical,api:'other'}])expect(()=>assertNativeBackgroundModel(policy,changed)).toThrow('physical model changed');
});
test('background policy: absolute deadline is inclusive at admission and never renewed by a retry',()=>{
  const policy=createNativeBackgroundPayload(input()).policy,start=Date.parse(policy.acceptedAt),end=Date.parse(policy.expiresAt);
  expect(()=>assertNativeBackgroundDeadline(policy,start)).not.toThrow();expect(()=>assertNativeBackgroundDeadline(policy,end-1)).not.toThrow();
  for(const now of [start-1,end,end+1,NaN,Infinity])expect(()=>assertNativeBackgroundDeadline(policy,now)).toThrow('deadline unavailable or expired');
  const restored=readNativeBackgroundPolicy(JSON.parse(JSON.stringify(policy)));expect(()=>assertNativeBackgroundDeadline(restored,end)).toThrow('expired');
});
