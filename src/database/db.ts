import Database from 'better-sqlite3';

const db = new Database('record_club.db');

export const database = {
  init: () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        discord_id TEXT PRIMARY KEY,
        record_club_username TEXT NOT NULL,
        last_review_url TEXT,
        last_checked_at INTEGER
      );
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS guild_settings (
        guild_id TEXT PRIMARY KEY,
        notification_channel_id TEXT,
        channel_1001_id TEXT,
        channel_latam_id TEXT
      );
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS tracked_albums (
        title TEXT,
        artist TEXT,
        source TEXT,
        PRIMARY KEY (title, artist, source)
      );
    `);
  },
  getDb: () => db
};
