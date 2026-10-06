import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {pause,waitFor,connectPage} from './lib/recordly-test-client.mjs';
const require=createRequire(import.meta.url),root=process.cwd(),installed=process.argv.includes('--installed');
const out=path.join(root,'.tmp/responsiveness',installed?'installed-stress':'packaged-stress');await fs.mkdir(out,{recursive:true});
const profile=path.join(out,'profile');await fs.mkdir(profile,{recursive:true});await fs.writeFile(path.join(profile,'countdown-settings.json'),'{"delay":0}');await fs.writeFile(path.join(profile,'recordings-settings.json'),'{"microphoneEnabled":true}');
const exe=installed?path.join(process.env.LOCALAPPDATA,'Programs/recordly/Recordly.exe'):path.join(root,'release/screen-layout/win-unpacked/Recordly.exe');
const env={...process.env};for(const k of ['ELECTRON_RUN_AS_NODE','VITE_DEV_SERVER_URL','RECORDLY_DEV_OPEN_RECORDING_INPUT','RECORDLY_DEV_OPEN_RECORDING_WEBCAM'])delete env[k];
const log=await fs.open(path.join(out,'app.log'),'w'),child=spawn(exe,[`--user-data-dir=${profile}`,'--remote-debugging-port=9355','--remote-debugging-address=127.0.0.1','--autoplay-policy=no-user-gesture-required'],{env,windowsHide:true,stdio:['ignore',log.fd,log.fd]});
const connections=[],results={cycles:[],resources:[],deviceTest:null};let hud;
const pages=()=>fetch('http://127.0.0.1:9355/json/list').then(r=>r.json());
const assert=(v,m)=>{if(!v)throw Error(m)};
async function resources(){const ps=`$all = Get-CimInstance Win32_Process; $ids = [System.Collections.Generic.HashSet[int]]::new(); [void]$ids.Add(${child.pid}); 1..4 | ForEach-Object { foreach($p in $all) { if($ids.Contains([int]$p.ParentProcessId)) { [void]$ids.Add([int]$p.ProcessId) } } }; Get-Process -Id @($ids) -ErrorAction SilentlyContinue | Select-Object Id,CPU,WorkingSet64 | ConvertTo-Json -Compress`;const r=spawnSync('powershell.exe',['-NoProfile','-Command',ps],{windowsHide:true,encoding:'utf8'});return {at:Date.now(),processes:JSON.parse(r.stdout||'[]')}}
try{
 hud=await connectPage(await waitFor(async()=>(await pages()).find(p=>p.url.includes('hud-overlay')),'hud'));connections.push(hud);
 await waitFor(()=>hud.evaluate(`!!document.querySelector('button[title="Screen"]')`));
 const sources=await hud.evaluate(`window.electronAPI.getSources({types:['screen'],thumbnailSize:{width:1,height:1}})`);assert(sources.length,'no screen');
 const source={...sources[0],captureRegion:{x:.3,y:.3,width:.3,height:.3}};
 await hud.evaluate(`window.testSource=${JSON.stringify(source)};window.electronAPI.selectSource(window.testSource)`);
 await hud.evaluate(`window.testAudio=new AudioContext();window.testTone=testAudio.createOscillator();const gain=testAudio.createGain();gain.gain.value=.01;testTone.connect(gain).connect(testAudio.destination);testTone.start();testAudio.resume()`);
 results.resources.push(await resources());
 for(let i=0;i<(process.argv.includes("--skip-cycles")?0:10);i++){
  const start=performance.now();const started=await hud.evaluate(`window.electronAPI.startNativeScreenRecording(window.testSource,{capturesSystemAudio:true,capturesMicrophone:false})`);assert(started.success,'native start '+JSON.stringify(started));const startMs=performance.now()-start;
  if(i===9&&!process.argv.includes('--short')){for(let t=0;t<10;t++){await pause(30000);results.resources.push(await resources());await fs.writeFile(path.join(out,'progress.json'),JSON.stringify({minutes:(t+1)/2,pid:child.pid}));console.log('LONG_RECORDING',((t+1)*30)+'s')}}else await pause(800);
  const stop=performance.now();const ended=await hud.evaluate('window.electronAPI.stopNativeScreenRecording()');assert(ended.success&&ended.path,'native stop '+JSON.stringify(ended));
  const probe=spawnSync(require('ffprobe-static').path,['-v','error','-show_streams','-show_format','-of','json',ended.path],{windowsHide:true,encoding:'utf8'});assert(probe.status===0,'probe');const meta=JSON.parse(probe.stdout);assert(meta.streams.some(s=>s.codec_type==='video'),'missing video');
  results.cycles.push({startMs,stopMs:performance.now()-stop,duration:Number(meta.format.duration),path:ended.path});console.log('RECORDING_CYCLE',i+1,startMs);
 }
 if(!process.argv.includes('--short')&&!process.argv.includes('--skip-cycles'))assert(results.cycles.at(-1).duration>=299,'long recording truncated');
 await hud.evaluate('testTone.stop();testAudio.close()');
 const devices=await hud.evaluate(`navigator.mediaDevices.enumerateDevices().then(ds=>ds.filter(d=>d.kind==='videoinput').map(d=>({deviceId:d.deviceId,label:d.label})))`);
 console.log('CAMERA_DEVICES',devices.map(d=>d.label));
 if(devices.length&&!process.argv.includes('--microphone-only')){
  await hud.evaluate(`window.mediaStats=[];const OriginalRecorder=window.MediaRecorder;window.MediaRecorder=class extends OriginalRecorder{constructor(...args){super(...args);const entry={mime:this.mimeType,settings:args[0].getTracks().map(t=>{const s=t.getSettings();return {kind:t.kind,width:s.width,height:s.height,frameRate:s.frameRate}}),events:[]};window.mediaStats.push(entry);for(const event of ['start','stop','error','dataavailable'])this.addEventListener(event,e=>entry.events.push({type:event,size:e.data?.size,state:this.state}));}}`);
  await hud.evaluate(`document.querySelector('button[title="启用摄像头叠加"],button[title="Enable webcam overlay"]').click()`);
  await waitFor(()=>hud.evaluate(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent.includes(${JSON.stringify(devices[0].label||'Camera 1')}))`),'camera menu');
  await hud.evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes(${JSON.stringify(devices[0].label||'Camera 1')})).click()`);
  // Close popover using Escape, then verify the preview has acquired the real device.
  await hud.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await pause(1500);
  await hud.evaluate(`window.deviceErrors=[];const original=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);window.realGetUserMedia=c=>original(c).catch(e=>{deviceErrors.push({name:e.name,message:e.message});throw e});window.lateResolvers=[];navigator.mediaDevices.getUserMedia=()=>new Promise(r=>lateResolvers.push(r))`);
  await hud.evaluate(`document.querySelector('button[title="录制"],button[title="Record"]').click()`);
  await waitFor(()=>hud.evaluate(`!!document.querySelector('[data-testid=recording-starting]')&&lateResolvers.length>0`),'waiting camera');
  await hud.evaluate(`document.querySelector('[data-testid=cancel-starting]').click()`);
  await waitFor(()=>hud.evaluate(`!document.querySelector('[data-testid=recording-starting]')&&!!document.querySelector('button[title="录制"],button[title="Record"]')`),'cancel recovered');
  const cleaned=await hud.evaluate(`(async()=>{const c=document.createElement('canvas');c.width=160;c.height=90;c.getContext('2d').fillRect(0,0,160,90);const s=c.captureStream(10);lateResolvers.forEach(r=>r(s));await new Promise(r=>setTimeout(r,100));navigator.mediaDevices.getUserMedia=realGetUserMedia;return s.getTracks().every(t=>t.readyState==='ended')})()`);assert(cleaned,'late camera track leaked');
  await hud.evaluate(`document.querySelector('button[title="录制"],button[title="Record"]').click()`);
  await waitFor(()=>hud.evaluate(`!!document.querySelector('button[title="停止录制"],button[title="Stop recording"],button[title="Stop"],button[title="停止"]')||deviceErrors.length>0`),'actual hardware recording',45000);
  const deviceErrors=await hud.evaluate('window.deviceErrors');assert(!deviceErrors.length,'hardware device rejected '+JSON.stringify(deviceErrors));
  await pause(2000);
  await hud.evaluate(`document.querySelector('button[title="暂停"],button[title="Pause"]').click()`);
  await waitFor(()=>hud.evaluate(`!!document.querySelector('button[title="恢复"],button[title="Resume"]')`),'paused');
  await pause(1000);
  await hud.evaluate(`document.querySelector('button[title="恢复"],button[title="Resume"]').click()`);
  await waitFor(()=>hud.evaluate(`!!document.querySelector('button[title="暂停"],button[title="Pause"]')`),'resumed');
  await pause(2000); console.log("MEDIA_STATS",JSON.stringify(await hud.evaluate("window.mediaStats")));
  await hud.evaluate(`document.querySelector('button[title="停止录制"],button[title="Stop recording"],button[title="Stop"],button[title="停止"]').click()`);
  const editor=await connectPage(await waitFor(async()=>(await pages()).find(p=>p.url.includes('windowType=editor')),'editor',60000));connections.push(editor);
  console.log('EDITOR_SESSION',JSON.stringify(await editor.evaluate('window.electronAPI.getCurrentRecordingSession()')));
  const session=await waitFor(()=>editor.evaluate('window.electronAPI.getCurrentRecordingSession().then(r=>r.session?.webcamPath?r.session:null)'),'webcam session',60000);
  await waitFor(async()=>!(await pages()).some(p=>p.url.includes('hud-overlay')),'background save complete',60000);
  const streams={};for(const [kind,file]of Object.entries({screen:session.videoPath,camera:session.webcamPath})){const p=spawnSync(require('ffprobe-static').path,['-v','error','-show_streams','-show_format','-of','json',file],{windowsHide:true,encoding:'utf8'});assert(p.status===0,'hardware probe '+kind);streams[kind]=JSON.parse(p.stdout);assert(streams[kind].streams.some(s=>s.codec_type==='video'),'hardware video missing '+kind);assert(Number(streams[kind].format.duration)>=2,'hardware recording too short '+kind)}
  const hasMic=streams.screen.streams.some(s=>s.codec_type==='audio') || await fs.stat(session.videoPath.replace(/\.mp4$/,'.mic.webm')).then(s=>s.size>44).catch(()=>false);assert(hasMic,'hardware microphone audio missing');
  results.deviceTest={camera:true,microphone:true,pauseResume:true,cancelAndLateCleanup:true,session,streams};console.log('REAL_CAMERA_RECORDING_PASS');
 }else results.deviceTest={camera:false,reason:'Camera test skipped or unavailable'};
 if(process.argv.includes('--microphone-only')){
  await hud.evaluate(`document.querySelector('button[title="录制"],button[title="Record"]').click()`);
  await waitFor(()=>hud.evaluate(`!!document.querySelector('button[title="暂停"],button[title="Pause"]')`),'microphone recording',45000);
  await pause(2000);
  await hud.evaluate(`document.querySelector('button[title="暂停"],button[title="Pause"]').click()`);
  await waitFor(()=>hud.evaluate(`!!document.querySelector('button[title="恢复"],button[title="Resume"]')`),'microphone paused');
  await pause(1000);
  await hud.evaluate(`document.querySelector('button[title="恢复"],button[title="Resume"]').click()`);
  await pause(2000);
  await hud.evaluate(`document.querySelector('button[title="停止录制"],button[title="Stop recording"],button[title="Stop"],button[title="停止"]').click()`);
  const editor=await connectPage(await waitFor(async()=>(await pages()).find(p=>p.url.includes('windowType=editor')),'mic editor',60000));connections.push(editor);
  await waitFor(async()=>!(await pages()).some(p=>p.url.includes('hud-overlay')),'mic save',60000);
  const session=(await editor.evaluate('window.electronAPI.getCurrentRecordingSession()')).session;
  let sidecar;
  for(const suffix of ['.mic.wav','.mic.webm','.mic.m4a']){const file=session.videoPath.replace(/\.mp4$/,suffix);if(await fs.stat(file).then(s=>s.size>44).catch(()=>false)){sidecar=file;break}}
  assert(sidecar,'microphone sidecar missing');
  const p=spawnSync(require('ffprobe-static').path,['-v','error','-show_streams','-show_format','-of','json',sidecar],{windowsHide:true,encoding:'utf8'});
  assert(p.status===0,'microphone sidecar missing');const meta=JSON.parse(p.stdout);assert(meta.streams.some(s=>s.codec_type==='audio'),'mic stream missing');
  results.microphoneTest={success:true,pauseResume:true,session,sidecar,meta};console.log('REAL_MICROPHONE_PASS');
 }
 results.resources.push(await resources());results.success=true;await fs.writeFile(path.join(out,'results.json'),JSON.stringify(results,null,2));console.log('RESPONSIVENESS_STRESS_PASS');
}catch(e){results.error=String(e);await fs.writeFile(path.join(out,'results.json'),JSON.stringify(results,null,2));if(hud)await fs.writeFile(path.join(out,'hud-text.txt'),await hud.evaluate('document.body.innerText').catch(()=>''));throw e}
finally{for(const c of connections)c.close();child.kill();await log.close()}
