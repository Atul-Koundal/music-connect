// Creates fake users with overlapping tastes so you can test the app alone.
require('dotenv').config();
const db = require('./db');

const pool = {
  artists: ['Radiohead','Tame Impala','Kendrick Lamar','Arctic Monkeys','Frank Ocean','Daft Punk','The Weeknd','Bon Iver','Mac DeMarco','Beach House','Slowdive','Khruangbin','Men I Trust','Alvvays','Tyler, The Creator','FKA twigs','Boards of Canada','Burial','Sufjan Stevens','Mitski'],
  under: ['Clairo','Cigarettes After Sex','Wednesday','Squid','Black Country, New Road','Narrow Head','Teen Suicide','Parannoul','Hovvdy','Snail Mail'],
};
const ALBUM_OF = { Radiohead: 'OK Computer', 'Tame Impala': 'Currents', 'Kendrick Lamar': 'good kid, m.A.A.d city', 'Frank Ocean': 'Blonde', 'Arctic Monkeys': 'AM', 'Bon Iver': 'For Emma, Forever Ago', 'Beach House': 'Depression Cherry', Slowdive: 'Souvlaki' };

const people = [
  ['aria_beats', 'Aria', '1999-03-12', 'Shimla', 31.10, 77.17],
  ['dev_dreamer', 'Dev', '1998-07-21', 'Delhi', 28.61, 77.21],
  ['luna_waves', 'Luna', '2001-11-02', 'Hamirpur', 31.69, 76.52],
  ['rohan_riffs', 'Rohan', '2000-01-30', 'Chandigarh', 30.73, 76.78],
  ['mira_synth', 'Mira', '2002-05-18', 'Delhi', 28.70, 77.10],
  ['kid_minor', 'Minor (should never show)', new Date(Date.now() - 15 * 365.25 * 864e5).toISOString().slice(0, 10), 'Delhi', 28.61, 77.21],
];

const shuffle = (a) => a.map((x) => [Math.random(), x]).sort((x, y) => x[0] - y[0]).map((x) => x[1]);

db.transaction(() => {
  for (const [username, name, dob, city, lat, lng] of people) {
    db.prepare('DELETE FROM users WHERE username=?').run(username);
    const id = db.prepare('INSERT INTO users (username, display_name, dob, city, bio, last_synced) VALUES (?,?,?,?,?,strftime(\'%s\',\'now\'))')
      .run(username, name, dob, city, 'Seed user — here for good music.').lastInsertRowid;
    db.prepare('UPDATE users SET lat=?, lng=? WHERE id=?').run(lat, lng, id);
    const artists = shuffle(pool.artists).slice(0, 14).concat(shuffle(pool.under).slice(0, 4));
    artists.forEach((a, i) => {
      db.prepare('INSERT INTO user_artists VALUES (?,?,?,?)').run(id, a, 500 - i * 20, i);
      if (ALBUM_OF[a]) db.prepare('INSERT OR IGNORE INTO user_albums VALUES (?,?,?,?,?)').run(id, ALBUM_OF[a], a, 100, i);
      db.prepare('INSERT OR IGNORE INTO user_tracks VALUES (?,?,?,?,?)').run(id, a + ' — Greatest Hit', a, 50, i);
    });
  }
  const cache = db.prepare("INSERT OR REPLACE INTO artist_cache VALUES (?,?,strftime('%s','now'))");
  pool.artists.forEach((a) => cache.run(a, 2000000));
  pool.under.forEach((a) => cache.run(a, 40000));
})();

console.log('Seeded', people.length, 'users. Log in with DEV_LOGIN as any real Last.fm username, then open Discover.');
