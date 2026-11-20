import { execFile } from 'child_process';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { DOWNLOAD_DIR, db, getSettingsMap, updateSetting } from './server/db.ts';
import {
  attachSession,
  disconnectProvider,
  getAuthStatus,
  getSessionId,
  getSpotifyAuthUrl,
  getYouTubeAuthUrl,
  handleSpotifyCallback,
  handleYouTubeCallback,
  renderOAuthPopupHtml,
  saveCookiesTxt,
} from './server/services/auth.ts';
import {
  cancelJob,
  deleteJob,
  enqueuePlaylistDownload,
  getDiskStats,
  getJobById,
  listAllJobs,
  pauseJob,
  resumeJob,
  scheduleQueuePump,
  subscribeDownloadEvents,
} from './server/services/downloader.ts';
import {
  checkYtDlpAvailable,
  getPlaylistDetail,
  getPrivatePlaylists,
  searchPlaylists,
} from './server/services/providers.ts';
import type { AudioFormat, AudioQuality, Platform, PlaylistTrack } from './server/types.ts';

dotenv.config();

const execFileAsync = promisify(execFile);

async function checkFfmpegAvailable(): Promise<boolean> {
  try {
    await execFileAsync('which', ['ffmpeg']);
    return true;
  } catch {
    return false;
  }
}

async function startServer(): Promise<void> {
  const app = express();
  const port = Number(process.env.PORT || 3000);

  app.set('trust proxy', true);
  app.use(cookieParser());
  app.use(express.json({ limit: '2mb' }));
  app.use(attachSession);

  // -------------------------------------------------------------------------
  // Health & OAuth Routes
  // -------------------------------------------------------------------------

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.get('/api/auth/status', (req, res) => {
    const sid = getSessionId(req);
    res.json(getAuthStatus(sid));
  });

  app.get('/api/auth/spotify/url', (req, res) => {
    try {
      const sid = getSessionId(req);
      const url = getSpotifyAuthUrl(sid);
      res.json({ url });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Spotify no configurado' });
    }
  });

  app.get(['/auth/spotify/callback', '/auth/spotify/callback/'], async (req, res) => {
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const state = typeof req.query.state === 'string' ? req.query.state : getSessionId(req);
    const error = typeof req.query.error === 'string' ? req.query.error : '';

    if (error || !code) {
      res.status(400).send(renderOAuthPopupHtml('spotify', error || 'Autorización cancelada'));
      return;
    }

    try {
      await handleSpotifyCallback(code, state);
      res.send(renderOAuthPopupHtml('spotify'));
    } catch (err) {
      res
        .status(500)
        .send(renderOAuthPopupHtml('spotify', err instanceof Error ? err.message : 'Error de OAuth'));
    }
  });

  app.get('/api/auth/youtube/url', (req, res) => {
    try {
      const sid = getSessionId(req);
      const url = getYouTubeAuthUrl(sid);
      res.json({ url });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'YouTube/Google no configurado' });
    }
  });

  app.get(['/auth/youtube/callback', '/auth/youtube/callback/'], async (req, res) => {
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const state = typeof req.query.state === 'string' ? req.query.state : getSessionId(req);
    const error = typeof req.query.error === 'string' ? req.query.error : '';

    if (error || !code) {
      res.status(400).send(renderOAuthPopupHtml('youtube', error || 'Autorización cancelada'));
      return;
    }

    try {
      await handleYouTubeCallback(code, state);
      res.send(renderOAuthPopupHtml('youtube'));
    } catch (err) {
      res
        .status(500)
        .send(renderOAuthPopupHtml('youtube', err instanceof Error ? err.message : 'Error de OAuth'));
    }
  });

  app.post('/api/auth/disconnect/:provider', (req, res) => {
    const sid = getSessionId(req);
    const provider = req.params.provider;
    if (provider !== 'spotify' && provider !== 'youtube') {
      res.status(400).json({ error: 'Proveedor no válido' });
      return;
    }
    disconnectProvider(sid, provider);
    res.json(getAuthStatus(sid));
  });

  app.post('/api/auth/cookies', (req, res) => {
    const sid = getSessionId(req);
    const cookiesTxt = typeof req.body?.cookiesTxt === 'string' ? req.body.cookiesTxt.trim() : '';
    if (!cookiesTxt) {
      res.status(400).json({ error: 'El contenido de cookies.txt no puede estar vacío.' });
      return;
    }
    saveCookiesTxt(sid, cookiesTxt);
    res.json(getAuthStatus(sid));
  });

  app.delete('/api/auth/cookies', (req, res) => {
    const sid = getSessionId(req);
    saveCookiesTxt(sid, null);
    res.json(getAuthStatus(sid));
  });

  // -------------------------------------------------------------------------
  // Playlist Search, Detail & Private Library
  // -------------------------------------------------------------------------

  app.get('/api/playlists/search', async (req, res) => {
    try {
      const sid = getSessionId(req);
      const q = typeof req.query.q === 'string' ? req.query.q : '';
      const platform = (typeof req.query.platform === 'string' ? req.query.platform : 'all') as
        | Platform
        | 'all';
      const data = await searchPlaylists(q, platform, sid);
      res.json(data);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Error al buscar listas',
        results: [],
        notes: [],
      });
    }
  });

  app.get('/api/playlists/detail', async (req, res) => {
    try {
      const sid = getSessionId(req);
      const platform = (typeof req.query.platform === 'string' ? req.query.platform : 'youtube') as Platform;
      const id = typeof req.query.id === 'string' ? req.query.id : '';
      const url = typeof req.query.url === 'string' ? req.query.url : undefined;
      if (!id && !url) {
        res.status(400).json({ error: 'Falta el identificador de la lista' });
        return;
      }
      const detail = await getPlaylistDetail(platform, id, url, sid);
      res.json(detail);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'No se pudieron obtener las pistas de la lista',
      });
    }
  });

  app.get('/api/playlists/private', async (req, res) => {
    try {
      const sid = getSessionId(req);
      const playlists = await getPrivatePlaylists(sid);
      res.json({ playlists });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Error al obtener listas privadas',
        playlists: [],
      });
    }
  });

  // -------------------------------------------------------------------------
  // Download Queue & File Streaming
  // -------------------------------------------------------------------------

  app.get('/api/downloads', (_req, res) => {
    res.json({ jobs: listAllJobs() });
  });

  app.get('/api/downloads/events', (_req, res) => {
    subscribeDownloadEvents(res);
  });

  app.post('/api/downloads', async (req, res) => {
    try {
      const sid = getSessionId(req);
      const body = req.body as {
        platform?: Platform;
        id?: string;
        url?: string;
        playlistTitle?: string;
        playlistAuthor?: string;
        thumbnailUrl?: string;
        isPrivate?: boolean;
        format?: AudioFormat;
        quality?: AudioQuality;
        tracks?: PlaylistTrack[];
      };

      const settings = getSettingsMap();
      const format = body.format || settings.defaultFormat;
      const quality = body.quality || settings.defaultQuality;

      let tracks = body.tracks;
      let title = body.playlistTitle || 'Lista sin título';
      let author = body.playlistAuthor || 'Desconocido';
      let playlistUrl = body.url || '';
      let thumbnailUrl = body.thumbnailUrl || '';
      let isPrivate = Boolean(body.isPrivate);
      const platform = body.platform || 'youtube';

      if (!tracks || tracks.length === 0) {
        if (!body.id && !body.url) {
          res.status(400).json({ error: 'Debes indicar una lista o pistas para descargar.' });
          return;
        }
        const detail = await getPlaylistDetail(platform, body.id || '', body.url, sid);
        tracks = detail.tracks;
        title = detail.title;
        author = detail.author;
        playlistUrl = detail.url;
        thumbnailUrl = detail.thumbnailUrl;
        isPrivate = detail.isPrivate;
      }

      if (!tracks || tracks.length === 0) {
        res.status(400).json({ error: 'La lista seleccionada no contiene pistas descargables.' });
        return;
      }

      const job = enqueuePlaylistDownload({
        sessionId: sid,
        playlistTitle: title,
        playlistAuthor: author,
        platform,
        playlistUrl,
        thumbnailUrl,
        isPrivate,
        format,
        quality,
        tracks,
      });

      res.status(201).json({ job });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'No se pudo iniciar la descarga',
      });
    }
  });

  app.post('/api/downloads/:id/pause', (req, res) => {
    const job = pauseJob(req.params.id);
    if (!job) {
      res.status(404).json({ error: 'Descarga no encontrada' });
      return;
    }
    res.json({ job });
  });

  app.post('/api/downloads/:id/resume', (req, res) => {
    const job = resumeJob(req.params.id);
    if (!job) {
      res.status(404).json({ error: 'Descarga no encontrada' });
      return;
    }
    res.json({ job });
  });

  app.post('/api/downloads/:id/cancel', (req, res) => {
    const job = cancelJob(req.params.id);
    if (!job) {
      res.status(404).json({ error: 'Descarga no encontrada' });
      return;
    }
    res.json({ job });
  });

  app.delete('/api/downloads/:id', (req, res) => {
    deleteJob(req.params.id);
    res.json({ ok: true });
  });

  app.get('/api/downloads/:id/zip', (req, res) => {
    const job = getJobById(req.params.id);
    if (!job || !job.zipPath || !fs.existsSync(job.zipPath)) {
      res.status(404).json({ error: 'El archivo ZIP aún no está disponible.' });
      return;
    }
    const safeName = `${job.playlistTitle.replace(/[^a-zA-Z0-9_\- ]/g, '').trim() || 'playlist'}.zip`;
    res.download(job.zipPath, safeName);
  });

  app.get('/api/downloads/:id/tracks/:trackId/file', (req, res) => {
    const row = db
      .prepare('SELECT * FROM download_tracks WHERE id = ? AND job_id = ?')
      .get(req.params.trackId, req.params.id) as
      | { file_path?: string | null; title?: string; artist?: string }
      | undefined;
    if (!row?.file_path || !fs.existsSync(row.file_path)) {
      res.status(404).json({ error: 'Archivo de pista no encontrado.' });
      return;
    }
    res.download(row.file_path, path.basename(row.file_path));
  });

  // -------------------------------------------------------------------------
  // Settings & Docker Files
  // -------------------------------------------------------------------------

  app.get('/api/settings', async (_req, res) => {
    const base = getSettingsMap();
    const [hasYtDlp, hasFfmpeg] = await Promise.all([
      checkYtDlpAvailable(),
      checkFfmpegAvailable(),
    ]);
    const stats = getDiskStats();
    res.json({
      ...base,
      downloadDir: DOWNLOAD_DIR,
      hasYtDlp,
      hasFfmpeg,
      ...stats,
    });
  });

  app.put('/api/settings', (req, res) => {
    const body = req.body as Partial<{
      concurrency: number;
      defaultFormat: AudioFormat;
      defaultQuality: AudioQuality;
      filenameTemplate: string;
    }>;

    if (typeof body.concurrency === 'number' && body.concurrency >= 1 && body.concurrency <= 4) {
      updateSetting('concurrency', String(Math.round(body.concurrency)));
    }
    if (body.defaultFormat && ['mp3', 'm4a', 'opus', 'flac'].includes(body.defaultFormat)) {
      updateSetting('defaultFormat', body.defaultFormat);
    }
    if (body.defaultQuality && ['320', '256', '192', '128'].includes(body.defaultQuality)) {
      updateSetting('defaultQuality', body.defaultQuality);
    }
    if (typeof body.filenameTemplate === 'string' && body.filenameTemplate.trim()) {
      updateSetting('filenameTemplate', body.filenameTemplate.trim().slice(0, 120));
    }
    scheduleQueuePump();
    res.json(getSettingsMap());
  });

  app.get('/api/docker/files', (_req, res) => {
    const readSafe = (rel: string): string => {
      const full = path.resolve(process.cwd(), rel);
      return fs.existsSync(full) ? fs.readFileSync(full, 'utf-8') : '';
    };
    res.json({
      dockerfile: readSafe('Dockerfile'),
      compose: readSafe('docker-compose.yml'),
      envExample: readSafe('.env.example'),
    });
  });

  // -------------------------------------------------------------------------
  // Vite Middleware (dev) or Static Bundle (production)
  // -------------------------------------------------------------------------

  if (process.env.NODE_ENV === 'production') {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`CrateDock escuchando en http://0.0.0.0:${port}`);
    scheduleQueuePump();
  });
}

void startServer();
