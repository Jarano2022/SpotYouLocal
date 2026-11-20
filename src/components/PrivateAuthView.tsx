import {
  Check,
  Copy,
  Download,
  Eye,
  KeyRound,
  Loader2,
  Lock,
  LogOut,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';
import { useState } from 'react';
import type { AuthStatusResponse, PlaylistSummary } from '../types';
import { getPlatformLabel } from '../utils/format';
import { PlaylistArtwork } from './PlaylistArtwork';

interface PrivateAuthViewProps {
  authStatus: AuthStatusResponse | null;
  privatePlaylists: PlaylistSummary[];
  loadingPlaylists: boolean;
  onConnectProvider: (provider: 'spotify' | 'youtube') => void;
  onDisconnectProvider: (provider: 'spotify' | 'youtube') => void;
  onSaveCookies: (cookiesTxt: string) => Promise<void>;
  onDeleteCookies: () => Promise<void>;
  onInspectPlaylist: (playlist: PlaylistSummary) => void;
  onQuickDownload: (playlist: PlaylistSummary) => void;
  onRefreshPrivate: () => void;
}

export function PrivateAuthView({
  authStatus,
  privatePlaylists,
  loadingPlaylists,
  onConnectProvider,
  onDisconnectProvider,
  onSaveCookies,
  onDeleteCookies,
  onInspectPlaylist,
  onQuickDownload,
  onRefreshPrivate,
}: PrivateAuthViewProps) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [cookiesInput, setCookiesInput] = useState('');
  const [savingCookies, setSavingCookies] = useState(false);
  const [filterText, setFilterText] = useState('');

  const handleCopy = (key: string, text: string) => {
    void navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1800);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setCookiesInput(reader.result);
      }
    };
    reader.readAsText(file);
  };

  const handleSaveCookiesSubmit = async () => {
    if (!cookiesInput.trim()) return;
    setSavingCookies(true);
    try {
      await onSaveCookies(cookiesInput);
      setCookiesInput('');
    } finally {
      setSavingCookies(false);
    }
  };

  const filteredPrivate = privatePlaylists.filter((pl) => {
    if (!filterText.trim()) return true;
    const q = filterText.toLowerCase();
    return (
      pl.title.toLowerCase().includes(q) ||
      pl.author.toLowerCase().includes(q) ||
      pl.platform.toLowerCase().includes(q)
    );
  });

  const anyConnected = Boolean(authStatus?.spotify.connected || authStatus?.youtube.connected);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
          Autenticación y listas privadas
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Conecta tus cuentas con OAuth 2.0 o importa cookies de sesión para acceder a listas privadas, ocultas o colaborativas.
        </p>
      </div>

      {/* OAuth Providers */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Spotify */}
        <div className="bg-white border border-zinc-200 rounded-lg p-6 flex flex-col justify-between gap-5">
          <div>
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-zinc-900">Spotify</h2>
                <p className="mt-0.5 text-xs text-zinc-500">
                  Acceso a listas privadas, colaborativas y «Canciones que te gustan».
                </p>
              </div>
              <span
                className={`text-xs font-medium whitespace-nowrap ${
                  authStatus?.spotify.connected ? 'text-emerald-700' : 'text-zinc-500'
                }`}
              >
                {authStatus?.spotify.connected ? 'Conectada' : 'Sin conectar'}
              </span>
            </div>

            {authStatus?.spotify.connected && authStatus.spotify.displayName && (
              <p className="mt-3 text-xs text-zinc-700">
                Sesión iniciada como{' '}
                <span className="font-semibold">{authStatus.spotify.displayName}</span>
              </p>
            )}

            {authStatus && (
              <div className="mt-4 pt-4 border-t border-zinc-100">
                <p className="text-xs text-zinc-500">URI de redirección (OAuth Callback)</p>
                <div className="mt-1.5 flex items-center gap-2">
                  <code className="flex-1 px-2.5 py-1.5 text-[11px] font-mono bg-zinc-50 border border-zinc-200 rounded text-zinc-700 truncate">
                    {authStatus.callbackUrls.spotify}
                  </code>
                  <button
                    type="button"
                    onClick={() => handleCopy('sp-uri', authStatus.callbackUrls.spotify)}
                    className="p-1.5 text-zinc-500 hover:text-zinc-900 border border-zinc-200 rounded bg-white transition-colors cursor-pointer"
                    aria-label="Copiar URI de Spotify"
                  >
                    {copiedKey === 'sp-uri' ? (
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
                {!authStatus.spotify.configured && (
                  <p className="mt-2 text-xs text-amber-700">
                    Define <code className="font-mono">SPOTIFY_CLIENT_ID</code> y{' '}
                    <code className="font-mono">SPOTIFY_CLIENT_SECRET</code> para habilitar OAuth.
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center gap-3">
            {authStatus?.spotify.connected ? (
              <button
                type="button"
                onClick={() => onDisconnectProvider('spotify')}
                className="px-4 py-2 text-xs font-medium border border-zinc-200 hover:bg-zinc-50 text-zinc-700 rounded-md inline-flex items-center gap-2 transition-colors cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                Desconectar Spotify
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onConnectProvider('spotify')}
                className="px-4 py-2 text-xs font-semibold bg-zinc-900 hover:bg-zinc-800 text-white rounded-md inline-flex items-center gap-2 transition-colors cursor-pointer"
              >
                <KeyRound className="w-3.5 h-3.5" />
                Conectar con Spotify
              </button>
            )}
          </div>
        </div>

        {/* YouTube / Google */}
        <div className="bg-white border border-zinc-200 rounded-lg p-6 flex flex-col justify-between gap-5">
          <div>
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-zinc-900">YouTube / Google</h2>
                <p className="mt-0.5 text-xs text-zinc-500">
                  Acceso a listas privadas, ocultas y listas propias de tu canal de YouTube.
                </p>
              </div>
              <span
                className={`text-xs font-medium whitespace-nowrap ${
                  authStatus?.youtube.connected ? 'text-emerald-700' : 'text-zinc-500'
                }`}
              >
                {authStatus?.youtube.connected ? 'Conectada' : 'Sin conectar'}
              </span>
            </div>

            {authStatus?.youtube.connected && authStatus.youtube.displayName && (
              <p className="mt-3 text-xs text-zinc-700">
                Sesión iniciada como{' '}
                <span className="font-semibold">{authStatus.youtube.displayName}</span>
              </p>
            )}

            {authStatus && (
              <div className="mt-4 pt-4 border-t border-zinc-100">
                <p className="text-xs text-zinc-500">URI de redirección (OAuth Callback)</p>
                <div className="mt-1.5 flex items-center gap-2">
                  <code className="flex-1 px-2.5 py-1.5 text-[11px] font-mono bg-zinc-50 border border-zinc-200 rounded text-zinc-700 truncate">
                    {authStatus.callbackUrls.youtube}
                  </code>
                  <button
                    type="button"
                    onClick={() => handleCopy('yt-uri', authStatus.callbackUrls.youtube)}
                    className="p-1.5 text-zinc-500 hover:text-zinc-900 border border-zinc-200 rounded bg-white transition-colors cursor-pointer"
                    aria-label="Copiar URI de YouTube"
                  >
                    {copiedKey === 'yt-uri' ? (
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
                {!authStatus.youtube.configured && (
                  <p className="mt-2 text-xs text-amber-700">
                    Define <code className="font-mono">GOOGLE_CLIENT_ID</code> y{' '}
                    <code className="font-mono">GOOGLE_CLIENT_SECRET</code> para habilitar OAuth.
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center gap-3">
            {authStatus?.youtube.connected ? (
              <button
                type="button"
                onClick={() => onDisconnectProvider('youtube')}
                className="px-4 py-2 text-xs font-medium border border-zinc-200 hover:bg-zinc-50 text-zinc-700 rounded-md inline-flex items-center gap-2 transition-colors cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                Desconectar YouTube
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onConnectProvider('youtube')}
                className="px-4 py-2 text-xs font-semibold bg-zinc-900 hover:bg-zinc-800 text-white rounded-md inline-flex items-center gap-2 transition-colors cursor-pointer"
              >
                <KeyRound className="w-3.5 h-3.5" />
                Conectar con Google / YouTube
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Cookies.txt for yt-dlp private extractions */}
      <div className="bg-white border border-zinc-200 rounded-lg p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-zinc-900">
              Archivo cookies.txt (Opcional para yt-dlp)
            </h2>
            <p className="mt-0.5 text-xs text-zinc-500">
              Útil en Docker para listas privadas de SoundCloud, Bandcamp o vídeos con restricción de sesión sin claves OAuth.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span
              className={`text-xs font-medium ${
                authStatus?.hasCookiesTxt ? 'text-emerald-700' : 'text-zinc-500'
              }`}
            >
              {authStatus?.hasCookiesTxt ? 'Cookies activas' : 'No cargadas'}
            </span>
            {authStatus?.hasCookiesTxt && (
              <button
                type="button"
                onClick={onDeleteCookies}
                className="p-1.5 text-zinc-400 hover:text-red-600 rounded transition-colors cursor-pointer"
                title="Eliminar cookies"
                aria-label="Eliminar cookies"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        <div className="mt-4 space-y-3">
          <textarea
            value={cookiesInput}
            onChange={(e) => setCookiesInput(e.target.value)}
            rows={3}
            placeholder="# Netscape HTTP Cookie File&#10;.youtube.com	TRUE	/	TRUE	..."
            className="w-full px-3 py-2 text-xs font-mono bg-zinc-50 border border-zinc-200 rounded-md text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:border-zinc-400"
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="px-3 py-1.5 text-xs font-medium border border-zinc-200 hover:bg-zinc-50 text-zinc-700 rounded-md inline-flex items-center gap-2 cursor-pointer transition-colors">
              <Upload className="w-3.5 h-3.5" />
              Cargar archivo .txt
              <input
                type="file"
                accept=".txt"
                onChange={handleFileUpload}
                className="hidden"
              />
            </label>
            <button
              type="button"
              disabled={!cookiesInput.trim() || savingCookies}
              onClick={handleSaveCookiesSubmit}
              className="px-4 py-2 text-xs font-semibold bg-[#EA580C] hover:bg-[#DC4E07] disabled:opacity-45 text-white rounded-md transition-colors cursor-pointer"
            >
              {savingCookies ? 'Guardando...' : 'Guardar cookies'}
            </button>
          </div>
        </div>
      </div>

      {/* Private Playlists Library */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-zinc-900">
              Tus listas privadas y personales
            </h2>
          </div>
          {anyConnected && (
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={filterText}
                  onChange={(e) => setFilterText(e.target.value)}
                  placeholder="Filtrar tus listas..."
                  className="pl-8 pr-3 py-1.5 text-xs bg-white border border-zinc-200 rounded-md text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:border-zinc-400"
                />
              </div>
              <button
                type="button"
                onClick={onRefreshPrivate}
                className="px-3 py-1.5 text-xs font-medium border border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-700 rounded-md transition-colors cursor-pointer"
              >
                Actualizar
              </button>
            </div>
          )}
        </div>

        {!anyConnected ? (
          <div className="bg-white border border-zinc-200 rounded-lg p-10 text-center">
            <p className="text-sm font-medium text-zinc-900">
              Conecta Spotify o YouTube para ver tus listas privadas
            </p>
            <p className="mt-1 text-xs text-zinc-500">
              Una vez iniciada la sesión OAuth, aparecerán aquí automáticamente listas privadas, ocultas y colaborativas.
            </p>
          </div>
        ) : loadingPlaylists ? (
          <div className="bg-white border border-zinc-200 rounded-lg p-10 flex items-center justify-center gap-2 text-xs text-zinc-500">
            <Loader2 className="w-4 h-4 animate-spin text-[#EA580C]" />
            Cargando listas de tus cuentas conectadas...
          </div>
        ) : filteredPrivate.length === 0 ? (
          <div className="bg-white border border-zinc-200 rounded-lg p-10 text-center text-xs text-zinc-500">
            No se encontraron listas privadas que coincidan con tu filtro.
          </div>
        ) : (
          <div className="bg-white border border-zinc-200 rounded-lg divide-y divide-zinc-200">
            {filteredPrivate.map((pl) => (
              <div
                key={`${pl.platform}-${pl.id}`}
                className="px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-zinc-50/70 transition-colors"
              >
                <div className="flex items-center gap-3.5 min-w-0 flex-1">
                  <PlaylistArtwork src={pl.thumbnailUrl} alt={pl.title} sizeClass="w-11 h-11" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-zinc-900 truncate">{pl.title}</p>
                      {pl.isPrivate && (
                        <Lock className="w-3.5 h-3.5 text-zinc-400 shrink-0" aria-label="Privada" />
                      )}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-zinc-500">
                      <span>{getPlatformLabel(pl.platform)}</span>
                      <span aria-hidden="true">·</span>
                      <span className="truncate">{pl.author}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">{pl.trackCount} pistas</span>
                      <span aria-hidden="true">·</span>
                      <span>{pl.isPrivate ? 'Privada' : 'Pública'}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => onInspectPlaylist(pl)}
                    className="px-3 py-1.5 text-xs font-medium border border-zinc-200 hover:bg-white text-zinc-700 rounded-md inline-flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    Ver pistas
                  </button>
                  <button
                    type="button"
                    onClick={() => onQuickDownload(pl)}
                    className="px-3 py-1.5 text-xs font-semibold bg-[#EA580C] hover:bg-[#DC4E07] text-white rounded-md inline-flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Descargar
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
