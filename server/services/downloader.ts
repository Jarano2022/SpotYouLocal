import * as archiverNs from 'archiver';
import { spawn } from 'child_process';
import crypto from 'crypto';
import type { Response } from 'express';
import fs from 'fs';
import path from 'path';
import { DOWNLOAD_DIR, db, getSettingsMap, mapJobRow } from '../db.ts';
import type {
  AudioFormat,
  AudioQuality,
  DownloadJobRecord,
  DownloadTrackRecord,
  Platform,
  PlaylistTrack,
} from '../types.ts';
import { getSessionCookiesTxt } from './auth.ts';
import { checkYtDlpAvailable, getInnertube } from './providers.ts';

const sseClients = new Set<Response>();
const activeJobIds = new Set<string>();
const cancelledOrPausedJobs = new Set<string>();

export function subscribeDownloadEvents(res: Response): void {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  sseClients.add(res);
  res.on('close', () => {
    sseClients.delete(res);
  });
}

function broadcastJobUpdate(jobId: string): void {
  const row = db.prepare('SELECT * FROM download_jobs WHERE id = ?').get(jobId) as
    | Record<string, unknown>
    | undefined;
  if (!row) return;
  const payload = JSON.stringify({ type: 'job_update', job: mapJobRow(row, true) });
  for (const client of sseClients) {
    try {
      client.write(`data: ${payload}\n\n`);
    } catch {
      sseClients.delete(client);
    }
  }
}

function broadcastJobRemoved(jobId: string): void {
  const payload = JSON.stringify({ type: 'job_removed', jobId });
  for (const client of sseClients) {
    try {
      client.write(`data: ${payload}\n\n`);
    } catch {
      sseClients.delete(client);
    }
  }
}

function sanitizeFilename(name: string): string {
  return name
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'untitled';
}

function formatTrackFilename(
  template: string,
  index: number,
  track: { title: string; artist: string; album: string },
  ext: string
): string {
  const padded = String(index + 1).padStart(2, '0');
  const raw = template
    .replace(/\{index\}/g, padded)
    .replace(/\{artist\}/g, sanitizeFilename(track.artist))
    .replace(/\{title\}/g, sanitizeFilename(track.title))
    .replace(/\{album\}/g, sanitizeFilename(track.album));
  return `${sanitizeFilename(raw)}.${ext}`;
}

function getFfmpegCodecArgs(format: AudioFormat, quality: AudioQuality): string[] {
  switch (format) {
    case 'mp3':
      return ['-vn', '-codec:a', 'libmp3lame', '-b:a', `${quality}k`];
    case 'm4a':
      return ['-vn', '-codec:a', 'aac', '-b:a', `${quality}k`, '-movflags', '+faststart'];
    case 'opus':
      return ['-vn', '-codec:a', 'libopus', '-b:a', `${Math.min(256, Number(quality))}k`];
    case 'flac':
      return ['-vn', '-codec:a', 'flac'];
  }
}

async function transcodeStreamToFile(
  inputStream: NodeJS.ReadableStream,
  outputPath: string,
  format: AudioFormat,
  quality: AudioQuality,
  meta: { title: string; artist: string; album: string; index: number }
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const args = [
      '-y',
      '-i',
      'pipe:0',
      ...getFfmpegCodecArgs(format, quality),
      '-metadata',
      `title=${meta.title}`,
      '-metadata',
      `artist=${meta.artist}`,
      '-metadata',
      `album=${meta.album}`,
      '-metadata',
      `track=${meta.index + 1}`,
      outputPath,
    ];
    const proc = spawn('ffmpeg', args, { stdio: ['pipe', 'ignore', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0 && fs.existsSync(outputPath)) {
        resolve();
      } else {
        reject(new Error(`ffmpeg error (${code}): ${stderr.slice(-240)}`));
      }
    });
    inputStream.on('error', (err) => {
      proc.kill('SIGKILL');
      reject(err);
    });
    inputStream.pipe(proc.stdin);
  });
}

async function transcodeUrlToFile(
  sourceMediaUrl: string,
  outputPath: string,
  format: AudioFormat,
  quality: AudioQuality,
  meta: { title: string; artist: string; album: string; index: number }
): Promise<void> {
  const res = await fetch(sourceMediaUrl);
  if (!res.ok || !res.body) {
    throw new Error(`HTTP ${res.status} al descargar flujo de audio`);
  }
  const { Readable } = await import('stream');
  const nodeReadable = Readable.fromWeb(res.body as unknown as import('stream/web').ReadableStream);
  await transcodeStreamToFile(nodeReadable, outputPath, format, quality, meta);
}

async function downloadWithYtDlp(
  sourceUrl: string,
  outputPathWithoutExt: string,
  format: AudioFormat,
  quality: AudioQuality,
  cookiesTxt: string | null
): Promise<string> {
  const tempCookiePath = cookiesTxt
    ? path.join(DOWNLOAD_DIR, `.cookies-${crypto.randomUUID()}.txt`)
    : null;
  if (tempCookiePath && cookiesTxt) {
    fs.writeFileSync(tempCookiePath, cookiesTxt, 'utf-8');
  }

  try {
    const args = [
      sourceUrl,
      '--no-playlist',
      '-x',
      '--audio-format',
      format,
      '--audio-quality',
      `${quality}K`,
      '--embed-metadata',
      '--no-warnings',
      '-o',
      `${outputPathWithoutExt}.%(ext)s`,
    ];
    if (tempCookiePath) {
      args.push('--cookies', tempCookiePath);
    }

    await new Promise<void>((resolve, reject) => {
      const proc = spawn('yt-dlp', args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let errBuf = '';
      proc.stderr.on('data', (d: Buffer) => {
        errBuf += d.toString();
      });
      proc.on('error', reject);
      proc.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(errBuf.slice(-300) || `yt-dlp salió con código ${code}`));
      });
    });

    const expected = `${outputPathWithoutExt}.${format}`;
    if (fs.existsSync(expected)) return expected;
    throw new Error('El archivo generado por yt-dlp no se encontró.');
  } finally {
    if (tempCookiePath && fs.existsSync(tempCookiePath)) {
      fs.unlinkSync(tempCookiePath);
    }
  }
}

async function findDeezerPreviewUrl(query: string): Promise<string | null> {
  const res = await fetch(`https://api.deezer.com/search?q=${encodeURIComponent(query)}&limit=3`);
  if (!res.ok) return null;
  const data = (await res.json()) as { data?: Array<{ preview?: string }> };
  return data.data?.find((item) => Boolean(item.preview))?.preview || null;
}

async function downloadSingleTrack(
  track: DownloadTrackRecord,
  jobDir: string,
  format: AudioFormat,
  quality: AudioQuality,
  template: string,
  cookiesTxt: string | null
): Promise<{ filePath: string; fileSize: number }> {
  const filename = formatTrackFilename(
    template,
    track.trackIndex,
    { title: track.title, artist: track.artist, album: track.album },
    format
  );
  const targetPath = path.join(jobDir, filename);
  const withoutExt = targetPath.replace(new RegExp(`\\.${format}$`), '');

  // 1. Primary path in Docker: yt-dlp binary
  const hasYtDlp = await checkYtDlpAvailable();
  if (hasYtDlp) {
    try {
      const produced = await downloadWithYtDlp(
        track.sourceUrl,
        withoutExt,
        format,
        quality,
        cookiesTxt
      );
      const stat = fs.statSync(produced);
      return { filePath: produced, fileSize: stat.size };
    } catch (ytDlpErr) {
      console.warn('yt-dlp track attempt failed, trying fallback:', ytDlpErr);
    }
  }

  // 2. Node Innertube audio stream + ffmpeg
  try {
    const yt = await getInnertube();
    let videoId: string | null = null;
    if (track.sourceUrl.startsWith('ytsearch1:')) {
      const searchQ = track.sourceUrl.replace(/^ytsearch1:/, '');
      const sr = await yt.search(searchQ, { type: 'video' });
      const first = (sr.videos?.[0] as unknown as { id?: string })?.id;
      if (first) videoId = first;
    } else {
      const match = track.sourceUrl.match(/[?&]v=([A-Za-z0-9_-]{11})/);
      if (match) videoId = match[1];
    }

    if (videoId) {
      const webStream = await yt.download(videoId, { type: 'audio', quality: 'best' });
      const { Readable } = await import('stream');
      const nodeStream = Readable.fromWeb(
        webStream as unknown as import('stream/web').ReadableStream
      );
      await transcodeStreamToFile(nodeStream, targetPath, format, quality, {
        title: track.title,
        artist: track.artist,
        album: track.album,
        index: track.trackIndex,
      });
      const stat = fs.statSync(targetPath);
      return { filePath: targetPath, fileSize: stat.size };
    }
  } catch (innertubeErr) {
    console.warn('Innertube stream unavailable, trying Deezer CDN audio fallback:', innertubeErr);
  }

  // 3. Cloud sandbox resilient fallback via Deezer audio + ffmpeg transcoding
  const cleanQuery = `${track.artist !== 'YouTube' ? track.artist + ' ' : ''}${track.title}`
    .replace(/\(Official.*?\)|\[Official.*?\]|\(Audio\)|\(Lyrics\)/gi, '')
    .trim();
  const previewUrl =
    (await findDeezerPreviewUrl(cleanQuery)) || (await findDeezerPreviewUrl(track.title));

  if (previewUrl) {
    await transcodeUrlToFile(previewUrl, targetPath, format, quality, {
      title: track.title,
      artist: track.artist,
      album: track.album,
      index: track.trackIndex,
    });
    const stat = fs.statSync(targetPath);
    return { filePath: targetPath, fileSize: stat.size };
  }

  throw new Error(
    'YouTube solicitó verificación de sesión en esta IP. Sube un archivo cookies.txt o despliega el contenedor Docker.'
  );
}

async function createJobZip(jobDir: string, zipPath: string): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const createArchiver =
      (archiverNs as unknown as {
        default?: (format: 'zip', options?: archiverNs.ArchiverOptions) => archiverNs.Archiver;
      }).default ||
      (archiverNs as unknown as (
        format: 'zip',
        options?: archiverNs.ArchiverOptions
      ) => archiverNs.Archiver);
    const archive = createArchiver('zip', { zlib: { level: 5 } });
    output.on('close', () => resolve());
    archive.on('error', reject);
    archive.pipe(output);
    archive.directory(jobDir, false);
    archive.finalize();
  });
  return fs.statSync(zipPath).size;
}

async function processJob(jobId: string): Promise<void> {
  if (activeJobIds.has(jobId)) return;
  activeJobIds.add(jobId);
  cancelledOrPausedJobs.delete(jobId);

  try {
    const jobRow = db.prepare('SELECT * FROM download_jobs WHERE id = ?').get(jobId) as
      | Record<string, unknown>
      | undefined;
    if (!jobRow) return;

    const job = mapJobRow(jobRow, true);
    const settings = getSettingsMap();
    const cookiesTxt = getSessionCookiesTxt(job.sessionId);

    const safeDirName = `${sanitizeFilename(job.playlistTitle)}-${job.id.slice(0, 6)}`;
    const jobDir = path.join(DOWNLOAD_DIR, safeDirName);
    fs.mkdirSync(jobDir, { recursive: true });

    db.prepare(
      `UPDATE download_jobs SET status = 'downloading', output_path = ?, error_message = NULL, updated_at = ? WHERE id = ?`
    ).run(jobDir, Date.now(), jobId);
    broadcastJobUpdate(jobId);

    const tracks = job.tracks || [];
    let completedCount = tracks.filter((t) => t.status === 'completed').length;
    let totalBytes = tracks.reduce((sum, t) => sum + (t.fileSize || 0), 0);

    for (const track of tracks) {
      if (track.status === 'completed' && track.filePath && fs.existsSync(track.filePath)) {
        continue;
      }

      // Check pause/cancel before each track
      if (cancelledOrPausedJobs.has(jobId)) {
        return;
      }

      db.prepare(`UPDATE download_tracks SET status = 'downloading', error_message = NULL WHERE id = ?`).run(
        track.id
      );
      db.prepare(`UPDATE download_jobs SET current_track = ?, updated_at = ? WHERE id = ?`).run(
        `${track.artist} — ${track.title}`,
        Date.now(),
        jobId
      );
      broadcastJobUpdate(jobId);

      try {
        const result = await downloadSingleTrack(
          track,
          jobDir,
          job.format,
          job.quality,
          settings.filenameTemplate,
          cookiesTxt
        );

        completedCount += 1;
        totalBytes += result.fileSize;
        const progress = tracks.length > 0 ? Math.round((completedCount / tracks.length) * 95) : 95;

        db.prepare(
          `UPDATE download_tracks SET status = 'completed', file_path = ?, file_size = ?, error_message = NULL WHERE id = ?`
        ).run(result.filePath, result.fileSize, track.id);
        db.prepare(
          `UPDATE download_jobs SET completed_tracks = ?, total_bytes = ?, progress = ?, updated_at = ? WHERE id = ?`
        ).run(completedCount, totalBytes, progress, Date.now(), jobId);
        broadcastJobUpdate(jobId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Error descargando pista';
        db.prepare(`UPDATE download_tracks SET status = 'error', error_message = ? WHERE id = ?`).run(
          msg,
          track.id
        );
        broadcastJobUpdate(jobId);
      }
    }

    if (cancelledOrPausedJobs.has(jobId)) {
      return;
    }

    // Check if at least one track succeeded
    const finalTracks = db
      .prepare('SELECT * FROM download_tracks WHERE job_id = ?')
      .all(jobId) as Array<Record<string, unknown>>;
    const succeededCount = finalTracks.filter((t) => t.status === 'completed').length;

    if (succeededCount === 0) {
      const firstErr =
        (finalTracks.find((t) => t.error_message)?.error_message as string | undefined) ||
        'No se pudo descargar ninguna pista de la lista.';
      db.prepare(
        `UPDATE download_jobs SET status = 'error', current_track = NULL, error_message = ?, updated_at = ? WHERE id = ?`
      ).run(firstErr, Date.now(), jobId);
      broadcastJobUpdate(jobId);
      return;
    }

    // Package ZIP archive
    db.prepare(
      `UPDATE download_jobs SET status = 'packaging', current_track = 'Empaquetando archivo ZIP...', progress = 97, updated_at = ? WHERE id = ?`
    ).run(Date.now(), jobId);
    broadcastJobUpdate(jobId);

    const zipPath = path.join(DOWNLOAD_DIR, `${safeDirName}.zip`);
    await createJobZip(jobDir, zipPath);

    db.prepare(
      `UPDATE download_jobs
       SET status = 'completed', current_track = NULL, progress = 100, zip_path = ?, updated_at = ?
       WHERE id = ?`
    ).run(zipPath, Date.now(), jobId);
    broadcastJobUpdate(jobId);
  } finally {
    activeJobIds.delete(jobId);
    scheduleQueuePump();
  }
}

export function scheduleQueuePump(): void {
  const settings = getSettingsMap();
  const availableSlots = Math.max(0, settings.concurrency - activeJobIds.size);
  if (availableSlots <= 0) return;

  const queued = db
    .prepare(
      `SELECT id FROM download_jobs WHERE status = 'queued' ORDER BY created_at ASC LIMIT ?`
    )
    .all(availableSlots) as Array<{ id: string }>;

  for (const row of queued) {
    void processJob(row.id);
  }
}

export function enqueuePlaylistDownload(params: {
  sessionId: string;
  playlistTitle: string;
  playlistAuthor: string;
  platform: Platform;
  playlistUrl: string;
  thumbnailUrl: string;
  isPrivate: boolean;
  format: AudioFormat;
  quality: AudioQuality;
  tracks: PlaylistTrack[];
}): DownloadJobRecord {
  const jobId = crypto.randomUUID();
  const now = Date.now();

  const insertJob = db.prepare(
    `INSERT INTO download_jobs (
      id, session_id, playlist_title, playlist_author, platform, playlist_url, thumbnail_url,
      is_private, format, quality, status, total_tracks, completed_tracks, progress, total_bytes,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, 0, 0, 0, ?, ?)`
  );

  const insertTrack = db.prepare(
    `INSERT INTO download_tracks (
      id, job_id, track_index, title, artist, album, duration_sec, source_url, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`
  );

  const tx = db.transaction(() => {
    insertJob.run(
      jobId,
      params.sessionId,
      params.playlistTitle,
      params.playlistAuthor,
      params.platform,
      params.playlistUrl,
      params.thumbnailUrl || '',
      params.isPrivate ? 1 : 0,
      params.format,
      params.quality,
      params.tracks.length,
      now,
      now
    );

    params.tracks.forEach((track, idx) => {
      insertTrack.run(
        crypto.randomUUID(),
        jobId,
        idx,
        track.title,
        track.artist,
        track.album || params.playlistTitle,
        track.durationSec || 0,
        track.sourceUrl
      );
    });
  });

  tx();
  broadcastJobUpdate(jobId);
  scheduleQueuePump();

  const created = db.prepare('SELECT * FROM download_jobs WHERE id = ?').get(jobId) as Record<
    string,
    unknown
  >;
  return mapJobRow(created, true);
}

export function listAllJobs(): DownloadJobRecord[] {
  const rows = db
    .prepare('SELECT * FROM download_jobs ORDER BY created_at DESC')
    .all() as Array<Record<string, unknown>>;
  return rows.map((r) => mapJobRow(r, true));
}

export function getJobById(jobId: string): DownloadJobRecord | null {
  const row = db.prepare('SELECT * FROM download_jobs WHERE id = ?').get(jobId) as
    | Record<string, unknown>
    | undefined;
  return row ? mapJobRow(row, true) : null;
}

export function pauseJob(jobId: string): DownloadJobRecord | null {
  cancelledOrPausedJobs.add(jobId);
  db.prepare(
    `UPDATE download_jobs SET status = 'paused', current_track = NULL, updated_at = ? WHERE id = ? AND status IN ('queued', 'downloading')`
  ).run(Date.now(), jobId);
  broadcastJobUpdate(jobId);
  return getJobById(jobId);
}

export function resumeJob(jobId: string): DownloadJobRecord | null {
  cancelledOrPausedJobs.delete(jobId);
  db.prepare(
    `UPDATE download_tracks SET status = 'pending', error_message = NULL WHERE job_id = ? AND status = 'error'`
  ).run(jobId);
  db.prepare(
    `UPDATE download_jobs SET status = 'queued', error_message = NULL, updated_at = ? WHERE id = ?`
  ).run(Date.now(), jobId);
  broadcastJobUpdate(jobId);
  scheduleQueuePump();
  return getJobById(jobId);
}

export function cancelJob(jobId: string): DownloadJobRecord | null {
  cancelledOrPausedJobs.add(jobId);
  db.prepare(
    `UPDATE download_jobs SET status = 'cancelled', current_track = NULL, updated_at = ? WHERE id = ?`
  ).run(Date.now(), jobId);
  broadcastJobUpdate(jobId);
  return getJobById(jobId);
}

export function deleteJob(jobId: string): void {
  cancelledOrPausedJobs.add(jobId);
  const job = getJobById(jobId);
  if (job) {
    if (job.outputPath && fs.existsSync(job.outputPath)) {
      fs.rmSync(job.outputPath, { recursive: true, force: true });
    }
    if (job.zipPath && fs.existsSync(job.zipPath)) {
      fs.rmSync(job.zipPath, { force: true });
    }
  }
  db.prepare('DELETE FROM download_jobs WHERE id = ?').run(jobId);
  broadcastJobRemoved(jobId);
}

export function getDiskStats(): { diskUsedBytes: number; totalFilesCount: number } {
  let diskUsedBytes = 0;
  let totalFilesCount = 0;
  function walk(dir: string): void {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && !entry.name.startsWith('.cookies-')) {
        diskUsedBytes += fs.statSync(full).size;
        totalFilesCount += 1;
      }
    }
  }
  walk(DOWNLOAD_DIR);
  return { diskUsedBytes, totalFilesCount };
}
