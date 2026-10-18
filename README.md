# music-connect 🎧

Meet people who listen like you. Log in with **Last.fm** (the Spotify API replacement),
get an Instagram-style feed of people ranked by **% music compatibility**, send a
**sync request**, and once both sides accept, request a **real-time chat**.

## Features
- Last.fm login (official web-auth flow) + import of top artists / albums / tracks
- Feed ranked by % compatibility, with filters (age range, city)
- Compatibility breakdown: **Artists sync · Albums sync · Songs sync · Underground artist match**
- Flow: Sync request → accept → Chat request → accept → real-time chat (Socket.IO)
- Safety: Report, Block, 18+ age gate (DOB), reported users auto-hidden after 3 reports,
  message flood control

## Quick start (Node 18+)

```bash
unzip music-connect.zip && cd music-connect
npm install
cp .env.example .env        # Windows: copy .env.example .env
# edit .env and add your Last.fm API key + secret (see below)
npm start
```
Open http://localhost:3000

### Get a Last.fm API key (free, ~1 minute)
1. Go to https://www.last.fm/api/account/create
2. App name: anything. **Callback URL:** `http://localhost:3000/auth/lastfm/callback`
3. Copy the **API key** and **Shared secret** into `.env`

### Try it without a second account
```bash
npm run seed     # adds 5 demo users (+1 under-18 user that must never appear)
```
With `DEV_LOGIN=true` you can type any Last.fm username on the login page
(no ownership check, local testing only). For two real users, use two browsers
(or one normal + one incognito window).

## Project layout
```
src/server.js   Express routes + Socket.IO chat
src/db.js       SQLite schema (data/app.db is created automatically)
src/lastfm.js   Last.fm API client, auth, library import
src/compat.js   Compatibility + underground matching
src/seed.js     Demo users
public/         Frontend (vanilla JS, no build step)
```

## How compatibility works
Each user's top-50 artists/albums/tracks are weighted by rank (top items count more).
Score per category = weighted overlap with the smaller list. Overall =
55% artists + 20% albums + 25% tracks. "Underground" = shared artists with fewer than
`UNDERGROUND_MAX_LISTENERS` (default 150k) Last.fm listeners (fetched in the background
after a user's first sync, so it fills in after a minute).

## Before going public (important)
- Set `DEV_LOGIN=false`, use HTTPS, set `BASE_URL`, and mark the cookie `secure: true` in `server.js`.
- A DOB field is **not** real age verification. If strangers can chat, add proper
  verification/moderation and an admin review queue for the `reports` table.
- Add rate limiting (e.g. `express-rate-limit`) and a privacy policy; you store DOBs.
- SQLite is fine for a prototype; move to Postgres when you scale, and use a Redis adapter for Socket.IO.
- Respect Last.fm's API terms; the artist cache already throttles calls.

## Ideas for next steps
Location-based filtering, shared-playlist export, image/voice messages,
push notifications, an admin dashboard for reports.
