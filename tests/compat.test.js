const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start, stop, db, makeUser } = require('./helpers');
const { compare } = require('../src/compat');

let a, b, c;
before(async () => {
  await start();
  const rock = ['Radiohead', 'Slowdive', 'Beach House', 'Alvvays', 'Squid'];
  a = await makeUser('ann', rock);
  b = await makeUser('ben', rock);
  c = await makeUser('cat', ['Drake', 'Migos', 'Future', 'Travis Scott', 'Kodak Black']);
  db.prepare('INSERT OR REPLACE INTO artist_cache (name, listeners) VALUES (?,?)').run('Squid', 40000);
  db.prepare('INSERT OR REPLACE INTO artist_cache (name, listeners) VALUES (?,?)').run('Radiohead', 5000000);
});
after(stop);

test('identical libraries are highly compatible', () => {
  assert.ok(compare(a.id, b.id).percent >= 50);
});

test('disjoint libraries score 0', () => {
  const r = compare(a.id, c.id);
  assert.equal(r.percent, 0);
  assert.equal(r.artists.shared.length, 0);
});

test('compatibility is symmetric', () => {
  assert.equal(compare(a.id, b.id).percent, compare(b.id, a.id).percent);
});

test('only low-listener shared artists count as underground', () => {
  const names = compare(a.id, b.id).underground.map((u) => u.name);
  assert.deepEqual(names, ['Squid']);
});

test('users with empty libraries do not crash and score 0', async () => {
  const d = await makeUser('dan', []);
  assert.equal(compare(a.id, d.id).percent, 0);
});
