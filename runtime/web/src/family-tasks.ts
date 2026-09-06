import { FamilyApi } from './family-api.js';
import { FAMILY_WEB_TOOLS } from '../../src/core/family-workspace-policy.js';

const node=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
const validId=(id:unknown):id is string=>typeof id==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(id);
const validChat=(chat:unknown):chat is string=>typeof chat==='string'&&!!chat.trim()&&chat.length<=512&&chat===chat.trim();
interface TaskItem {grant_id:string;task_id:string;chat_jid:string;created_at:string;revoked:boolean}
interface Preparation {request_id:string;chat_jid:string;prompt:string;scheduled_for:string;allowed_tools:string[];confirm:true}

/** Drafts and exact retry payloads live only while this panel is active. No activation or execution controls. */
export class FamilyTasks {
  private root=node('scheduled-tasks');private list=node('scheduled-task-list');private status=node('scheduled-tasks-status');
  private editor=node<HTMLFormElement>('prepare-task-form');private target=node<HTMLSelectElement>('task-target');
  private prompt=node<HTMLTextAreaElement>('task-prompt');private due=node<HTMLInputElement>('task-due');private tools=node('task-tools');
  private confirm=node<HTMLInputElement>('confirm-task-preparation');private submit=node<HTMLButtonElement>('prepare-task');
  private detail=node('scheduled-task-detail');private revokeConfirm=node<HTMLInputElement>('confirm-task-revocation');private revoke=node<HTMLButtonElement>('revoke-task');
  private opened=false;private paused=false;private stopped=false;private busy=false;private generation=0;private controller:AbortController|null=null;
  private retry:Preparation|null=null;private selected:TaskItem|null=null;private targets=new Set<string>();private allowed:string[]=[];
  constructor(private api:FamilyApi,private hooks:{lock:(value:boolean)=>boolean;changed:()=>Promise<void>}) {
    node('open-tasks').addEventListener('click',()=>{if(this.paused||this.stopped||this.busy)return;if(this.opened&&!this.root.hidden){node('scheduled-tasks-heading').focus();return;}this.opened=true;void this.load(true);});
    node('close-tasks').addEventListener('click',()=>{this.opened=false;this.clear();node('open-tasks').focus();});
    node('refresh-tasks').addEventListener('click',()=>{void this.load();});
    node('reset-task-draft').addEventListener('click',()=>{if(this.busy||!this.visible())return;this.resetDraft();this.status.textContent='Draft discarded. Check the task list for an earlier uncertain request before preparing another.';});
    this.confirm.addEventListener('change',()=>{this.submit.disabled=this.busy||!this.confirm.checked;});
    this.revokeConfirm.addEventListener('change',()=>{this.revoke.disabled=this.busy||!this.selected||!this.revokeConfirm.checked;});
    this.editor.addEventListener('submit',event=>{event.preventDefault();void this.prepare();});
    for(const field of [this.target,this.prompt,this.due,this.tools])field.addEventListener('input',()=>{if(!this.busy){this.confirm.checked=false;this.submit.disabled=true;}});
    this.revoke.addEventListener('click',()=>{void this.revokeSelected();});
  }
  private visible():boolean{return this.opened&&!this.paused&&!this.stopped&&!document.hidden;}
  private resetDetail():void {
    this.selected=null;this.detail.hidden=true;this.revokeConfirm.checked=false;this.revokeConfirm.disabled=true;this.revoke.disabled=true;
    for(const id of ['scheduled-task-target','scheduled-task-state','scheduled-task-text'])node(id).textContent='';
  }
  private resetDraft():void {
    this.retry=null;this.prompt.value='';this.due.value='';this.target.value='';this.confirm.checked=false;this.submit.disabled=true;this.submit.textContent='Prepare paused task';
    for(const box of this.tools.querySelectorAll<HTMLInputElement>('input'))box.checked=false;
    this.editorLocked(false);
  }
  private editorLocked(value:boolean):void {
    this.target.disabled=this.prompt.disabled=this.due.disabled=value;
    for(const box of this.tools.querySelectorAll<HTMLInputElement>('input'))box.disabled=value;
  }
  private clear():void {
    this.generation++;this.controller?.abort();this.controller=null;this.root.hidden=true;this.list.replaceChildren();this.status.textContent='';
    this.resetDraft();this.resetDetail();this.editor.hidden=true;this.target.replaceChildren();this.tools.replaceChildren();this.targets.clear();this.allowed=[];
  }
  suspend():void {this.paused=true;this.clear();node<HTMLButtonElement>('open-tasks').disabled=true;}
  resume():void {if(this.stopped)return;const wasPaused=this.paused;this.paused=false;node<HTMLButtonElement>('open-tasks').disabled=this.busy;if(wasPaused&&this.opened&&!this.busy)void this.load();}
  stop():void {this.stopped=true;this.opened=false;this.clear();node<HTMLButtonElement>('open-tasks').disabled=true;}
  private startRequest(){this.controller?.abort();this.controller=new AbortController();return {generation:++this.generation,signal:this.controller.signal};}
  private active(generation:number){return this.visible()&&generation===this.generation;}
  private async load(focus=false):Promise<void>{
    if(!this.visible()||this.busy)return;this.clear();this.root.hidden=false;this.status.textContent='Loading prepared tasks…';
    const request=this.startRequest();if(focus)node('scheduled-tasks-heading').focus();
    try{
      const [value,directory,policy]=await Promise.all([this.api.request('/agent/scheduled-tasks','GET',undefined,request.signal),this.api.request('/agent/branches','GET',undefined,request.signal),this.api.request('/account/workspace','GET',undefined,request.signal)]);
      if(!this.active(request.generation))return;
      if(value?.owner_user_id!==this.api.identity.userId||value.window_size!==50||value.activation_available!==false||!Array.isArray(value.items)||value.items.length>50
        ||!Array.isArray(directory?.branches)||policy?.user_id!==this.api.identity.userId||policy.tools?.policy!=='fixed-family-web-preview'||!Array.isArray(policy.tools.allowed)
        ||new Set(policy.tools.allowed).size!==policy.tools.allowed.length||policy.tools.allowed.some((name:unknown)=>!(FAMILY_WEB_TOOLS as readonly unknown[]).includes(name)))throw Error('Invalid task preparation metadata.');
      const targets=new Set<string>(),options=document.createDocumentFragment();const empty=document.createElement('option');empty.value='';empty.textContent='Choose an owned conversation';options.append(empty);
      for(const branch of directory.branches){if(!validChat(branch?.chat_jid)||typeof branch.agent_name!=='string'||targets.has(branch.chat_jid)||branch.archived_at)throw Error('Invalid owned task target.');targets.add(branch.chat_jid);const option=document.createElement('option');option.value=branch.chat_jid;option.textContent=`${branch.agent_name} · ${branch.chat_jid}`;options.append(option);}
      const toolNodes=document.createDocumentFragment();const allowed=FAMILY_WEB_TOOLS.filter(name=>policy.tools.allowed.includes(name));
      for(const name of allowed){const label=document.createElement('label'),box=document.createElement('input');box.type='checkbox';box.value=name;label.append(box,document.createTextNode(` ${name}`));toolNodes.append(label);}
      const fragment=document.createDocumentFragment(),ids=new Set<string>();
      for(const item of value.items as TaskItem[]){if(!validId(item?.grant_id)||!validId(item.task_id)||ids.has(item.grant_id)||!validChat(item.chat_jid)||typeof item.revoked!=='boolean'||typeof item.created_at!=='string')throw Error('Invalid task list.');ids.add(item.grant_id);
        const li=document.createElement('li'),text=document.createElement('span'),button=document.createElement('button');text.textContent=`${item.chat_jid} · ${item.created_at} · ${item.revoked?'revoked':'prepared grant'}`;button.type='button';button.textContent='Inspect task';button.addEventListener('click',()=>{void this.inspect(item);});li.append(text,button);fragment.append(li);}
      this.targets=targets;this.allowed=allowed;this.target.replaceChildren(options);this.tools.replaceChildren(toolNodes);this.list.replaceChildren(fragment);this.editor.hidden=false;
      this.status.textContent=value.items.length?'Newest 50 owner grants; inaccessible targets omitted. Preparing never runs a task.':'No accessible prepared tasks. Preparing never runs a task.';
    }catch(error){if(this.active(request.generation)){this.clear();this.root.hidden=false;this.status.textContent=(error as Error).message;}}
  }
  private async inspect(item:TaskItem):Promise<void>{
    if(!this.visible()||this.busy)return;this.resetDetail();const request=this.startRequest();this.status.textContent='Loading task…';
    try{const value=await this.api.request(`/agent/scheduled-tasks/${encodeURIComponent(item.grant_id)}`,'GET',undefined,request.signal);if(!this.active(request.generation))return;
      const p=value?.preparation;
      if(value?.grant_id!==item.grant_id||value.task_id!==item.task_id||value.chat_jid!==item.chat_jid||value.activation_available!==false||typeof value.revoked!=='boolean'
        ||(value.revoked?p!==null:(!p||p.state!=='paused'||typeof p.prompt!=='string'||new TextEncoder().encode(p.prompt).byteLength>102400||typeof p.scheduled_for!=='string'||!Array.isArray(p.allowed_tools)||p.allowed_tools.some((name:unknown)=>!(FAMILY_WEB_TOOLS as readonly unknown[]).includes(name)))))throw Error('Invalid task detail.');
      this.detail.hidden=false;node('scheduled-task-target').textContent=`Original conversation: ${item.chat_jid} · Grant: ${item.grant_id}`;
      node('scheduled-task-state').textContent=value.revoked?'Grant revoked. It cannot run.':`Paused · Due (UTC): ${p.scheduled_for} · Currently allowed: ${p.allowed_tools.join(', ')||'none'}`;
      node('scheduled-task-text').textContent=p?.prompt??'';this.status.textContent='';
      if(!value.revoked){this.selected=item;this.revokeConfirm.disabled=false;}node('scheduled-task-detail-heading').focus();
    }catch(error){if(this.active(request.generation)){this.resetDetail();this.status.textContent=(error as Error).message;}}
  }
  private newPreparation():Preparation {
    const text=this.prompt.value,due=this.due.value;
    if(!this.targets.has(this.target.value)||!text.trim()||text.includes('\0')||new TextEncoder().encode(text).byteLength>102400)throw Error('Choose an owned conversation and a prompt up to 100 KiB UTF-8.');
    if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(due))throw Error('Enter a complete UTC date and time.');
    const date=new Date(`${due}:00.000Z`);if(!Number.isFinite(date.getTime())||date.toISOString()!==`${due}:00.000Z`||date.getTime()<=Date.now()||date.getTime()>Date.now()+366*86400000)throw Error('Choose a future UTC time within 366 days.');
    const selected=[...this.tools.querySelectorAll<HTMLInputElement>('input:checked')].map(box=>box.value);if(selected.some(name=>!this.allowed.includes(name)))throw Error('Refresh the current tool policy.');
    const payload:Preparation={request_id:crypto.randomUUID(),chat_jid:this.target.value,prompt:text,scheduled_for:date.toISOString(),allowed_tools:this.allowed.filter(name=>selected.includes(name)),confirm:true};
    if(new TextEncoder().encode(JSON.stringify(payload)).byteLength>128*1024)throw Error('The encoded request exceeds 128 KiB. Shorten the prompt; JSON escaping also counts towards this limit.');
    return payload;
  }
  private async prepare():Promise<void>{
    if(!this.visible()||this.busy||!this.confirm.checked||this.editor.hidden)return;
    let payload:Preparation;try{payload=this.retry??this.newPreparation();}catch(error){this.status.textContent=(error as Error).message;return;}
    if(!this.hooks.lock(true))return;
    this.retry=payload;this.busy=true;this.editorLocked(true);this.confirm.checked=false;this.confirm.disabled=true;this.submit.disabled=true;const request=this.startRequest();this.status.textContent='Preparing paused task…';
    try{const value=await this.api.request('/agent/scheduled-tasks','POST',payload,request.signal);if(!this.active(request.generation))return;
      if(value?.request_id!==payload.request_id||!validId(value.task_id)||!validId(value.grant_id)||value.state!=='paused'||typeof value.created!=='boolean')throw Error('Invalid task preparation response.');
      this.resetDraft();this.status.textContent=`${value.created?'Prepared paused task':'Preparation verified'}: ${value.task_id}. Refresh tasks to inspect it. No execution was queued.`;
    }catch(error){if(this.active(request.generation)){this.submit.textContent='Retry same preparation';this.status.textContent=`${(error as Error).message} The task may have been prepared. Confirm again to retry this exact request; fields stay locked until Discard task draft.`;}}
    finally{this.busy=false;this.confirm.disabled=false;this.hooks.lock(false);if(!this.stopped)await this.hooks.changed();if(this.visible()&&this.root.hidden)void this.load();}
  }
  private async revokeSelected():Promise<void>{
    if(!this.visible()||this.busy||!this.selected||!this.revokeConfirm.checked||!this.hooks.lock(true))return;
    const target=this.selected;this.busy=true;this.revokeConfirm.checked=false;this.revokeConfirm.disabled=true;this.revoke.disabled=true;const request=this.startRequest();
    try{const value=await this.api.request(`/agent/scheduled-tasks/${encodeURIComponent(target.grant_id)}/revoke`,'POST',{confirm:true},request.signal);if(!this.active(request.generation))return;
      if(value?.grant_id!==target.grant_id||value.revoked!==true)throw Error('Invalid revocation response.');this.resetDetail();this.status.textContent='Task grant revoked. Refresh tasks to inspect the saved state.';
    }catch(error){if(this.active(request.generation)){this.resetDetail();this.status.textContent=`${(error as Error).message} Revocation may have completed. Refresh and inspect before confirming again.`;}}
    finally{this.busy=false;this.hooks.lock(false);if(!this.stopped)await this.hooks.changed();if(this.visible()&&this.root.hidden)void this.load();}
  }
}
