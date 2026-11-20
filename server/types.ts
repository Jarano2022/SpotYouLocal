export type Platform = 'youtube' | 'spotify' | 'deezer' | 'soundcloud' | 'other';
export type AudioFormat = 'mp3' | 'm4a' | 'opus' | 'flac';
export type AudioQuality = '320' | '256' | '192' | '128';
export type JobStatus =
  | 'queued'
  | 'downloading'
  | 'packaging'
  | 'completed'
  | 'paused'
  | 'error'
  | 'cancelled';

export type TrackStatus =
  | 'pending'
  | 'downloading'
  | 'converting'
  | 'completed'
  | 'error';

export interface PlaylistTrack {
  id: string;
  title: string;
  artist: string;
  album: string;
  durationSec: number;
  sourceUrl: string;
  thumbnailUrl?: string;
}

export interface PlaylistSummary {
  id: string;
  title: string;
  author: string;
  platform: Platform;
  url: string;
  thumbnailUrl: string;
  trackCount: number;
  isPrivate: boolean;
  isOwned?: boolean;
  description?: string;
}

export interface PlaylistDetail extends PlaylistSummary {
  tracks: PlaylistTrack[];
}

export interface DownloadTrackRecord {
  id: string;
  jobId: string;
  trackIndex: number;
  title: string;
  artist: string;
  album: string;
  durationSec: number;
  sourceUrl: string;
  status: TrackStatus;
  filePath: string | null;
  fileSize: number;
  errorMessage: string | null;
}

export interface DownloadJobRecord {
  id: string;
  sessionId: string;
  playlistTitle: string;
  playlistAuthor: string;
  platform: Platform;
  playlistUrl: string;
  thumbnailUrl: string;
  isPrivate: boolean;
  format: AudioFormat;
  quality: AudioQuality;
  status: JobStatus;
  totalTracks: number;
  completedTracks: number;
  currentTrack: string | null;
  progress: number;
  totalBytes: number;
  outputPath: string | null;
  zipPath: string | null;
  errorMessage: string | null;
  createdAt: number;
  updatedAt: number;
  tracks?: DownloadTrackRecord[];
}

export interface AuthProviderStatus {
  connected: boolean;
  configured: boolean;
  displayName: string | null;
  avatarUrl: string | null;
  accountId: string | null;
}

export interface AuthStatusResponse {
  spotify: AuthProviderStatus;
  youtube: AuthProviderStatus;
  hasCookiesTxt: boolean;
  callbackUrls: {
    spotify: string;
    youtube: string;
  };
}

export interface SystemSettings {
  concurrency: number;
  defaultFormat: AudioFormat;
  defaultQuality: AudioQuality;
  filenameTemplate: string;
  downloadDir: string;
  hasYtDlp: boolean;
  hasFfmpeg: boolean;
  diskUsedBytes: number;
  totalFilesCount: number;
}
