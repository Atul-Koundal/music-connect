process.env.RATE_LIMIT_DISABLED = 'false';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start, stop, client } = require('./helpers');

before(start);
after(stop);

test('login endpoint is rate limited (429 after too many attempts)', async () => {
  const c = client();
  let limited = false;
  for (let i = 0; i < 60 && !limited; i++) {
    const r = await c.post('/auth/dev', { username: 'spammer' });
    if (r.status === 429) limited = true;
  }
  assert.ok(limited, 'expected a 429 response');
});
