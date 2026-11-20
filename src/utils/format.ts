import type { JobStatus, Platform } from '../types';

export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let idx = 0;
  let value = bytes;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  return `${value >= 10 || idx === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[idx]}`;
}

export function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return '--:--';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function getPlatformLabel(platform: Platform): string {
  switch (platform) {
    case 'youtube':
      return 'YouTube';
    case 'spotify':
      return 'Spotify';
    case 'deezer':
      return 'Deezer';
    case 'soundcloud':
      return 'SoundCloud';
    default:
      return 'Externa';
  }
}

export function getJobStatusLabel(status: JobStatus): string {
  switch (status) {
    case 'queued':
      return 'En cola';
    case 'downloading':
      return 'Descargando';
    case 'packaging':
      return 'Empaquetando';
    case 'completed':
      return 'Completada';
    case 'paused':
      return 'Pausada';
    case 'error':
      return 'Error';
    case 'cancelled':
      return 'Cancelada';
  }
}
