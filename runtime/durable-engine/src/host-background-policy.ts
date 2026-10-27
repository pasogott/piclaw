import { createHash } from "node:crypto";
import { AgentDoc, defineDocFamily, InboxDoc, LiveDoc, type ConversationId, type TaskId, type ToolTaskInput, type ConversationRecord, type TaskRecord, type Tx } from "@earendil-works/pi-durable";
import {
  assertNativeBackgroundDeadline,nativeBackgroundPolicyHash,readNativeBackgroundPolicy,nativeBackgroundIdentity,
  type NativeBackgroundPolicy,
} from "../../src/agent-pool/background-operation-contract.js";

type Claim={taskId:number;callId:string;toolName:string};
/** Correlation and a bounded quota only. The immutable payload/S01 admission
 * own policy authority; this document never authorises execution or replay.
 * Each accepted input has a family member; `initial` prevents a fork from
 * inheriting its parent's background grant. Explicit continuation never resets
 * an earlier input's quota. */
export const NativeBackgroundPolicyDoc=defineDocFamily({kind:"app.background-policy",version:1,family:true,scope:"conversation",history:"latest",fork:"initial",
  checkpointWhen:()=>false,initial:(_seed:null)=>({sourceId:null as string|null,policySha256:null as string|null,calls:[] as Claim[]})});
function current(assertCurrent:()=>void){
  const result:unknown=assertCurrent();
  if(result!==undefined){void Promise.resolve(result).catch(()=>{});throw Error("Background host authority must be synchronous");}
}
function bound(doc:Readonly<{sourceId:string|null;policySha256:string|null;calls:readonly Claim[]}>,policy:NativeBackgroundPolicy){
  if(doc.sourceId!==policy.sourceId||doc.policySha256!==nativeBackgroundPolicyHash(policy)||!Array.isArray(doc.calls)||doc.calls.length>100||
    policy.maxToolCalls!==null&&doc.calls.length>policy.maxToolCalls||policy.maxToolCalls===null&&doc.calls.length!==0)throw Error("Native background policy binding conflict");
  const tasks=new Set<number>();
  for(const claim of doc.calls){
    if(!Number.isSafeInteger(claim.taskId)||claim.taskId<1||typeof claim.callId!=="string"||!claim.callId||claim.callId.length>2048||typeof claim.toolName!=="string"||
      !policy.allowedTools.includes(claim.toolName)||tasks.has(claim.taskId))throw Error("Invalid native background tool quota");
    tasks.add(claim.taskId);
  }
}
export { bound as assertNativeBackgroundBindingData };

export function assertNativeBackgroundAgentData(agent:Readonly<{model?:{provider:string;modelId:string};instructions?:unknown;tools?:unknown}>,policy:NativeBackgroundPolicy){
  if(agent.model?.provider!==policy.model.provider||agent.model.modelId!==policy.model.modelId||typeof agent.instructions!=="string"||
    createHash("sha256").update(agent.instructions).digest("hex")!==policy.instructionsSha256||!Array.isArray(agent.tools)||
    agent.tools.some(name=>typeof name!=="string")||JSON.stringify([...agent.tools].sort())!==JSON.stringify(policy.allowedTools))throw Error("Native background agent configuration changed");
}
async function assertAgentPolicy(tx:Tx,id:ConversationId,policy:NativeBackgroundPolicy){
  assertNativeBackgroundAgentData(await tx.doc(AgentDoc,id),policy);
}
/** Call only in the host-owned public allocation transaction, after current
 * grant/model checks. Existing same-policy binding is replay, never quota reset. */
export async function bindNativeBackgroundPolicy(tx:Tx,id:ConversationId,input:NativeBackgroundPolicy,assertCurrent:()=>void,created?:ConversationRecord){
  current(assertCurrent);const policy=readNativeBackgroundPolicy(input);await assertAgentPolicy(tx,id,policy);
  const doc=await tx.doc(NativeBackgroundPolicyDoc,id,policy.sourceId,null);current(assertCurrent);
  if(doc.sourceId!==null||doc.policySha256!==null){bound(doc,policy);return;}
  if(created){
    // Only the exact record returned by this transaction's createConversation.
    // Public Tx forbids table reads after its first table write. The host
    // allocation path creates/configures/binds this record without task writes.
    if(created.id!==id||created.parent||created.owner||doc.calls.length)throw Error('Fresh private background conversation required');
  }else{
    const conversation=await tx.conversation(id),entries=await tx.scanEntries({conversationId:id},1);
    const tasks=await tx.scanTasks({conversationId:id},1),inbox=await tx.doc(InboxDoc,id),live=await tx.doc(LiveDoc,id);
    current(assertCurrent);
    if(!conversation||conversation.parent||conversation.owner||entries.items.length||tasks.items.length||inbox.items.length||live.run||doc.calls.length)throw Error("Fresh private background conversation required");
  }
  doc.sourceId=policy.sourceId;doc.policySha256=nativeBackgroundPolicyHash(policy);current(assertCurrent);
}
export async function nativeBackgroundToolReceiptKnown(tx:Tx,task:TaskRecord<unknown,unknown,unknown>):Promise<boolean>{
  if(task.kind!=='pi.tool'||task.state.status!=='terminal'||task.state.outcome.status!=='completed')return false;
  const result=task.state.outcome.result as {kind?:string;entryId?:import('@earendil-works/pi-durable').EntryId};
  if(result.kind==='nested'||result.entryId===undefined)return false;
  const entry=await tx.entry(result.entryId),diagnostics=(entry?.data as {diagnostics?:{code?:string}[]}|undefined)?.diagnostics;
  return entry?.kind==='pi.tool-result'&&entry.conversationId===task.conversationId&&entry.byTaskId===task.id&&Array.isArray(diagnostics)&&!diagnostics.some(item=>['interrupted','aborted','faulted','orphaned'].includes(item.code??''));
}

/** A new owner input may reuse an idle context, never a fork or a live/unknown
 * tool. Host admission separately proves prior EF-S01 terminals. Existing
 * policy-family members remain immutable; only the new source gets a quota. */
export async function advanceNativeBackgroundPolicy(tx:Tx,id:ConversationId,raw:NativeBackgroundPolicy,prior:readonly NativeBackgroundPolicy[],accepted:readonly string[],assertCurrent:()=>void){
  const policy=readNativeBackgroundPolicy(raw),previous=prior.map(readNativeBackgroundPolicy),sources=new Set(accepted);current(assertCurrent);
  if(policy.origin.kind!=='addon'||!previous.length||sources.size!==accepted.length)throw Error('Explicit background input history required');
  for(const old of previous){
    if(old.origin.kind!=='addon'||old.origin.inputSequence>=policy.origin.inputSequence||nativeBackgroundIdentity(old).contextKey!==nativeBackgroundIdentity(policy).contextKey||
      old.origin.target!==policy.origin.target||old.origin.grantRevision!==policy.origin.grantRevision||old.workId!==policy.workId||old.parentWorkId!==policy.parentWorkId||
      JSON.stringify(old.model)!==JSON.stringify(policy.model)||JSON.stringify(old.allowedTools)!==JSON.stringify(policy.allowedTools)||old.maxToolCalls!==policy.maxToolCalls||old.instructionsSha256!==policy.instructionsSha256||Date.parse(old.acceptedAt)>Date.parse(policy.acceptedAt))throw Error('Background continuation policy changed');
  }
  if([...sources].some(source=>!previous.some(old=>old.sourceId===source)))throw Error('Unbound previous background source');
  const conversation=await tx.conversation(id),inbox=await tx.doc(InboxDoc,id),live=await tx.doc(LiveDoc,id);current(assertCurrent);
  if(!conversation||conversation.owner||conversation.parent||inbox.items.length||live.run||live.compactions?.length||live.tools?.some(slot=>slot.status!=='done')||live.nestedTools?.some(slot=>slot.status!=='done'))throw Error('Idle private background context required');
  let cursor:import('@earendil-works/pi-durable').Cursor|undefined;
  do{
    const page=await tx.scanTasks({conversationId:id},100,cursor);current(assertCurrent);
    for(const task of page.items){
      if(task.state.status!=='terminal')throw Error('Previous background task is still live');
      if(task.kind==='pi.tool'&&!await nativeBackgroundToolReceiptKnown(tx,task))throw Error('Previous background tool effect is unresolved');
      current(assertCurrent);
    }
    cursor=page.next;
  }while(cursor!==undefined);
  for(const old of previous){
    const submission=await tx.submissionByRequest(id,old.sourceId);current(assertCurrent);
    if(sources.has(old.sourceId)?!submission||submission.type!=='input'||!['done','unanswered'].includes(submission.status)||submission.entry===undefined:submission!==undefined&&submission!==null)throw Error('Previous background submission proof missing');
  }
  const seen=new Set<string>();cursor=undefined;
  do{
    const page=await tx.scanEntries({conversationId:id},100,cursor);current(assertCurrent);
    for(const entry of page.items){
      if(entry.kind==='pi.user')throw Error('Unaccepted private background input');
      if(entry.kind!=='host.accepted')continue;
      const data=entry.data as Record<string,unknown>|undefined,old=previous.find(policy=>policy.sourceId===data?.sourceId),model=entry.model?.[0];
      const identity=old&&nativeBackgroundIdentity(old);
      if(!data||!old||!identity||!sources.has(old.sourceId)||seen.has(old.sourceId)||data.role!=='primary'||data.requestId!==identity.requestId||data.operationId!==identity.operationId||data.chatJid!==identity.chatJid||data.branchId!==identity.branchId||data.conversationId!==id||entry.model?.length!==1||model?.role!=='user'||typeof model.content!=='string'||createHash('sha256').update(model.content).digest('hex')!==old.promptSha256)throw Error('Previous background input history mismatch');
      seen.add(old.sourceId);
    }
    cursor=page.next;
  }while(cursor!==undefined);
  if(seen.size!==sources.size)throw Error('Missing previous background input history');
  await assertAgentPolicy(tx,id,policy);
  for(const old of previous){bound(await tx.doc(NativeBackgroundPolicyDoc,id,old.sourceId,null),old);current(assertCurrent);}
  const doc=await tx.doc(NativeBackgroundPolicyDoc,id,policy.sourceId,null);current(assertCurrent);
  if(doc.sourceId!==null||doc.policySha256!==null){bound(doc,policy);return;}
  if(doc.calls.length)throw Error('New background input quota is not empty');doc.sourceId=policy.sourceId;doc.policySha256=nativeBackgroundPolicyHash(policy);current(assertCurrent);
}

/** A fresh host effect guard and exact accepted source remain mandatory. This
 * read must not be installed as a general bootstrap/read-only recovery gate:
 * revoked/expired work still needs passive inspection and terminal settlement. */
export async function assertNativeBackgroundExecution(tx:Tx,id:ConversationId,input:NativeBackgroundPolicy,now:number,assertCurrent:()=>void){
  current(assertCurrent);const policy=readNativeBackgroundPolicy(input);
  assertNativeBackgroundDeadline(policy,now);await assertAgentPolicy(tx,id,policy);
  bound(await tx.doc(NativeBackgroundPolicyDoc,id,policy.sourceId,null),policy);current(assertCurrent);
}
/** Before-intent quota claim, using actual public SDK task/assistant/live-slot
 * evidence. Re-entry of one SDK task never spends another call. This receipt is
 * NOT an effect receipt and must never be used to resend an uncertain tool. */
export async function claimNativeBackgroundTool(tx:Tx,id:ConversationId,input:NativeBackgroundPolicy,
  call:{taskId:TaskId;callId:string;toolName:string},now:number,assertCurrent:()=>void){
  const policy=readNativeBackgroundPolicy(input);await assertNativeBackgroundExecution(tx,id,policy,now,assertCurrent);
  if(typeof call.callId!=="string"||!call.callId||call.callId.length>2048)throw Error("Invalid native background call identity");
  if(!policy.allowedTools.includes(call.toolName))throw Error("Native background tool ceiling denied");
  const task=await tx.task(call.taskId),live=await tx.doc(LiveDoc,id);current(assertCurrent);
  if(!task||task.kind!=="pi.tool"||task.conversationId!==id||task.abortRequested||task.state.status==="terminal"||task.owner===undefined||!live.run)
    throw Error("Exact pending background tool task required");
  const source=task.input as ToolTaskInput;
  if(source.kind==="model"){
    const slot=live.tools?.find(slot=>slot.taskId===call.taskId&&slot.callId===call.callId&&slot.name===call.toolName&&slot.status==="pending");
    const assistant=await tx.entry(source.assistant);current(assertCurrent);
    const recorded=assistant?.model?.flatMap(message=>message.role==="assistant"?message.content.filter(part=>part.type==="toolCall"):[]).find(part=>part.id===call.callId);
    if(!slot||source.callId!==call.callId||task.owner!==live.run.taskId||assistant?.byTaskId!==task.owner||assistant.conversationId!==id||recorded?.name!==call.toolName)
      throw Error("Exact pending background model call required");
  }else if(source.kind==="nested"){
    const slot=live.nestedTools?.find(slot=>slot.taskId===call.taskId&&slot.callId===call.callId&&slot.name===call.toolName&&slot.status==="pending");
    const parent=await tx.task(source.parent);current(assertCurrent);
    if(!slot||source.call.id!==call.callId||source.call.name!==call.toolName||task.owner!==source.parent||!parent||parent.kind!=="pi.tool"||
      parent.conversationId!==id||parent.abortRequested||parent.state.status==="terminal"||
      ![...(live.tools??[]),...(live.nestedTools??[])].some(slot=>slot.taskId===source.parent&&slot.callId===source.parentCallId&&slot.status==="running"))
      throw Error("Exact pending background nested call required");
  }else throw Error("Unsupported background tool task");
  const doc=await tx.doc(NativeBackgroundPolicyDoc,id,policy.sourceId,null);current(assertCurrent);bound(doc,policy);
  const prior=doc.calls.find(claim=>claim.taskId===call.taskId);
  if(prior){if(prior.taskId!==call.taskId||prior.callId!==call.callId||prior.toolName!==call.toolName)throw Error("Native background tool claim conflict");return;}
  if(policy.maxToolCalls===null)return; // Explicitly uncapped host policy; no unbounded quota ledger.
  if(doc.calls.length>=policy.maxToolCalls)throw Error("Native background tool call limit reached");
  doc.calls.push({taskId:call.taskId,callId:call.callId,toolName:call.toolName});current(assertCurrent);
}
