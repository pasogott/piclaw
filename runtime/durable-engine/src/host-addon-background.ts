import type Database from "bun:sqlite";
import { createHash } from "node:crypto";
import { readAddonOperation,readAddonOperationInputSequence } from "../../src/db/addon-operations.js";
import { getBudgetWork } from "../../src/db/budget-limits.js";
import { authorizeAddonOperation } from "../../src/addons/operation-host.js";
import { OPERATION_SYSTEM_PROMPT } from "../../src/agent-pool/operation-session-profile.js";
import {
  createNativeBackgroundPayload,readNativeBackgroundPayload,assertNativeBackgroundDeadline,assertNativeBackgroundRetry,
  nativeBackgroundSourceId,type NativeBackgroundOrigin,type NativeBackgroundPayload,
} from "../../src/agent-pool/background-operation-contract.js";

export function addonBackgroundOrigin(root:Database,id:string):Extract<NativeBackgroundOrigin,{kind:'addon'}>{
  const record=readAddonOperation(id,root),sequence=readAddonOperationInputSequence(id,root);
  if(!record||sequence===null)throw Error('Native add-on input identity unavailable');
  return Object.freeze({kind:'addon',operationId:record.id,addonId:record.addonId,principalId:record.principalId,target:record.target,
    grantRevision:record.grant.revision,inputSequence:sequence});
}
/** Uses the SAME host grant decision as the existing operation owner. Parsing a
 * persisted snapshot alone never grants spending/tools, including after reopen. */
export function assertAddonBackgroundCurrent(root:Database,raw:NativeBackgroundPayload):void{
  const payload=readNativeBackgroundPayload(raw),policy=payload.policy,origin=policy.origin;
  if(origin.kind!=='addon')throw Error('Expected admitted add-on origin');
  const record=readAddonOperation(origin.operationId,root);
  if(!record||record.status!=='working'||JSON.stringify(addonBackgroundOrigin(root,record.id))!==JSON.stringify(origin))throw Error('Native add-on operation authority changed');
  const admission=authorizeAddonOperation({addonId:origin.addonId,principalId:origin.principalId},origin.target,'admit');
  if(admission.decision!=='allow'||JSON.stringify(admission.grant)!==JSON.stringify(record.grant))throw Error('Native add-on grant changed');
  const work=getBudgetWork(record.workId,root);
  if(!work||work.chat_jid!==record.chatJid||work.execution_kind!=='background'||work.status!=='active'||work.parent_work_id!==policy.parentWorkId||
    policy.workId!==record.workId||policy.parentWorkId!==record.grant.parentWorkId||policy.maxToolCalls!==record.grant.maxToolCalls||
    JSON.stringify(policy.allowedTools)!==JSON.stringify([...record.grant.allowedTools].sort())||
    Date.parse(policy.expiresAt)-Date.parse(policy.acceptedAt)!==record.grant.timeoutMs||payload.instructions!==OPERATION_SYSTEM_PROMPT)
    throw Error('Native add-on policy no longer matches its owner');
  assertNativeBackgroundDeadline(policy,Date.now());
}
export function prepareAddonBackgroundPayload(root:Database,id:string,model:NativeBackgroundPayload['policy']['model'],
  existing:NativeBackgroundPayload|undefined,toolAvailable:(name:string)=>boolean):NativeBackgroundPayload{
  const origin=addonBackgroundOrigin(root,id),record=readAddonOperation(id,root)!;
  for(const name of record.grant.allowedTools)if(!toolAvailable(name))throw Error(`Native operation tool unavailable: ${name}`);
  const prior=existing&&readNativeBackgroundPayload(existing);
  if(prior&&prior.policy.sourceId!==nativeBackgroundSourceId(origin))throw Error('Native add-on input epoch changed');
  // A mutable legacy committed-input marker cannot reconstruct missing original
  // bytes. Explicit continuations require an existing private-context proof.
  if(!prior&&createHash('sha256').update(JSON.stringify([record.target,record.text])).digest('hex')!==record.inputHash)
    throw Error('Original add-on input payload unavailable');
  const acceptedAt=prior?.policy.acceptedAt??new Date().toISOString();
  const payload=createNativeBackgroundPayload({origin,workId:record.workId,parentWorkId:record.grant.parentWorkId,model:prior?.policy.model??model,
    allowedTools:record.grant.allowedTools,maxToolCalls:record.grant.maxToolCalls,acceptedAt,
    expiresAt:prior?.policy.expiresAt??new Date(Date.parse(acceptedAt)+record.grant.timeoutMs).toISOString(),
    prompt:prior?.prompt??record.text,instructions:OPERATION_SYSTEM_PROMPT});
  if(prior)assertNativeBackgroundRetry(prior.policy,payload.policy);
  assertAddonBackgroundCurrent(root,payload);return payload;
}
