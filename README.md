# 🎧 music-connect

**Meet people who listen like you.** Log in with Last.fm, get a feed of people ranked by how compatible your music taste is, send a *sync* request, and once you both accept, start a real-time chat.

<p align="center">
  <img src="docs/screenshot.png" alt="music-connect discover feed" width="720">
</p>

> Built because Spotify's API stopped being available to new apps, so the whole platform runs on the Last.fm API instead.

## ✨ Features

- **Last.fm login** using the official web-auth flow, plus import of top artists, albums and tracks
- **% compatibility feed**, an Instagram-style list of suggested people, with age, city and distance filters
- **Deep taste breakdown:** Artists sync, Albums sync, Songs sync and an **Underground artist match** (shared artists with few global listeners)
- **Consent-based connections:** Sync request → accept → Chat request → accept → chat
- **Real-time chat** over WebSockets (Socket.IO) with typing indicators
- **Nearby filter:** optional location, shown to others only as a rough distance bucket ("within 25 km"), never as coordinates
- **Safety:** report, block, 18+ age gate, reported users auto-hidden after 3 reports, message flood control

## 🧰 Tech stack

Node.js · Express · Socket.IO · SQLite (better-sqlite3) · Last.fm API · vanilla JS frontend (no build step)

## 🚀 Run it locally

Requires Node 18+.

```bash
git clone https://github.com/Atul-Koundal/music-connect.git
cd music-connect
npm install
cp .env.example .env     # then add your Last.fm API key + secret
npm start
```

Open http://localhost:3000.

Get a free Last.fm API key at https://www.last.fm/api/account/create and set the callback URL to `http://localhost:3000/auth/lastfm/callback`.

## 🎬 Demo walkthrough (about 2 minutes, no second account needed)

1. `npm run seed` adds five demo users (and one under-18 user who must never appear).
2. Open the app and sign in with `DEV_LOGIN` using any Last.fm username (set `DEV_LOGIN=true` in `.env`).
3. Fill in your date of birth, then open **Me → 📍 Use my current location**.
4. Go to **Discover**: browse people ranked by compatibility and filter by distance.
5. Open a profile to see the Artists, Albums, Songs and Underground breakdown, then tap **🎵 Sync music taste**.
6. Open a second browser window (or incognito), log in as another user, accept the sync, then send and accept a chat request.
7. Chat in real time, and try **Report** and **Block**.

## 🧠 How matching works

Each user's top 50 artists, albums and tracks are weighted by rank, so top items count more. The score for each category is the weighted overlap with the smaller list. The overall score is 55% artists, 20% albums and 25% tracks. "Underground" matches are shared artists with fewer than 150k Last.fm listeners, and listener counts are cached after a user's first sync.

## 🗺️ Project layout

```
src/server.js   Express routes + Socket.IO chat
src/db.js       SQLite schema and migrations
src/lastfm.js   Last.fm client, auth and library import
src/compat.js   Compatibility and underground matching
src/seed.js     Demo users
public/         Frontend (vanilla JS)
```

## 🔐 Privacy and safety notes

- Location is optional, stored rounded to roughly 1 km, and never returned by any API. Others see only a coarse distance bucket.
- The date of birth field is a basic age gate, not real age verification. Add proper verification before a public launch.
- Before deploying: set `DEV_LOGIN=false`, serve over HTTPS, set the cookie to `secure`, and add rate limiting.

## 🛣️ Roadmap

- Shared-playlist export
- Push notifications
- Admin dashboard for reports
- Postgres and a Redis adapter for Socket.IO at scale
