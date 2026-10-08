import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AudioPreviewMonitor, type AudioTarget } from "./audioPreviewMonitor";
import { PreviewAudioResources } from "./previewAudioResource";
import { waitForPreviewAudio } from "./previewAudioReadiness";
import { buildResolvedAudioPlan } from "@/lib/exporter/audioRoutingEngine";
import { resolveMediaElementSource } from "@/lib/exporter/localMediaSource";
import {
  clampMediaTimeToDuration,
  enablePitchPreservingPlayback,
  estimateCompanionAudioStartDelaySeconds,
  getMediaSyncPlaybackRate,
} from "@/lib/mediaTiming";
import type { AudioRegion, SpeedRegion } from "../types";

const SOURCE_AUDIO_PREVIEW_PLAYING_SEEK_DRIFT_SECONDS = 0.18;
const SOURCE_AUDIO_PREVIEW_PAUSED_SEEK_DRIFT_SECONDS = 0.01;

interface UseAudioPreviewSyncParams {
  audioRegions: AudioRegion[];
  previewVolume: number;
  isPlaying: boolean;
  currentTime: number;
  timelineTime: number;
  duration: number;
  effectiveSpeedRegions: SpeedRegion[];
  sourceAudioFallbackRevision?: number;
  sourceAudioFallbackLoading?: boolean;
  sourceAudioFallbackError?: unknown;
  previewSourceAudioFallbackPaths: string[];
  sourceAudioFallbackStartDelayMsByPath: Record<string, number>;
  isCurrentClipMuted: boolean;
  getSourceTrackPreviewGain: (audioPath: string) => number;
  onSourceFallbackLoadError: (error: unknown) => void;
  getMainVideo?: () => HTMLVideoElement | null;
  onPlaybackHealth?: (status: "recovering" | "recovered" | "failed" | "cancelled") => void;
}

export function useAudioPreviewSync({
  audioRegions,
  previewVolume,
  isPlaying,
  currentTime,
  timelineTime,
  duration,
  effectiveSpeedRegions,
  sourceAudioFallbackRevision = 0,
  sourceAudioFallbackLoading = false,
  sourceAudioFallbackError,
  previewSourceAudioFallbackPaths,
  sourceAudioFallbackStartDelayMsByPath,
  isCurrentClipMuted,
  getSourceTrackPreviewGain,
  onSourceFallbackLoadError,
  getMainVideo,
  onPlaybackHealth,
}: UseAudioPreviewSyncParams) {
  const resolvedPlan = useMemo(
    () =>
      buildResolvedAudioPlan({
        videoResource: null,
        sourceAudioFallbackPaths: previewSourceAudioFallbackPaths,
        audioRegions,
      }),
    [audioRegions, previewSourceAudioFallbackPaths],
  );
  const resolvedUserTracks = useMemo(
    () => resolvedPlan.tracks.filter((track) => track.kind === "user"),
    [resolvedPlan],
  );
  const resolvedSourceTracks = useMemo(
    () => resolvedPlan.tracks.filter((track) => track.kind !== "user"),
    [resolvedPlan],
  );

  const audioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const [userResources] = useState(() => new PreviewAudioResources(resolveMediaElementSource));
  const [sourceResources] = useState(() => new PreviewAudioResources(resolveMediaElementSource));
  const [resourceVersion, setResourceVersion] = useState(0);
  const errorHandlerRef = useRef(onSourceFallbackLoadError);
  errorHandlerRef.current = onSourceFallbackLoadError;
  const reportedPlaybackErrorsRef = useRef(new WeakSet<HTMLAudioElement>());
  const sourceAudioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const sourceAudioMediaNodesRef = useRef<Map<string, MediaElementAudioSourceNode>>(new Map());
  const sourceAudioGainNodesRef = useRef<Map<string, GainNode>>(new Map());
  const sourceAudioContextRef = useRef<AudioContext | null>(null);
  const sourceAudioMasterGainRef = useRef<GainNode | null>(null);
  const sourceAudioResumePromiseRef = useRef<Promise<void> | null>(null);
  const lastSourceAudioSyncTimeRef = useRef<number | null>(null);

  const ensureSourceAudioContext = useCallback(() => {
    if (!sourceAudioContextRef.current) {
      const context = new AudioContext({ latencyHint: "interactive" });
      const masterGain = context.createGain();
      masterGain.gain.value = 1;
      masterGain.connect(context.destination);
      sourceAudioContextRef.current = context;
      sourceAudioMasterGainRef.current = masterGain;
    }
    return sourceAudioContextRef.current;
  }, []);

  const ensureSourceAudioRunning = useCallback(() => {
    const context = ensureSourceAudioContext();
    if (context.state === "running") {
      return Promise.resolve();
    }
    if (!sourceAudioResumePromiseRef.current) {
      sourceAudioResumePromiseRef.current = context
        .resume()
        .catch(() => undefined)
        .finally(() => {
          sourceAudioResumePromiseRef.current = null;
        });
    }
    return sourceAudioResumePromiseRef.current;
  }, [ensureSourceAudioContext]);

  const latest = useRef({getMainVideo,onPlaybackHealth,isPlaying,currentTime,timelineTime,duration,effectiveSpeedRegions,isCurrentClipMuted,previewVolume,getSourceTrackPreviewGain,sourceAudioFallbackStartDelayMsByPath,resolvedUserTracks});
  latest.current={getMainVideo,onPlaybackHealth,isPlaying,currentTime,timelineTime,duration,effectiveSpeedRegions,isCurrentClipMuted,previewVolume,getSourceTrackPreviewGain,sourceAudioFallbackStartDelayMsByPath,resolvedUserTracks};
  const trackInfo=useRef(new WeakMap<HTMLAudioElement,{path:string;userId?:string;revision?:number}>());
  const sourceRevisionRef = useRef(sourceAudioFallbackRevision);
  sourceRevisionRef.current = sourceAudioFallbackRevision;
  const manualReloadPending = useRef(false);
  const preparation = useRef({ sourceAudioFallbackLoading, sourceAudioFallbackError, resolvedSourceTracks, resolvedUserTracks });
  preparation.current = { sourceAudioFallbackLoading, sourceAudioFallbackError, resolvedSourceTracks, resolvedUserTracks };
  const targetFor=useCallback((audio:HTMLAudioElement):AudioTarget=>{
    const p=latest.current,video=p.getMainVideo?.(),info=trackInfo.current.get(audio);
    const videoTime=video?.currentTime??p.currentTime;
    const playing=p.isPlaying && (!video || (!video.paused&&!video.ended));
    const seeking=Boolean(video?.seeking);
    const speed=p.effectiveSpeedRegions.find(r=>videoTime*1000>=r.startMs&&videoTime*1000<r.endMs)?.speed??1;
    const audioDuration=Number.isFinite(audio.duration)?audio.duration:null;
    if(info?.userId){
      const track=p.resolvedUserTracks.find(t=>t.id===info.userId);
      // Advance from the latest mapped timeline position using the actual video clock.
      const time=p.timelineTime+(videoTime-p.currentTime);
      const target=track?(time*1000-track.timelineBinding.startMs)/1000:0;
      const inRegion=Boolean(track&&time*1000>=track.timelineBinding.startMs&&time*1000<track.timelineBinding.endMs);
      return {target:Math.max(0,target),rate:speed,videoTime,seeking,expected:playing&&inRegion&&p.previewVolume>0&&(track?.gain??0)>0&&!audio.muted&&(audioDuration===null||target<audioDuration-.001)};
    }
    const audioPath=info?.path??audio.dataset.sourceAudioPath??'';
    const isMic=/\.mic\./i.test(audioPath);
    const raw=estimateCompanionAudioStartDelaySeconds(p.duration,audioDuration,p.sourceAudioFallbackStartDelayMsByPath[audioPath]);
    const delay=isMic?0:Number.isFinite(p.duration)&&(raw>=Math.max(0,p.duration-.01)||raw>Math.max(5,p.duration*.9))?0:raw;
    const rawTarget=videoTime-delay;
    return {target:clampMediaTimeToDuration(rawTarget,audioDuration),rate:speed,videoTime,seeking,expected:playing&&rawTarget>=-.001&&(audioDuration===null||rawTarget<audioDuration-.001)&&!p.isCurrentClipMuted&&p.previewVolume>0&&p.getSourceTrackPreviewGain(audioPath)>0&&!audio.muted};
  },[]);
  const [monitor]=useState(()=>new AudioPreviewMonitor({target:targetFor,report:d=>window.electronAPI?.reportAudioPlaybackDiagnostic?.(d),status:s=>latest.current.onPlaybackHealth?.(s)}));
  useEffect(()=>{
    const timer=window.setInterval(()=>monitor.tick(),500);
    const device=()=>monitor.snapshot('devicechange'),visible=()=>monitor.snapshot('visibilitychange');
    navigator.mediaDevices?.addEventListener?.('devicechange',device);
    document.addEventListener('visibilitychange',visible);
    return ()=>{window.clearInterval(timer);navigator.mediaDevices?.removeEventListener?.('devicechange',device);document.removeEventListener('visibilitychange',visible);monitor.clear();};
  },[monitor]);

  const reportPlaybackError = useCallback((audio: HTMLAudioElement, error: unknown) => {
    if ((error as { name?: string })?.name === "AbortError") return;
    if (!audio.getAttribute("src") || reportedPlaybackErrorsRef.current.has(audio)) return;
    reportedPlaybackErrorsRef.current.add(audio);
    errorHandlerRef.current(error);
  }, []);

  const playAudio = useCallback((audio: HTMLAudioElement) => {
    if (!audio.getAttribute("src")) return;
    monitor.requestPlay(audio, (error: unknown) => reportPlaybackError(audio, error));
  }, [reportPlaybackError, monitor]);

  const onResourceLoaded = useCallback(() => {
    setResourceVersion(value => value + 1);
    const elements = [...sourceAudioElementsRef.current.values(), ...audioElementsRef.current.values()];
    if (manualReloadPending.current && elements.length > 0 && elements.every(audio => audio.readyState >= 2 && !audio.error)) {
      manualReloadPending.current = false;
      latest.current.onPlaybackHealth?.("recovered");
    }
  }, []);
  const onResourceError = useCallback((error: unknown) => {
    errorHandlerRef.current(error);
    if (manualReloadPending.current) {
      manualReloadPending.current = false;
      latest.current.onPlaybackHealth?.("failed");
    }
  }, []);

  const playSourceAudioPreview = useCallback(async (signal?: AbortSignal) => {
    monitor.retry();
    userResources.retryFailed();
    sourceResources.retryFailed();
    reportedPlaybackErrorsRef.current = new WeakSet();
    setResourceVersion((value) => value + 1);
    await waitForPreviewAudio(() => {
      const p = preparation.current;
      return {
        loading: p.sourceAudioFallbackLoading,
        error: p.sourceAudioFallbackError,
        tracks: [
          ...p.resolvedSourceTracks.map(track => sourceAudioElementsRef.current.get(track.sourceRef.path)),
          ...p.resolvedUserTracks.map(track => audioElementsRef.current.get(track.id)),
        // Clearing src during retry leaves the old decode error on Chromium's element.
        // Until the replacement URL is assigned it is pending, not a failed new load.
        ].map(audio => audio?.getAttribute("src") ? audio : undefined),
      };
    }, signal);
    // Actual audio starts from the normal synchronization effect once video plays.
  }, [sourceResources, userResources, monitor]);

  const reloadSourceAudioPreview = useCallback(() => {
    manualReloadPending.current = true;
    latest.current.onPlaybackHealth?.("recovering");
    for (const audio of [...sourceAudioElementsRef.current.values(), ...audioElementsRef.current.values()]) monitor.detach(audio, false);
    userResources.clear();
    sourceResources.clear();
    reportedPlaybackErrorsRef.current = new WeakSet();
    setResourceVersion(value => value + 1);
    void ensureSourceAudioRunning();
  }, [monitor, userResources, sourceResources, ensureSourceAudioRunning]);

  useEffect(() => {
    const existing = audioElementsRef.current;
    const currentIds = new Set(resolvedUserTracks.map((track) => track.id));

    for (const [id, audio] of existing) {
      if (!currentIds.has(id)) {
        audio.pause();
        audio.src = "";
        monitor.detach(audio);
        audio.onerror = null;
        userResources.release(id);
        existing.delete(id);
      }
    }

    for (const track of resolvedUserTracks) {
      let audio = existing.get(track.id);
      if (!audio) {
        audio = new Audio();
        audio.preload = "auto";
        const element = audio;
        audio.onerror = () => reportPlaybackError(element, new Error("Audio preview could not load the media file."));
        existing.set(track.id, audio);
      }

      const prior=trackInfo.current.get(audio);
      if(prior&&prior.path!==track.sourceRef.path)monitor.detach(audio);
      trackInfo.current.set(audio,{path:track.sourceRef.path,userId:track.id});
      const element=audio;
      monitor.attach(audio,"user",()=>{userResources.release(track.id);userResources.load(track.id,element,track.sourceRef.path,{onLoaded:onResourceLoaded,onError:onResourceError});});
      userResources.load(track.id, audio, track.sourceRef.path, { onLoaded: onResourceLoaded, onError: onResourceError });

      audio.volume = Math.max(0, Math.min(1, track.gain * previewVolume));
    }

  }, [previewVolume, resolvedUserTracks, userResources, onResourceLoaded, onResourceError, reportPlaybackError, resourceVersion]);

  useEffect(() => {
    const existing = sourceAudioElementsRef.current;
    const currentIds = new Set(resolvedSourceTracks.map((track) => track.sourceRef.path));

    for (const [id, audio] of existing) {
      if (!currentIds.has(id)) {
        audio.pause();
        audio.src = "";
        sourceAudioMediaNodesRef.current.get(id)?.disconnect();
        sourceAudioMediaNodesRef.current.delete(id);
        sourceAudioGainNodesRef.current.get(id)?.disconnect();
        sourceAudioGainNodesRef.current.delete(id);
        monitor.detach(audio);
        audio.onerror = null;
        sourceResources.release(id);
        existing.delete(id);
      }
    }

    for (const track of resolvedSourceTracks) {
      const audioPath = track.sourceRef.path;
      let audio = existing.get(audioPath);
      if (!audio) {
        audio = new Audio();
        audio.preload = "auto";
        audio.crossOrigin = "anonymous";
        const element = audio;
        audio.onerror = () => reportPlaybackError(element, new Error("Recorded audio preview could not load the media file."));
        existing.set(audioPath, audio);
      }
      audio.volume = 1;
      audio.dataset.sourceAudioPath = audioPath;

      // Web Audio API createMediaElementSource breaks preservesPitch on Chromium.
      // We route directly through the HTMLAudioElement to ensure pitch preservation works
      // during speed changes. Note: this limits maximum preview volume to 1.0 (100%).

      const previous = trackInfo.current.get(audio);
      if (previous && previous.revision !== sourceAudioFallbackRevision) monitor.detach(audio);
      trackInfo.current.set(audio,{path:audioPath,revision:sourceAudioFallbackRevision});
      const element=audio;
      monitor.attach(audio,/\.mic\./i.test(audioPath)?"mic":"source",()=>{sourceResources.release(audioPath);sourceResources.load(audioPath,element,audioPath,{onLoaded:onResourceLoaded,onError:onResourceError},sourceRevisionRef.current);});
      sourceResources.load(audioPath, audio, audioPath, { onLoaded: onResourceLoaded, onError: onResourceError }, sourceAudioFallbackRevision);

      audio.volume = Math.max(0, Math.min(1, getSourceTrackPreviewGain(audioPath) * (isCurrentClipMuted ? 0 : previewVolume)));
    }

    if (sourceAudioMasterGainRef.current) {
      sourceAudioMasterGainRef.current.gain.value = isCurrentClipMuted
        ? 0
        : Math.max(0, Math.min(1, previewVolume));
    }

    if (resolvedSourceTracks.length === 0) {
      lastSourceAudioSyncTimeRef.current = null;
    }

  }, [
    getSourceTrackPreviewGain,
    isPlaying,
    isCurrentClipMuted,
    resolvedSourceTracks,
    previewVolume,
    sourceResources,
    sourceAudioFallbackRevision,
    onResourceLoaded,
    onResourceError,
    reportPlaybackError,
    resourceVersion,
  ]);

  useEffect(() => {
    return () => {
      for (const audio of audioElementsRef.current.values()) {
        monitor.detach(audio);
        audio.onerror = null;
        audio.pause();
        audio.src = "";
      }
      userResources.clear();
      sourceResources.clear();
      audioElementsRef.current.clear();
      for (const audio of sourceAudioElementsRef.current.values()) {
        monitor.detach(audio);
        audio.onerror = null;
        audio.pause();
        audio.src = "";
      }
      for (const node of sourceAudioMediaNodesRef.current.values()) {
        node.disconnect();
      }
      for (const node of sourceAudioGainNodesRef.current.values()) {
        node.disconnect();
      }
      sourceAudioElementsRef.current.clear();
      sourceAudioMediaNodesRef.current.clear();
      sourceAudioGainNodesRef.current.clear();
      if (sourceAudioMasterGainRef.current) {
        sourceAudioMasterGainRef.current.disconnect();
        sourceAudioMasterGainRef.current = null;
      }
      const context = sourceAudioContextRef.current;
      sourceAudioContextRef.current = null;
      sourceAudioResumePromiseRef.current = null;
      if (context) {
        void context.close();
      }
      lastSourceAudioSyncTimeRef.current = null;
    };
  }, [userResources, sourceResources]);

  useEffect(() => {
    const currentTimeMs = timelineTime * 1000;
    const activeSpeedRegion = effectiveSpeedRegions.find(
      (region) => currentTimeMs >= region.startMs && currentTimeMs < region.endMs,
    );
    const targetPlaybackRate = activeSpeedRegion ? activeSpeedRegion.speed : 1;

    for (const track of resolvedUserTracks) {
      const audio = audioElementsRef.current.get(track.id);
      if (!audio) continue;
      if (isPlaying && !monitor.canSynchronize(audio)) continue;

      const startMs = track.timelineBinding.startMs;
      const endMs = track.timelineBinding.endMs;
      const isInRegion = currentTimeMs >= startMs && currentTimeMs < endMs;

      if (isPlaying && isInRegion) {
        enablePitchPreservingPlayback(audio);
        const audioOffset = (currentTimeMs - startMs) / 1000;
        if (Math.abs(audio.currentTime - audioOffset) > 0.2) {
          audio.currentTime = audioOffset;
        }
        const syncedPlaybackRate = getMediaSyncPlaybackRate({
          basePlaybackRate: targetPlaybackRate,
          currentTime: audio.currentTime,
          targetTime: audioOffset,
        });
        if (Math.abs(audio.playbackRate - syncedPlaybackRate) > 0.001) {
          audio.playbackRate = syncedPlaybackRate;
        }
        if (audio.paused) {
          playAudio(audio);
        }
      } else if (!audio.paused) {
        audio.pause();
      }
    }
  }, [effectiveSpeedRegions, isPlaying, resolvedUserTracks, timelineTime, resourceVersion, playAudio]);

  useEffect(() => {
    if (resolvedSourceTracks.length === 0) {
      lastSourceAudioSyncTimeRef.current = null;
      return;
    }

    const activeSpeedRegion = effectiveSpeedRegions.find(
      (region) => currentTime * 1000 >= region.startMs && currentTime * 1000 < region.endMs,
    );
    const targetPlaybackRate = activeSpeedRegion ? activeSpeedRegion.speed : 1;
    const previousTimelineTime = lastSourceAudioSyncTimeRef.current;
    const timelineJumped =
      previousTimelineTime === null || Math.abs(currentTime - previousTimelineTime) > 0.25;
    const driftThreshold = isPlaying
      ? SOURCE_AUDIO_PREVIEW_PLAYING_SEEK_DRIFT_SECONDS
      : SOURCE_AUDIO_PREVIEW_PAUSED_SEEK_DRIFT_SECONDS;
    if (sourceAudioMasterGainRef.current) {
      sourceAudioMasterGainRef.current.gain.value = isCurrentClipMuted
        ? 0
        : Math.max(0, Math.min(1, previewVolume));
    }

    for (const audio of sourceAudioElementsRef.current.values()) {
      const sourceAudioPath = audio.dataset.sourceAudioPath ?? "";
      audio.volume = Math.max(0, Math.min(1, getSourceTrackPreviewGain(sourceAudioPath) * (isCurrentClipMuted ? 0 : previewVolume)));

      enablePitchPreservingPlayback(audio);
      const audioDuration = Number.isFinite(audio.duration) ? audio.duration : null;
      const desired=targetFor(audio);
      const targetTime=desired.target;
      if(isPlaying && !monitor.canSynchronize(audio))continue;

      const shouldSeek =
        timelineJumped ||
        (!isPlaying && Math.abs(audio.currentTime - targetTime) > driftThreshold) ||
        (isPlaying && Math.abs(audio.currentTime - targetTime) > 0.9);
      if (shouldSeek) {
        try {
          audio.currentTime = targetTime;
        } catch {
          // no-op
        }
      }

      // KISS for companion source tracks: fixed playback rate avoids audible flutter/stutter
      // from continuous micro-corrections on system audio.
      const syncedPlaybackRate = targetPlaybackRate;
      if (Math.abs(audio.playbackRate - syncedPlaybackRate) > 0.001) {
        audio.playbackRate = syncedPlaybackRate;
      }

      const atEnd = audioDuration !== null && targetTime >= audioDuration;
      if (desired.expected && !atEnd) {
        playAudio(audio);
      } else if (!audio.paused) {
        audio.pause();
      }
    }

    lastSourceAudioSyncTimeRef.current = currentTime;
  }, [
    currentTime,
    duration,
    effectiveSpeedRegions,
    getSourceTrackPreviewGain,
    isCurrentClipMuted,
    isPlaying,
    previewVolume,
    resolvedSourceTracks,
    sourceAudioFallbackStartDelayMsByPath,
    playAudio,
    resourceVersion,
  ]);

  const savePlaybackDiagnostic=useCallback(async()=>{monitor.snapshot();return window.electronAPI?.saveAudioPlaybackDiagnostic?.();},[monitor]);
  return { playSourceAudioPreview, reloadSourceAudioPreview, savePlaybackDiagnostic };
}
