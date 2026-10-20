require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const cookieParser = require('cookie-parser');
const { Server } = require('socket.io');

const db = require('./db');
const lastfm = require('./lastfm');
const { compare } = require('./compat');

const PORT = +process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const MIN_AGE = +process.env.MIN_AGE || 18;
const REPORT_HIDE = +process.env.REPORT_HIDE_THRESHOLD || 3;
const DEV_LOGIN = process.env.DEV_LOGIN === 'true';

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.json({ limit: '50kb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/healthz', (req, res) => res.json({ ok: true }));

/* ---------------- helpers ---------------- */
const ageOf = (dob) => {
  if (!dob) return null;
  const d = new Date(dob);
  if (isNaN(d)) return null;
  const now = new Date();
  let a = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) a--;
  return a;
};
// Great-circle distance in km
const haversine = (lat1, lng1, lat2, lng2) => {
  const R = 6371, rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1), dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
};
// Privacy: we never expose coordinates, only a coarse bucket (5, 10, 15 ... km)
const kmBetween = (a, b) => (a.lat != null && b.lat != null ? haversine(a.lat, a.lng, b.lat, b.lng) : null);
const kmBucket = (km) => (km === null ? null : Math.max(5, Math.ceil(km / 5) * 5));
const clean = (s, n) => String(s || '').replace(/[<>]/g, '').trim().slice(0, n);
const publicUser = (u) => ({
  id: u.id, username: u.username, display_name: u.display_name || u.username,
  avatar: u.avatar, bio: u.bio, city: u.city, age: ageOf(u.dob),
});

function startSession(res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id) VALUES (?,?)').run(token, userId);
  res.cookie('sid', token, { httpOnly: true, sameSite: 'lax', maxAge: 30 * 864e5 });
}

function userFromToken(token) {
  if (!token) return null;
  return db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=?').get(token);
}

const auth = (req, res, next) => {
  const u = userFromToken(req.cookies.sid);
  if (!u) return res.status(401).json({ error: 'Not logged in' });
  req.user = u;
  next();
};
// must have finished onboarding (DOB set and 18+)
const ready = (req, res, next) => {
  const a = ageOf(req.user.dob);
  if (a === null) return res.status(403).json({ error: 'Finish onboarding first' });
  if (a < MIN_AGE) return res.status(403).json({ error: `You must be ${MIN_AGE}+ to use this app` });
  next();
};

const isBlocked = (a, b) =>
  !!db.prepare('SELECT 1 FROM blocks WHERE (blocker_id=? AND blocked_id=?) OR (blocker_id=? AND blocked_id=?)').get(a, b, b, a);

const reportCount = (id) => db.prepare('SELECT COUNT(*) c FROM reports WHERE reported_id=?').get(id).c;

function relation(me, other) {
  const s = db.prepare('SELECT * FROM syncs WHERE (from_id=? AND to_id=?) OR (from_id=? AND to_id=?)').get(me, other, other, me);
  const c = db.prepare('SELECT * FROM chat_requests WHERE (from_id=? AND to_id=?) OR (from_id=? AND to_id=?)').get(me, other, other, me);
  const st = (r) => (!r ? 'none' : r.status === 'accepted' ? 'accepted' : r.status === 'declined' ? 'declined' : r.from_id === me ? 'pending_out' : 'pending_in');
  return { sync: st(s), sync_id: s?.id, chat: st(c), chat_id: c?.id };
}

const pair = (a, b) => [Math.min(a, b), Math.max(a, b)];
const canChat = (a, b) => relation(a, b).chat === 'accepted' && !isBlocked(a, b);

/* ---------------- Last.fm login ---------------- */
async function loginAs(res, username) {
  const info = await lastfm.getUserInfo(username).catch(() => ({ name: username, display: username, avatar: '' }));
  let u = db.prepare('SELECT * FROM users WHERE username=? COLLATE NOCASE').get(info.name);
  if (!u) {
    const r = db.prepare('INSERT INTO users (username, display_name, avatar) VALUES (?,?,?)').run(info.name, info.display, info.avatar);
    u = db.prepare('SELECT * FROM users WHERE id=?').get(r.lastInsertRowid);
  } else {
    db.prepare('UPDATE users SET avatar=? WHERE id=?').run(info.avatar || u.avatar, u.id);
  }
  startSession(res, u.id);
  // first-time (or stale) library import, runs in the background
  if (process.env.LASTFM_API_KEY && Date.now() / 1000 - u.last_synced > 6 * 3600) {
    lastfm.syncUserLibrary(u.id, u.username).catch((e) => console.warn('sync failed:', e.message));
  }
}

app.get('/auth/lastfm', (req, res) => {
  if (!process.env.LASTFM_API_KEY) return res.status(500).send('Set LASTFM_API_KEY in .env');
  res.redirect(lastfm.authUrl(`${BASE_URL}/auth/lastfm/callback`));
});

app.get('/auth/lastfm/callback', async (req, res) => {
  try {
    const username = await lastfm.getSession(req.query.token);
    await loginAs(res, username);
    res.redirect('/');
  } catch (e) {
    res.status(400).send('Last.fm login failed: ' + e.message);
  }
});

app.get('/auth/config', (req, res) => res.json({ devLogin: DEV_LOGIN, minAge: MIN_AGE }));

app.post('/auth/dev', async (req, res) => {
  if (!DEV_LOGIN) return res.status(403).json({ error: 'Dev login disabled' });
  const username = clean(req.body.username, 40);
  if (!username) return res.status(400).json({ error: 'Username required' });
  try { await loginAs(res, username); res.json({ ok: true }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

app.post('/auth/logout', (req, res) => {
  db.prepare('DELETE FROM sessions WHERE token=?').run(req.cookies.sid);
  res.clearCookie('sid');
  res.json({ ok: true });
});

/* ---------------- profile ---------------- */
app.get('/api/me', auth, (req, res) => {
  const u = req.user;
  const counts = {
    artists: db.prepare('SELECT COUNT(*) c FROM user_artists WHERE user_id=?').get(u.id).c,
    albums: db.prepare('SELECT COUNT(*) c FROM user_albums WHERE user_id=?').get(u.id).c,
    tracks: db.prepare('SELECT COUNT(*) c FROM user_tracks WHERE user_id=?').get(u.id).c,
  };
  const a = ageOf(u.dob);
  res.json({ ...publicUser(u), has_location: u.lat != null, onboarded: a !== null, underage: a !== null && a < MIN_AGE, counts, last_synced: u.last_synced });
});

app.post('/api/onboard', auth, (req, res) => {
  const { dob, bio, city, display_name } = req.body;
  const a = ageOf(dob);
  if (a === null || a > 120) return res.status(400).json({ error: 'Enter a valid date of birth' });
  if (a < MIN_AGE) return res.status(403).json({ error: `Sorry, you must be ${MIN_AGE}+ to use this app` });
  db.prepare('UPDATE users SET dob=?, bio=?, city=?, display_name=? WHERE id=?')
    .run(dob, clean(bio, 200), clean(city, 60), clean(display_name, 40) || req.user.username, req.user.id);
  res.json({ ok: true });
});

app.put('/api/me', auth, ready, (req, res) => {
  db.prepare('UPDATE users SET bio=?, city=?, display_name=? WHERE id=?')
    .run(clean(req.body.bio, 200), clean(req.body.city, 60), clean(req.body.display_name, 40) || req.user.username, req.user.id);
  res.json({ ok: true });
});

// Location is optional. Stored rounded to 2 decimals (~1 km) and never returned to other users.
app.put('/api/me/location', auth, ready, (req, res) => {
  const lat = Number(req.body.lat), lng = Number(req.body.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180)
    return res.status(400).json({ error: 'Invalid coordinates' });
  db.prepare('UPDATE users SET lat=?, lng=? WHERE id=?').run(+lat.toFixed(2), +lng.toFixed(2), req.user.id);
  res.json({ ok: true });
});
app.delete('/api/me/location', auth, ready, (req, res) => {
  db.prepare('UPDATE users SET lat=NULL, lng=NULL WHERE id=?').run(req.user.id);
  res.json({ ok: true });
});

app.post('/api/resync', auth, ready, async (req, res) => {
  try { res.json(await lastfm.syncUserLibrary(req.user.id, req.user.username)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

/* ---------------- discover feed ---------------- */
app.get('/api/feed', auth, ready, (req, res) => {
  const me = req.user;
  const minAge = Math.max(MIN_AGE, +req.query.minAge || MIN_AGE);
  const maxAge = +req.query.maxAge || 120;
  const q = clean(req.query.city, 60).toLowerCase();
  const maxKm = +req.query.maxKm || 0;
  const sortBy = req.query.sort === 'distance' ? 'distance' : 'match';
  if ((maxKm || sortBy === 'distance') && me.lat == null)
    return res.status(400).json({ error: 'Set your location in the Me tab first' });
  const rows = db.prepare(`
    SELECT * FROM users WHERE id != ? AND dob IS NOT NULL
      AND id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id=?)
      AND id NOT IN (SELECT blocker_id FROM blocks WHERE blocked_id=?)`).all(me.id, me.id, me.id);

  const out = [];
  for (const u of rows) {
    const age = ageOf(u.dob);
    if (age < MIN_AGE || age < minAge || age > maxAge) continue;
    if (q && !(u.city || '').toLowerCase().includes(q)) continue;
    if (reportCount(u.id) >= REPORT_HIDE) continue;
    const km = kmBetween(me, u);
    if (maxKm && (km === null || km > maxKm)) continue;
    const c = compare(me.id, u.id);
    out.push({
      ...publicUser(u), percent: c.percent, distance_km: kmBucket(km), _km: km,
      shared_artists: c.artists.shared.slice(0, 4).map((s) => s.name),
      underground_count: c.underground.length,
      ...relation(me.id, u.id),
    });
  }
  if (sortBy === 'distance') out.sort((a, b) => (a._km ?? 1e9) - (b._km ?? 1e9) || b.percent - a.percent);
  else out.sort((a, b) => b.percent - a.percent);
  res.json(out.map(({ _km, ...rest }) => rest));
});

app.get('/api/users/:id', auth, ready, (req, res) => {
  const id = +req.params.id;
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(id);
  if (!u || !u.dob || isBlocked(req.user.id, id)) return res.status(404).json({ error: 'Not found' });
  const top = (t) => db.prepare(`SELECT * FROM ${t} WHERE user_id=? ORDER BY rank LIMIT 10`).all(id);
  res.json({
    user: publicUser(u),
    distance_km: id === req.user.id ? null : kmBucket(kmBetween(req.user, u)),
    compat: id === req.user.id ? null : compare(req.user.id, id),
    top: { artists: top('user_artists'), albums: top('user_albums'), tracks: top('user_tracks') },
    ...relation(req.user.id, id),
  });
});

/* ---------------- sync requests ---------------- */
app.post('/api/sync-requests', auth, ready, (req, res) => {
  const to = +req.body.to;
  const other = db.prepare('SELECT id, dob FROM users WHERE id=?').get(to);
  if (!other || to === req.user.id || isBlocked(req.user.id, to) || ageOf(other.dob) < MIN_AGE)
    return res.status(400).json({ error: 'Cannot send request to this user' });
  const rel = relation(req.user.id, to);
  if (rel.sync !== 'none') return res.status(409).json({ error: 'A sync already exists: ' + rel.sync });
  db.prepare('INSERT INTO syncs (from_id, to_id) VALUES (?,?)').run(req.user.id, to);
  io.to('u:' + to).emit('notify', { type: 'sync_request', from: publicUser(req.user) });
  res.json({ ok: true });
});

app.get('/api/sync-requests', auth, ready, (req, res) => {
  const me = req.user.id;
  const sel = (where) => db.prepare(`
    SELECT s.id, s.status, s.created_at, u.id uid, u.username, u.display_name, u.avatar FROM syncs s
    JOIN users u ON u.id = ${where === 'in' ? 's.from_id' : 's.to_id'}
    WHERE ${where === 'in' ? 's.to_id' : 's.from_id'}=? AND s.status='pending' ORDER BY s.id DESC`).all(me)
    .filter((r) => !isBlocked(me, r.uid))
    .map((r) => ({ ...r, percent: compare(me, r.uid).percent }));
  res.json({ incoming: sel('in'), outgoing: sel('out') });
});

app.post('/api/sync-requests/:id/respond', auth, ready, (req, res) => {
  const r = db.prepare("SELECT * FROM syncs WHERE id=? AND to_id=? AND status='pending'").get(+req.params.id, req.user.id);
  if (!r) return res.status(404).json({ error: 'Request not found' });
  const status = req.body.accept ? 'accepted' : 'declined';
  db.prepare('UPDATE syncs SET status=? WHERE id=?').run(status, r.id);
  io.to('u:' + r.from_id).emit('notify', { type: 'sync_' + status, from: publicUser(req.user) });
  res.json({ ok: true });
});

/* list of people I'm synced with */
app.get('/api/syncs', auth, ready, (req, res) => {
  const me = req.user.id;
  const rows = db.prepare(`SELECT u.* FROM syncs s JOIN users u ON u.id = CASE WHEN s.from_id=? THEN s.to_id ELSE s.from_id END
    WHERE (s.from_id=? OR s.to_id=?) AND s.status='accepted'`).all(me, me, me);
  res.json(rows.filter((u) => !isBlocked(me, u.id)).map((u) => ({ ...publicUser(u), percent: compare(me, u.id).percent, ...relation(me, u.id) })));
});

/* ---------------- chat requests (only after sync) ---------------- */
app.post('/api/chat-requests', auth, ready, (req, res) => {
  const to = +req.body.to;
  const rel = relation(req.user.id, to);
  if (rel.sync !== 'accepted' || isBlocked(req.user.id, to)) return res.status(400).json({ error: 'You must be synced first' });
  if (rel.chat !== 'none') return res.status(409).json({ error: 'Chat request already exists: ' + rel.chat });
  db.prepare('INSERT INTO chat_requests (from_id, to_id) VALUES (?,?)').run(req.user.id, to);
  io.to('u:' + to).emit('notify', { type: 'chat_request', from: publicUser(req.user) });
  res.json({ ok: true });
});

app.get('/api/chat-requests', auth, ready, (req, res) => {
  const rows = db.prepare(`SELECT c.id, u.id uid, u.username, u.display_name, u.avatar FROM chat_requests c
    JOIN users u ON u.id=c.from_id WHERE c.to_id=? AND c.status='pending' ORDER BY c.id DESC`).all(req.user.id);
  res.json({ incoming: rows.filter((r) => !isBlocked(req.user.id, r.uid)) });
});

app.post('/api/chat-requests/:id/respond', auth, ready, (req, res) => {
  const r = db.prepare("SELECT * FROM chat_requests WHERE id=? AND to_id=? AND status='pending'").get(+req.params.id, req.user.id);
  if (!r) return res.status(404).json({ error: 'Request not found' });
  const status = req.body.accept ? 'accepted' : 'declined';
  db.prepare('UPDATE chat_requests SET status=? WHERE id=?').run(status, r.id);
  io.to('u:' + r.from_id).emit('notify', { type: 'chat_' + status, from: publicUser(req.user) });
  res.json({ ok: true });
});

app.get('/api/chats', auth, ready, (req, res) => {
  const me = req.user.id;
  const rows = db.prepare(`SELECT u.* FROM chat_requests c JOIN users u ON u.id = CASE WHEN c.from_id=? THEN c.to_id ELSE c.from_id END
    WHERE (c.from_id=? OR c.to_id=?) AND c.status='accepted'`).all(me, me, me);
  res.json(rows.filter((u) => !isBlocked(me, u.id)).map((u) => {
    const [lo, hi] = pair(me, u.id);
    const last = db.prepare('SELECT body, created_at FROM messages WHERE user_lo=? AND user_hi=? ORDER BY id DESC LIMIT 1').get(lo, hi);
    return { ...publicUser(u), last_message: last?.body || '', last_at: last?.created_at || 0 };
  }).sort((a, b) => b.last_at - a.last_at));
});

app.get('/api/chats/:id/messages', auth, ready, (req, res) => {
  const other = +req.params.id;
  if (!canChat(req.user.id, other)) return res.status(403).json({ error: 'Chat not available' });
  const [lo, hi] = pair(req.user.id, other);
  const msgs = db.prepare('SELECT id, sender_id, body, created_at FROM messages WHERE user_lo=? AND user_hi=? ORDER BY id DESC LIMIT 200').all(lo, hi);
  res.json(msgs.reverse());
});

/* ---------------- block & report ---------------- */
app.post('/api/block', auth, ready, (req, res) => {
  const id = +req.body.userId;
  if (!id || id === req.user.id) return res.status(400).json({ error: 'Invalid user' });
  db.prepare('INSERT OR IGNORE INTO blocks VALUES (?,?)').run(req.user.id, id);
  io.to('u:' + id).emit('notify', { type: 'refresh' });
  res.json({ ok: true });
});

app.post('/api/unblock', auth, ready, (req, res) => {
  db.prepare('DELETE FROM blocks WHERE blocker_id=? AND blocked_id=?').run(req.user.id, +req.body.userId);
  res.json({ ok: true });
});

app.post('/api/report', auth, ready, (req, res) => {
  const id = +req.body.userId;
  if (!id || id === req.user.id) return res.status(400).json({ error: 'Invalid user' });
  db.prepare('INSERT OR IGNORE INTO reports (reporter_id, reported_id, reason) VALUES (?,?,?)').run(req.user.id, id, clean(req.body.reason, 300));
  if (req.body.alsoBlock) db.prepare('INSERT OR IGNORE INTO blocks VALUES (?,?)').run(req.user.id, id);
  res.json({ ok: true });
});

/* ---------------- real-time chat ---------------- */
io.use((socket, next) => {
  const cookie = socket.handshake.headers.cookie || '';
  const token = (cookie.match(/(?:^|;\s*)sid=([^;]+)/) || [])[1];
  const u = userFromToken(token);
  const a = u && ageOf(u.dob);
  if (!u || a === null || a < MIN_AGE) return next(new Error('unauthorized'));
  socket.user = u;
  next();
});

const lastMsgAt = new Map(); // simple flood control
io.on('connection', (socket) => {
  const me = socket.user;
  socket.join('u:' + me.id);

  socket.on('message', ({ to, body }, ack) => {
    to = +to;
    body = String(body || '').trim().slice(0, 1000);
    if (!body || !canChat(me.id, to)) return ack?.({ error: 'Cannot send message' });
    const now = Date.now();
    if (now - (lastMsgAt.get(me.id) || 0) < 400) return ack?.({ error: 'Slow down' });
    lastMsgAt.set(me.id, now);
    const [lo, hi] = pair(me.id, to);
    const r = db.prepare('INSERT INTO messages (user_lo, user_hi, sender_id, body) VALUES (?,?,?,?)').run(lo, hi, me.id, body);
    const msg = { id: r.lastInsertRowid, sender_id: me.id, to, body, created_at: Math.floor(now / 1000) };
    io.to('u:' + me.id).to('u:' + to).emit('message', msg);
    ack?.({ ok: true });
  });

  socket.on('typing', ({ to }) => {
    if (canChat(me.id, +to)) io.to('u:' + +to).emit('typing', { from: me.id });
  });
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`music-connect running at ${BASE_URL}`);
    if (!process.env.LASTFM_API_KEY) console.warn('⚠  LASTFM_API_KEY missing — copy .env.example to .env and fill it in.');
  });
}

module.exports = { app, server, io };
