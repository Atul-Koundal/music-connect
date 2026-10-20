const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

let dbFile = process.env.DB_PATH;
if (!dbFile) {
  const dir = path.join(__dirname, '..', 'data');
  fs.mkdirSync(dir, { recursive: true });
  dbFile = path.join(dir, 'app.db');
} else if (dbFile !== ':memory:') {
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
}
const db = new Database(dbFile);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  display_name TEXT,
  avatar TEXT,
  bio TEXT DEFAULT '',
  city TEXT DEFAULT '',
  dob TEXT,
  created_at INTEGER DEFAULT (strftime('%s','now')),
  last_synced INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER DEFAULT (strftime('%s','now'))
);
CREATE TABLE IF NOT EXISTS user_artists (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL, playcount INTEGER DEFAULT 0, rank INTEGER NOT NULL,
  PRIMARY KEY (user_id, name)
);
CREATE TABLE IF NOT EXISTS user_albums (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL, artist TEXT NOT NULL, playcount INTEGER DEFAULT 0, rank INTEGER NOT NULL,
  PRIMARY KEY (user_id, name, artist)
);
CREATE TABLE IF NOT EXISTS user_tracks (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL, artist TEXT NOT NULL, playcount INTEGER DEFAULT 0, rank INTEGER NOT NULL,
  PRIMARY KEY (user_id, name, artist)
);
CREATE TABLE IF NOT EXISTS artist_cache (
  name TEXT PRIMARY KEY, listeners INTEGER, fetched_at INTEGER
);
CREATE TABLE IF NOT EXISTS syncs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER DEFAULT (strftime('%s','now')),
  UNIQUE (from_id, to_id)
);
CREATE TABLE IF NOT EXISTS chat_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER DEFAULT (strftime('%s','now')),
  UNIQUE (from_id, to_id)
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_lo INTEGER NOT NULL, user_hi INTEGER NOT NULL,
  sender_id INTEGER NOT NULL, body TEXT NOT NULL,
  created_at INTEGER DEFAULT (strftime('%s','now'))
);
CREATE INDEX IF NOT EXISTS idx_msgs ON messages(user_lo, user_hi, id);
CREATE TABLE IF NOT EXISTS blocks (
  blocker_id INTEGER NOT NULL, blocked_id INTEGER NOT NULL,
  PRIMARY KEY (blocker_id, blocked_id)
);
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reporter_id INTEGER NOT NULL, reported_id INTEGER NOT NULL,
  reason TEXT, created_at INTEGER DEFAULT (strftime('%s','now')),
  UNIQUE (reporter_id, reported_id)
);
`);

// lightweight migration: add coarse location columns if missing
const userCols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
if (!userCols.includes('lat')) db.exec('ALTER TABLE users ADD COLUMN lat REAL');
if (!userCols.includes('lng')) db.exec('ALTER TABLE users ADD COLUMN lng REAL');

module.exports = db;
