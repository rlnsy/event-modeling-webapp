const { test } = require('node:test');
const assert = require('node:assert/strict');
const Client = require('../routing-client.js');
const edges = [{ fromId: 'a', toId: 'b', kind: 'cross' }];
const boxes = { a: { x: 0, y: 0, w: 100, h: 50 }, b: { x: 200, y: 0, w: 100, h: 50 } };
function setup(timeout) {
  const workers = [];
  const client = new Client(() => {
    const worker = { terminate() { this.terminated = true; }, postMessage(data) { this.data = data; } };
    workers.push(worker);
    return worker;
  }, timeout);
  return { client, workers, reply: (i, routes = [null]) => workers[i].onmessage({ data: { routes } }) };
}
test('superseded jobs terminate and late replies cannot populate the cache', async () => {
  const { client, workers, reply } = setup();
  const first = client.request(edges, boxes);
  const rejected = assert.rejects(first, /cancelled/);
  const second = client.request([], boxes);
  assert.equal(workers[0].terminated, true);
  reply(0, ['stale']);
  reply(1, []);
  await rejected;
  assert.deepEqual(await second, []);
  const third = client.request(edges, boxes);
  assert.equal(workers.length, 3);
  reply(2);
  await third;
});
test('identical pending requests coalesce; cache invalidates for geometry and edges', async () => {
  const { client, workers, reply } = setup();
  const first = client.request(edges, boxes);
  assert.equal(client.request(edges, boxes), first);
  reply(0);
  await first;
  await client.request(edges, { b: boxes.b, a: boxes.a });
  assert.equal(workers.length, 1);
  for (const [nextEdges, nextBoxes] of [
    [edges, { ...boxes, a: { ...boxes.a, h: 150 } }],
    [edges, { ...boxes, b: { ...boxes.b, x: 300 } }],
    [edges, { ...boxes, obstacle: boxes.a }],
    [[{ ...edges[0], kind: 'intra' }], boxes],
    [[], boxes],
  ]) {
    const count = workers.length;
    const pending = client.request(nextEdges, nextBoxes);
    assert.equal(workers.length, count + 1);
    reply(count);
    await pending;
  }
});
test('worker failures and deadlines reject, terminate and allow retry', async () => {
  const { client, workers, reply } = setup(10);
  const pending = client.request(edges, boxes);
  workers[0].onerror();
  await assert.rejects(pending, /failed/);
  assert.equal(workers[0].terminated, true);
  await assert.rejects(client.request(edges, boxes), /time limit/);
  assert.equal(workers[1].terminated, true);
  const retry = client.request(edges, boxes);
  reply(2);
  await retry;
});
test('cancellation on empty model and bounded LRU eviction', async () => {
  const { client, workers, reply } = setup();
  const pending = client.request(edges, boxes);
  client.cancel();
  await assert.rejects(pending, /cancelled/);
  for (let i = 0; i < 10; i++) {
    const next = client.request(edges, { ...boxes, a: { ...boxes.a, x: i } });
    reply(workers.length - 1);
    await next;
  }
  assert.equal(client.cache.size, 8);
  const count = workers.length;
  const evicted = client.request(edges, boxes);
  assert.equal(workers.length, count + 1);
  reply(count);
  await evicted;
});
