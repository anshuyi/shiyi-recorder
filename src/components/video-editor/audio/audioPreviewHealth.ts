export interface PlaybackSample {
  now: number; videoTime: number; audioTime: number; target: number; rate: number;
  expected: boolean; seeking: boolean; paused: boolean; readyState: number; error: boolean;
}
export interface HealthState { last: PlaybackSample; suspectSince?: number; }
export function evaluateAudioHealth(previous: HealthState | undefined, sample: PlaybackSample): {
  state: HealthState; action: 'none' | 'wait' | 'recover'; reason: string;
} {
  const state: HealthState = {last:sample};
  const old=previous?.last, gap=old ? sample.now-old.now : 0;
  const reset=!sample.expected || sample.seeking || !old || gap<=0 || gap>1500 ||
    old.rate!==sample.rate || Math.abs(sample.target-old.target)>gap/1000*Math.max(sample.rate,old.rate)+.75;
  if(reset) return {state,action:'none',reason:'inactive-or-discontinuity'};
  if(sample.videoTime-old.videoTime<.02) return {state,action:'none',reason:'video-not-advancing'};
  const stalled=sample.paused || sample.error || sample.audioTime-old.audioTime<.01;
  if(!stalled && sample.readyState>=2) return {state,action:'none',reason:'clock-progress'};
  state.suspectSince=previous.suspectSince ?? sample.now;
  const delay=sample.readyState<2 && !sample.error ? 5000 : 2000;
  return {state,action:sample.now-state.suspectSince>=delay?'recover':'wait',reason:sample.error?'media-error':sample.readyState<2?'data-timeout':'audio-not-advancing'};
}
