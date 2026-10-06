import React from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { useSourceAudioFallback } from "@/components/video-editor/audio/useSourceAudioFallback";
import { useAudioPreviewSync } from "@/components/video-editor/audio/useAudioPreviewSync";

const bridge = (window as any).audioFinalizationTest;
const audios: HTMLAudioElement[] = [];
const OriginalAudio = window.Audio;
(window as any).Audio = function (...args: ConstructorParameters<typeof Audio>) {
  const audio = new OriginalAudio(...args); audios.push(audio); return audio;
};
(window as any).Audio.prototype = OriginalAudio.prototype;
const checks: string[] = [], errors: string[] = [], empty: any[] = [], gain = () => 1, summarize = (s: string) => s;
let props = { path: "", refresh: 0, playing: false, time: 0 }, api: ReturnType<typeof useAudioPreviewSync>;
function Harness() {
  const fallback = useSourceAudioFallback({ currentSourcePath: props.path, refreshKey: props.refresh, summarizeErrorMessage: summarize });
  api = useAudioPreviewSync({ audioRegions: empty, previewVolume: 1, isPlaying: props.playing,
    currentTime: props.time, timelineTime: props.time, duration: 12, effectiveSpeedRegions: empty,
    previewSourceAudioFallbackPaths: fallback.sourceAudioFallbackPaths,
    sourceAudioFallbackRevision: fallback.sourceAudioFallbackRevision,
    sourceAudioFallbackStartDelayMsByPath: fallback.sourceAudioFallbackStartDelayMsByPath,
    isCurrentClipMuted: false, getSourceTrackPreviewGain: gain,
    onSourceFallbackLoadError: e => errors.push(String(e)) });
  return null;
}
const root = createRoot(document.body.appendChild(document.createElement("div")));
const pause = (ms: number) => new Promise(r => setTimeout(r, ms));
async function until(test: () => boolean, label: string) {
  const deadline = performance.now() + 10000;
  while (!test()) { if (performance.now() > deadline) throw Error(label); await pause(25); }
}
function assert(ok: unknown, label: string) { if (!ok) throw Error(label); checks.push(label); }
async function render(next: Partial<typeof props>) { props = { ...props, ...next }; flushSync(() => root.render(<Harness/>)); await pause(80); }
function active() { return audios.filter(a => a.getAttribute("src")); }
async function loaded(duration: number) { await until(() => active().length === 1 && Math.abs(active()[0].duration - duration) < .01 && active()[0].readyState >= 2, `expected one ${duration}s audio`); return active()[0]; }
async function signal(audio: HTMLAudioElement) {
  const context = new AudioContext(), analyser = context.createAnalyser(), source = context.createMediaElementSource(audio), silent = context.createGain();
  silent.gain.value = 0; source.connect(analyser); analyser.connect(silent); silent.connect(context.destination); await context.resume();
  const buffer = new Float32Array(analyser.fftSize); let peak = 0;
  for (let i = 0; i < 10; i++) { await pause(40); analyser.getFloatTimeDomainData(buffer); for (const value of buffer) peak = Math.max(peak, Math.abs(value)); }
  source.disconnect(); await context.close(); return peak;
}
async function run() {
  const paths = await bridge.setup();
  await render({ path: paths.legacy }); const old = await loaded(2);
  await bridge.completeLegacy(); await pause(100);
  assert(Math.abs(old.duration - 2) < .01, "reproduces stale duration after same-path file completes");
  const oldUrl = old.src;
  await render({ refresh: 1 }); const renewed = await loaded(12);
  assert(renewed.src !== oldUrl, "completion lookup refreshes cached same-path audio");
  await render({ time: 6, playing: true }); await until(() => renewed.currentTime > 6.1 && !renewed.paused, "play past old cutoff");
  assert(await signal(renewed) > .01, "decoded signal exists after old cutoff");
  await render({ playing: false }); assert(renewed.paused, "pause stops refreshed audio");

  await render({ path: paths.retry, time: 0 }); const retry = await loaded(2);
  await bridge.completeRetry(); api.reloadSourceAudioPreview(); api.reloadSourceAudioPreview();
  const reloaded = await loaded(12);
  assert(active().length === 1 && reloaded === retry, "repeated manual reload keeps exactly one live audio element");
  await render({ time: 11, playing: true }); await until(() => reloaded.currentTime > 11.1 && !reloaded.paused, "seek near end");
  assert(await signal(reloaded) > .01, "manual reload restores signal near video end");
  await render({ playing: false });

  await bridge.startPublication();
  await render({ path: paths.atomic, time: 0 });
  assert(active().length === 0, "pending WAV is invisible to editor audio lookup");
  await bridge.finishPublication(); await render({ refresh: 2 }); const complete = await loaded(12);
  assert(Math.abs(complete.duration - 12) < .01, "published WAV loads its complete duration first time");

  await render({ path: paths.short, time: 6, playing: true }); const short = await loaded(2), shortUrl = short.src;
  await pause(1200);
  assert(short.paused && short.src === shortUrl, "legitimate short audio stays ended without reload loops");
  assert(errors.length === 0, "no unexpected audio load errors");
  flushSync(() => root.unmount());
  assert(active().length === 0, "all resources released on editor teardown");
  return { checks, success: true };
}
(window as any).smokePromise = run();
