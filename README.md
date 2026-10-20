# 🎧 music-connect

**Meet people who listen like you.** Log in with Last.fm, get a feed of people ranked by how compatible your music taste is, send a *sync* request, and once you both accept, start a real-time chat.

[![CI](https://github.com/Atul-Koundal/music-connect/actions/workflows/ci.yml/badge.svg)](https://github.com/Atul-Koundal/music-connect/actions/workflows/ci.yml)

<p align="center">
  <img src="docs/demo.gif" alt="music-connect demo" width="760">
</p>

> Built because Spotify's API stopped being available to new apps, so the whole platform runs on the Last.fm API instead.

## ✨ Features

**Matching**
- **Last.fm login** (official web-auth flow) with import of top artists, albums and tracks
- **% compatibility feed**, an Instagram-style list of suggestions, with age, city and distance filters
- **Deep breakdown:** Genres, Artists, Albums and Songs in common, plus an **Underground artist match**
- **Choose your history:** all time, last 12, 6, 3 or 1 month
- **Now playing:** see what someone is listening to right now on their profile

**Connecting**
- **Consent-based flow:** Sync request → accept → Chat request → accept → chat
- **Real-time chat** (Socket.IO): typing indicators, online presence, unread badges, timestamps and date separators
- **Share a song** from your own library as a track card that links to Last.fm
- **Nearby filter:** optional location, shown to others only as a rough distance ("within 25 km"), never as coordinates

**Safety**
- Report, block, 18+ age gate, auto-hide after 3 reports
- **Admin page** to review reports, ban and unban users (bans revoke sessions and drop live connections)
- Rate limiting on login, API, requests and reports

## 🧰 Tech stack

Node.js · Express · Socket.IO · SQLite (better-sqlite3) · Last.fm API · vanilla JS frontend (no build step) · Node's built-in test runner · ESLint · GitHub Actions · Docker

## 🚀 Run it locally

Requires Node 18+ (22 recommended).

```bash
git clone https://github.com/Atul-Koundal/music-connect.git
cd music-connect
npm install
cp .env.example .env     # then add your Last.fm API key + secret
npm start
```

Open http://localhost:3000.

Get a free Last.fm API key at https://www.last.fm/api/account/create and set the callback URL to `http://localhost:3000/auth/lastfm/callback`.

**With Docker:** `cp .env.example .env`, fill it in, then `docker compose up --build`.

## 🎬 Demo walkthrough (about 2 minutes, no second account needed)

1. `npm run seed` adds five demo users (and one under-18 user who must never appear).
2. Set `DEV_LOGIN=true` in `.env` and sign in with any Last.fm username.
3. Fill in your date of birth, then open **Profile → Use my current location**.
4. Open **Discover**: browse people ranked by compatibility and filter by distance.
5. Open a profile to see the Genres, Artists, Albums, Songs and Underground breakdown, then tap **Sync music taste**.
6. Open a second browser window (or incognito), log in as another user, accept the sync, then send and accept a chat request.
7. Chat in real time, share a song, and try **Report** and **Block**.

To try the admin page, set `ADMIN_USERNAMES=<your username>` in `.env` and restart.

## ✅ Tests and quality

```bash
npm test        # 34 tests: compatibility maths, sync/chat/block/report flows, admin, rate limits, mocked Last.fm
npm run lint    # ESLint
```

CI runs both on Node 20 and 22 for every push and pull request.

## ☁️ Deploy

A `Dockerfile` and a `fly.toml` (Fly.io, persistent volume for SQLite, health check) are included. The steps are at the top of `fly.toml`. Set `BASE_URL` to your https URL and update the Last.fm callback to `https://<your-app>/auth/lastfm/callback`. Keep `DEV_LOGIN=false` in production.

Run a single instance: SQLite and the in-memory presence tracking assume one server.

## 🧠 How matching works

Each user's top 50 artists, albums and tracks are weighted by rank, so top items count more. The score for each category is the weighted overlap with the smaller list. Genres use cosine similarity over Last.fm tags of each user's artists. The overall score is 45% artists, 15% albums, 20% songs and 20% genres (before tag data has been fetched it falls back to 55 / 20 / 25). "Underground" matches are shared artists with fewer than 150k Last.fm listeners.

## 🗺️ Project layout

```
src/server.js   Express routes, Socket.IO chat, admin
src/db.js       SQLite schema and migrations
src/lastfm.js   Last.fm client, auth, library import, now playing
src/compat.js   Compatibility, genres and underground matching
src/seed.js     Demo users
public/         Frontend (vanilla JS)
tests/          Node test runner suites
```

## 🔐 Privacy and safety notes

- Location is optional, stored rounded to roughly 1 km, and never returned by any API. Others see only a coarse distance bucket.
- Now playing uses the user's public Last.fm scrobbles.
- The date of birth field is a basic age gate, not real age verification. Add proper verification before a public launch.
- Before deploying: `DEV_LOGIN=false`, serve over HTTPS, and review the rate limits in `src/server.js`.

## 🛣️ Roadmap

- Postgres and a Redis adapter for Socket.IO to run multiple instances
- Web push notifications for requests and messages
- Shared-playlist export
