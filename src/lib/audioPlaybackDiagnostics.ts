export type AudioPlaybackEvent = 'sample'|'fault'|'recovering'|'recovered'|'failed'|'cancelled'|'manual-retry'|'snapshot'|'devicechange'|'visibilitychange'|'play'|'playing'|'pause'|'waiting'|'stalled'|'seeking'|'seeked'|'ended'|'error'|'emptied'|'play-rejected'|'attached'|'removed';
export interface AudioPlaybackDiagnostic {
  session: string; track: string; event: AudioPlaybackEvent; now: number;
  videoTime?: number; audioTime?: number; target?: number; rate?: number;
  volume?: number; readyState?: number; networkState?: number; errorCode?: number;
  expected?: boolean; paused?: boolean; ended?: boolean; seeking?: boolean; muted?: boolean;
  hidden?: boolean; generation?: number; bufferedEnd?: number;
}
