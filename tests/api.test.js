const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { io: ioc } = require('socket.io-client');
const { start, stop, db, client, makeUser, isoYearsAgo } = require('./helpers');

let base, alice, bob, carol;
const rock = ['Radiohead', 'Slowdive', 'Beach House'];

before(async () => {
  base = await start();
  alice = await makeUser('alice', rock, { city: 'Shimla' });
  bob = await makeUser('bob', rock);
  carol = await makeUser('carol', ['Drake']);
});
after(stop);

test('API requires login', async () => {
  const r = await client().get('/api/me');
  assert.equal(r.status, 401);
});

test('healthcheck', async () => {
  assert.equal((await client().get('/healthz')).body.ok, true);
});

test('under-18 users cannot onboard', async () => {
  const c = client();
  await c.post('/auth/dev', { username: 'kiddo' });
  const r = await c.post('/api/onboard', { dob: isoYearsAgo(15) });
  assert.equal(r.status, 403);
  assert.equal((await c.get('/api/feed')).status, 403);
});

test('feed ranks by compatibility and excludes self', async () => {
  const r = await alice.c.get('/api/feed');
  assert.equal(r.status, 200);
  const names = r.body.map((u) => u.username);
  assert.ok(!names.includes('alice'));
  assert.equal(names[0], 'bob');
  assert.ok(r.body[0].percent > r.body.find((u) => u.username === 'carol').percent);
});

test('chat request is refused before sync is accepted', async () => {
  const r = await alice.c.post('/api/chat-requests', { to: bob.id });
  assert.equal(r.status, 400);
});

test('sync -> accept -> chat request -> accept -> realtime message', async () => {
  assert.equal((await alice.c.post('/api/sync-requests', { to: bob.id })).status, 200);
  assert.equal((await alice.c.post('/api/sync-requests', { to: bob.id })).status, 409, 'duplicate request rejected');
  const inc = (await bob.c.get('/api/sync-requests')).body.incoming;
  assert.equal(inc.length, 1);
  assert.equal((await bob.c.post(`/api/sync-requests/${inc[0].id}/respond`, { accept: true })).status, 200);

  assert.equal((await alice.c.post('/api/chat-requests', { to: bob.id })).status, 200);
  const ch = (await bob.c.get('/api/chat-requests')).body.incoming;
  assert.equal((await bob.c.post(`/api/chat-requests/${ch[0].id}/respond`, { accept: true })).status, 200);

  const sock = (u) => ioc(base, { extraHeaders: { cookie: u.c.cookie } });
  const sa = sock(alice), sb = sock(bob);
  await Promise.all([new Promise((r) => sa.on('connect', r)), new Promise((r) => sb.on('connect', r))]);
  const got = new Promise((r) => sb.on('message', r));
  const ack = await new Promise((r) => sa.emit('message', { to: bob.id, body: 'hello bob' }, r));
  assert.equal(ack.ok, true);
  assert.equal((await got).body, 'hello bob');
  const hist = (await bob.c.get(`/api/chats/${alice.id}/messages`)).body;
  assert.equal(hist.length, 1);
  sa.close(); sb.close();
});

test('a stranger cannot read or send messages', async () => {
  assert.equal((await carol.c.get(`/api/chats/${alice.id}/messages`)).status, 403);
  const s = ioc(base, { extraHeaders: { cookie: carol.c.cookie } });
  await new Promise((r) => s.on('connect', r));
  const ack = await new Promise((r) => s.emit('message', { to: alice.id, body: 'hi' }, r));
  assert.ok(ack.error);
  s.close();
});

test('blocking removes the user from the feed and disables chat', async () => {
  assert.equal((await bob.c.post('/api/block', { userId: alice.id })).status, 200);
  assert.ok(!(await alice.c.get('/api/feed')).body.some((u) => u.username === 'bob'));
  assert.equal((await alice.c.get(`/api/chats/${bob.id}/messages`)).status, 403);
  assert.equal((await alice.c.get(`/api/users/${bob.id}`)).status, 404);
});

test('users reported by 3 people are hidden from the feed', async () => {
  const target = await makeUser('troll', rock);
  const r1 = await makeUser('r1', rock), r2 = await makeUser('r2', rock), r3 = await makeUser('r3', rock);
  const viewer = await makeUser('viewer', rock);
  assert.ok((await viewer.c.get('/api/feed')).body.some((u) => u.username === 'troll'));
  for (const r of [r1, r2, r3]) await r.c.post('/api/report', { userId: target.id, reason: 'spam' });
  assert.ok(!(await viewer.c.get('/api/feed')).body.some((u) => u.username === 'troll'));
});

test('location: stored coarsely, never leaked, radius filter works', async () => {
  const near = await makeUser('near', rock), far = await makeUser('far', rock), me = await makeUser('me1', rock);
  await me.c.put('/api/me/location', { lat: 31.1048, lng: 77.1734 });
  await near.c.put('/api/me/location', { lat: 31.2, lng: 77.2 });
  await far.c.put('/api/me/location', { lat: 28.6, lng: 77.2 });
  const row = db.prepare('SELECT lat, lng FROM users WHERE id=?').get(me.id);
  assert.equal(row.lat, 31.1);
  const feed = await me.c.get('/api/feed?maxKm=50');
  const names = feed.body.map((u) => u.username);
  assert.ok(names.includes('near') && !names.includes('far'));
  assert.ok(!JSON.stringify(feed.body).includes('"lat"'));
});
