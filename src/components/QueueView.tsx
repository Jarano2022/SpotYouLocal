import {
  AlertCircle,
  Archive,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Download,
  Loader2,
  Lock,
  Pause,
  Play,
  RotateCcw,
  Trash2,
  XCircle,
} from 'lucide-react';
import { useState } from 'react';
import type { DownloadJobRecord } from '../types';
import { formatBytes, formatDuration, getJobStatusLabel, getPlatformLabel } from '../utils/format';
import { PlaylistArtwork } from './PlaylistArtwork';

interface QueueViewProps {
  jobs: DownloadJobRecord[];
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onCancel: (id: string) => void;
  onDelete: (id: string) => void;
  onGoToSearch: () => void;
}

export function QueueView({
  jobs,
  onPause,
  onResume,
  onCancel,
  onDelete,
  onGoToSearch,
}: QueueViewProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<'all' | 'active' | 'completed' | 'error'>('all');

  const toggleExpand = (id: string) => {
    const next = new Set(expandedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpandedIds(next);
  };

  const activeJobs = jobs.filter((j) =>
    ['queued', 'downloading', 'packaging', 'paused'].includes(j.status)
  );
  const completedJobs = jobs.filter((j) => j.status === 'completed');
  const errorJobs = jobs.filter((j) => j.status === 'error' || j.status === 'cancelled');

  const filteredJobs = jobs.filter((job) => {
    if (filter === 'active') {
      return ['queued', 'downloading', 'packaging', 'paused'].includes(job.status);
    }
    if (filter === 'completed') return job.status === 'completed';
    if (filter === 'error') return job.status === 'error' || job.status === 'cancelled';
    return true;
  });

  const totalBytes = jobs.reduce((acc, j) => acc + (j.totalBytes || 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
            Cola de descargas
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500 font-mono tabular-nums">
            <span>{activeJobs.length} activas</span>
            <span aria-hidden="true">·</span>
            <span>{completedJobs.length} completadas</span>
            <span aria-hidden="true">·</span>
            <span>{formatBytes(totalBytes)} almacenados</span>
          </div>
        </div>

        <div className="inline-flex items-center gap-1 p-1 bg-zinc-100 rounded-lg self-start sm:self-auto">
          {(
            [
              { key: 'all', label: 'Todas' },
              { key: 'active', label: 'Activas' },
              { key: 'completed', label: 'Completadas' },
              { key: 'error', label: 'Incidencias' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setFilter(tab.key)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                filter === tab.key
                  ? 'bg-white text-zinc-900 shadow-xs'
                  : 'text-zinc-600 hover:text-zinc-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {filteredJobs.length === 0 ? (
        <div className="bg-white border border-zinc-200 rounded-lg p-12 text-center">
          <p className="text-sm font-medium text-zinc-900">
            {jobs.length === 0
              ? 'No hay descargas en tu cola todavía'
              : 'No hay descargas en esta categoría'}
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            Busca cualquier lista de YouTube, Spotify o Deezer por su nombre para comenzar.
          </p>
          {jobs.length === 0 && (
            <button
              type="button"
              onClick={onGoToSearch}
              className="mt-5 px-4 py-2 text-xs font-semibold bg-[#EA580C] hover:bg-[#DC4E07] text-white rounded-md transition-colors cursor-pointer"
            >
              Buscar listas
            </button>
          )}
        </div>
      ) : (
        <div className="bg-white border border-zinc-200 rounded-lg divide-y divide-zinc-200">
          {filteredJobs.map((job) => {
            const expanded = expandedIds.has(job.id);
            const isRunning =
              job.status === 'queued' ||
              job.status === 'downloading' ||
              job.status === 'packaging';

            return (
              <div key={job.id} className="p-5">
                <div className="flex flex-col md:flex-row md:items-center gap-4">
                  <div className="flex items-start gap-3.5 min-w-0 flex-1">
                    <PlaylistArtwork
                      src={job.thumbnailUrl}
                      alt={job.playlistTitle}
                      sizeClass="w-12 h-12"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-semibold text-zinc-900 truncate">
                          {job.playlistTitle}
                        </h3>
                        {job.isPrivate && (
                          <Lock
                            className="w-3.5 h-3.5 text-zinc-400 shrink-0"
                            aria-label="Lista privada"
                          />
                        )}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                        <span>{getPlatformLabel(job.platform)}</span>
                        <span aria-hidden="true">·</span>
                        <span className="uppercase font-mono">
                          {job.format}
                          {job.format !== 'flac' ? ` ${job.quality}k` : ''}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">
                          {job.completedTracks}/{job.totalTracks} pistas
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">
                          {formatBytes(job.totalBytes)}
                        </span>
                      </div>

                      <div className="mt-2.5 flex items-center gap-3">
                        <div className="flex-1 h-1.5 bg-zinc-100 rounded-full overflow-hidden max-w-md">
                          <div
                            className={`h-full transition-all duration-300 ${
                              job.status === 'completed'
                                ? 'bg-emerald-600'
                                : job.status === 'error' || job.status === 'cancelled'
                                ? 'bg-red-500'
                                : 'bg-[#EA580C]'
                            }`}
                            style={{ width: `${job.progress}%` }}
                          />
                        </div>
                        <span className="text-xs font-mono tabular-nums text-zinc-600 w-9 text-right">
                          {job.progress}%
                        </span>
                        <span
                          className={`inline-flex items-center gap-1.5 text-xs font-medium ${
                            job.status === 'completed'
                              ? 'text-emerald-700'
                              : job.status === 'error' || job.status === 'cancelled'
                              ? 'text-red-600'
                              : isRunning
                              ? 'text-amber-700'
                              : 'text-zinc-600'
                          }`}
                        >
                          {job.status === 'completed' && <CheckCircle2 className="w-3.5 h-3.5" />}
                          {isRunning && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                          {job.status === 'paused' && <Clock className="w-3.5 h-3.5" />}
                          {job.status === 'error' && <AlertCircle className="w-3.5 h-3.5" />}
                          {job.status === 'cancelled' && <XCircle className="w-3.5 h-3.5" />}
                          {getJobStatusLabel(job.status)}
                        </span>
                      </div>

                      {job.currentTrack && isRunning && (
                        <p className="mt-1.5 text-xs text-zinc-500 truncate">
                          Procesando: {job.currentTrack}
                        </p>
                      )}
                      {job.errorMessage && job.status === 'error' && (
                        <p className="mt-1.5 text-xs text-red-600">{job.errorMessage}</p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 flex-wrap">
                    {job.status === 'completed' && job.zipPath && (
                      <a
                        href={`/api/downloads/${job.id}/zip`}
                        className="px-3 py-1.5 text-xs font-semibold bg-[#EA580C] hover:bg-[#DC4E07] text-white rounded-md inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
                      >
                        <Archive className="w-3.5 h-3.5" />
                        Descargar ZIP
                      </a>
                    )}

                    {(job.status === 'downloading' || job.status === 'queued') && (
                      <button
                        type="button"
                        onClick={() => onPause(job.id)}
                        className="px-3 py-1.5 text-xs font-medium border border-zinc-200 hover:bg-zinc-50 text-zinc-700 rounded-md inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        <Pause className="w-3.5 h-3.5" />
                        Pausar
                      </button>
                    )}

                    {(job.status === 'paused' || job.status === 'error' || job.status === 'cancelled') && (
                      <button
                        type="button"
                        onClick={() => onResume(job.id)}
                        className="px-3 py-1.5 text-xs font-medium border border-zinc-200 hover:bg-zinc-50 text-zinc-700 rounded-md inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        {job.status === 'error' ? (
                          <RotateCcw className="w-3.5 h-3.5" />
                        ) : (
                          <Play className="w-3.5 h-3.5" />
                        )}
                        {job.status === 'error' ? 'Reintentar' : 'Reanudar'}
                      </button>
                    )}

                    {isRunning && (
                      <button
                        type="button"
                        onClick={() => onCancel(job.id)}
                        className="p-1.5 text-zinc-400 hover:text-zinc-700 rounded-md transition-colors cursor-pointer"
                        title="Cancelar"
                        aria-label="Cancelar descarga"
                      >
                        <XCircle className="w-4 h-4" />
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => toggleExpand(job.id)}
                      className="px-2.5 py-1.5 text-xs font-medium text-zinc-600 hover:text-zinc-900 rounded-md inline-flex items-center gap-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      Pistas
                      {expanded ? (
                        <ChevronUp className="w-3.5 h-3.5" />
                      ) : (
                        <ChevronDown className="w-3.5 h-3.5" />
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => onDelete(job.id)}
                      className="p-1.5 text-zinc-400 hover:text-red-600 rounded-md transition-colors cursor-pointer"
                      title="Eliminar"
                      aria-label="Eliminar descarga"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {expanded && job.tracks && job.tracks.length > 0 && (
                  <div className="mt-4 pt-3 border-t border-zinc-100 divide-y divide-zinc-100 max-h-72 overflow-y-auto">
                    {job.tracks.map((track) => (
                      <div
                        key={track.id}
                        className="py-2 flex items-center justify-between gap-3 text-xs"
                      >
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <span className="w-6 font-mono tabular-nums text-zinc-400 text-right shrink-0">
                            {String(track.trackIndex + 1).padStart(2, '0')}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="font-medium text-zinc-800 truncate">{track.title}</p>
                            <p className="text-zinc-500 truncate">{track.artist}</p>
                          </div>
                        </div>

                        <div className="flex items-center gap-4 shrink-0">
                          <span className="font-mono tabular-nums text-zinc-400 hidden sm:inline">
                            {formatDuration(track.durationSec)}
                          </span>
                          <span className="font-mono tabular-nums text-zinc-500 w-16 text-right">
                            {track.fileSize > 0 ? formatBytes(track.fileSize) : '—'}
                          </span>
                          {track.status === 'completed' && track.filePath ? (
                            <a
                              href={`/api/downloads/${job.id}/tracks/${track.id}/file`}
                              className="inline-flex items-center gap-1 text-[#EA580C] hover:underline font-medium whitespace-nowrap"
                            >
                              <Download className="w-3.5 h-3.5" />
                              Archivo
                            </a>
                          ) : track.status === 'downloading' ? (
                            <span className="text-amber-700 font-medium">Descargando</span>
                          ) : track.status === 'error' ? (
                            <span
                              className="text-red-600 font-medium"
                              title={track.errorMessage || 'Error'}
                            >
                              Error
                            </span>
                          ) : (
                            <span className="text-zinc-400">Pendiente</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
