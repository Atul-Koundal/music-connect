const $app = document.getElementById('app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const api = async (url, method = 'GET', body) => {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(d.error || 'Request failed'), { status: r.status });
  return d;
};
function toast(t) { const el = document.getElementById('toast'); el.textContent = t; el.style.display = 'block'; clearTimeout(toast.t); toast.t = setTimeout(() => (el.style.display = 'none'), 3000); }
const avatar = (u, big) => u.avatar ? `<img class="avatar ${big ? 'big' : ''}" src="${esc(u.avatar)}" alt="">` : `<div class="avatar ${big ? 'big' : ''}">${esc((u.display_name || u.username || '?')[0].toUpperCase())}</div>`;

let me = null, socket = null, tab = 'discover', openChat = null, badge = { req: 0 };
const state = { feed: [], filters: { minAge: '', maxAge: '', city: '', km: '', sort: '' } };

/* ---------- boot ---------- */
async function boot() {
  try { me = await api('/api/me'); } catch { me = null; }
  if (!me) return renderLogin();
  if (!me.onboarded) return renderOnboard();
  if (me.underage) return renderBlocked();
  connectSocket();
  go('discover');
}

async function renderLogin() {
  const cfg = await api('/auth/config');
  $app.innerHTML = `<div class="wrap center">
    <div class="logo" style="font-size:34px">music-connect</div>
    <p class="mute">Find people who listen like you.</p>
    <p><a class="btn" href="/auth/lastfm" style="text-decoration:none;display:inline-block">Continue with Last.fm</a></p>
    ${cfg.devLogin ? `<div class="card" style="text-align:left"><b>Dev login</b><div class="mute">Local testing only (no ownership check).</div>
      <input id="dev" placeholder="any Last.fm username"><button class="btn sm" id="devgo">Enter</button></div>` : ''}
    <p class="mute">${cfg.minAge}+ only. We read your public Last.fm top artists, albums and tracks.</p></div>`;
  if (cfg.devLogin) document.getElementById('devgo').onclick = async () => {
    try { await api('/auth/dev', 'POST', { username: document.getElementById('dev').value }); boot(); } catch (e) { toast(e.message); }
  };
}

function renderOnboard() {
  $app.innerHTML = `<div class="wrap"><h2>Welcome, ${esc(me.username)} 👋</h2>
    <div class="card"><label class="mute">Display name</label><input id="dn" value="${esc(me.display_name)}">
    <label class="mute">Date of birth (18+ only, used for age moderation)</label><input id="dob" type="date">
    <label class="mute">City (optional)</label><input id="city" placeholder="e.g. Hamirpur">
    <label class="mute">Short bio</label><textarea id="bio" rows="3" maxlength="200" placeholder="What are you listening to lately?"></textarea>
    <button class="btn" id="go">Create profile</button></div></div>`;
  document.getElementById('go').onclick = async () => {
    try {
      await api('/api/onboard', 'POST', { dob: dob.value, bio: bio.value, city: city.value, display_name: dn.value });
      boot();
    } catch (e) { toast(e.message); }
  };
}

function renderBlocked() {
  $app.innerHTML = `<div class="wrap center"><h2>Sorry!</h2><p>You must be 18 or older to use music-connect.</p><button class="btn ghost" onclick="logout()">Log out</button></div>`;
}
async function logout() { await api('/auth/logout', 'POST'); location.reload(); }

/* ---------- shell ---------- */
function shell(inner) {
  const t = (id, label, b) => `<button class="${tab === id ? 'on' : ''}" onclick="go('${id}')">${label}${b ? `<span class="badge">${b}</span>` : ''}</button>`;
  $app.innerHTML = `<header class="top"><span class="logo">music-connect</span><span class="mute">@${esc(me.username)}</span></header>
    <div class="wrap">${inner}</div>
    <nav class="tabs">${t('discover', '🎧 Discover')}${t('requests', '🤝 Syncs', badge.req)}${t('chats', '💬 Chats', badge.chat)}${t('me', '👤 Me')}</nav>`;
}

async function go(t, arg) {
  tab = t; openChat = null;
  ({ discover: viewDiscover, requests: viewRequests, chats: viewChats, me: viewMe, profile: viewProfile, chat: viewChat })[t](arg);
  refreshBadges();
}

async function refreshBadges() {
  try {
    const [s, c] = await Promise.all([api('/api/sync-requests'), api('/api/chat-requests')]);
    badge = { req: s.incoming.length + c.incoming.length };
    const b = document.querySelector('nav.tabs button:nth-child(2)');
    if (b) { b.querySelector('.badge')?.remove(); if (badge.req) b.insertAdjacentHTML('beforeend', `<span class="badge">${badge.req}</span>`); }
  } catch {}
}

/* ---------- discover ---------- */
async function viewDiscover() {
  const sel = 'width:auto;margin:0;border:3px solid var(--ink,#444);border-radius:12px;padding:8px;background:#fff;color:inherit;font:inherit';
  const opt = (v, label, cur) => `<option value="${v}" ${String(cur) === String(v) ? 'selected' : ''}>${label}</option>`;
  const F = state.filters;
  shell(`<div class="card filters" style="flex-wrap:wrap"><input id="fmin" type="number" min="18" placeholder="Min age" value="${esc(F.minAge)}" style="width:90px"><input id="fmax" type="number" placeholder="Max age" value="${esc(F.maxAge)}" style="width:90px"><input id="fcity" placeholder="City" value="${esc(F.city)}" style="flex:1;min-width:110px">
    <select id="fkm" style="${sel}">${opt('', '📍 Any distance', F.km)}${opt(10, 'within 10 km', F.km)}${opt(25, 'within 25 km', F.km)}${opt(50, 'within 50 km', F.km)}${opt(100, 'within 100 km', F.km)}${opt(300, 'within 300 km', F.km)}</select>
    <select id="fsort" style="${sel}">${opt('', 'Best match', F.sort)}${opt('distance', 'Nearest first', F.sort)}</select>
    <button class="btn sm" id="fgo">Go</button></div><div id="feed" class="mute">Loading…</div>`);
  fgo.onclick = () => { state.filters = { minAge: fmin.value, maxAge: fmax.value, city: fcity.value, km: fkm.value, sort: fsort.value }; viewDiscover(); };
  const f = state.filters;
  try {
    const list = await api(`/api/feed?minAge=${f.minAge}&maxAge=${f.maxAge}&city=${encodeURIComponent(f.city)}&maxKm=${f.km}&sort=${f.sort}`);
    const el = document.getElementById('feed');
    if (!list.length) return (el.innerHTML = `<div class="card center">No one here yet. Make sure your Last.fm library is synced (Me → Re-sync), or run <code>npm run seed</code> for demo users.</div>`);
    el.innerHTML = list.map(card).join('');
  } catch (e) { toast(e.message); if (/location/i.test(e.message)) { state.filters.km = ''; state.filters.sort = ''; } }
}

function card(u) {
  return `<div class="card"><div class="row" style="cursor:pointer" onclick="go('profile',${u.id})">${avatar(u)}
    <div class="grow"><b>${esc(u.display_name)}</b> <span class="mute">${u.age} · ${esc(u.city || '—')}${u.distance_km ? ` · 📍 within ${u.distance_km} km` : ''}</span>
    <div class="mute">${esc(u.bio || '')}</div></div><div class="pct">${u.percent}%<small>compatible</small></div></div>
    <div>${u.shared_artists.map((a) => `<span class="chip">${esc(a)}</span>`).join('')}${u.underground_count ? `<span class="chip ug">🕳 ${u.underground_count} underground match${u.underground_count > 1 ? 'es' : ''}</span>` : ''}</div>
    <div style="margin-top:10px">${actionButtons(u)}</div></div>`;
}

function actionButtons(u) {
  if (u.chat === 'accepted') return `<button class="btn sm" onclick="go('chat',${u.id})">💬 Open chat</button>`;
  if (u.chat === 'pending_out') return `<button class="btn sm ghost" disabled>Chat request sent</button>`;
  if (u.chat === 'pending_in') return `<button class="btn sm" onclick="go('requests')">Respond to chat request</button>`;
  if (u.sync === 'accepted') return `<button class="btn sm" onclick="reqChat(${u.id})">💬 Request to chat</button>`;
  if (u.sync === 'pending_out') return `<button class="btn sm ghost" disabled>Sync request sent</button>`;
  if (u.sync === 'pending_in') return `<button class="btn sm" onclick="go('requests')">Respond to sync request</button>`;
  if (u.sync === 'declined') return `<button class="btn sm ghost" disabled>Not available</button>`;
  return `<button class="btn sm" onclick="reqSync(${u.id})">🎵 Sync music taste</button>`;
}
async function reqSync(id) { try { await api('/api/sync-requests', 'POST', { to: id }); toast('Sync request sent'); go(tab, tab === 'profile' ? id : undefined); } catch (e) { toast(e.message); } }
async function reqChat(id) { try { await api('/api/chat-requests', 'POST', { to: id }); toast('Chat request sent'); go(tab, tab === 'profile' ? id : undefined); } catch (e) { toast(e.message); } }

/* ---------- profile / compat detail ---------- */
async function viewProfile(id) {
  shell('<div class="mute">Loading…</div>');
  try {
    const d = await api('/api/users/' + id);
    const u = d.user, c = d.compat;
    const list = (items, fmt) => items.length ? items.map((x) => `<span class="chip">${fmt(x)}</span>`).join('') : '<span class="mute">Nothing in common yet</span>';
    const section = (title, s, fmt) => `<h3>${title} — ${s.percent}%</h3><div class="bar"><i style="width:${s.percent}%"></i></div>${list(s.shared.slice(0, 15), fmt)}`;
    document.querySelector('.wrap').innerHTML = `<p><a href="#" onclick="go('discover');return false">← Back</a></p>
      <div class="card"><div class="row">${avatar(u, true)}<div class="grow"><h2 style="margin:0">${esc(u.display_name)}</h2>
      <div class="mute">@${esc(u.username)} · ${u.age} · ${esc(u.city || '—')}${d.distance_km ? ` · 📍 within ${d.distance_km} km` : ''}</div><p>${esc(u.bio)}</p></div>
      ${c ? `<div class="pct">${c.percent}%<small>compatible</small></div>` : ''}</div>
      ${c ? `<div>${actionButtons({ ...u, ...d })}
      <button class="btn sm ghost" onclick="doReport(${u.id})">🚩 Report</button>
      <button class="btn sm danger" onclick="doBlock(${u.id})">⛔ Block</button></div>` : ''}</div>
      ${c ? `<div class="card"><h3>🕳 Underground artist match</h3>${c.underground.length ? c.underground.map((x) => `<span class="chip ug">${esc(x.name)} · ${x.listeners.toLocaleString()} listeners</span>`).join('') : '<span class="mute">No shared underground artists (or listener data still loading)</span>'}
        ${section('Artists sync', c.artists, (x) => esc(x.name))}${section('Albums sync', c.albums, (x) => `${esc(x.name)} <span class="mute">${esc(x.artist)}</span>`)}${section('Songs sync', c.tracks, (x) => `${esc(x.name)} <span class="mute">${esc(x.artist)}</span>`)}</div>` : ''}
      <div class="card"><h3>Top artists</h3>${list(d.top.artists, (x) => esc(x.name))}<h3>Top albums</h3>${list(d.top.albums, (x) => esc(x.name))}<h3>Top songs</h3>${list(d.top.tracks, (x) => esc(x.name))}</div>`;
  } catch (e) { toast(e.message); go('discover'); }
}
async function doBlock(id) { if (!confirm('Block this user? They will disappear for both of you.')) return; await api('/api/block', 'POST', { userId: id }); toast('Blocked'); go('discover'); }
async function doReport(id) {
  const reason = prompt('Why are you reporting this user?'); if (reason === null) return;
  await api('/api/report', 'POST', { userId: id, reason, alsoBlock: confirm('Also block them?') }); toast('Report submitted'); go('discover');
}

/* ---------- requests ---------- */
async function viewRequests() {
  shell('<div class="mute">Loading…</div>');
  const [s, c, syncs] = await Promise.all([api('/api/sync-requests'), api('/api/chat-requests'), api('/api/syncs')]);
  const row = (r, btns) => `<div class="card row">${avatar(r)}<div class="grow"><b>${esc(r.display_name)}</b><div class="mute">@${esc(r.username)}${r.percent !== undefined ? ' · ' + r.percent + '% compatible' : ''}</div></div>${btns}</div>`;
  const yn = (kind, id) => `<button class="btn sm" onclick="respond('${kind}',${id},true)">Accept</button><button class="btn sm ghost" onclick="respond('${kind}',${id},false)">Decline</button>`;
  document.querySelector('.wrap').innerHTML = `<h2>Sync requests</h2>
    ${s.incoming.map((r) => row(r, yn('sync-requests', r.id))).join('') || '<p class="mute">No incoming requests.</p>'}
    ${s.outgoing.length ? '<h3>Sent</h3>' + s.outgoing.map((r) => row(r, '<span class="mute">pending</span>')).join('') : ''}
    <h2>Chat requests</h2>${c.incoming.map((r) => row(r, yn('chat-requests', r.id))).join('') || '<p class="mute">No chat requests.</p>'}
    <h2>Your synced people</h2>${syncs.map((u) => `<div class="card row" style="cursor:pointer" onclick="go('profile',${u.id})">${avatar(u)}<div class="grow"><b>${esc(u.display_name)}</b><div class="mute">${u.percent}% compatible</div></div>${actionButtons(u)}</div>`).join('') || '<p class="mute">Nobody yet — send a sync from Discover.</p>'}`;
}
async function respond(kind, id, accept) { try { await api(`/api/${kind}/${id}/respond`, 'POST', { accept }); toast(accept ? 'Accepted' : 'Declined'); viewRequests(); refreshBadges(); } catch (e) { toast(e.message); } }

/* ---------- chats ---------- */
async function viewChats() {
  shell('<div class="mute">Loading…</div>');
  const list = await api('/api/chats');
  document.querySelector('.wrap').innerHTML = `<h2>Chats</h2>` + (list.map((u) => `<div class="card row" style="cursor:pointer" onclick="go('chat',${u.id})">${avatar(u)}<div class="grow"><b>${esc(u.display_name)}</b><div class="mute">${esc(u.last_message || 'Say hi 👋')}</div></div></div>`).join('') || '<p class="mute">No chats yet. Sync with someone, then request to chat.</p>');
}

async function viewChat(id) {
  openChat = id; tab = 'chats';
  shell('');
  const [u, msgs] = await Promise.all([api('/api/users/' + id), api('/api/chats/' + id + '/messages')]).catch((e) => { toast(e.message); go('chats'); return []; });
  if (!u) return;
  document.querySelector('.wrap').innerHTML = `<div class="row" style="padding:12px 0"><a href="#" onclick="go('chats');return false">←</a>${avatar(u.user)}<div class="grow"><b>${esc(u.user.display_name)}</b><div class="mute" id="typing">${u.compat.percent}% compatible</div></div>
    <button class="btn sm ghost" onclick="doReport(${id})">🚩</button><button class="btn sm danger" onclick="doBlock(${id})">⛔</button></div>
    <div class="chatbox"><div class="msgs" id="msgs"></div><div class="send"><input id="txt" maxlength="1000" placeholder="Message…" autocomplete="off"><button class="btn" id="snd">Send</button></div></div>`;
  msgs.forEach(addMsg);
  const send = () => { const body = txt.value.trim(); if (!body) return; socket.emit('message', { to: id, body }, (r) => r?.error && toast(r.error)); txt.value = ''; };
  snd.onclick = send;
  txt.onkeydown = (e) => { if (e.key === 'Enter') send(); else socket.emit('typing', { to: id }); };
  txt.focus();
}
function addMsg(m) {
  const box = document.getElementById('msgs'); if (!box) return;
  const el = document.createElement('div'); el.className = 'm' + (m.sender_id === me.id ? ' me' : ''); el.textContent = m.body;
  box.appendChild(el); box.scrollTop = box.scrollHeight;
}

/* ---------- me ---------- */
async function viewMe() {
  shell('');
  me = await api('/api/me');
  document.querySelector('.wrap').innerHTML = `<div class="card"><div class="row">${avatar(me, true)}<div class="grow"><h2 style="margin:0">${esc(me.display_name)}</h2><div class="mute">@${esc(me.username)} · ${me.age}</div></div></div>
    <p class="mute">Library: ${me.counts.artists} artists · ${me.counts.albums} albums · ${me.counts.tracks} songs${me.last_synced ? '' : ' (not synced yet)'}</p>
    <button class="btn sm" id="rs">🔄 Re-sync from Last.fm</button></div>
    <div class="card"><b>📍 Location</b>
    <div class="mute">Optional. Used only to filter people near you. Other users only ever see a rough distance (like "within 25 km"), never your coordinates.</div>
    <p class="mute">${me.has_location ? '✅ Location saved.' : 'No location set.'}</p>
    <button class="btn sm" onclick="setLocation()">📍 Use my current location</button>
    ${me.has_location ? '<button class="btn sm ghost" onclick="removeLocation()">Remove</button>' : ''}</div>
    <div class="card"><label class="mute">Display name</label><input id="dn" value="${esc(me.display_name)}"><label class="mute">City</label><input id="city" value="${esc(me.city)}"><label class="mute">Bio</label><textarea id="bio" rows="3" maxlength="200">${esc(me.bio)}</textarea>
    <button class="btn" id="sv">Save</button> <button class="btn ghost" onclick="logout()">Log out</button></div>`;
  rs.onclick = async () => { rs.disabled = true; try { const r = await api('/api/resync', 'POST'); toast(`Synced ${r.artists} artists, ${r.albums} albums, ${r.tracks} songs`); viewMe(); } catch (e) { toast(e.message); rs.disabled = false; } };
  sv.onclick = async () => { await api('/api/me', 'PUT', { display_name: dn.value, city: city.value, bio: bio.value }); toast('Saved'); };
}

function setLocation() {
  if (!navigator.geolocation) return toast('Your browser does not support location');
  navigator.geolocation.getCurrentPosition(
    async (p) => { try { await api('/api/me/location', 'PUT', { lat: p.coords.latitude, lng: p.coords.longitude }); toast('Location saved'); viewMe(); } catch (e) { toast(e.message); } },
    () => toast('Location permission denied'), { timeout: 10000 });
}
async function removeLocation() { await api('/api/me/location', 'DELETE'); toast('Location removed'); viewMe(); }

/* ---------- realtime ---------- */
function connectSocket() {
  socket = io();
  socket.on('message', (m) => {
    const other = m.sender_id === me.id ? m.to : m.sender_id;
    if (openChat === other) addMsg(m);
    else if (m.sender_id !== me.id) toast('💬 New message');
  });
  socket.on('typing', ({ from }) => {
    if (openChat !== from) return;
    const t = document.getElementById('typing'); if (!t) return;
    const old = t.textContent; t.textContent = 'typing…'; clearTimeout(connectSocket.t); connectSocket.t = setTimeout(() => (t.textContent = old.includes('typing') ? '' : old), 1200);
  });
  socket.on('notify', (n) => {
    const msg = { sync_request: 'sent you a sync request', sync_accepted: 'accepted your sync', sync_declined: 'declined your sync', chat_request: 'wants to chat', chat_accepted: 'accepted your chat request', chat_declined: 'declined your chat request' }[n.type];
    if (msg) toast(`${n.from.display_name} ${msg}`);
    refreshBadges();
    if (tab === 'requests') viewRequests();
  });
}

boot();
