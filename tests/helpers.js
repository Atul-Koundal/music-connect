// Shared test helpers. Each test file runs in its own process (node --test),
// so setting env here before requiring the app gives every file a fresh in-memory DB.
process.env.DB_PATH = ':memory:';
process.env.DEV_LOGIN = 'true';
process.env.RATE_LIMIT_DISABLED = process.env.RATE_LIMIT_DISABLED || 'true';
delete process.env.LASTFM_API_KEY;

const { app, server, io } = require('../src/server');
const db = require('../src/db');

let base = '';
async function start() {
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
  return base;
}
async function stop() {
  io.close();
  await new Promise((r) => server.close(r));
}

// tiny HTTP client with a cookie jar, one per simulated browser
function client() {
  let cookie = '';
  const api = {
    get cookie() { return cookie; },
    async req(method, path, body) {
      const res = await fetch(base + path, {
        method, redirect: 'manual',
        headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      const sc = res.headers.get('set-cookie');
      if (sc) cookie = sc.split(';')[0];
      return { status: res.status, body: await res.json().catch(() => null) };
    },
    get: (p) => api.req('GET', p),
    post: (p, b) => api.req('POST', p, b || {}),
    put: (p, b) => api.req('PUT', p, b || {}),
    del: (p) => api.req('DELETE', p),
  };
  return api;
}

const isoYearsAgo = (y) => new Date(Date.now() - y * 365.25 * 864e5).toISOString().slice(0, 10);

// create a logged-in, onboarded adult with a music library
async function makeUser(username, artists = [], opts = {}) {
  const c = client();
  await c.post('/auth/dev', { username });
  const r = await c.post('/api/onboard', { dob: opts.dob || isoYearsAgo(25), city: opts.city || '', bio: '', display_name: username });
  if (r.status !== 200 && !opts.allowFail) throw new Error('onboard failed: ' + JSON.stringify(r.body));
  const row = db.prepare('SELECT id FROM users WHERE username=?').get(username);
  artists.forEach((a, i) => db.prepare('INSERT OR REPLACE INTO user_artists VALUES (?,?,?,?)').run(row.id, a, 100, i));
  return { c, id: row.id, username };
}

module.exports = { app, server, io, db, start, stop, client, makeUser, isoYearsAgo };
