import { execFile } from 'child_process';
import { promisify } from 'util';
import { Innertube, Log } from 'youtubei.js';
import type { Platform, PlaylistDetail, PlaylistSummary, PlaylistTrack } from '../types.ts';
import { getValidGoogleToken, getValidSpotifyToken } from './auth.ts';

const execFileAsync = promisify(execFile);

Log.setLevel(Log.Level.NONE);

let innertubePromise: Promise<Innertube> | null = null;
export async function getInnertube(): Promise<Innertube> {
  if (!innertubePromise) {
    innertubePromise = Innertube.create({ generate_session_locally: true }).catch((err) => {
      innertubePromise = null;
      throw err;
    });
  }
  return innertubePromise;
}

let cachedHasYtDlp: boolean | null = null;
export async function checkYtDlpAvailable(): Promise<boolean> {
  if (cachedHasYtDlp !== null) return cachedHasYtDlp;
  try {
    await execFileAsync('which', ['yt-dlp']);
    cachedHasYtDlp = true;
  } catch {
    cachedHasYtDlp = false;
  }
  return cachedHasYtDlp;
}

function parseDurationText(raw?: string | number | null): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.round(raw);
  if (!raw || typeof raw !== 'string') return 0;
  const parts = raw.trim().split(':').map(Number);
  if (parts.some((n) => Number.isNaN(n))) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 1) return parts[0];
  return 0;
}

function safeText(val: unknown): string {
  if (!val) return '';
  if (typeof val === 'string') return val;
  if (typeof val === 'object') {
    const obj = val as Record<string, unknown>;
    if (typeof obj.text === 'string') return obj.text;
    if (typeof obj.toString === 'function') {
      const str = obj.toString();
      if (str !== '[object Object]') return str;
    }
  }
  return '';
}

function extractYouTubePlaylistId(input: string): string | null {
  try {
    const url = new URL(input);
    if (url.hostname.includes('youtube.com') || url.hostname.includes('youtu.be')) {
      const listParam = url.searchParams.get('list');
      if (listParam) return listParam;
    }
  } catch {
    // not a URL
  }
  if (/^(PL|RD|OLAK5uy_|UU|LL|FL|WL)[A-Za-z0-9_-]{8,}$/.test(input.trim())) {
    return input.trim();
  }
  return null;
}

function extractSpotifyPlaylistId(input: string): string | null {
  const match = input.match(/open\.spotify\.com\/playlist\/([A-Za-z0-9]+)/);
  if (match) return match[1];
  const uriMatch = input.match(/^spotify:playlist:([A-Za-z0-9]+)$/);
  if (uriMatch) return uriMatch[1];
  return null;
}

function extractDeezerPlaylistId(input: string): string | null {
  const match = input.match(/deezer\.com\/(?:[a-z]{2}\/)?playlist\/(\d+)/);
  return match ? match[1] : null;
}

// ---------------------------------------------------------------------------
// YouTube Search & Playlist Fetching
// ---------------------------------------------------------------------------

async function searchYouTubePlaylistsByName(query: string, limit = 10): Promise<PlaylistSummary[]> {
  try {
    const yt = await getInnertube();
    const res = await yt.search(query, { type: 'playlist' });
    const items = (res.playlists || []) as unknown as Array<Record<string, unknown>>;
    const results: PlaylistSummary[] = [];

    for (const item of items.slice(0, limit)) {
      const id = String(item.content_id || item.id || '');
      if (!id) continue;

      // Support both LockupView and Playlist node shapes
      const meta = item.metadata as Record<string, unknown> | undefined;
      const title =
        safeText(meta?.title) ||
        safeText(item.title) ||
        'Lista de YouTube';

      let author = safeText((item.author as Record<string, unknown> | undefined)?.name) || 'YouTube';
      let trackCount = Number(item.video_count || 0);

      const metaRows = (meta?.metadata as Record<string, unknown> | undefined)?.metadata_rows as
        | Array<{ metadata_parts?: Array<{ text?: { text?: string } }> }>
        | undefined;
      if (metaRows?.length) {
        const firstPart = metaRows[0]?.metadata_parts?.[0]?.text?.text;
        if (firstPart) author = firstPart;
      }

      const imgObj = item.content_image as Record<string, unknown> | undefined;
      const primaryThumb = imgObj?.primary_thumbnail as Record<string, unknown> | undefined;
      const thumbArr =
        (imgObj?.image as Array<{ url?: string }> | undefined) ||
        (primaryThumb?.image as Array<{ url?: string }> | undefined) ||
        (item.thumbnails as Array<{ url?: string }> | undefined) ||
        [];
      const thumbnailUrl = thumbArr[0]?.url || '';

      // Try extracting track count from overlays/badges if missing
      const overlays = (primaryThumb?.overlays || imgObj?.overlays || []) as Array<Record<string, unknown>>;
      for (const ov of overlays) {
        const badges = (ov.badges || []) as Array<{ text?: string }>;
        for (const b of badges) {
          const m = String(b.text || '').match(/(\d+)/);
          if (m && !trackCount) trackCount = Number(m[1]);
        }
      }

      results.push({
        id,
        title,
        author,
        platform: 'youtube',
        url: `https://www.youtube.com/playlist?list=${id}`,
        thumbnailUrl,
        trackCount,
        isPrivate: false,
      });
    }
    return results;
  } catch (err) {
    console.error('YouTube search error:', err);
    return [];
  }
}

async function getUserYouTubePlaylists(accessToken: string): Promise<PlaylistSummary[]> {
  try {
    const res = await fetch(
      'https://www.googleapis.com/youtube/v3/playlists?part=snippet,contentDetails,status&mine=true&maxResults=50',
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!res.ok) return [];
    const data = (await res.json()) as {
      items?: Array<{
        id: string;
        snippet?: {
          title?: string;
          channelTitle?: string;
          description?: string;
          thumbnails?: { high?: { url: string }; medium?: { url: string }; default?: { url: string } };
        };
        contentDetails?: { itemCount?: number };
        status?: { privacyStatus?: string };
      }>;
    };

    return (data.items || []).map((item) => ({
      id: item.id,
      title: item.snippet?.title || 'Lista sin título',
      author: item.snippet?.channelTitle || 'Tu canal de YouTube',
      platform: 'youtube' as const,
      url: `https://www.youtube.com/playlist?list=${item.id}`,
      thumbnailUrl:
        item.snippet?.thumbnails?.high?.url ||
        item.snippet?.thumbnails?.medium?.url ||
        item.snippet?.thumbnails?.default?.url ||
        '',
      trackCount: item.contentDetails?.itemCount || 0,
      isPrivate: item.status?.privacyStatus !== 'public',
      isOwned: true,
      description: item.snippet?.description || undefined,
    }));
  } catch (err) {
    console.error('YouTube user playlists error:', err);
    return [];
  }
}

async function getYouTubePlaylistDetail(
  playlistId: string,
  googleToken: string | null
): Promise<PlaylistDetail> {
  // If user has Google OAuth, try official YouTube Data API first (handles private & unlisted!)
  if (googleToken) {
    try {
      const metaRes = await fetch(
        `https://www.googleapis.com/youtube/v3/playlists?part=snippet,contentDetails,status&id=${encodeURIComponent(
          playlistId
        )}`,
        { headers: { Authorization: `Bearer ${googleToken}` } }
      );
      if (metaRes.ok) {
        const metaData = (await metaRes.json()) as {
          items?: Array<{
            id: string;
            snippet?: {
              title?: string;
              channelTitle?: string;
              description?: string;
              thumbnails?: { high?: { url: string }; medium?: { url: string } };
            };
            contentDetails?: { itemCount?: number };
            status?: { privacyStatus?: string };
          }>;
        };
        const item = metaData.items?.[0];
        if (item) {
          const tracks: PlaylistTrack[] = [];
          let pageToken: string | undefined = undefined;
          do {
            const url = new URL('https://www.googleapis.com/youtube/v3/playlistItems');
            url.searchParams.set('part', 'snippet,contentDetails');
            url.searchParams.set('playlistId', playlistId);
            url.searchParams.set('maxResults', '50');
            if (pageToken) url.searchParams.set('pageToken', pageToken);

            const itemsRes = await fetch(url.toString(), {
              headers: { Authorization: `Bearer ${googleToken}` },
            });
            if (!itemsRes.ok) break;
            const itemsJson = (await itemsRes.json()) as {
              nextPageToken?: string;
              items?: Array<{
                snippet?: {
                  title?: string;
                  videoOwnerChannelTitle?: string;
                  resourceId?: { videoId?: string };
                  thumbnails?: { medium?: { url: string }; default?: { url: string } };
                };
              }>;
            };
            for (const entry of itemsJson.items || []) {
              const vid = entry.snippet?.resourceId?.videoId;
              const title = entry.snippet?.title || '';
              if (!vid || title === 'Deleted video' || title === 'Private video') continue;
              tracks.push({
                id: vid,
                title,
                artist: (entry.snippet?.videoOwnerChannelTitle || 'YouTube').replace(/ - Topic$/, ''),
                album: item.snippet?.title || 'YouTube',
                durationSec: 0,
                sourceUrl: `https://www.youtube.com/watch?v=${vid}`,
                thumbnailUrl:
                  entry.snippet?.thumbnails?.medium?.url || entry.snippet?.thumbnails?.default?.url,
              });
            }
            pageToken = itemsJson.nextPageToken;
          } while (pageToken && tracks.length < 250);

          return {
            id: playlistId,
            title: item.snippet?.title || 'Lista de YouTube',
            author: item.snippet?.channelTitle || 'YouTube',
            platform: 'youtube',
            url: `https://www.youtube.com/playlist?list=${playlistId}`,
            thumbnailUrl:
              item.snippet?.thumbnails?.high?.url || item.snippet?.thumbnails?.medium?.url || '',
            trackCount: tracks.length || item.contentDetails?.itemCount || 0,
            isPrivate: item.status?.privacyStatus !== 'public',
            isOwned: true,
            description: item.snippet?.description,
            tracks,
          };
        }
      }
    } catch (err) {
      console.warn('YouTube Data API fallback to Innertube:', err);
    }
  }

  // Fallback to Innertube for public playlists
  const yt = await getInnertube();
  const pl = await yt.getPlaylist(playlistId);
  const videos = (pl.videos || []) as unknown as Array<Record<string, unknown>>;
  const tracks: PlaylistTrack[] = [];

  for (const v of videos) {
    const vid = String(v.id || v.content_id || '');
    if (!vid) continue;

    const meta = v.metadata as Record<string, unknown> | undefined;
    const title = safeText(v.title) || safeText(meta?.title) || 'Pista sin título';
    const author =
      safeText((v.author as Record<string, unknown> | undefined)?.name) ||
      'YouTube';
    const durObj = v.duration as Record<string, unknown> | undefined;
    const durationSec =
      typeof durObj?.seconds === 'number'
        ? durObj.seconds
        : parseDurationText(safeText(durObj?.text));
    const thumbs = (v.thumbnails as Array<{ url?: string }> | undefined) || [];

    tracks.push({
      id: vid,
      title,
      artist: author.replace(/ - Topic$/, ''),
      album: safeText(pl.info?.title) || 'YouTube',
      durationSec,
      sourceUrl: `https://www.youtube.com/watch?v=${vid}`,
      thumbnailUrl: thumbs[0]?.url,
    });
  }

  const infoThumbs = (pl.info?.thumbnails as Array<{ url?: string }> | undefined) || [];
  return {
    id: playlistId,
    title: safeText(pl.info?.title) || 'Lista de YouTube',
    author: safeText(pl.info?.author?.name) || 'YouTube',
    platform: 'youtube',
    url: `https://www.youtube.com/playlist?list=${playlistId}`,
    thumbnailUrl: infoThumbs[0]?.url || tracks[0]?.thumbnailUrl || '',
    trackCount: tracks.length,
    isPrivate: false,
    description: safeText(pl.info?.description),
    tracks,
  };
}

// ---------------------------------------------------------------------------
// Spotify Search & Playlist Fetching (OAuth + Public Embed fallback)
// ---------------------------------------------------------------------------

async function getUserSpotifyPlaylists(accessToken: string): Promise<PlaylistSummary[]> {
  try {
    const results: PlaylistSummary[] = [];

    // Include Liked Songs ("Canciones que te gustan")
    const likedRes = await fetch('https://api.spotify.com/v1/me/tracks?limit=1', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (likedRes.ok) {
      const likedJson = (await likedRes.json()) as { total?: number };
      results.push({
        id: 'liked-songs',
        title: 'Canciones que te gustan',
        author: 'Tu biblioteca de Spotify',
        platform: 'spotify',
        url: 'https://open.spotify.com/collection/tracks',
        thumbnailUrl: '',
        trackCount: likedJson.total || 0,
        isPrivate: true,
        isOwned: true,
      });
    }

    const res = await fetch('https://api.spotify.com/v1/me/playlists?limit=50', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return results;
    const data = (await res.json()) as {
      items?: Array<{
        id: string;
        name: string;
        public: boolean | null;
        collaborative: boolean;
        description?: string;
        owner?: { display_name?: string };
        images?: Array<{ url: string }>;
        tracks?: { total?: number };
      }>;
    };

    for (const item of data.items || []) {
      if (!item?.id) continue;
      results.push({
        id: item.id,
        title: item.name,
        author: item.owner?.display_name || 'Spotify',
        platform: 'spotify',
        url: `https://open.spotify.com/playlist/${item.id}`,
        thumbnailUrl: item.images?.[0]?.url || '',
        trackCount: item.tracks?.total || 0,
        isPrivate: item.public === false || item.collaborative,
        isOwned: true,
        description: item.description || undefined,
      });
    }
    return results;
  } catch (err) {
    console.error('Spotify user playlists error:', err);
    return [];
  }
}

async function searchSpotifyPlaylists(query: string, accessToken: string, limit = 8): Promise<PlaylistSummary[]> {
  try {
    const res = await fetch(
      `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=playlist&limit=${limit}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!res.ok) return [];
    const data = (await res.json()) as {
      playlists?: {
        items?: Array<{
          id: string;
          name: string;
          public?: boolean;
          description?: string;
          owner?: { display_name?: string };
          images?: Array<{ url: string }>;
          tracks?: { total?: number };
        } | null>;
      };
    };

    return (data.playlists?.items || [])
      .filter((item): item is NonNullable<typeof item> => Boolean(item && item.id))
      .map((item) => ({
        id: item.id,
        title: item.name,
        author: item.owner?.display_name || 'Spotify',
        platform: 'spotify' as const,
        url: `https://open.spotify.com/playlist/${item.id}`,
        thumbnailUrl: item.images?.[0]?.url || '',
        trackCount: item.tracks?.total || 0,
        isPrivate: item.public === false,
        description: item.description || undefined,
      }));
  } catch (err) {
    console.error('Spotify search error:', err);
    return [];
  }
}

async function getSpotifyPlaylistPublicEmbed(playlistId: string): Promise<PlaylistDetail> {
  const res = await fetch(`https://open.spotify.com/embed/playlist/${playlistId}`, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });
  if (!res.ok) {
    throw new Error('No se pudo leer la lista pública de Spotify. Si es privada, conecta tu cuenta de Spotify.');
  }
  const html = await res.text();
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!match) {
    throw new Error('Lista de Spotify inaccesible sin autenticación OAuth.');
  }
  const nextData = JSON.parse(match[1]) as {
    props?: {
      pageProps?: {
        state?: {
          data?: {
            entity?: {
              name?: string;
              subtitle?: string;
              coverArt?: { sources?: Array<{ url: string }> };
              trackList?: Array<{
                uri?: string;
                title?: string;
                subtitle?: string;
                duration?: number;
              }>;
            };
          };
        };
      };
    };
  };

  const entity = nextData.props?.pageProps?.state?.data?.entity;
  if (!entity) {
    throw new Error('No se encontraron pistas en la lista de Spotify.');
  }

  const tracks: PlaylistTrack[] = (entity.trackList || []).map((t, idx) => ({
    id: t.uri || `sp-${playlistId}-${idx}`,
    title: t.title || 'Pista desconocida',
    artist: t.subtitle || 'Artista',
    album: entity.name || 'Spotify',
    durationSec: Math.round((t.duration || 0) / 1000),
    sourceUrl: `ytsearch1:${t.subtitle || ''} - ${t.title || ''}`,
  }));

  return {
    id: playlistId,
    title: entity.name || 'Lista de Spotify',
    author: entity.subtitle || 'Spotify',
    platform: 'spotify',
    url: `https://open.spotify.com/playlist/${playlistId}`,
    thumbnailUrl: entity.coverArt?.sources?.[0]?.url || '',
    trackCount: tracks.length,
    isPrivate: false,
    tracks,
  };
}

async function getSpotifyPlaylistDetail(
  playlistId: string,
  accessToken: string | null
): Promise<PlaylistDetail> {
  if (!accessToken) {
    if (playlistId === 'liked-songs') {
      throw new Error('Conecta tu cuenta de Spotify para acceder a tus canciones guardadas.');
    }
    return getSpotifyPlaylistPublicEmbed(playlistId);
  }

  if (playlistId === 'liked-songs') {
    const tracks: PlaylistTrack[] = [];
    let nextUrl: string | null = 'https://api.spotify.com/v1/me/tracks?limit=50';
    while (nextUrl && tracks.length < 200) {
      const res = await fetch(nextUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!res.ok) break;
      const data = (await res.json()) as {
        next: string | null;
        items?: Array<{
          track?: {
            id: string;
            name: string;
            duration_ms: number;
            artists?: Array<{ name: string }>;
            album?: { name?: string; images?: Array<{ url: string }> };
          };
        }>;
      };
      for (const item of data.items || []) {
        const t = item.track;
        if (!t) continue;
        const artist = (t.artists || []).map((a) => a.name).join(', ') || 'Artista';
        tracks.push({
          id: t.id,
          title: t.name,
          artist,
          album: t.album?.name || 'Spotify',
          durationSec: Math.round((t.duration_ms || 0) / 1000),
          sourceUrl: `ytsearch1:${artist} - ${t.name}`,
          thumbnailUrl: t.album?.images?.[0]?.url,
        });
      }
      nextUrl = data.next;
    }

    return {
      id: 'liked-songs',
      title: 'Canciones que te gustan',
      author: 'Tu biblioteca de Spotify',
      platform: 'spotify',
      url: 'https://open.spotify.com/collection/tracks',
      thumbnailUrl: tracks[0]?.thumbnailUrl || '',
      trackCount: tracks.length,
      isPrivate: true,
      isOwned: true,
      tracks,
    };
  }

  const plRes = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!plRes.ok) {
    return getSpotifyPlaylistPublicEmbed(playlistId);
  }
  const plData = (await plRes.json()) as {
    id: string;
    name: string;
    public: boolean | null;
    description?: string;
    owner?: { display_name?: string };
    images?: Array<{ url: string }>;
    tracks?: {
      next: string | null;
      items?: Array<{
        track?: {
          id: string;
          name: string;
          duration_ms: number;
          artists?: Array<{ name: string }>;
          album?: { name?: string; images?: Array<{ url: string }> };
        } | null;
      }>;
    };
  };

  const tracks: PlaylistTrack[] = [];
  const pushItems = (
    items: Array<{
      track?: {
        id: string;
        name: string;
        duration_ms: number;
        artists?: Array<{ name: string }>;
        album?: { name?: string; images?: Array<{ url: string }> };
      } | null;
    }>
  ) => {
    for (const item of items) {
      const t = item.track;
      if (!t || !t.name) continue;
      const artist = (t.artists || []).map((a) => a.name).join(', ') || 'Artista';
      tracks.push({
        id: t.id || `${tracks.length}`,
        title: t.name,
        artist,
        album: t.album?.name || plData.name,
        durationSec: Math.round((t.duration_ms || 0) / 1000),
        sourceUrl: `ytsearch1:${artist} - ${t.name}`,
        thumbnailUrl: t.album?.images?.[0]?.url,
      });
    }
  };

  pushItems(plData.tracks?.items || []);
  let nextUrl = plData.tracks?.next || null;
  while (nextUrl && tracks.length < 250) {
    const nextRes = await fetch(nextUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!nextRes.ok) break;
    const nextData = (await nextRes.json()) as {
      next: string | null;
      items?: Array<{
        track?: {
          id: string;
          name: string;
          duration_ms: number;
          artists?: Array<{ name: string }>;
          album?: { name?: string; images?: Array<{ url: string }> };
        } | null;
      }>;
    };
    pushItems(nextData.items || []);
    nextUrl = nextData.next;
  }

  return {
    id: plData.id,
    title: plData.name,
    author: plData.owner?.display_name || 'Spotify',
    platform: 'spotify',
    url: `https://open.spotify.com/playlist/${plData.id}`,
    thumbnailUrl: plData.images?.[0]?.url || tracks[0]?.thumbnailUrl || '',
    trackCount: tracks.length,
    isPrivate: plData.public === false,
    description: plData.description,
    tracks,
  };
}

// ---------------------------------------------------------------------------
// Deezer Search & Playlist Fetching (No API key needed!)
// ---------------------------------------------------------------------------

async function searchDeezerPlaylists(query: string, limit = 10): Promise<PlaylistSummary[]> {
  try {
    const res = await fetch(
      `https://api.deezer.com/search/playlist?q=${encodeURIComponent(query)}&limit=${limit}`
    );
    if (!res.ok) return [];
    const data = (await res.json()) as {
      data?: Array<{
        id: number;
        title: string;
        nb_tracks: number;
        picture_medium?: string;
        picture_big?: string;
        link?: string;
        user?: { name?: string };
      }>;
    };

    return (data.data || []).map((item) => ({
      id: String(item.id),
      title: item.title,
      author: item.user?.name || 'Deezer',
      platform: 'deezer' as const,
      url: item.link || `https://www.deezer.com/playlist/${item.id}`,
      thumbnailUrl: item.picture_big || item.picture_medium || '',
      trackCount: item.nb_tracks || 0,
      isPrivate: false,
    }));
  } catch (err) {
    console.error('Deezer search error:', err);
    return [];
  }
}

async function getDeezerPlaylistDetail(playlistId: string): Promise<PlaylistDetail> {
  const res = await fetch(`https://api.deezer.com/playlist/${playlistId}`);
  if (!res.ok) {
    throw new Error('No se pudo obtener la lista de Deezer.');
  }
  const data = (await res.json()) as {
    id: number;
    title: string;
    description?: string;
    nb_tracks: number;
    picture_big?: string;
    picture_medium?: string;
    link?: string;
    creator?: { name?: string };
    tracks?: {
      data?: Array<{
        id: number;
        title: string;
        duration: number;
        preview?: string;
        artist?: { name?: string };
        album?: { title?: string; cover_medium?: string };
      }>;
    };
  };

  const tracks: PlaylistTrack[] = (data.tracks?.data || []).map((t) => {
    const artist = t.artist?.name || 'Artista';
    return {
      id: String(t.id),
      title: t.title,
      artist,
      album: t.album?.title || data.title,
      durationSec: t.duration || 0,
      sourceUrl: `ytsearch1:${artist} - ${t.title}`,
      thumbnailUrl: t.album?.cover_medium,
    };
  });

  return {
    id: String(data.id),
    title: data.title,
    author: data.creator?.name || 'Deezer',
    platform: 'deezer',
    url: data.link || `https://www.deezer.com/playlist/${data.id}`,
    thumbnailUrl: data.picture_big || data.picture_medium || '',
    trackCount: tracks.length || data.nb_tracks || 0,
    isPrivate: false,
    description: data.description,
    tracks,
  };
}

// ---------------------------------------------------------------------------
// Generic URL via yt-dlp (SoundCloud, Bandcamp, Mixcloud, etc.)
// ---------------------------------------------------------------------------

async function getGenericYtDlpPlaylist(url: string): Promise<PlaylistDetail> {
  const hasYtDlp = await checkYtDlpAvailable();
  if (!hasYtDlp) {
    throw new Error(
      'Las URLs externas (SoundCloud, Bandcamp, Mixcloud) requieren yt-dlp, incluido automáticamente en el contenedor Docker.'
    );
  }
  const { stdout } = await execFileAsync('yt-dlp', [
    '--dump-single-json',
    '--flat-playlist',
    '--no-warnings',
    url,
  ]);
  const info = JSON.parse(stdout) as {
    id?: string;
    title?: string;
    uploader?: string;
    thumbnail?: string;
    webpage_url?: string;
    entries?: Array<{
      id?: string;
      title?: string;
      uploader?: string;
      duration?: number;
      url?: string;
      webpage_url?: string;
    }>;
  };

  const entries = info.entries || [];
  const tracks: PlaylistTrack[] = entries.map((e, i) => ({
    id: e.id || `ext-${i}`,
    title: e.title || `Pista ${i + 1}`,
    artist: e.uploader || info.uploader || 'Desconocido',
    album: info.title || 'Lista externa',
    durationSec: Math.round(e.duration || 0),
    sourceUrl: e.webpage_url || e.url || url,
  }));

  const platform: Platform = url.includes('soundcloud.com') ? 'soundcloud' : 'other';
  return {
    id: info.id || url,
    title: info.title || 'Lista externa',
    author: info.uploader || platform,
    platform,
    url: info.webpage_url || url,
    thumbnailUrl: info.thumbnail || '',
    trackCount: tracks.length,
    isPrivate: false,
    tracks,
  };
}

// ---------------------------------------------------------------------------
// Public Service Exports
// ---------------------------------------------------------------------------

export async function searchPlaylists(
  query: string,
  platformFilter: Platform | 'all',
  sessionId: string
): Promise<{
  results: PlaylistSummary[];
  notes: string[];
}> {
  const trimmed = query.trim();
  const notes: string[] = [];

  if (!trimmed) {
    return { results: [], notes };
  }

  // Check if user pasted a direct URL or playlist ID
  const ytId = extractYouTubePlaylistId(trimmed);
  if (ytId) {
    const googleToken = await getValidGoogleToken(sessionId);
    const detail = await getYouTubePlaylistDetail(ytId, googleToken);
    return { results: [detail], notes };
  }

  const spId = extractSpotifyPlaylistId(trimmed);
  if (spId) {
    const spToken = await getValidSpotifyToken(sessionId);
    const detail = await getSpotifyPlaylistDetail(spId, spToken);
    return { results: [detail], notes };
  }

  const dzId = extractDeezerPlaylistId(trimmed);
  if (dzId) {
    const detail = await getDeezerPlaylistDetail(dzId);
    return { results: [detail], notes };
  }

  if (/^https?:\/\//i.test(trimmed)) {
    const detail = await getGenericYtDlpPlaylist(trimmed);
    return { results: [detail], notes };
  }

  // Search by playlist name!
  const lowerQ = trimmed.toLowerCase();
  const tasks: Array<Promise<PlaylistSummary[]>> = [];

  const [spotifyToken, googleToken] = await Promise.all([
    getValidSpotifyToken(sessionId),
    getValidGoogleToken(sessionId),
  ]);

  // 1. User's private/owned playlists matching the name
  if (googleToken && (platformFilter === 'all' || platformFilter === 'youtube')) {
    tasks.push(
      getUserYouTubePlaylists(googleToken).then((mine) =>
        mine.filter(
          (p) =>
            p.title.toLowerCase().includes(lowerQ) ||
            p.author.toLowerCase().includes(lowerQ)
        )
      )
    );
  }

  if (spotifyToken && (platformFilter === 'all' || platformFilter === 'spotify')) {
    tasks.push(
      getUserSpotifyPlaylists(spotifyToken).then((mine) =>
        mine.filter(
          (p) =>
            p.title.toLowerCase().includes(lowerQ) ||
            p.author.toLowerCase().includes(lowerQ)
        )
      )
    );
  }

  // 2. Public searches by name
  if (platformFilter === 'all' || platformFilter === 'youtube') {
    tasks.push(searchYouTubePlaylistsByName(trimmed, 8));
  }

  if (platformFilter === 'all' || platformFilter === 'deezer') {
    tasks.push(searchDeezerPlaylists(trimmed, 8));
  }

  if (platformFilter === 'all' || platformFilter === 'spotify') {
    if (spotifyToken) {
      tasks.push(searchSpotifyPlaylists(trimmed, spotifyToken, 8));
    } else if (platformFilter === 'spotify') {
      notes.push(
        'Para buscar listas de Spotify por nombre (públicas o privadas), conecta tu cuenta de Spotify o pega la URL directa de la lista.'
      );
    }
  }

  if (platformFilter === 'soundcloud' || platformFilter === 'other') {
    const hasYtDlp = await checkYtDlpAvailable();
    if (!hasYtDlp) {
      notes.push(
        'Para SoundCloud y otras plataformas pega la URL directa en Docker (con yt-dlp incluido).'
      );
    }
  }

  const settled = await Promise.all(tasks);
  const seen = new Set<string>();
  const combined: PlaylistSummary[] = [];

  for (const group of settled) {
    for (const item of group) {
      const key = `${item.platform}:${item.id}`;
      if (!seen.has(key)) {
        seen.add(key);
        combined.push(item);
      }
    }
  }

  return { results: combined, notes };
}

export async function getPlaylistDetail(
  platform: Platform,
  id: string,
  url: string | undefined,
  sessionId: string
): Promise<PlaylistDetail> {
  if (platform === 'youtube') {
    const googleToken = await getValidGoogleToken(sessionId);
    return getYouTubePlaylistDetail(id, googleToken);
  }
  if (platform === 'spotify') {
    const spToken = await getValidSpotifyToken(sessionId);
    return getSpotifyPlaylistDetail(id, spToken);
  }
  if (platform === 'deezer') {
    return getDeezerPlaylistDetail(id);
  }
  if (url) {
    return getGenericYtDlpPlaylist(url);
  }
  throw new Error('Plataforma o URL no compatible.');
}

export async function getPrivatePlaylists(sessionId: string): Promise<PlaylistSummary[]> {
  const [spotifyToken, googleToken] = await Promise.all([
    getValidSpotifyToken(sessionId),
    getValidGoogleToken(sessionId),
  ]);

  const tasks: Array<Promise<PlaylistSummary[]>> = [];
  if (spotifyToken) tasks.push(getUserSpotifyPlaylists(spotifyToken));
  if (googleToken) tasks.push(getUserYouTubePlaylists(googleToken));

  const results = await Promise.all(tasks);
  return results.flat();
}
