import type { AuthenticatedPrincipal } from "../../../core/access-types.js";
import { getDb } from "../../../db/connection.js";
import { requireAccountActor } from "../../../db/account-administration.js";
import { listOwnFamilyTasks,prepareOwnFamilyTask,readOwnFamilyTask } from "../../../db/family-task-admission.js";
import { revokeFamilyScheduledGrant } from "../../../db/family-scheduled-grants.js";
import { ChatAccessDenied } from "../../../db/session-ownership.js";
import type { WebChannelLike } from "../core/web-channel-contracts.js";
import { checkCsrfOrigin,rateLimitResponse } from "./security.js";
import { isRateLimitedForClient } from "./rate-limit.js";
import { createLogger } from "../../../utils/logger.js";

const log=createLogger("web.family-scheduled-tasks");
async function body(req:Request,maxBytes:number):Promise<Record<string,unknown>> {
  if(!req.body)throw new ChatAccessDenied();
  const reader=req.body.getReader(),buffer=new Uint8Array(maxBytes);let size=0,timer:ReturnType<typeof setTimeout>|undefined;let abort!:()=>void;
  const cancelled=new Promise<never>((_,reject)=>{abort=()=>reject(new ChatAccessDenied());timer=setTimeout(abort,10000);req.signal.addEventListener("abort",abort,{once:true});});
  try{
    if(req.signal.aborted)throw new ChatAccessDenied();
    for(;;){const {done,value}=await Promise.race([reader.read(),cancelled]);if(done)break;if(size+value.byteLength>buffer.length)throw new ChatAccessDenied();buffer.set(value,size);size+=value.byteLength;}
    let value:unknown;try{value=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(buffer.subarray(0,size)));}catch{throw new ChatAccessDenied();}
    if(!value||typeof value!=="object"||Array.isArray(value))throw new ChatAccessDenied();return value as Record<string,unknown>;
  }finally{clearTimeout(timer);req.signal.removeEventListener("abort",abort);void reader.cancel().catch(()=>log.debug("Task request stream already closed",{operation:"family_task.cancel"}));reader.releaseLock();}
}

/** Owner preparation only: never invoke the dispatcher, activate tasks, or return capability tokens. */
export async function handleFamilyScheduledTasks(channel:WebChannelLike,req:Request,actor:AuthenticatedPrincipal):Promise<Response> {
  const deny=()=>channel.json({error:"Session access denied."},403),url=new URL(req.url),collection=url.pathname==="/agent/scheduled-tasks";
  const match=url.pathname.match(/^\/agent\/scheduled-tasks\/([a-zA-Z0-9_-]{1,128})(\/revoke)?$/);
  if(url.search||(!collection&&!match)||req.headers.get("x-piclaw-account-id")!==actor.userId||req.headers.get("x-piclaw-login-id")!==actor.authentication.sessionId)return deny();
  try{
    if(req.method==="GET"){
      if(collection)return channel.json(listOwnFamilyTasks(getDb(),actor));
      if(match&&!match[2])return channel.json(readOwnFamilyTask(getDb(),actor,match[1]!));
      return deny();
    }
    if(req.method!=="POST"||(!collection&&!match?.[2])||!req.headers.get("origin")||!checkCsrfOrigin(req))return deny();
    requireAccountActor(getDb(),actor,{recent:true});
    if(isRateLimitedForClient(actor.userId,"family_task_admission",60000,20))return rateLimitResponse("Too many task preparation requests.");
    const value=await body(req,collection?128*1024:1024);if(req.signal.aborted)throw new ChatAccessDenied();
    if(value.confirm!==true)throw new ChatAccessDenied();
    if(collection){
      if(Object.keys(value).length!==6||Object.keys(value).some(key=>!["confirm","request_id","chat_jid","prompt","scheduled_for","allowed_tools"].includes(key)))throw new ChatAccessDenied();
      const prepared=prepareOwnFamilyTask(getDb(),actor,{request_id:value.request_id as string,chat_jid:value.chat_jid as string,prompt:value.prompt as string,scheduled_for:value.scheduled_for as string,allowed_tools:value.allowed_tools as string[]});
      return channel.json({...prepared,request_id:value.request_id},prepared.created?201:200);
    }
    if(Object.keys(value).length!==1)throw new ChatAccessDenied();
    revokeFamilyScheduledGrant(getDb(),actor,match![1]!);
    return channel.json({grant_id:match![1],revoked:true});
  }catch(error){if(error instanceof ChatAccessDenied||req.signal.aborted)return deny();log.error("Task preparation request failed",{operation:"family_task.request_failed",err:error});return channel.json({error:"Task preparation request failed."},500);}
}
