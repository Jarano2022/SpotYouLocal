import type { NextFunction, Request, Response } from 'express';
import crypto from 'crypto';
import { db, getOrCreateSession } from '../db.ts';
import type { SessionRow } from '../db.ts';
import type { AuthStatusResponse } from '../types.ts';

export const SESSION_COOKIE_NAME = 'cratedock_sid';

export function getAppBaseUrl(): string {
  const envUrl = process.env.APP_URL;
  if (envUrl && envUrl !== 'MY_APP_URL' && envUrl.startsWith('http')) {
    return envUrl.replace(/\/+$/, '');
  }
  const port = process.env.PORT || '3000';
  return `http://localhost:${port}`;
}

export function attachSession(req: Request, res: Response, next: NextFunction): void {
  let sid = req.cookies?.[SESSION_COOKIE_NAME] as string | undefined;
  if (!sid || typeof sid !== 'string' || sid.length < 8) {
    sid = crypto.randomUUID();
    const baseUrl = getAppBaseUrl();
    const isHttps = baseUrl.startsWith('https://') || req.secure || req.headers['x-forwarded-proto'] === 'https';
    res.cookie(SESSION_COOKIE_NAME, sid, {
      httpOnly: true,
      sameSite: isHttps ? 'none' : 'lax',
      secure: isHttps,
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });
  }
  getOrCreateSession(sid);
  (req as Request & { sessionId: string }).sessionId = sid;
  next();
}

export function getSessionId(req: Request): string {
  return (req as Request & { sessionId: string }).sessionId;
}

export function isSpotifyConfigured(): boolean {
  return Boolean(process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET);
}

export function isGoogleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function getSpotifyAuthUrl(sessionId: string): string {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  if (!clientId) {
    throw new Error('SPOTIFY_CLIENT_ID no está configurado en las variables de entorno.');
  }
  const redirectUri = `${getAppBaseUrl()}/auth/spotify/callback`;
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: 'playlist-read-private playlist-read-collaborative user-library-read user-read-private',
    state: sessionId,
    show_dialog: 'true',
  });
  return `https://accounts.spotify.com/authorize?${params.toString()}`;
}

export function getYouTubeAuthUrl(sessionId: string): string {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    throw new Error('GOOGLE_CLIENT_ID no está configurado en las variables de entorno.');
  }
  const redirectUri = `${getAppBaseUrl()}/auth/youtube/callback`;
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: 'https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/userinfo.profile',
    access_type: 'offline',
    prompt: 'consent',
    state: sessionId,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function handleSpotifyCallback(code: string, stateSessionId: string): Promise<void> {
  const clientId = process.env.SPOTIFY_CLIENT_ID!;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET!;
  const redirectUri = `${getAppBaseUrl()}/auth/spotify/callback`;

  const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    }),
  });

  if (!tokenRes.ok) {
    const errText = await tokenRes.text();
    throw new Error(`Error al intercambiar token de Spotify: ${errText}`);
  }

  const tokenData = (await tokenRes.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };

  const meRes = await fetch('https://api.spotify.com/v1/me', {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  const meData = meRes.ok ? await meRes.json() : {};

  getOrCreateSession(stateSessionId);
  const now = Date.now();
  db.prepare(
    `UPDATE sessions
     SET spotify_access_token = ?,
         spotify_refresh_token = COALESCE(?, spotify_refresh_token),
         spotify_expires_at = ?,
         spotify_user_json = ?,
         updated_at = ?
     WHERE id = ?`
  ).run(
    tokenData.access_token,
    tokenData.refresh_token || null,
    now + (tokenData.expires_in - 60) * 1000,
    JSON.stringify(meData),
    now,
    stateSessionId
  );
}

export async function handleYouTubeCallback(code: string, stateSessionId: string): Promise<void> {
  const clientId = process.env.GOOGLE_CLIENT_ID!;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET!;
  const redirectUri = `${getAppBaseUrl()}/auth/youtube/callback`;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });

  if (!tokenRes.ok) {
    const errText = await tokenRes.text();
    throw new Error(`Error al intercambiar token de Google/YouTube: ${errText}`);
  }

  const tokenData = (await tokenRes.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };

  const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  const userData = userRes.ok ? await userRes.json() : {};

  getOrCreateSession(stateSessionId);
  const now = Date.now();
  db.prepare(
    `UPDATE sessions
     SET google_access_token = ?,
         google_refresh_token = COALESCE(?, google_refresh_token),
         google_expires_at = ?,
         google_user_json = ?,
         updated_at = ?
     WHERE id = ?`
  ).run(
    tokenData.access_token,
    tokenData.refresh_token || null,
    now + (tokenData.expires_in - 60) * 1000,
    JSON.stringify(userData),
    now,
    stateSessionId
  );
}

export async function getValidSpotifyToken(sessionId: string): Promise<string | null> {
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as SessionRow | undefined;
  if (!session?.spotify_access_token) return null;

  if (session.spotify_expires_at && Date.now() < session.spotify_expires_at) {
    return session.spotify_access_token;
  }

  if (!session.spotify_refresh_token || !isSpotifyConfigured()) {
    return session.spotify_access_token;
  }

  const clientId = process.env.SPOTIFY_CLIENT_ID!;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET!;
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: session.spotify_refresh_token,
    }),
  });

  if (!res.ok) return null;
  const data = (await res.json()) as { access_token: string; expires_in: number; refresh_token?: string };
  const now = Date.now();
  db.prepare(
    `UPDATE sessions
     SET spotify_access_token = ?,
         spotify_refresh_token = COALESCE(?, spotify_refresh_token),
         spotify_expires_at = ?,
         updated_at = ?
     WHERE id = ?`
  ).run(data.access_token, data.refresh_token || null, now + (data.expires_in - 60) * 1000, now, sessionId);

  return data.access_token;
}

export async function getValidGoogleToken(sessionId: string): Promise<string | null> {
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as SessionRow | undefined;
  if (!session?.google_access_token) return null;

  if (session.google_expires_at && Date.now() < session.google_expires_at) {
    return session.google_access_token;
  }

  if (!session.google_refresh_token || !isGoogleConfigured()) {
    return session.google_access_token;
  }

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: session.google_refresh_token,
      grant_type: 'refresh_token',
    }),
  });

  if (!res.ok) return null;
  const data = (await res.json()) as { access_token: string; expires_in: number };
  const now = Date.now();
  db.prepare(
    `UPDATE sessions
     SET google_access_token = ?,
         google_expires_at = ?,
         updated_at = ?
     WHERE id = ?`
  ).run(data.access_token, now + (data.expires_in - 60) * 1000, now, sessionId);

  return data.access_token;
}

export function getAuthStatus(sessionId: string): AuthStatusResponse {
  const session = getOrCreateSession(sessionId);
  const spotifyUser = session.spotify_user_json ? JSON.parse(session.spotify_user_json) : null;
  const googleUser = session.google_user_json ? JSON.parse(session.google_user_json) : null;
  const baseUrl = getAppBaseUrl();

  return {
    spotify: {
      connected: Boolean(session.spotify_access_token),
      configured: isSpotifyConfigured(),
      displayName: spotifyUser?.display_name || spotifyUser?.id || null,
      avatarUrl: spotifyUser?.images?.[0]?.url || null,
      accountId: spotifyUser?.id || null,
    },
    youtube: {
      connected: Boolean(session.google_access_token),
      configured: isGoogleConfigured(),
      displayName: googleUser?.name || null,
      avatarUrl: googleUser?.picture || null,
      accountId: googleUser?.id || null,
    },
    hasCookiesTxt: Boolean(session.cookies_txt && session.cookies_txt.trim().length > 0),
    callbackUrls: {
      spotify: `${baseUrl}/auth/spotify/callback`,
      youtube: `${baseUrl}/auth/youtube/callback`,
    },
  };
}

export function disconnectProvider(sessionId: string, provider: 'spotify' | 'youtube'): void {
  const now = Date.now();
  if (provider === 'spotify') {
    db.prepare(
      `UPDATE sessions
       SET spotify_access_token = NULL, spotify_refresh_token = NULL, spotify_expires_at = NULL, spotify_user_json = NULL, updated_at = ?
       WHERE id = ?`
    ).run(now, sessionId);
  } else {
    db.prepare(
      `UPDATE sessions
       SET google_access_token = NULL, google_refresh_token = NULL, google_expires_at = NULL, google_user_json = NULL, updated_at = ?
       WHERE id = ?`
    ).run(now, sessionId);
  }
}

export function saveCookiesTxt(sessionId: string, cookiesTxt: string | null): void {
  db.prepare('UPDATE sessions SET cookies_txt = ?, updated_at = ? WHERE id = ?').run(
    cookiesTxt,
    Date.now(),
    sessionId
  );
}

export function getSessionCookiesTxt(sessionId: string): string | null {
  const row = db.prepare('SELECT cookies_txt FROM sessions WHERE id = ?').get(sessionId) as
    | { cookies_txt: string | null }
    | undefined;
  return row?.cookies_txt || null;
}

export function renderOAuthPopupHtml(provider: 'spotify' | 'youtube', errorMessage?: string): string {
  if (errorMessage) {
    const safeErr = JSON.stringify(errorMessage);
    return `<!doctype html>
<html lang="es">
  <head><meta charset="utf-8"><title>Error de autenticación</title></head>
  <body style="font-family: sans-serif; padding: 32px; color: #18181B; background: #FAFAFA;">
    <h2 style="margin-top:0;">No se pudo completar la conexión</h2>
    <p style="color:#52525B;">${errorMessage.replace(/</g, '&lt;')}</p>
    <script>
      if (window.opener) {
        window.opener.postMessage({ type: 'OAUTH_AUTH_ERROR', provider: ${JSON.stringify(provider)}, error: ${safeErr} }, '*');
      }
      setTimeout(() => window.close(), 2500);
    </script>
  </body>
</html>`;
  }

  return `<!doctype html>
<html lang="es">
  <head><meta charset="utf-8"><title>Autenticación completada</title></head>
  <body style="font-family: sans-serif; padding: 32px; color: #18181B; background: #FAFAFA;">
    <p>Cuenta conectada correctamente. Cerrando ventana...</p>
    <script>
      if (window.opener) {
        window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS', provider: ${JSON.stringify(provider)} }, '*');
        window.close();
      } else {
        window.location.href = '/';
      }
    </script>
  </body>
</html>`;
}
