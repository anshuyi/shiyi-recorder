import React, { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { useAudioPreviewSync } from "@/components/video-editor/audio/useAudioPreviewSync";

const checks: string[] = [];
const audios: FakeAudio[] = [];
let requests: Array<{ path: string; resolve: (resource: unknown) => void; reject: (error: Error) => void }> = [];
let revocations = 0, errors: unknown[] = [], api: ReturnType<typeof useAudioPreviewSync>;
class FakeAudio {
  src = ""; dataset: Record<string,string> = {}; duration = 10; currentTime = 0;
  paused = true; volume = 1; muted = false; playbackRate = 1; playCalls = 0;
  failure: Error | null = null; error = null; readyState = 4;
  constructor() { audios.push(this); }
  getAttribute(name: string) { return name === "src" ? this.src : null; }
  load() {}
  play() { this.playCalls++; if (this.failure) return Promise.reject(this.failure); this.paused = false; return Promise.resolve(); }
  pause() { this.paused = true; }
}
(window as any).Audio = FakeAudio;
(window as any).resolveTestAudio = (path: string) => new Promise((resolve,reject) => requests.push({path,resolve,reject}));
const empty: any[] = [], gain = () => 1;
let props: any;
function Harness() {
  api = useAudioPreviewSync({ audioRegions: empty, previewVolume: 1, isPlaying: false,
    currentTime: 0, timelineTime: 0, duration: 10, effectiveSpeedRegions: empty,
    previewSourceAudioFallbackPaths: ["C:/a.mic.wav"], sourceAudioFallbackStartDelayMsByPath: {},
    isCurrentClipMuted: false, getSourceTrackPreviewGain: gain,
    ...props, onSourceFallbackLoadError: error => errors.push(error) });
  return null;
}
const wait = () => new Promise(resolve => setTimeout(resolve, 35));
function assert(ok: unknown, message: string) { if (!ok) throw Error(message); checks.push(message); }
function resolve(index: number) { requests[index].resolve({src:`blob:${requests[index].path}:${index}`,revoke:()=>revocations++}); }
async function setup(strict = false) {
  audios.length = 0; requests = []; errors = []; revocations = 0; props = {};
  const div = document.createElement("div"); document.body.append(div); const root = createRoot(div);
  const render = async (next: any = {}) => { props = {...props,...next}; flushSync(()=>root.render(strict ? <StrictMode><Harness/></StrictMode> : <Harness/>)); await wait(); };
  await render();
  return { render, close: async()=>{flushSync(()=>root.unmount());div.remove();await wait();} };
}

export async function run() {
  let test = await setup();
  resolve(0); await wait();
  await test.render({sourceAudioFallbackRevision:1});
  assert(requests.length===2,"completed same-path revision invalidates ready audio");
  resolve(1); await wait();
  api.reloadSourceAudioPreview(); await wait();
  assert(requests.length===3,"explicit reload invalidates even ready audio without media errors");
  resolve(2); await wait();
  await api.playSourceAudioPreview(); await wait();
  assert(requests.length===3,"ordinary play does not reload ready audio");
  await test.close();

  test = await setup();
  await test.render({previewVolume:.25}); await test.render({previewVolume:.5});
  resolve(0); await wait();
  assert(requests.length===1 && !!audios[0].src,"callback/volume rerenders retain one pending source load");
  assert(audios[0].volume===.5 && audios[0].paused,"late load uses current volume and remains paused");
  await test.close(); assert(revocations===1,"loaded resource revoked once on unmount");

  test = await setup(); await test.render({isPlaying:true}); await test.render({isPlaying:false});
  resolve(0); await wait(); assert(audios[0].paused && audios[0].playCalls===0,"pause during loading is respected"); await test.close();

  test = await setup(); await test.render({isPlaying:true,currentTime:2,timelineTime:2}); resolve(0); await wait();
  assert(!audios[0].paused && audios[0].currentTime===2,"audio arriving during playback starts at latest timeline position");
  await test.render({isCurrentClipMuted:true}); assert(audios[0].volume===0,"clip mute stays effective"); await test.close();

  test = await setup(); const old=audios[0]; await test.render({previewSourceAudioFallbackPaths:["C:/b.mic.wav"]});
  resolve(1); await wait(); resolve(0); await wait();
  assert(old.src==="" && audios[1].src.includes("b.mic"),"switching sources discards old pending result");
  assert(revocations===1,"stale source result is released"); await test.close();

  test = await setup(); await test.close(); resolve(0); await wait();
  assert(audios[0].src==="" && revocations===1,"unmounted pending source never revives");

  test = await setup(true); for(let i=0;i<requests.length;i++)resolve(i); await wait();
  assert(audios.some(a=>!!a.src),"StrictMode setup-cleanup-setup restores sound"); await test.close();

  test = await setup(); requests[0].reject(Error("transient")); await wait(); requests[1].reject(Error("missing")); await wait();
  await test.render({previewVolume:.7}); await test.render({currentTime:1});
  assert(requests.length===2 && errors.length===1,"failed source has bounded retries and one notification");
  const preparation = api.playSourceAudioPreview(); await wait(); resolve(2); await preparation; await wait();
  assert(!!audios[0].src,"explicit play retries a failed resource"); await test.close();

  test = await setup();
  // A real browser can resolve src="" to the current document URL.
  audios[0].src = "file:///editor.html";
  audios[0].getAttribute = () => "";
  await test.render({isPlaying:true});
  assert(audios[0].playCalls===0 && errors.length===0,"empty source attribute never plays the editor document");
  await test.close(); resolve(0); await wait();

  test = await setup(); await test.render({previewSourceAudioFallbackPaths:[],audioRegions:[{id:"music",audioPath:"C:/music.wav",startMs:0,endMs:10000,volume:1}]});
  await test.render({previewVolume:.3}); resolve(1); await wait();
  assert(audios[1].src.includes("music.wav") && audios[1].volume===.3,"user audio survives gain changes during loading");
  resolve(0); await wait(); await test.close();

  test = await setup(); resolve(0); await wait();
  audios[0].failure=Object.assign(Error("playback denied"),{name:"NotAllowedError"});
  await test.render({isPlaying:true}); await test.render({currentTime:1}); await test.render({currentTime:2});
  assert(errors.length===1,"playback errors are visible without repeated notifications"); await test.close();

  test = await setup(); resolve(0); await wait(); audios[0].failure=Object.assign(Error("paused"),{name:"AbortError"});
  await test.render({isPlaying:true}); assert(errors.length===0,"normal pause AbortError is not reported as a failure"); await test.close();

  test = await setup(); resolve(0); await wait();
  const clock={currentTime:3,paused:false,ended:false,seeking:false};
  await test.render({isPlaying:true,currentTime:1,timelineTime:1,getMainVideo:()=>clock});
  assert(!audios[0].paused&&audios[0].currentTime===3,"source sync reads actual video clock when React time lags");
  clock.paused=true;await test.render({currentTime:2});
  assert(audios[0].paused,"actual paused video prevents audio revival before React catches up");await test.close();

  test = await setup(); resolve(0); await wait();await test.render({isPlaying:true,currentTime:2});
  await test.render({previewVolume:0});assert(audios[0].volume===0&&audios[0].paused,"zero preview volume cannot trigger recovery playback");
  await test.render({previewVolume:1,getSourceTrackPreviewGain:()=>0});assert(audios[0].volume===0&&audios[0].paused,"disabled source gain stays silent");
  await test.render({getSourceTrackPreviewGain:gain,isCurrentClipMuted:true});assert(audios[0].volume===0&&audios[0].paused,"clip mute stops source preview");
  await test.render({isCurrentClipMuted:false,effectiveSpeedRegions:[{id:'slow',startMs:0,endMs:10000,speed:.5}]});
  assert(!audios[0].paused&&audios[0].playbackRate===.5,"unmute resumes with current slow playback rate");
  await test.render({effectiveSpeedRegions:[{id:'fast',startMs:0,endMs:10000,speed:2}]});
  assert(audios[0].playbackRate===2,"fast playback updates the same audio element");
  await test.render({currentTime:10});assert(audios[0].paused,"normal source ending does not restart audio");await test.close();
  return {checks};
}
(window as any).smokePromise=run();
