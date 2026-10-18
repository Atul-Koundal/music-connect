const db = require('./db');

const norm = (s) => (s || '').toLowerCase().trim();
const weight = (rank) => 1 / (1 + rank * 0.04); // top items matter more

function listMap(rows, keyFn) {
  const m = new Map();
  rows.forEach((r) => m.set(keyFn(r), { ...r, w: weight(r.rank) }));
  return m;
}

// weighted overlap coefficient: shared weight / smaller list's total weight
function overlap(a, b) {
  if (!a.size || !b.size) return { score: 0, shared: [] };
  let shared = 0;
  const sharedItems = [];
  for (const [k, va] of a) {
    const vb = b.get(k);
    if (vb) {
      shared += Math.min(va.w, vb.w);
      sharedItems.push({ name: va.name, artist: va.artist, rankA: va.rank, rankB: vb.rank });
    }
  }
  const totA = [...a.values()].reduce((s, x) => s + x.w, 0);
  const totB = [...b.values()].reduce((s, x) => s + x.w, 0);
  sharedItems.sort((x, y) => x.rankA + x.rankB - (y.rankA + y.rankB));
  return { score: shared / Math.min(totA, totB), shared: sharedItems };
}

const load = (table, id) => db.prepare(`SELECT * FROM ${table} WHERE user_id=? ORDER BY rank`).all(id);

function compare(idA, idB) {
  const artA = listMap(load('user_artists', idA), (r) => norm(r.name));
  const artB = listMap(load('user_artists', idB), (r) => norm(r.name));
  const albA = listMap(load('user_albums', idA), (r) => norm(r.name) + '|' + norm(r.artist));
  const albB = listMap(load('user_albums', idB), (r) => norm(r.name) + '|' + norm(r.artist));
  const trA = listMap(load('user_tracks', idA), (r) => norm(r.name) + '|' + norm(r.artist));
  const trB = listMap(load('user_tracks', idB), (r) => norm(r.name) + '|' + norm(r.artist));

  const ar = overlap(artA, artB);
  const al = overlap(albA, albB);
  const tr = overlap(trA, trB);

  // Artists are the strongest signal; tracks/albums are rarer so we boost them a little.
  const raw = 0.55 * ar.score + 0.2 * Math.min(1, al.score * 1.5) + 0.25 * Math.min(1, tr.score * 1.5);
  const percent = Math.round(Math.min(1, raw) * 100);

  // underground: shared artists with few global listeners
  const max = +process.env.UNDERGROUND_MAX_LISTENERS || 150000;
  const cache = db.prepare('SELECT listeners FROM artist_cache WHERE name=?');
  const underground = ar.shared
    .map((s) => ({ ...s, listeners: cache.get(s.name)?.listeners ?? null }))
    .filter((s) => s.listeners !== null && s.listeners < max)
    .sort((a, b) => a.listeners - b.listeners);

  return {
    percent,
    artists: { percent: Math.round(ar.score * 100), shared: ar.shared },
    albums: { percent: Math.round(al.score * 100), shared: al.shared },
    tracks: { percent: Math.round(tr.score * 100), shared: tr.shared },
    underground,
  };
}

module.exports = { compare };
