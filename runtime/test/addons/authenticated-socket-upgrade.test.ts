import {expect,test} from 'bun:test';
import {withAddonRegistrationOwner} from '../../src/addons/registration-owner';
import {registerAuthenticatedWebSocket} from '../../src/addons/authenticated-socket-registry';
import {prepareAuthenticatedAddonSocket} from '../../src/addons/authenticated-socket-upgrade';
import type {AuthenticatedPrincipal} from '../../src/core/access-types';
import {initDatabase,storeChatMetadata} from '../../src/db';
import {ensureChatBranch,archiveChatBranch} from '../../src/db/chat-branches';
initDatabase();
const principal:AuthenticatedPrincipal={kind:'user',userId:'default',username:'test',displayName:'Test',role:'admin',mode:'single-user',homeChatJid:'web:default',authentication:{method:'session',sessionId:'test-session',expiresAt:null}};
const path='/agent/addons/test-upgrade/stream';
function request(origin='https://test.example'){return new Request('https://test.example'+path,{headers:{origin,upgrade:'websocket'}});}
test('authenticated upgrade validates Origin, principal and host-resolved chat before reserving an open session',async()=>{
 storeChatMetadata('web:socket','2026-01-01','socket','web',false);ensureChatBranch({chat_jid:'web:socket',agent_name:'socket'});
 let dispose!:()=>void;await withAddonRegistrationOwner({addonId:'test-upgrade',packageName:'test-upgrade',entryPath:'test'},async()=>{dispose=registerAuthenticatedWebSocket({path:'stream',maxMessageBytes:8,maxQueuedBytes:8,maxSessionMs:1000,maxConnections:1,authorize:async()=>({chatJid:'web:socket'}),open:async()=>({message:async()=>{},dispose:async()=>{}})});});
 const auth={isAuthEnabled:()=>true,getPrincipal:()=>principal};
 await expect(prepareAuthenticatedAddonSocket(request('https://foreign.example'),path,auth)).rejects.toThrow('denied');
 await expect(prepareAuthenticatedAddonSocket(request(),path,{...auth,getPrincipal:()=>null})).rejects.toThrow('login');
 const data=await prepareAuthenticatedAddonSocket(request(),path,auth);expect(data.scope.chatJid).toBe('web:socket');expect(data.scope.workspaceId).toHaveLength(64);
 await data.session.open(principal,data.scope,{send:async()=>{},close:()=>{}});
 archiveChatBranch('web:socket');
 await expect(data.session.message('revoked')).rejects.toThrow('unauthorized');await data.session.close();dispose();
});
