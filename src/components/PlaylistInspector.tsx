import { Check, Download, Loader2, Lock, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { AudioFormat, AudioQuality, PlaylistDetail, PlaylistTrack } from '../types';
import { formatDuration, getPlatformLabel } from '../utils/format';
import { PlaylistArtwork } from './PlaylistArtwork';

interface PlaylistInspectorProps {
  playlist: PlaylistDetail | null;
  loading: boolean;
  error: string | null;
  defaultFormat: AudioFormat;
  defaultQuality: AudioQuality;
  submitting: boolean;
  onClose: () => void;
  onStartDownload: (params: {
    playlist: PlaylistDetail;
    tracks: PlaylistTrack[];
    format: AudioFormat;
    quality: AudioQuality;
  }) => void;
}

export function PlaylistInspector({
  playlist,
  loading,
  error,
  defaultFormat,
  defaultQuality,
  submitting,
  onClose,
  onStartDownload,
}: PlaylistInspectorProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [format, setFormat] = useState<AudioFormat>(defaultFormat);
  const [quality, setQuality] = useState<AudioQuality>(defaultQuality);

  useEffect(() => {
    setFormat(defaultFormat);
    setQuality(defaultQuality);
  }, [defaultFormat, defaultQuality]);

  useEffect(() => {
    if (playlist?.tracks) {
      setSelectedIds(new Set(playlist.tracks.map((t) => t.id)));
    } else {
      setSelectedIds(new Set());
    }
  }, [playlist]);

  if (!playlist && !loading && !error) return null;

  const toggleAll = () => {
    if (!playlist) return;
    if (selectedIds.size === playlist.tracks.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(playlist.tracks.map((t) => t.id)));
    }
  };

  const toggleOne = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const selectedTracks = playlist
    ? playlist.tracks.filter((t) => selectedIds.has(t.id))
    : [];

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-zinc-950/25 backdrop-blur-[1px]">
      <div
        className="w-full max-w-2xl bg-white border-l border-zinc-200 h-full flex flex-col"
        role="dialog"
        aria-label="Detalle de la lista"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200">
          <h2 className="text-base font-semibold text-zinc-900">Contenido de la lista</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-2 -mr-2 text-zinc-500 hover:text-zinc-900 rounded-md transition-colors cursor-pointer"
            aria-label="Cerrar inspector"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {loading && (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 p-8 text-zinc-500">
            <Loader2 className="w-5 h-5 animate-spin text-[#EA580C]" />
            <p className="text-sm">Obteniendo pistas de la lista...</p>
          </div>
        )}

        {!loading && error && (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 p-8 text-center">
            <p className="text-sm font-medium text-red-600">{error}</p>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium bg-zinc-100 hover:bg-zinc-200 text-zinc-800 rounded-md transition-colors cursor-pointer"
            >
              Cerrar
            </button>
          </div>
        )}

        {!loading && !error && playlist && (
          <>
            <div className="px-6 py-5 border-b border-zinc-200 flex items-start gap-4">
              <PlaylistArtwork
                src={playlist.thumbnailUrl}
                alt={playlist.title}
                sizeClass="w-16 h-16"
              />
              <div className="min-w-0 flex-1">
                <h3 className="text-lg font-semibold text-zinc-900 truncate">
                  {playlist.title}
                </h3>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                  <span>{getPlatformLabel(playlist.platform)}</span>
                  <span aria-hidden="true">·</span>
                  <span className="truncate max-w-[200px]">{playlist.author}</span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums">{playlist.tracks.length} pistas</span>
                  {playlist.isPrivate && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="inline-flex items-center gap-1 text-zinc-700 font-medium">
                        <Lock className="w-3 h-3" />
                        Privada
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>

            <div className="px-6 py-3 bg-zinc-50 border-b border-zinc-200 flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                onClick={toggleAll}
                className="text-xs font-medium text-zinc-700 hover:text-zinc-900 flex items-center gap-2 cursor-pointer"
              >
                <span
                  className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${
                    selectedIds.size === playlist.tracks.length && playlist.tracks.length > 0
                      ? 'bg-[#EA580C] border-[#EA580C] text-white'
                      : 'bg-white border-zinc-300'
                  }`}
                >
                  {selectedIds.size === playlist.tracks.length && playlist.tracks.length > 0 && (
                    <Check className="w-3 h-3" />
                  )}
                </span>
                {selectedIds.size === playlist.tracks.length
                  ? 'Deseleccionar todas'
                  : 'Seleccionar todas'}
              </button>

              <div className="flex items-center gap-2">
                <select
                  value={format}
                  onChange={(e) => setFormat(e.target.value as AudioFormat)}
                  className="px-2.5 py-1.5 text-xs bg-white border border-zinc-200 rounded-md text-zinc-800 focus:outline-none focus:border-zinc-400"
                  aria-label="Formato de audio"
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
                    className="px-2.5 py-1.5 text-xs font-mono bg-white border border-zinc-200 rounded-md text-zinc-800 focus:outline-none focus:border-zinc-400"
                    aria-label="Calidad en kbps"
                  >
                    <option value="320">320 kbps</option>
                    <option value="256">256 kbps</option>
                    <option value="192">192 kbps</option>
                    <option value="128">128 kbps</option>
                  </select>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-zinc-100">
              {playlist.tracks.length === 0 ? (
                <div className="p-8 text-center text-sm text-zinc-500">
                  Esta lista no contiene pistas disponibles.
                </div>
              ) : (
                playlist.tracks.map((track, index) => {
                  const checked = selectedIds.has(track.id);
                  return (
                    <button
                      key={`${track.id}-${index}`}
                      type="button"
                      onClick={() => toggleOne(track.id)}
                      className="w-full px-6 py-3 flex items-center gap-3.5 hover:bg-zinc-50 transition-colors text-left cursor-pointer"
                    >
                      <span
                        className={`w-4 h-4 shrink-0 rounded border flex items-center justify-center transition-colors ${
                          checked
                            ? 'bg-[#EA580C] border-[#EA580C] text-white'
                            : 'bg-white border-zinc-300'
                        }`}
                      >
                        {checked && <Check className="w-3 h-3" />}
                      </span>
                      <span className="w-7 text-xs font-mono tabular-nums text-zinc-400 text-right shrink-0">
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-zinc-900 truncate">{track.title}</p>
                        <p className="text-xs text-zinc-500 truncate">{track.artist}</p>
                      </div>
                      <span className="text-xs font-mono tabular-nums text-zinc-400 shrink-0">
                        {formatDuration(track.durationSec)}
                      </span>
                    </button>
                  );
                })
              )}
            </div>

            <div className="px-6 py-4 border-t border-zinc-200 bg-white flex items-center justify-between gap-4">
              <span className="text-xs text-zinc-500 font-mono tabular-nums">
                {selectedTracks.length} de {playlist.tracks.length} seleccionadas
              </span>
              <button
                type="button"
                disabled={submitting || selectedTracks.length === 0}
                onClick={() =>
                  onStartDownload({
                    playlist,
                    tracks: selectedTracks,
                    format,
                    quality,
                  })
                }
                className="px-4 py-2 text-xs font-semibold bg-[#EA580C] hover:bg-[#DC4E07] disabled:opacity-45 text-white rounded-md inline-flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                {submitting ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Download className="w-3.5 h-3.5" />
                )}
                Descargar selección ({selectedTracks.length})
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
