import {
  AlertCircle,
  CheckCircle2,
  Download,
  Eye,
  Loader2,
  Lock,
  Search,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { DockerSettingsView } from './components/DockerSettingsView';
import { PlaylistArtwork } from './components/PlaylistArtwork';
import { PlaylistInspector } from './components/PlaylistInspector';
import { PrivateAuthView } from './components/PrivateAuthView';
import { QueueView } from './components/QueueView';
import type {
  AudioFormat,
  AudioQuality,
  AuthStatusResponse,
  DownloadJobRecord,
  Platform,
  PlaylistDetail,
  PlaylistSummary,
  PlaylistTrack,
  SystemSettings,
} from './types';
import { getPlatformLabel } from './utils/format';

type ActiveTab = 'search' | 'queue' | 'private' | 'docker';

const SAMPLE_QUERIES = [
  'Lo-Fi Beats',
  'Synthwave Night Drive',
  'Acoustic Chill',
  'Electronic Focus',
];

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('search');

  // Search state
  const [query, setQuery] = useState('');
  const [platformFilter, setPlatformFilter] = useState<Platform | 'all'>('all');
  const [format, setFormat] = useState<AudioFormat>('mp3');
  const [quality, setQuality] = useState<AudioQuality>('320');
  const [searching, setSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [results, setResults] = useState<PlaylistSummary[]>([]);
  const [searchNotes, setSearchNotes] = useState<string[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);

  // Inspector state
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [inspectorLoading, setInspectorLoading] = useState(false);
  const [inspectorError, setInspectorError] = useState<string | null>(null);
  const [inspectorPlaylist, setInspectorPlaylist] = useState<PlaylistDetail | null>(null);
  const [submittingDownload, setSubmittingDownload] = useState(false);
  const [quickDownloadingId, setQuickDownloadingId] = useState<string | null>(null);

  // Queue, Auth, Settings
  const [jobs, setJobs] = useState<DownloadJobRecord[]>([]);
  const [authStatus, setAuthStatus] = useState<AuthStatusResponse | null>(null);
  const [privatePlaylists, setPrivatePlaylists] = useState<PlaylistSummary[]>([]);
  const [loadingPrivate, setLoadingPrivate] = useState(false);
  const [settings, setSettings] = useState<SystemSettings | null>(null);

  // Subtle transient notification
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  const showNotice = useCallback((kind: 'success' | 'error', text: string) => {
    setNotice({ kind, text });
    setTimeout(() => {
      setNotice((prev) => (prev?.text === text ? null : prev));
    }, 4500);
  }, []);

  const fetchAuthStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/status');
      if (res.ok) {
        const data = (await res.json()) as AuthStatusResponse;
        setAuthStatus(data);
        return data;
      }
    } catch {
      // ignore
    }
    return null;
  }, []);

  const fetchPrivatePlaylists = useCallback(async () => {
    setLoadingPrivate(true);
    try {
      const res = await fetch('/api/playlists/private');
      if (res.ok) {
        const data = (await res.json()) as { playlists: PlaylistSummary[] };
        setPrivatePlaylists(data.playlists || []);
      }
    } finally {
      setLoadingPrivate(false);
    }
  }, []);

  const fetchJobs = useCallback(async () => {
    try {
      const res = await fetch('/api/downloads');
      if (res.ok) {
        const data = (await res.json()) as { jobs: DownloadJobRecord[] };
        setJobs(data.jobs || []);
      }
    } catch {
      // ignore
    }
  }, []);

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/settings');
      if (res.ok) {
        const data = (await res.json()) as SystemSettings;
        setSettings(data);
        setFormat(data.defaultFormat);
        setQuality(data.defaultQuality);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    void fetchAuthStatus().then((status) => {
      if (status?.spotify.connected || status?.youtube.connected) {
        void fetchPrivatePlaylists();
      }
    });
    void fetchJobs();
    void fetchSettings();
  }, [fetchAuthStatus, fetchPrivatePlaylists, fetchJobs, fetchSettings]);

  // Real-time download progress over SSE
  useEffect(() => {
    const es = new EventSource('/api/downloads/events');
    es.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as
          | { type: 'job_update'; job: DownloadJobRecord }
          | { type: 'job_removed'; jobId: string };
        if (msg.type === 'job_update') {
          setJobs((prev) => {
            const exists = prev.some((j) => j.id === msg.job.id);
            if (exists) {
              return prev.map((j) => (j.id === msg.job.id ? msg.job : j));
            }
            return [msg.job, ...prev];
          });
          if (msg.job.status === 'completed') {
            void fetchSettings();
          }
        } else if (msg.type === 'job_removed') {
          setJobs((prev) => prev.filter((j) => j.id !== msg.jobId));
          void fetchSettings();
        }
      } catch {
        // ignore parse errors
      }
    };
    return () => es.close();
  }, [fetchSettings]);

  // Listen for OAuth popup completion
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const origin = event.origin || '';
      if (
        origin &&
        !origin.endsWith('.run.app') &&
        !origin.includes('localhost') &&
        !origin.includes('127.0.0.1')
      ) {
        return;
      }
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        const label = event.data.provider === 'spotify' ? 'Spotify' : 'YouTube';
        showNotice('success', `Cuenta de ${label} conectada correctamente.`);
        void fetchAuthStatus();
        void fetchPrivatePlaylists();
      } else if (event.data?.type === 'OAUTH_AUTH_ERROR') {
        showNotice('error', event.data.error || 'Error de autenticación.');
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [fetchAuthStatus, fetchPrivatePlaylists, showNotice]);

  const runSearch = async (searchQuery: string, platform = platformFilter) => {
    const trimmed = searchQuery.trim();
    if (!trimmed) return;
    setSearching(true);
    setHasSearched(true);
    setSearchError(null);
    setSearchNotes([]);
    try {
      const params = new URLSearchParams({
        q: trimmed,
        platform,
      });
      const res = await fetch(`/api/playlists/search?${params.toString()}`);
      const data = (await res.json()) as {
        results?: PlaylistSummary[];
        notes?: string[];
        error?: string;
      };
      if (!res.ok) {
        setSearchError(data.error || 'Error al buscar listas.');
        setResults([]);
      } else {
        setResults(data.results || []);
        setSearchNotes(data.notes || []);
      }
    } catch {
      setSearchError('No se pudo conectar con el servidor de búsqueda.');
    } finally {
      setSearching(false);
    }
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void runSearch(query);
  };

  const handleInspectPlaylist = async (playlist: PlaylistSummary) => {
    setInspectorOpen(true);
    setInspectorLoading(true);
    setInspectorError(null);
    setInspectorPlaylist(null);
    try {
      const params = new URLSearchParams({
        platform: playlist.platform,
        id: playlist.id,
        url: playlist.url,
      });
      const res = await fetch(`/api/playlists/detail?${params.toString()}`);
      const data = (await res.json()) as PlaylistDetail & { error?: string };
      if (!res.ok) {
        setInspectorError(data.error || 'No se pudieron cargar las pistas.');
      } else {
        setInspectorPlaylist(data);
      }
    } catch {
      setInspectorError('Error de red al obtener los detalles de la lista.');
    } finally {
      setInspectorLoading(false);
    }
  };

  const handleStartDownloadFromInspector = async (params: {
    playlist: PlaylistDetail;
    tracks: PlaylistTrack[];
    format: AudioFormat;
    quality: AudioQuality;
  }) => {
    setSubmittingDownload(true);
    try {
      const res = await fetch('/api/downloads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: params.playlist.platform,
          id: params.playlist.id,
          url: params.playlist.url,
          playlistTitle: params.playlist.title,
          playlistAuthor: params.playlist.author,
          thumbnailUrl: params.playlist.thumbnailUrl,
          isPrivate: params.playlist.isPrivate,
          format: params.format,
          quality: params.quality,
          tracks: params.tracks,
        }),
      });
      const data = (await res.json()) as { job?: DownloadJobRecord; error?: string };
      if (!res.ok || !data.job) {
        showNotice('error', data.error || 'No se pudo iniciar la descarga.');
        return;
      }
      setJobs((prev) => [data.job!, ...prev.filter((j) => j.id !== data.job!.id)]);
      setInspectorOpen(false);
      setActiveTab('queue');
      showNotice('success', `«${params.playlist.title}» añadida a la cola de descargas.`);
    } catch {
      showNotice('error', 'Error de conexión al encolar la descarga.');
    } finally {
      setSubmittingDownload(false);
    }
  };

  const handleQuickDownload = async (playlist: PlaylistSummary) => {
    const key = `${playlist.platform}:${playlist.id}`;
    setQuickDownloadingId(key);
    try {
      const res = await fetch('/api/downloads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: playlist.platform,
          id: playlist.id,
          url: playlist.url,
          playlistTitle: playlist.title,
          playlistAuthor: playlist.author,
          thumbnailUrl: playlist.thumbnailUrl,
          isPrivate: playlist.isPrivate,
          format,
          quality,
        }),
      });
      const data = (await res.json()) as { job?: DownloadJobRecord; error?: string };
      if (!res.ok || !data.job) {
        showNotice('error', data.error || 'No se pudo iniciar la descarga.');
        return;
      }
      setJobs((prev) => [data.job!, ...prev.filter((j) => j.id !== data.job!.id)]);
      showNotice('success', `Descargando «${playlist.title}» en ${format.toUpperCase()}.`);
    } catch {
      showNotice('error', 'Error al encolar la lista.');
    } finally {
      setQuickDownloadingId(null);
    }
  };

  const handleConnectProvider = async (provider: 'spotify' | 'youtube') => {
    try {
      const res = await fetch(`/api/auth/${provider}/url`);
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        showNotice(
          'error',
          data.error ||
            `Configura las variables OAuth de ${provider === 'spotify' ? 'Spotify' : 'Google'} para conectar.`
        );
        return;
      }
      const popup = window.open(data.url, 'oauth_popup', 'width=600,height=700');
      if (!popup) {
        showNotice('error', 'El navegador bloqueó la ventana emergente de autenticación.');
      }
    } catch {
      showNotice('error', 'No se pudo iniciar el flujo OAuth.');
    }
  };

  const handleDisconnectProvider = async (provider: 'spotify' | 'youtube') => {
    const res = await fetch(`/api/auth/disconnect/${provider}`, { method: 'POST' });
    if (res.ok) {
      const updated = (await res.json()) as AuthStatusResponse;
      setAuthStatus(updated);
      void fetchPrivatePlaylists();
      showNotice(
        'success',
        `Sesión de ${provider === 'spotify' ? 'Spotify' : 'YouTube'} desconectada.`
      );
    }
  };

  const handleSaveCookies = async (cookiesTxt: string) => {
    const res = await fetch('/api/auth/cookies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cookiesTxt }),
    });
    if (res.ok) {
      setAuthStatus((await res.json()) as AuthStatusResponse);
      showNotice('success', 'Cookies guardadas para descargas privadas con yt-dlp.');
    } else {
      const data = (await res.json()) as { error?: string };
      showNotice('error', data.error || 'Error al guardar cookies.');
    }
  };

  const handleDeleteCookies = async () => {
    const res = await fetch('/api/auth/cookies', { method: 'DELETE' });
    if (res.ok) {
      setAuthStatus((await res.json()) as AuthStatusResponse);
      showNotice('success', 'Cookies eliminadas.');
    }
  };

  const handleSaveSettings = async (next: {
    concurrency: number;
    defaultFormat: AudioFormat;
    defaultQuality: AudioQuality;
    filenameTemplate: string;
  }) => {
    const res = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(next),
    });
    if (res.ok) {
      await fetchSettings();
      showNotice('success', 'Preferencias actualizadas.');
    }
  };

  const activeQueueCount = jobs.filter((j) =>
    ['queued', 'downloading', 'packaging'].includes(j.status)
  ).length;

  const connectedCount =
    Number(Boolean(authStatus?.spotify.connected)) +
    Number(Boolean(authStatus?.youtube.connected));

  return (
    <div className="min-h-screen flex flex-col bg-[#FAFAFA] text-[#18181B]">
      {/* Top Bar: 3-Zone Contract */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-xs border-b border-zinc-200">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-8">
          {/* Zone 1: Single-element brand wordmark */}
          <button
            type="button"
            onClick={() => setActiveTab('search')}
            className="font-display text-lg font-bold tracking-tight text-zinc-900 whitespace-nowrap shrink-0 cursor-pointer"
          >
            CrateDock
          </button>

          {/* Zone 2: 4 single-line navigation links */}
          <nav
            className="flex items-center gap-6 sm:gap-8 text-sm font-medium overflow-x-auto"
            aria-label="Navegación principal"
          >
            {(
              [
                { id: 'search', label: 'Buscar' },
                {
                  id: 'queue',
                  label: activeQueueCount > 0 ? `Cola · ${activeQueueCount}` : 'Cola',
                },
                { id: 'private', label: 'Privadas' },
                { id: 'docker', label: 'Docker' },
              ] as const
            ).map((item) => {
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className={`py-5 border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    active
                      ? 'border-[#EA580C] text-zinc-900'
                      : 'border-transparent text-zinc-500 hover:text-zinc-900'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>

          {/* Zone 3: 1 primary action */}
          <div className="shrink-0">
            <button
              type="button"
              onClick={() => setActiveTab('private')}
              className="px-4 py-2 text-xs font-semibold bg-zinc-900 hover:bg-zinc-800 text-white rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {connectedCount > 0 ? `Cuentas (${connectedCount})` : 'Conectar cuentas'}
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Viewport */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-8 sm:py-10">
        {notice && (
          <div
            className={`mb-6 px-4 py-3 rounded-md border flex items-center justify-between gap-3 text-xs ${
              notice.kind === 'success'
                ? 'bg-white border-emerald-200 text-emerald-800'
                : 'bg-white border-red-200 text-red-700'
            }`}
            role="status"
          >
            <div className="flex items-center gap-2">
              {notice.kind === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
              )}
              <span>{notice.text}</span>
            </div>
            <button
              type="button"
              onClick={() => setNotice(null)}
              className="text-zinc-400 hover:text-zinc-700 cursor-pointer"
              aria-label="Cerrar aviso"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {activeTab === 'search' && (
          <div className="space-y-8">
            <div className="max-w-3xl">
              <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-zinc-900 text-balance">
                Descarga listas de música por nombre o enlace
              </h1>
              <p className="mt-2 text-sm text-zinc-500">
                Escribe el nombre de cualquier lista de YouTube, Spotify o Deezer, o pega su URL directa. Compatible con listas privadas mediante autenticación OAuth.
              </p>
            </div>

            {/* Minimalist Search & Format Toolbar */}
            <form
              onSubmit={handleSearchSubmit}
              className="bg-white border border-zinc-200 rounded-lg p-4 sm:p-5 space-y-4"
            >
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Nombre de la lista o URL (ej. Lo-Fi Beats, Workout Mix, https://...)"
                    className="w-full pl-10 pr-4 py-2.5 text-sm bg-zinc-50 border border-zinc-200 rounded-md text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:bg-white focus:border-[#EA580C] transition-colors"
                  />
                </div>
                <button
                  type="submit"
                  disabled={searching || !query.trim()}
                  className="px-6 py-2.5 text-sm font-semibold bg-[#EA580C] hover:bg-[#DC4E07] disabled:opacity-45 text-white rounded-md inline-flex items-center justify-center gap-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {searching ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Buscando...
                    </>
                  ) : (
                    'Buscar listas'
                  )}
                </button>
              </div>

              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pt-1">
                {/* Interactive segmented platform filter */}
                <div className="inline-flex items-center gap-1 p-1 bg-zinc-100 rounded-lg self-start overflow-x-auto max-w-full">
                  {(
                    [
                      { key: 'all', label: 'Todas' },
                      { key: 'youtube', label: 'YouTube' },
                      { key: 'spotify', label: 'Spotify' },
                      { key: 'deezer', label: 'Deezer' },
                      { key: 'soundcloud', label: 'Más' },
                    ] as const
                  ).map((tab) => (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() => {
                        setPlatformFilter(tab.key);
                        if (query.trim() && hasSearched) {
                          void runSearch(query, tab.key);
                        }
                      }}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        platformFilter === tab.key
                          ? 'bg-white text-zinc-900 shadow-xs'
                          : 'text-zinc-600 hover:text-zinc-900'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                {/* Output format & quality */}
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-zinc-500">Salida:</span>
                  <select
                    value={format}
                    onChange={(e) => setFormat(e.target.value as AudioFormat)}
                    className="px-2.5 py-1.5 bg-zinc-50 border border-zinc-200 rounded-md text-zinc-800 focus:outline-none focus:border-zinc-400"
                    aria-label="Formato de descarga"
                  >
                    <option value="mp3">MP3</option>
                    <option value="m4a">M4A</option>
                    <option value="opus">OPUS</option>
                    <option value="flac">FLAC</option>
                  </select>
                  {format !== 'flac' && (
                    <select
                      value={quality}
                      onChange={(e) => setQuality(e.target.value as AudioQuality)}
                      className="px-2.5 py-1.5 font-mono bg-zinc-50 border border-zinc-200 rounded-md text-zinc-800 focus:outline-none focus:border-zinc-400"
                      aria-label="Calidad de audio"
                    >
                      <option value="320">320 kbps</option>
                      <option value="256">256 kbps</option>
                      <option value="192">192 kbps</option>
                      <option value="128">128 kbps</option>
                    </select>
                  )}
                </div>
              </div>
            </form>

            {/* Suggestions when idle */}
            {!hasSearched && (
              <div className="space-y-4">
                <p className="text-xs font-medium text-zinc-500">Búsquedas sugeridas</p>
                <div className="flex flex-wrap gap-2">
                  {SAMPLE_QUERIES.map((sample) => (
                    <button
                      key={sample}
                      type="button"
                      onClick={() => {
                        setQuery(sample);
                        void runSearch(sample);
                      }}
                      className="px-3.5 py-2 text-xs font-medium bg-white border border-zinc-200 hover:border-zinc-300 hover:bg-zinc-50 text-zinc-700 rounded-md transition-colors cursor-pointer"
                    >
                      {sample}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Notes / Error */}
            {searchNotes.length > 0 && (
              <div className="bg-white border border-zinc-200 rounded-lg px-4 py-3 text-xs text-zinc-600 space-y-1">
                {searchNotes.map((note, idx) => (
                  <p key={idx}>{note}</p>
                ))}
              </div>
            )}

            {searchError && (
              <div className="bg-white border border-red-200 rounded-lg px-4 py-3 text-xs text-red-700">
                {searchError}
              </div>
            )}

            {/* Results Table */}
            {hasSearched && !searching && !searchError && (
              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs text-zinc-500">
                  <span className="font-mono tabular-nums">
                    {results.length} {results.length === 1 ? 'lista encontrada' : 'listas encontradas'}
                  </span>
                </div>

                {results.length === 0 ? (
                  <div className="bg-white border border-zinc-200 rounded-lg p-12 text-center">
                    <p className="text-sm font-medium text-zinc-900">
                      No encontramos listas con ese nombre
                    </p>
                    <p className="mt-1 text-xs text-zinc-500">
                      Prueba con otro término o pega directamente la URL de YouTube, Spotify, Deezer o SoundCloud.
                    </p>
                  </div>
                ) : (
                  <div className="bg-white border border-zinc-200 rounded-lg divide-y divide-zinc-200">
                    {results.map((pl) => {
                      const itemKey = `${pl.platform}:${pl.id}`;
                      const isQueuing = quickDownloadingId === itemKey;

                      return (
                        <div
                          key={itemKey}
                          className="px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-zinc-50/70 transition-colors"
                        >
                          <div className="flex items-center gap-3.5 min-w-0 flex-1">
                            <PlaylistArtwork
                              src={pl.thumbnailUrl}
                              alt={pl.title}
                              sizeClass="w-12 h-12"
                            />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <h3 className="text-sm font-semibold text-zinc-900 truncate">
                                  {pl.title}
                                </h3>
                                {pl.isPrivate && (
                                  <Lock
                                    className="w-3.5 h-3.5 text-zinc-400 shrink-0"
                                    aria-label="Lista privada"
                                  />
                                )}
                              </div>
                              <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                                <span>{getPlatformLabel(pl.platform)}</span>
                                <span aria-hidden="true">·</span>
                                <span className="truncate max-w-[200px]">{pl.author}</span>
                                {pl.trackCount > 0 && (
                                  <>
                                    <span aria-hidden="true">·</span>
                                    <span className="font-mono tabular-nums">
                                      {pl.trackCount} pistas
                                    </span>
                                  </>
                                )}
                                <span aria-hidden="true">·</span>
                                <span>{pl.isPrivate ? 'Privada' : 'Pública'}</span>
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              type="button"
                              onClick={() => void handleInspectPlaylist(pl)}
                              className="px-3 py-1.5 text-xs font-medium border border-zinc-200 hover:bg-white text-zinc-700 rounded-md inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              Ver pistas
                            </button>
                            <button
                              type="button"
                              disabled={isQueuing}
                              onClick={() => void handleQuickDownload(pl)}
                              className="px-3.5 py-1.5 text-xs font-semibold bg-[#EA580C] hover:bg-[#DC4E07] disabled:opacity-50 text-white rounded-md inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                            >
                              {isQueuing ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <Download className="w-3.5 h-3.5" />
                              )}
                              Descargar
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {activeTab === 'queue' && (
          <QueueView
            jobs={jobs}
            onPause={(id) => void fetch(`/api/downloads/${id}/pause`, { method: 'POST' })}
            onResume={(id) => void fetch(`/api/downloads/${id}/resume`, { method: 'POST' })}
            onCancel={(id) => void fetch(`/api/downloads/${id}/cancel`, { method: 'POST' })}
            onDelete={(id) => void fetch(`/api/downloads/${id}`, { method: 'DELETE' })}
            onGoToSearch={() => setActiveTab('search')}
          />
        )}

        {activeTab === 'private' && (
          <PrivateAuthView
            authStatus={authStatus}
            privatePlaylists={privatePlaylists}
            loadingPlaylists={loadingPrivate}
            onConnectProvider={(provider) => void handleConnectProvider(provider)}
            onDisconnectProvider={(provider) => void handleDisconnectProvider(provider)}
            onSaveCookies={handleSaveCookies}
            onDeleteCookies={handleDeleteCookies}
            onInspectPlaylist={(pl) => void handleInspectPlaylist(pl)}
            onQuickDownload={(pl) => void handleQuickDownload(pl)}
            onRefreshPrivate={() => void fetchPrivatePlaylists()}
          />
        )}

        {activeTab === 'docker' && (
          <DockerSettingsView
            settings={settings}
            onSaveSettings={handleSaveSettings}
          />
        )}
      </main>

      {/* Tracklist Inspector Drawer */}
      {inspectorOpen && (
        <PlaylistInspector
          playlist={inspectorPlaylist}
          loading={inspectorLoading}
          error={inspectorError}
          defaultFormat={format}
          defaultQuality={quality}
          submitting={submittingDownload}
          onClose={() => setInspectorOpen(false)}
          onStartDownload={(params) => void handleStartDownloadFromInspector(params)}
        />
      )}
    </div>
  );
}
