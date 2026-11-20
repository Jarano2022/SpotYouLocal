import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import type { AudioFormat, AudioQuality, DownloadJobRecord, DownloadTrackRecord } from './types.ts';

export const DATA_DIR = path.resolve(process.env.DATA_DIR || './data');
export const DOWNLOAD_DIR = path.resolve(process.env.DOWNLOAD_DIR || './downloads');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

export const db = new Database(path.join(DATA_DIR, 'cratedock.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    spotify_access_token TEXT,
    spotify_refresh_token TEXT,
    spotify_expires_at INTEGER,
    spotify_user_json TEXT,
    google_access_token TEXT,
    google_refresh_token TEXT,
    google_expires_at INTEGER,
    google_user_json TEXT,
    cookies_txt TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS download_jobs (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    playlist_title TEXT NOT NULL,
    playlist_author TEXT NOT NULL,
    platform TEXT NOT NULL,
    playlist_url TEXT NOT NULL,
    thumbnail_url TEXT NOT NULL DEFAULT '',
    is_private INTEGER NOT NULL DEFAULT 0,
    format TEXT NOT NULL DEFAULT 'mp3',
    quality TEXT NOT NULL DEFAULT '320',
    status TEXT NOT NULL DEFAULT 'queued',
    total_tracks INTEGER NOT NULL DEFAULT 0,
    completed_tracks INTEGER NOT NULL DEFAULT 0,
    current_track TEXT,
    progress INTEGER NOT NULL DEFAULT 0,
    total_bytes INTEGER NOT NULL DEFAULT 0,
    output_path TEXT,
    zip_path TEXT,
    error_message TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS download_tracks (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    track_index INTEGER NOT NULL,
    title TEXT NOT NULL,
    artist TEXT NOT NULL,
    album TEXT NOT NULL DEFAULT '',
    duration_sec INTEGER NOT NULL DEFAULT 0,
    source_url TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    file_path TEXT,
    file_size INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,
    FOREIGN KEY (job_id) REFERENCES download_jobs(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

const defaultSettings: Record<string, string> = {
  concurrency: '2',
  defaultFormat: 'mp3',
  defaultQuality: '320',
  filenameTemplate: '{index} - {artist} - {title}',
};

const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
for (const [key, value] of Object.entries(defaultSettings)) {
  insertSetting.run(key, value);
}

// Recover any jobs left in "downloading" or "packaging" state after a container restart
db.prepare(
  `UPDATE download_jobs SET status = 'paused', current_track = NULL WHERE status IN ('downloading', 'packaging')`
).run();
db.prepare(
  `UPDATE download_tracks SET status = 'pending' WHERE status IN ('downloading', 'converting')`
).run();

export interface SessionRow {
  id: string;
  spotify_access_token: string | null;
  spotify_refresh_token: string | null;
  spotify_expires_at: number | null;
  spotify_user_json: string | null;
  google_access_token: string | null;
  google_refresh_token: string | null;
  google_expires_at: number | null;
  google_user_json: string | null;
  cookies_txt: string | null;
  created_at: number;
  updated_at: number;
}

export function getOrCreateSession(sessionId: string): SessionRow {
  const existing = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as SessionRow | undefined;
  if (existing) return existing;
  const now = Date.now();
  db.prepare(
    'INSERT INTO sessions (id, created_at, updated_at) VALUES (?, ?, ?)'
  ).run(sessionId, now, now);
  return db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as SessionRow;
}

export function getSettingsMap(): {
  concurrency: number;
  defaultFormat: AudioFormat;
  defaultQuality: AudioQuality;
  filenameTemplate: string;
} {
  const rows = db.prepare('SELECT key, value FROM settings').all() as Array<{ key: string; value: string }>;
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    concurrency: Math.max(1, Math.min(4, Number(map.concurrency || 2))),
    defaultFormat: (map.defaultFormat as AudioFormat) || 'mp3',
    defaultQuality: (map.defaultQuality as AudioQuality) || '320',
    filenameTemplate: map.filenameTemplate || '{index} - {artist} - {title}',
  };
}

export function updateSetting(key: string, value: string): void {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
}

export function mapJobRow(row: Record<string, unknown>, includeTracks = false): DownloadJobRecord {
  const job: DownloadJobRecord = {
    id: String(row.id),
    sessionId: String(row.session_id),
    playlistTitle: String(row.playlist_title),
    playlistAuthor: String(row.playlist_author),
    platform: String(row.platform) as DownloadJobRecord['platform'],
    playlistUrl: String(row.playlist_url),
    thumbnailUrl: String(row.thumbnail_url || ''),
    isPrivate: Boolean(row.is_private),
    format: String(row.format) as AudioFormat,
    quality: String(row.quality) as AudioQuality,
    status: String(row.status) as DownloadJobRecord['status'],
    totalTracks: Number(row.total_tracks || 0),
    completedTracks: Number(row.completed_tracks || 0),
    currentTrack: row.current_track ? String(row.current_track) : null,
    progress: Number(row.progress || 0),
    totalBytes: Number(row.total_bytes || 0),
    outputPath: row.output_path ? String(row.output_path) : null,
    zipPath: row.zip_path ? String(row.zip_path) : null,
    errorMessage: row.error_message ? String(row.error_message) : null,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };

  if (includeTracks) {
    const trackRows = db
      .prepare('SELECT * FROM download_tracks WHERE job_id = ? ORDER BY track_index ASC')
      .all(job.id) as Array<Record<string, unknown>>;
    job.tracks = trackRows.map(mapTrackRow);
  }
  return job;
}

export function mapTrackRow(row: Record<string, unknown>): DownloadTrackRecord {
  return {
    id: String(row.id),
    jobId: String(row.job_id),
    trackIndex: Number(row.track_index),
    title: String(row.title),
    artist: String(row.artist),
    album: String(row.album || ''),
    durationSec: Number(row.duration_sec || 0),
    sourceUrl: String(row.source_url),
    status: String(row.status) as DownloadTrackRecord['status'],
    filePath: row.file_path ? String(row.file_path) : null,
    fileSize: Number(row.file_size || 0),
    errorMessage: row.error_message ? String(row.error_message) : null,
  };
}
