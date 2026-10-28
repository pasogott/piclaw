import { beforeEach, afterEach, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { initDatabase, getDb } from "../../src/db.js";
import {
  readOperationsConfig,
  type OperationsConfig,
} from "../../src/core/config-operations.js";
import { createOperationHost,authorizeAddonOperation } from "../../src/addons/operation-host.js";
import { AddonOperationService } from "../../src/addons/operation-service.js";
import {
  installAddonRuntimeApi,
  resetAddonRuntimeContributionsForTests,
  setAddonOperationHost,
} from "../../src/addons/runtime-contributions.js";
import { withExternalAddonRegistrationContext } from "../../src/addons/external-routes.js";
import { createTempWorkspace, type TempWorkspace } from "../helpers.js";
import {readAddonOperation,readAddonOperationInputSequence,readAddonOperationInputEpoch,admitAddonOperation,transitionAddonOperation,appendOperationInput,markAddonOperationInputCommitted,ADDON_OPERATION_RESUME_TEXT} from '../../src/db/addon-operations.js';

let ws: TempWorkspace;
let config: OperationsConfig;
beforeEach(() => {
  initDatabase();
  getDb().exec(
    "DELETE FROM addon_operation_events;DELETE FROM addon_operations;DELETE FROM budget_caps;",
  );
  ws = createTempWorkspace("operations-host-");
  config = {
    enabled: true,
    grants: [
      {
        addonId: "example",
        principalId: "client",
        target: "echo",
        revision: "r1",
        allowedTools: ["read"],
        timeoutMs: 5000,
        maxToolCalls: 2,
        parentWorkId: null,
        enabled: true,
        approvalRequired: false,
      },
    ],
  };
});
afterEach(() => {
  resetAddonRuntimeContributionsForTests();
  ws.cleanup();
});
const principal = { addonId: "example", principalId: "client" };

test("operations configuration defaults disabled and rejects unknown/widening grant shapes", () => {
  const path = join(ws.base, "config.json");
  expect(readOperationsConfig(path)).toEqual({ enabled: false, grants: [] });
  writeFileSync(path, JSON.stringify({ domains: { operations: config } }));
  expect(readOperationsConfig(path)).toEqual(config);
  for (const grant of [
    { ...config.grants[0], allowedTools: ["read"], maxToolCalls: 0 },
    { ...config.grants[0], extra: true },
    { ...config.grants[0], timeoutMs: 0 },
    { ...config.grants[0], allowedTools: ["read", "read"] },
  ]) {
    writeFileSync(
      path,
      JSON.stringify({
        domains: { operations: { enabled: true, grants: [grant] } },
      }),
    );
    expect(() => readOperationsConfig(path)).toThrow();
  }
});

test("host policy denies disabled, unknown and unapproved callers before model work", async () => {
  let calls = 0;
  const host = createOperationHost(
    {
      isDurableRuntime:()=>true,dispatchAddonOperation: async () => {
        calls++;
        return { status: "success", result: "ok" };
      },
    },
    () => config,
  );
  config.enabled = false;
  expect((await host.authorize(principal, "echo", "admit")).decision).toBe(
    "rejected",
  );
  config.enabled = true;
  expect(
    (
      await host.authorize(
        { ...principal, principalId: "other" },
        "echo",
        "admit",
      )
    ).decision,
  ).toBe("rejected");
  config.grants[0].approvalRequired = true;
  expect((await host.authorize(principal, "echo", "admit")).decision).toBe(
    "approval_required",
  );
  expect((await host.authorize(principal, "echo", "read")).decision).toBe(
    "allow",
  );
  expect(calls).toBe(0);
});

test('host sends only persisted operation identity, epoch and caller signal to native dispatch',async()=>{
  const runs:unknown[][]=[];
  const host=createOperationHost({isDurableRuntime:()=>true,dispatchAddonOperation:async(...args)=>{runs.push(args);return{status:'success',result:'public answer'};}},()=>config);
  const service=new AddonOperationService(host),client=service.bind(principal);
  try {
    const admitted=await client.admit({target:'echo',idempotencyKey:'test',text:'untrusted request'});await service.waitForIdle();
    expect(runs).toHaveLength(1);expect(runs[0][0]).toBe(admitted.operation!.id);expect(runs[0][1]).toBeInstanceOf(AbortSignal);expect(runs[0][2]).toBe(1);
    expect(readAddonOperation(admitted.operation!.id)?.status).toBe('completed');
    config.grants[0].enabled=false;await expect(client.get(admitted.operation!.id)).rejects.toThrow('unavailable');
  }finally{service.shutdown();await service.waitForIdle();}
});

test('native input identity uses queued events rather than mutable status/input markers',async()=>{
  const epochs:(number|null)[]=[];let calls=0;
  const host=createOperationHost({isDurableRuntime:()=>true,dispatchAddonOperation:async(id,_signal,sequence)=>{
    epochs.push(readAddonOperationInputSequence(id));
    markAddonOperationInputCommitted(id,sequence);epochs.push(readAddonOperationInputSequence(id));calls++;
    return calls===1?{status:'success',result:null,requiresToolEnabledContinuation:true}:{status:'success',result:'completed'};
  }},()=>config);
  const service=new AddonOperationService(host),client=service.bind(principal);
  try{
    const first=await client.admit({target:'echo',idempotencyKey:'input-epochs',text:'first'});await service.waitForIdle();
    expect(readAddonOperation(first.operation!.id)?.status).toBe('input_required');expect(readAddonOperationInputSequence(first.operation!.id)).toBe(1);
    await client.continue(first.operation!.id,'second');await service.waitForIdle();
    expect(epochs).toEqual([1,1,4,4]);expect(readAddonOperation(first.operation!.id)?.sequence).toBe(6);expect(readAddonOperationInputSequence(first.operation!.id)).toBe(4);
  }finally{service.shutdown();await service.waitForIdle();}
});

test('native input epoch: stale acknowledgements and completions cannot overwrite a later owner input',()=>{
  const id='owner-epoch-guard',at=new Date().toISOString(),{revision,target,allowedTools,timeoutMs,maxToolCalls,parentWorkId}=config.grants[0];
  admitAddonOperation({id,addonId:principal.addonId,principalId:principal.principalId,idempotencyKey:'epoch-guard',inputHash:'a'.repeat(64),text:'first',target,grant:{revision,target,allowedTools,timeoutMs,maxToolCalls,parentWorkId},chatJid:'operation:'+id,workId:'operation:'+id,status:'queued',sequence:1,createdAt:at,updatedAt:at,output:null,reason:null});
  transitionAddonOperation(id,['queued'],'working');markAddonOperationInputCommitted(id,1);transitionAddonOperation(id,['working'],'input_required');appendOperationInput(id,'new input');transitionAddonOperation(id,['queued'],'working');
  expect(readAddonOperationInputEpoch(id)).toEqual({sequence:4,kind:'continuation',previousSequence:1});const before=readAddonOperation(id);
  expect(()=>markAddonOperationInputCommitted(id,1)).toThrow('epoch changed');
  expect(transitionAddonOperation(id,['working'],'failed',null,'stale_completion',1)).toBeNull();expect(readAddonOperation(id)).toEqual(before);
  markAddonOperationInputCommitted(id,4);expect(readAddonOperation(id)!.text).toBe(ADDON_OPERATION_RESUME_TEXT);
  expect(transitionAddonOperation(id,['working'],'input_required',null,null,4)?.status).toBe('input_required');
});

test('native request grant: revalidates operator approval and enabled state instead of borrowing read permission',()=>{
  config.grants[0].approvalRequired=true;
  expect(authorizeAddonOperation(principal,'echo','request',()=>config)).toEqual({decision:'approval_required'});
  config.grants[0].approvalRequired=false;
  expect(authorizeAddonOperation(principal,'echo','request',()=>config)).toMatchObject({decision:'allow',grant:{revision:'r1',allowedTools:['read']}});
  config.grants[0].enabled=false;
  expect(authorizeAddonOperation(principal,'echo','request',()=>config)).toEqual({decision:'rejected'});
});

test('native operation host forwards only the persisted owner ID and signal without legacy fallback',async()=>{
  let legacy=0;const calls:unknown[][]=[],signal=new AbortController().signal;
  const host=createOperationHost({isDurableRuntime:()=>true,dispatchAddonOperation:async(...args)=>{calls.push(args);return{status:'success',result:'native result'};},runAgent:async()=>{legacy++;throw Error('Legacy must remain unreachable');}},()=>config);
  expect(await host.execute({operationId:'accepted-native',inputSequence:7,chatJid:'operation:accepted-native',workId:'operation:accepted-native',text:'untrusted input is not dispatch authority',principal,grant:config.grants[0],signal})).toEqual({status:'completed',output:'native result'});
  expect(calls).toEqual([['accepted-native',signal,7]]);expect(legacy).toBe(0);
});
test('native receipt recovery host: only the persisted ID and epoch reach reconciliation',async()=>{
  let executions=0;const observed:unknown[][]=[];
  const host=createOperationHost({isDurableRuntime:()=>true,reconcileAddonOperation:async(...args)=>{observed.push(args);return{status:'success',result:'persisted result'};},dispatchAddonOperation:async()=>{executions++;throw Error('Recovery cannot dispatch');},runAgent:async()=>{executions++;throw Error('Recovery cannot use legacy');}},()=>{throw Error('Passive recovery cannot require a current grant');});
  expect(await host.recover!({operationId:'persisted',inputSequence:7,chatJid:'operation:persisted',workId:'operation:persisted',text:'not execution authority',principal,grant:config.grants[0],signal:new AbortController().signal})).toEqual({status:'completed',output:'persisted result'});
  expect(observed).toEqual([['persisted',7]]);expect(executions).toBe(0);
});
test('native receipt recovery host: a missing port cannot fall back to execution',async()=>{
  let executions=0;const host=createOperationHost({isDurableRuntime:()=>true,runAgent:async()=>{executions++;return{status:'success',result:'forbidden'};}},()=>config);
  await expect(host.recover!({operationId:'missing',inputSequence:1,chatJid:'operation:missing',workId:'operation:missing',text:'input',principal,grant:config.grants[0],signal:new AbortController().signal})).rejects.toThrow('Native add-on recovery unavailable');expect(executions).toBe(0);
});

test('native operation host refuses a missing dispatcher without falling back to runAgent',async()=>{
  let legacy=0;const host=createOperationHost({isDurableRuntime:()=>true,runAgent:async()=>{legacy++;return{status:'success',result:'must not run'};}},()=>config);
  await expect(host.execute({operationId:'missing-native',chatJid:'operation:missing-native',workId:'operation:missing-native',text:'input',principal,grant:config.grants[0],signal:new AbortController().signal})).rejects.toThrow('Native add-on execution unavailable');
  expect(legacy).toBe(0);
});

test("generic ABI registration belongs to startup package, not a caller supplied add-on id", async () => {
  resetAddonRuntimeContributionsForTests();
  setAddonOperationHost(
    createOperationHost(
      { isDurableRuntime:()=>true,dispatchAddonOperation: async () => ({ status: "success", result: "safe" }) },
      () => config,
    ),
  );
  const api = installAddonRuntimeApi();
  expect(() => api.operations.register()).toThrow("startup");
  const bound = await withExternalAddonRegistrationContext(
    {
      packageName: "@example/piclaw-addon-example",
      entryPath: join(ws.base, "runtime.ts"),
    },
    async () => api.operations.register(),
  );
  const client = bound.forPrincipal("client");
  expect(client.version).toBe(1);
  const other = bound.forPrincipal("unconfigured");
  expect(
    (
      await other.admit({
        target: "echo",
        idempotencyKey: "other",
        text: "test",
      })
    ).admission,
  ).toBe("rejected");
  const receipt = await client.admit({
    target: "echo",
    idempotencyKey: "own",
    text: "test",
  });
  for (let i = 0; i < 50; i++) {
    if ((await client.get(receipt.operation!.id)).status === "completed") break;
    await Bun.sleep(2);
  }
  expect((await client.get(receipt.operation!.id)).status).toBe("completed");
  expect(() => api.operations.register()).toThrow("startup");
});
