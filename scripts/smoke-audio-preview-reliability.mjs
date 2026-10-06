import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {spawn,spawnSync} from 'node:child_process';
import {connectPage,waitFor,pause} from './lib/recordly-test-client.mjs';
const require=createRequire(import.meta.url),root=path.resolve(import.meta.dirname,'..');
const args=process.argv.slice(2),opt=(key,fallback)=>args.find(s=>s.startsWith(key+'='))?.slice(key.length+1)??fallback;
const installed=args.includes('--installed'),late=args.includes('--late-audio'),faults=args.includes('--faults'),seconds=Number(opt('--duration-seconds','45')),repeats=Number(opt('--repeats','1')),port=Number(opt('--port','9370'));
const out=path.join(root,'.tmp/audio-reliability',`${installed?'installed':'candidate'}-${faults?'faults':'normal'}-${Date.now()}`);await fs.mkdir(out,{recursive:true});
const ffmpeg=require('ffmpeg-static'),ffprobe=require('ffprobe-static').path;
const encode=argv=>{const r=spawnSync(ffmpeg,['-y','-v','error',...argv],{windowsHide:true,encoding:'utf8',maxBuffer:1e6});if(r.status)throw Error(r.stderr);};
let input=opt('--input',null),camera=opt('--camera',null);
if(!input){input=path.join(out,'screen.mp4');encode(['-f','lavfi','-i',`color=c=0x345678:s=640x360:r=15:d=${seconds+2}`,'-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p',input]);encode(['-f','lavfi','-i',`aevalsrc='0.12*sin(2*PI*(220+110*floor(mod(t/10\,4)))*t)*lt(mod(t\,10)\,8)':s=48000:d=${seconds+2}`,'-c:a','pcm_s16le',input.replace(/\.mp4$/,'.mic.wav')]);}
const micFile=input.replace(/\.mp4$/,'.mic.wav');if(late){if(opt('--input',null))throw Error('Late-file test only accepts generated fixtures');await fs.rename(micFile,micFile+'.pending');}
const probe=spawnSync(ffprobe,['-v','error','-show_entries','format=duration:stream=codec_type,width,height','-of','json',input],{windowsHide:true,encoding:'utf8'});if(probe.status)throw Error(probe.stderr);const meta=JSON.parse(probe.stdout),videoMeta=meta.streams.find(s=>s.codec_type==='video'),duration=Number(meta.format.duration);
const exe=opt("--exe",null)||(installed?path.join(process.env.LOCALAPPDATA,'Programs/recordly/Recordly.exe'):path.join(root,'release/screen-layout/win-unpacked/Recordly.exe'));
const env={...process.env,RECORDLY_DEV_OPEN_RECORDING_INPUT:input};if(camera)env.RECORDLY_DEV_OPEN_RECORDING_WEBCAM=camera;delete env.ELECTRON_RUN_AS_NODE;delete env.VITE_DEV_SERVER_URL;
// Suppress only this test process's device output. Keep element gain and the production audio route intact.
const profile=path.join(out,'profile'),log=await fs.open(path.join(out,'app.log'),'w');const child=spawn(exe,[`--user-data-dir=${profile}`,`--remote-debugging-port=${port}`,'--remote-debugging-address=127.0.0.1','--disable-background-timer-throttling','--mute-audio'],{env,windowsHide:true,stdio:['ignore',log.fd,log.fd]});
let c;const rows=[],checks=[];const assert=(ok,label)=>{if(!ok)throw Error(label);checks.push(label);};
try{
const page=await waitFor(async()=>(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(p=>p.url.includes('windowType=editor')),'editor');c=await connectPage(page);const{evaluate:ev,send}=c;
await send('Page.enable');await send('Performance.enable');await send('Page.addScriptToEvaluateOnNewDocument',{source:`window.__audios=[];window.__mediaTrace=[];const trace=e=>{__mediaTrace.push(e);if(__mediaTrace.length>60)__mediaTrace.shift()};const originalPause=HTMLMediaElement.prototype.pause;HTMLMediaElement.prototype.pause=function(){if(this.tagName==='VIDEO'&&!this.paused)trace({type:'video-pause-call',time:this.currentTime,at:performance.now(),stack:new Error().stack});return originalPause.call(this)};for(const type of ['pointerdown','keydown','click'])window.addEventListener(type,e=>{if(e.isTrusted){trace({type,at:performance.now(),tag:e.target?.tagName});e.preventDefault();e.stopImmediatePropagation()}},true);const OriginalAudio=window.Audio;window.Audio=function(...args){const a=new OriginalAudio(...args);window.__audios.push(a);return a};window.Audio.prototype=OriginalAudio.prototype;`});await send('Page.reload');
if(late){await waitFor(()=>ev(`document.querySelector('button[title=Play]') && [...document.querySelectorAll('video')].some(v=>v.readyState>=3)`),'video before audio');await pause(3000);await fs.rename(micFile+'.pending',micFile);await ev(`window.electronAPI.setCurrentRecordingSession({videoPath:${JSON.stringify(input)}})`);checks.push('Late companion completion refresh sent');}
await waitFor(()=>ev(`window.__audios?.some(a=>a.getAttribute('src')&&a.readyState>=3) && [...document.querySelectorAll('video')].some(v=>v.videoWidth===${videoMeta.width}&&v.readyState>=3)`),'media ready',45000);await pause(1500);
await ev(`window.__a=__audios.find(a=>a.getAttribute('src')&&a.readyState>=3);window.__v=[...document.querySelectorAll('video')].find(v=>v.videoWidth===${videoMeta.width});window.__ordinaryPlay=__a.play.bind(__a);`);
const clickPlay=()=>send('Runtime.evaluate',{expression:`document.querySelector('button[title="Play"],button[title="播放"]')?.click()`,userGesture:true});
const read=()=>ev(`({v:__v.currentTime,a:__a.currentTime,paused:__v.paused,aPaused:__a.paused,ended:__v.ended,volume:__a.volume,muted:__a.muted,ready:__a.readyState,error:__a.error?.code??0,rate:__v.playbackRate,elements:__audios.filter(a=>a.getAttribute('src')).length,retry:!!document.querySelector('[data-testid="audio-retry"]'),notices:[...document.querySelectorAll('[data-sonner-toast]')].map(e=>e.textContent)})`);
await clickPlay();await waitFor(async()=>!(await read()).paused,'start playback');
const timings=faults?(seconds>=1220?[60,300,1200]:seconds>=600?[60,300,480]:[5,17,29]):[];let faultIndex=0;const start=Date.now();let replay=0,lastTime=-1,lastWall=Date.now();
while(true){await pause(1000);const s=await read(),elapsed=(Date.now()-start)/1000;rows.push({elapsed,...s});if(rows.length%15===0){const metrics=await send('Performance.getMetrics').catch(()=>({metrics:[]}));s.metrics=metrics.metrics?.filter(m=>['JSHeapUsedSize','Nodes','JSEventListeners','TaskDuration'].includes(m.name));rows.at(-1).metrics=s.metrics;}
if(!faults){if(s.paused&&!s.ended)throw Error(`Unexpected pause at ${s.v}`);if(!s.paused&&s.v<duration-.7){if(s.aPaused||s.error||s.volume===0)throw Error('Companion stopped during normal playback '+JSON.stringify(s));if(Math.abs(s.v-s.a)>1)throw Error('Audio/video clock drift '+JSON.stringify(s));}if(s.v>lastTime+.1){lastWall=Date.now();lastTime=s.v;}if(!s.ended&&Date.now()-lastWall>10000)throw Error('Video stopped advancing');}
if(faults&&s.paused&&!s.ended)throw Error(`Unexpected pause outside fault injection at ${s.v}`);
if(faults && faultIndex<timings.length && elapsed>=timings[faultIndex]){
 const n=faultIndex++;await ev(`__a.pause();__a.play=()=>Promise.reject(new DOMException('Injected audio refusal','NotAllowedError'));`);
 if(n<2){await pause(3200);await ev('__a.play=__ordinaryPlay');await waitFor(async()=>{const x=await read();return !x.paused&&!x.aPaused&&Math.abs(x.v-x.a)<1&&!x.notices.some(t=>/Trying to recover|正在尝试恢复/.test(t));},'bounded recovery',12000);checks.push(`fault ${n+1} recovered`);}
 else{await waitFor(async()=>(await read()).retry,'failed preview paused',15000);assert((await read()).paused,'Permanent failure pauses video and exposes retry');await ev('__a.play=__ordinaryPlay');await send('Runtime.evaluate',{expression:`document.querySelector('[data-testid="audio-retry"]').click()`,userGesture:true});await waitFor(async()=>{const x=await read();return !x.paused&&!x.aPaused;},'manual retry');checks.push('Manual retry restores preview');}
}
if(rows.length%15===0){await fs.writeFile(path.join(out,'progress.json'),JSON.stringify({elapsed,latest:s,checks},null,2));console.log(JSON.stringify({elapsed:Math.round(elapsed),v:Math.round(s.v),faultIndex,replay}));}
if(s.ended){replay++;if(replay>=repeats)break;await clickPlay();await waitFor(async()=>!(await read()).paused,'replay');lastTime=-1;lastWall=Date.now();}
if(faults&&faultIndex===timings.length&&elapsed>=Math.max(seconds,timings.at(-1)+15))break;
if(elapsed>duration*repeats+90)throw Error('Playback exceeded expected duration');
}
assert((await read()).elements===1,'One companion element; no duplicate playback');
if(faults){for(let i=0;i<20;i++){await ev(`document.querySelector('button[title="Pause"],button[title="暂停"]')?.click();__v.currentTime=${2+i%15}`);await pause(120);await clickPlay();await pause(120);}await pause(1000);const x=await read();assert(!x.paused&&!x.aPaused,'20 pause/seek/play cycles recover correctly');}
await fs.writeFile(path.join(out,'results.json'),JSON.stringify({success:true,outputSuppressed:true,exe,input,seconds,repeats,faults,checks,rows},null,2));console.log(JSON.stringify({success:true,out,checks}));
}catch(error){const trace=await c?.evaluate('window.__mediaTrace').catch(()=>null);await fs.writeFile(path.join(out,'failure.json'),JSON.stringify({error:String(error),trace,rows},null,2));throw error;}
finally{c?.close();if(child.pid)spawnSync('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});await log.close();}
