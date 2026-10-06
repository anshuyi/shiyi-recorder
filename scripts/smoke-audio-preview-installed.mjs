import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import { connectPage, pause, waitFor } from './lib/recordly-test-client.mjs';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
const installed = process.argv.includes('--installed');
const inputArgument = process.argv.find(a => a.startsWith('--input='))?.slice(8);
const out = path.join(root, '.tmp/audio-preview-installed', `${installed ? 'installed' : 'packaged'}-${Date.now()}`);
await fs.mkdir(out, { recursive: true });
const exe = process.argv.find(a => a.startsWith("--exe="))?.slice(6) || (installed ? path.join(process.env.LOCALAPPDATA, 'Programs/recordly/Recordly.exe') : path.join(root, 'release/screen-layout/win-unpacked/Recordly.exe'));
const ffmpeg = require('ffmpeg-static');
function encode(args) {
  const result = spawnSync(ffmpeg, ['-y', '-v', 'error', ...args], { windowsHide: true, encoding: 'utf8' });
  if (result.status !== 0) throw Error(result.stderr);
}
const input = inputArgument || path.join(out, 'screen.mp4');
let completeMic;
if (!inputArgument) {
  encode(['-f', 'lavfi', '-i', 'color=c=blue:s=640x360:r=30:d=8', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', input]);
  encode(['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=8', '-c:a', 'pcm_s16le', input.replace(/\.mp4$/, '.mic.wav')]);
}
if (!inputArgument) {
  const mic = input.replace(/\.mp4$/, '.mic.wav');
  completeMic = await fs.readFile(mic);
  const dataOffset = completeMic.indexOf(Buffer.from('data'));
  if (dataOffset < 0) throw Error('Fixture has no PCM data');
  const partial = Buffer.from(completeMic.subarray(0, dataOffset + 8 + 2 * 48000 * 2));
  partial.writeUInt32LE(0xffffffff, 4); partial.writeUInt32LE(0xffffffff, dataOffset + 4);
  await fs.writeFile(mic, partial);
}
const env = { ...process.env, RECORDLY_DEV_OPEN_RECORDING_INPUT: input };
delete env.ELECTRON_RUN_AS_NODE;
delete env.VITE_DEV_SERVER_URL;
const log = await fs.open(path.join(out, 'app.log'), 'w');
const child = spawn(exe, [`--user-data-dir=${path.join(out, 'profile')}`, '--remote-debugging-port=9367', '--remote-debugging-address=127.0.0.1', '--disable-background-timer-throttling', '--mute-audio'], { env, windowsHide: true, stdio: ['ignore', log.fd, log.fd] });
let client;
const checks = [];
const assert = (ok, message) => { if (!ok) throw Error(message); checks.push(message); };
try {
  const page = await waitFor(async () => (await (await fetch('http://127.0.0.1:9367/json/list')).json()).find(p => p.url.includes('windowType=editor')), 'editor');
  client = await connectPage(page);
  const { evaluate: ev, send } = client;
  await send('Page.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__testAudio=[];const OriginalAudio=window.Audio;window.Audio=function(...args){const a=new OriginalAudio(...args);window.__testAudio.push(a);return a};window.Audio.prototype=OriginalAudio.prototype;` });
  await send('Page.reload');
  await waitFor(() => ev(`window.__testAudio?.some(a=>a.src && a.readyState>=3)`), 'companion audio ready');
  if (completeMic) {
    const shortDuration = await ev(`window.__testAudio.find(a=>a.src&&a.readyState>=3).duration`);
    assert(Math.abs(shortDuration - 2) < .01, 'Actual editor reproduces truncated audio duration');
    await fs.writeFile(input.replace(/\.mp4$/, '.mic.wav'), completeMic);
    await ev(`window.electronAPI.setCurrentRecordingSession({videoPath:${JSON.stringify(input)}})`);
    await waitFor(() => ev(`window.__testAudio.filter(a=>a.getAttribute('src')).length===1 && window.__testAudio.some(a=>a.getAttribute('src')&&a.duration>7.9&&a.readyState>=3)`), 'actual recording-session-changed refreshes full audio');
    assert(true, 'Actual completion event refreshes same-path audio to full duration');
  }
  const before = await ev(`window.__testAudio.map(a=>({src:a.src,readyState:a.readyState,volume:a.volume,muted:a.muted}))`);
  assert(before.some(a => a.src && a.readyState >= 3), 'Companion audio loaded in actual editor');
  const result = await send('Runtime.evaluate', { expression: `(async()=>{const a=window.__testAudio.find(a=>a.src&&a.readyState>=3);const ctx=new AudioContext();const analyser=ctx.createAnalyser();const source=ctx.createMediaElementSource(a);source.connect(analyser);analyser.connect(ctx.destination);await ctx.resume();document.querySelector('button[title="Play"],button[title="播放"]').click();let peak=0;const samples=new Float32Array(analyser.fftSize);for(let i=0;i<30;i++){await new Promise(r=>setTimeout(r,100));analyser.getFloatTimeDomainData(samples);peak=Math.max(peak,...samples.map(Math.abs));}return {peak,time:a.currentTime,paused:a.paused,volume:a.volume,muted:a.muted,error:a.error?.message}})()`, awaitPromise: true, returnByValue: true, userGesture: true });
  if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
  const playing = result.result.value;
  assert(playing.peak > 0.001 && playing.time > 1 && !playing.paused && !playing.muted && playing.volume > 0, 'Decoded audio signal reaches playback output');
  await ev(`document.querySelector('button[title="Pause"],button[title="暂停"]').click()`);
  await pause(200);
  assert(await ev(`window.__testAudio.filter(a=>a.src).every(a=>a.paused)`), 'Pause stops companion audio');
  // Exercise the packaged main-process handler, not just the standalone publication helper.
  const rawMic = path.join(out, 'ipc-input.webm'), ipcVideo = path.join(out, 'ipc-screen.mp4');
  encode(['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=8', '-c:a', 'libopus', rawMic]);
  const encoded = (await fs.readFile(rawMic)).toString('base64');
  const saved = await ev(`window.electronAPI.storeMicrophoneSidecar(Uint8Array.from(atob(${JSON.stringify(encoded)}), c=>c.charCodeAt(0)).buffer,${JSON.stringify(ipcVideo)},{startDelayMs:418,browserMicrophoneProfile:'processed'})`);
  assert(saved.success, 'Packaged microphone save handler succeeds');
  const meta = JSON.parse(await fs.readFile(saved.path + '.json', 'utf8'));
  assert(meta.startDelayMs === 418, 'Packaged microphone save preserves timing metadata');
  const checkTail = spawnSync(ffmpeg, ['-ss', '7', '-i', saved.path, '-vn', '-af', 'volumedetect', '-f', 'null', '-'], {windowsHide:true,encoding:'utf8'});
  const tailLevel = /max_volume: ([-\d.]+) dB/.exec(checkTail.stderr);
  assert(checkTail.status === 0 && tailLevel && Number(tailLevel[1]) > -40, 'Packaged microphone output includes non-silent final second');
  let exportReport;
  if (!inputArgument) {
    const project = path.join(out, 'audio.recordly'), output = path.join(out, 'export.mp4');
    await fs.writeFile(project, JSON.stringify({ version: 1, videoPath: input, editor: { aspectRatio: '16:9', zoomRegions: [], showCursor: false, webcam: { enabled: false } } }));
    const url = new URL(page.url);
    url.searchParams.delete('devOpenInput');
    for (const [k, v] of Object.entries({ smokeExport: '1', smokeProject: project, smokeOutput: output, smokePipelineModel: 'modern', smokeBackendPreference: 'auto', smokeUseNativeExport: '1', smokeQuality: 'high', smokeFps: '30' })) url.searchParams.set(k, v);
    await send('Page.navigate', { url: url.href });
    exportReport = await waitFor(async () => JSON.parse(await fs.readFile(output + '.report.json', 'utf8')), 'export audio fixture', 90000);
    assert(exportReport.success, 'Actual editor MP4 export succeeds');
    const volume = spawnSync(ffmpeg, ['-ss', '6', '-i', output, '-vn', '-af', 'volumedetect', '-f', 'null', '-'], { windowsHide: true, encoding: 'utf8' });
    const max = /max_volume: ([-\d.]+) dB/.exec(volume.stderr);
    assert(volume.status === 0 && max && Number(max[1]) > -40, 'Export final two seconds contain non-silent audio');
  }
  await fs.writeFile(path.join(out, 'results.json'), JSON.stringify({ success: true, exe, input, checks, before, playing, exportReport }, null, 2));
  console.log(JSON.stringify({ success: true, out, checks, playing }));
} finally {
  client?.close();
  if (child.pid) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  await log.close();
}
