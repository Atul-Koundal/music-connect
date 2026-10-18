const crypto = require('crypto');
const db = require('./db');

const API = 'https://ws.audioscrobbler.com/2.0/';
const key = () => process.env.LASTFM_API_KEY;
const secret = () => process.env.LASTFM_SHARED_SECRET;

function sign(params) {
  const s = Object.keys(params)
    .filter((k) => k !== 'format' && k !== 'callback')
    .sort()
    .map((k) => k + params[k])
    .join('');
  return crypto.createHash('md5').update(s + secret(), 'utf8').digest('hex');
}

async function call(method, params = {}, signed = false) {
  if (!key()) throw new Error('LASTFM_API_KEY is not set in .env');
  const p = { method, api_key: key(), ...params };
  if (signed) p.api_sig = sign(p);
  p.format = 'json';
  const res = await fetch(API + '?' + new URLSearchParams(p));
  const data = await res.json();
  if (data.error) throw new Error(`Last.fm error ${data.error}: ${data.message}`);
  return data;
}

const authUrl = (cb) =>
  `https://www.last.fm/api/auth/?api_key=${key()}&cb=${encodeURIComponent(cb)}`;

async function getSession(token) {
  const d = await call('auth.getSession', { token }, true);
  return d.session.name;
}

const img = (arr) => {
  if (!Array.isArray(arr)) return '';
  const i = [...arr].reverse().find((x) => x['#text'] && !x['#text'].includes('2a96cbd8b46e442fc41c2b86b821562f'));
  return i ? i['#text'] : '';
};

async function getUserInfo(username) {
  const d = await call('user.getInfo', { user: username });
  return { name: d.user.name, display: d.user.realname || d.user.name, avatar: img(d.user.image) };
}

// Pull top artists/albums/tracks (overall) and store them
async function syncUserLibrary(userId, username, limit = 50) {
  const [ar, al, tr] = await Promise.all([
    call('user.getTopArtists', { user: username, period: 'overall', limit }),
    call('user.getTopAlbums', { user: username, period: 'overall', limit }),
    call('user.getTopTracks', { user: username, period: 'overall', limit }),
  ]);
  const artists = (ar.topartists?.artist || []).map((a, i) => ({ name: a.name, playcount: +a.playcount || 0, rank: i }));
  const albums = (al.topalbums?.album || []).map((a, i) => ({ name: a.name, artist: a.artist?.name || '', playcount: +a.playcount || 0, rank: i }));
  const tracks = (tr.toptracks?.track || []).map((t, i) => ({ name: t.name, artist: t.artist?.name || '', playcount: +t.playcount || 0, rank: i }));

  db.transaction(() => {
    db.prepare('DELETE FROM user_artists WHERE user_id=?').run(userId);
    db.prepare('DELETE FROM user_albums WHERE user_id=?').run(userId);
    db.prepare('DELETE FROM user_tracks WHERE user_id=?').run(userId);
    const ia = db.prepare('INSERT OR REPLACE INTO user_artists VALUES (?,?,?,?)');
    const ib = db.prepare('INSERT OR REPLACE INTO user_albums VALUES (?,?,?,?,?)');
    const it = db.prepare('INSERT OR REPLACE INTO user_tracks VALUES (?,?,?,?,?)');
    artists.forEach((a) => ia.run(userId, a.name, a.playcount, a.rank));
    albums.forEach((a) => ib.run(userId, a.name, a.artist, a.playcount, a.rank));
    tracks.forEach((t) => it.run(userId, t.name, t.artist, t.playcount, t.rank));
    db.prepare("UPDATE users SET last_synced=strftime('%s','now') WHERE id=?").run(userId);
  })();

  // fetch listener counts in the background (needed for "underground" matching)
  fillArtistCache(artists.map((a) => a.name)).catch((e) => console.warn('artist cache:', e.message));
  return { artists: artists.length, albums: albums.length, tracks: tracks.length };
}

async function fillArtistCache(names) {
  const has = db.prepare('SELECT 1 FROM artist_cache WHERE name=?');
  const ins = db.prepare("INSERT OR REPLACE INTO artist_cache VALUES (?,?,strftime('%s','now'))");
  for (const name of names) {
    if (has.get(name)) continue;
    try {
      const d = await call('artist.getInfo', { artist: name });
      ins.run(name, +d.artist?.stats?.listeners || 0);
    } catch (e) {
      ins.run(name, null);
    }
    await new Promise((r) => setTimeout(r, 250)); // be polite to Last.fm
  }
}

module.exports = { authUrl, getSession, getUserInfo, syncUserLibrary, fillArtistCache };
