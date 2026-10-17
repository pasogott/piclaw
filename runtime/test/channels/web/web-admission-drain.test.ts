import { expect, test } from 'bun:test';
import { WebChannel } from '../../../src/channels/web.js';

test('constructed WebChannel direct requests share the server stop join without starting a listener', async () => {
  const web = new WebChannel({ queue: { enqueue() {} } as any, agentPool: { isStreaming: () => false } as any });
  const entered = Promise.withResolvers<void>();
  const body = Promise.withResolvers<ReadableStreamDefaultController<Uint8Array>>();
  let writes = 0;
  web.requestRouter.handle = async req => {
    entered.resolve();
    await req.text();
    writes++;
    return Response.json({ accepted: true });
  };
  const request = new Request('http://localhost/post', { method: 'POST', body: new ReadableStream({ start(controller) { body.resolve(controller); } }) });
  const pending = web.handleRequest(request);
  await entered.promise;
  const stopping = web.stop();
  expect(web.stop()).toBe(stopping);
  let joined = false;
  void stopping.then(() => { joined = true; });
  const denied = new Request('http://localhost/post', { method: 'POST', body: 'never read' });
  expect((await web.handleRequest(denied)).status).toBe(503);
  expect(denied.bodyUsed).toBe(false);
  expect(joined).toBe(false);
  const controller = await body.promise;
  controller.enqueue(new TextEncoder().encode('already entered')); controller.close();
  expect((await pending).status).toBe(200);
  await stopping;
  expect(writes).toBe(1);
  expect((await web.handleRequest(new Request('http://localhost/post'))).status).toBe(503);
  expect(writes).toBe(1);
});
