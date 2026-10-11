import {expect,test} from 'bun:test';
import {withAddonRegistrationOwner} from '../../src/addons/registration-owner';
import {registerAuthenticatedWebSocket,hasAuthenticatedAddonSocket,reserveAuthenticatedAddonSocket} from '../../src/addons/authenticated-socket-registry';
const owner={addonId:'test-socket',packageName:'test-socket',entryPath:'runtime.js'};
const registration={path:'stream',maxMessageBytes:8,maxQueuedBytes:8,maxSessionMs:1000,maxConnections:1,authorize:async()=>({chatJid:'web:a'}),open:async()=>({message:async()=>{},dispose:async()=>{}})};
test('registration ownership expires and failed import rolls back its route',async()=>{
 expect(()=>registerAuthenticatedWebSocket(registration)).toThrow('installed add-on');
 await expect(withAddonRegistrationOwner(owner,async()=>{registerAuthenticatedWebSocket(registration);throw Error('import failed');})).rejects.toThrow('import failed');
 expect(hasAuthenticatedAddonSocket('/agent/addons/test-socket/stream')).toBe(false);
 let late!:()=>void;await withAddonRegistrationOwner(owner,async()=>{late=()=>{registerAuthenticatedWebSocket(registration);};});expect(late).toThrow('installed add-on');
});
test('owner route enforces limits and rejects reserved or duplicate registrations',async()=>{
 let remove!:()=>void;
 await withAddonRegistrationOwner(owner,async()=>{expect(()=>registerAuthenticatedWebSocket({...registration,path:'api/private'})).toThrow('Reserved');remove=registerAuthenticatedWebSocket(registration);expect(()=>registerAuthenticatedWebSocket(registration)).toThrow('Duplicate');});
 const reserved=reserveAuthenticatedAddonSocket('/agent/addons/test-socket/stream')!;
 expect(()=>reserveAuthenticatedAddonSocket('/agent/addons/test-socket/stream')).toThrow('limit');await reserved.session.close();
 remove();expect(hasAuthenticatedAddonSocket('/agent/addons/test-socket/stream')).toBe(false);
});

test('unregister keeps route capacity reserved until actual disposal finishes',async()=>{
 let remove!:()=>void;let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});
 await withAddonRegistrationOwner(owner,async()=>{remove=registerAuthenticatedWebSocket({...registration,open:async()=>({message:async()=>{},dispose:async()=>{await held;}})});});
 const session=reserveAuthenticatedAddonSocket('/agent/addons/test-socket/stream')!.session;
 const principal:any={kind:'user',userId:'default',authentication:{sessionId:'test'}};
 await session.open(principal,{chatJid:'web:a'},{send:async()=>{},close:()=>{}});remove();
 await withAddonRegistrationOwner(owner,async()=>{expect(()=>registerAuthenticatedWebSocket(registration)).toThrow('Duplicate');});
 release();await session.close();
 await withAddonRegistrationOwner(owner,async()=>{remove=registerAuthenticatedWebSocket(registration);});remove();
});
