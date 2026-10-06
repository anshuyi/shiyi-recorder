import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {connectPage,pause,waitFor} from './lib/recordly-test-client.mjs';
const require=createRequire(import.meta.url),root=path.resolve(import.meta.dirname,'..');
const installed=process.argv.includes('--installed');
const out=path.join(root,'.tmp','independent-portrait',installed?'installed':'packaged');
await fs.mkdir(out,{recursive:true});
const exe=installed?path.join(process.env.LOCALAPPDATA,'Programs/recordly/Recordly.exe'):path.join(root,'release/screen-layout/win-unpacked/Recordly.exe');
const screen=path.join(out,'screen.mp4'),camera=path.join(out,'camera.mp4'),project=path.join(out,'editing.recordly');
const ffmpeg=require('ffmpeg-static');
function encode(args){const r=spawnSync(ffmpeg,['-y','-v','error',...args],{windowsHide:true,encoding:'utf8'});if(r.status!==0)throw Error(r.stderr)}
encode(['-f','lavfi','-i','color=c=0x333344:s=1280x720:r=30:d=2','-f','lavfi','-i','sine=frequency=440:duration=2','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest',screen]);
encode(['-f','lavfi','-i','testsrc2=s=640x360:r=30:d=2','-vf','drawgrid=w=80:h=60:t=2:c=white','-c:v','libx264','-pix_fmt','yuv420p',camera]);
const hash=async file=>createHash('sha256').update(await fs.readFile(file)).digest('hex');
const originalHash=await hash(camera);
const packageHash=await hash(path.join(path.dirname(exe),"resources/app.asar"));
await fs.writeFile(project,JSON.stringify({version:1,videoPath:screen,editor:{aspectRatio:'16:9',wallpaper:'/wallpapers/paper-collage.png',zoomRegions:[],showCursor:false,webcam:{enabled:true,sourcePath:camera,timeOffsetMs:0,frameStyle:'portrait',size:20,positionPreset:'custom',positionX:.35,positionY:.5,mirror:true,reactToZoom:false,margin:24,shadow:0,cropRegion:{x:0,y:0,width:1,height:1}}}},null,2));
const env={...process.env,RECORDLY_DEV_OPEN_RECORDING_INPUT:screen,RECORDLY_DEV_OPEN_RECORDING_WEBCAM:camera};delete env.ELECTRON_RUN_AS_NODE;delete env.VITE_DEV_SERVER_URL;
const logfile=await fs.open(path.join(out,'app.log'),'w');
const child=spawn(exe,['--remote-debugging-port=9344','--remote-debugging-address=127.0.0.1','--disable-background-timer-throttling',`--user-data-dir=${path.join(out,'profile-'+Date.now())}`],{env,cwd:root,windowsHide:true,stdio:['ignore',logfile.fd,logfile.fd]});
const assert=(ok,message)=>{if(!ok)throw Error(message)};
let client;
const checks=[];
try{
 const page=await waitFor(async()=>{const pages=await(await fetch('http://127.0.0.1:9344/json/list')).json();return pages.find(p=>p.type==='page'&&p.url.includes('windowType=editor'))},'editor page');
 client=await connectPage(page);const {evaluate:ev,send}=client;
 const read=async()=>JSON.parse(await fs.readFile(project,'utf8'));
 const click=async testid=>{await ev(`document.querySelector('[data-testid="${testid}"]').click()`);await pause(180)};
 const key=async(k,modifiers=0)=>{for(const type of ['keyDown','keyUp'])await send('Input.dispatchKeyEvent',{type,key:k,code:'Key'+k.toUpperCase(),modifiers,windowsVirtualKeyCode:k.toUpperCase().charCodeAt(0)});await pause(200)};
 const save=async()=>{await ev('document.activeElement?.blur()');await key('s',2);await pause(600);return read()};
 const setRange=async(id,n,commit=true)=>{await ev(`(()=>{const e=document.querySelector('[data-testid="${id}"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${n});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);await pause(100);if(commit)await ev(`document.querySelector('[data-testid="${id}"]').dispatchEvent(new PointerEvent('pointerup',{bubbles:true}))`);await pause(200)};
 const rect=async selector=>ev(`document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect().toJSON()`);
 const geometry=async()=>ev(`(()=>{const camera=document.querySelector('[data-testid=webcam-preview]').getBoundingClientRect(),stage=document.querySelector('[data-testid=webcam-transform-box]').parentElement.getBoundingClientRect();return {camera:camera.toJSON(),stage:stage.toJSON(),size:camera.height/Math.min(stage.width,stage.height)}})()`);
 const drag=async(selector,dx,dy)=>{const r=await rect(selector),x=r.x+r.width/2,y=r.y+r.height/2;await send('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1});for(let i=1;i<=8;i++){await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:x+dx*i/8,y:y+dy*i/8,button:'left',buttons:1});await pause(20)}await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:x+dx,y:y+dy,button:'left',clickCount:1});await pause(250)};
 const opened=await ev(`window.electronAPI.openProjectFileAtPath(${JSON.stringify(project)})`);assert(opened.success,'Open fixture project');
 const url=new URL(page.url);url.searchParams.delete('devOpenInput');url.searchParams.delete('devOpenWebcam');
 async function reload(){await ev('window.__oldPortraitDoc=true');await send('Page.navigate',{url:url.href});await waitFor(()=>ev(`!window.__oldPortraitDoc && !!document.querySelector('[data-testid=portrait-edit]:not(:disabled)') && !!document.querySelector('[data-testid=webcam-transform-box]')`),'loaded portrait');await pause(350)}
 await reload();await click('portrait-edit');const small=await geometry();const initialEditor=(await save()).editor;
 await setRange('portrait-size',60);const large=await geometry();
 assert(Math.abs(large.size/small.size-3)<.04,'20 to 60 percent must triple portrait height');
 
 let saved=await save();assert(JSON.stringify(saved.editor.screenTransform)===JSON.stringify(initialEditor.screenTransform)&&JSON.stringify(saved.editor.cropRegion)===JSON.stringify(initialEditor.cropRegion),'Screen placement and crop unchanged');assert(saved.editor.webcam.size===60&&saved.editor.webcam.cropRegion.width===1,'Independent outer size persisted');checks.push('20→60% outer size; screen and crop unchanged');
 await key('z',2);assert(Math.abs((await geometry()).size-.2)<.01,'One undo returns to 20%');await key('y',2);assert(Math.abs((await geometry()).size-.6)<.01,'One redo returns to 60%');checks.push('Single-step size undo/redo');
 const beforeResize=await geometry();await drag('[data-testid=webcam-resize-se]',40,30);const afterResize=await geometry();assert(afterResize.size>beforeResize.size,'Corner handle enlarges portrait');assert(Math.abs(afterResize.camera.x-beforeResize.camera.x)<2&&Math.abs(afterResize.camera.y-beforeResize.camera.y)<2,'Opposite corner stays anchored');
 await key('z',2);assert(Math.abs((await geometry()).size-.6)<.01,'Corner resize undo is one step');await key('y',2);await drag('[data-testid=webcam-transform-box]',30,-15);saved=await save();checks.push('Real mouse resize with fixed opposite corner; drag and undo/redo');
 const beforeCrop=await geometry(),beforeSettings=JSON.stringify(saved.editor.webcam);
 async function crop(){await click('portrait-crop');await waitFor(()=>ev(`!!document.querySelector('[data-testid=portrait-crop-zoom]:not(:disabled)')`),'crop metadata')}
 await crop();await setRange('portrait-crop-zoom',2,false);await click('portrait-crop-cancel');saved=await save();assert(JSON.stringify(saved.editor.webcam)===beforeSettings,'Cancel restores all crop settings');
 await crop();await setRange('portrait-crop-zoom',2,false);await drag('[aria-label="Move webcam crop"]',-20,10);await click('portrait-crop-apply');const afterCrop=await geometry();assert(Math.abs(afterCrop.camera.width-beforeCrop.camera.width)<1&&Math.abs(afterCrop.camera.x-beforeCrop.camera.x)<1,'Framing leaves outer rectangle unchanged');saved=await save();assert(saved.editor.webcam.cropRegion.width<.2,'Crop zoom and mirror pan persisted');const cropSettings=JSON.stringify(saved.editor.webcam.cropRegion);
 await key('z',2);saved=await save();assert(saved.editor.webcam.cropRegion.width===1,'Crop apply is one history entry');await key('y',2);saved=await save();assert(JSON.stringify(saved.editor.webcam.cropRegion)===cropSettings,'Redo restores crop');checks.push('Crop zoom, mirror pan, cancel, apply, single-step undo/redo');
 await crop();await setRange('portrait-crop-zoom',3,false);await ev('document.activeElement?.blur()');await key('s',2);await waitFor(()=>ev(`!!document.querySelector('[data-testid=portrait-discard-pending]')`),'draft save decision');await click('portrait-discard-pending');await pause(700);saved=await read();assert(JSON.stringify(saved.editor.webcam.cropRegion)===cropSettings,'Discard draft before saving');checks.push('Save while cropping requires apply/discard/return');
 const stable=JSON.stringify((await save()).editor.webcam);
 async function changeAspect(from,to){
  const r=await ev(`(()=>{const e=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='${from}');return e.getBoundingClientRect().toJSON()})()`);
  for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,x:r.x+r.width/2,y:r.y+r.height/2,button:'left',clickCount:1});
  await pause(150);await ev(`[...document.querySelectorAll('[role="menuitem"]')].find(e=>e.textContent.trim()==='${to}').click()`);await pause(350);
 }
 await changeAspect('16:9','9:16');assert(Math.abs((await geometry()).stage.width/(await geometry()).stage.height-9/16)<.01,'Switch to vertical canvas');
 await changeAspect('9:16','16:9');assert(JSON.stringify((await save()).editor.webcam)===stable,'Aspect roundtrip preserves webcam settings');checks.push('16:9 → 9:16 → 16:9 preserves framing and layout');
 await crop();await setRange('portrait-crop-zoom',3,false);await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await pause(200);assert(!await ev(`!!document.querySelector('[data-testid=portrait-crop-zoom]')`),'Escape cancels crop');assert(JSON.stringify((await save()).editor.webcam)===stable,'Escape preserves committed framing');checks.push('Escape cancels unconfirmed crop');
 for(let i=0;i<20;i++){await crop();await setRange('portrait-crop-zoom',1.5+i*.02,false);await click('portrait-crop-cancel')}
 saved=await save();assert(JSON.stringify(saved.editor.webcam.cropRegion)===cropSettings,'20 canceled edits leave state intact');checks.push('20 repeated edit/cancel cycles');
 const reopened=await ev(`window.electronAPI.openProjectFileAtPath(${JSON.stringify(project)})`);assert(reopened.success,'Reopen saved project');await reload();await click('portrait-edit');const restored=await geometry();assert(Math.abs(restored.size-afterCrop.size)<.01,'Saved size reopens');await crop();const zoom=await ev(`Number(document.querySelector('[data-testid=portrait-crop-zoom]').value)`);assert(Math.abs(zoom-2)<.02,'Saved framing reopens');await click('portrait-crop-cancel');checks.push('Saved project reopens with size and framing');
 const baselineProject=await read();
 const followProject=structuredClone(baselineProject);followProject.editor.webcam.reactToZoom=true;followProject.editor.zoomClassicMode=true;followProject.editor.zoomRegions=[{id:'zoom-follow',startMs:0,endMs:2000,depth:2,focus:{cx:.5,cy:.5},mode:'manual'}];
 await fs.writeFile(project,JSON.stringify(followProject,null,2));await ev(`window.electronAPI.openProjectFileAtPath(${JSON.stringify(project)})`);await reload();
 await ev(`(()=>{const v=[...document.querySelectorAll('video')].find(v=>v.videoWidth===1280);v.currentTime=1;})()`);await pause(600);await click('portrait-edit');
 const follow=await geometry(),selection=await rect('[data-testid=webcam-transform-box]');assert(follow.size<restored.size*.9,'Explicit follow zoom affects portrait size');
 for(const k of ['x','y','width','height'])assert(Math.abs(selection[k]-follow.camera[k])<2,'Follow zoom selection matches rendered '+k);
 checks.push('Legacy follow-zoom selection matches the actual rendered portrait');
 await fs.writeFile(project,JSON.stringify(baselineProject,null,2));await ev(`window.electronAPI.openProjectFileAtPath(${JSON.stringify(project)})`);await reload();await click('portrait-edit');
 const shot=await send('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(out,'editor.png'),Buffer.from(shot.data,'base64'));
 await click('portrait-edit');const stage=(await geometry()).stage;const shotPreview=await send('Page.captureScreenshot',{format:'png',clip:{x:stage.x,y:stage.y,width:stage.width,height:stage.height,scale:1}});await fs.writeFile(path.join(out,'preview.png'),Buffer.from(shotPreview.data,'base64'));
 const output=path.join(out,'edited.mp4'),exportUrl=new URL(url.href);for(const[k,v]of Object.entries({smokeExport:'1',smokeProject:project,smokeOutput:output,smokePipelineModel:'modern',smokeBackendPreference:installed?'auto':'webcodecs',smokeUseNativeExport:installed?'1':'0',smokeQuality:'high',smokeFps:'30'}))exportUrl.searchParams.set(k,v);
 const started=Date.now();await send('Page.navigate',{url:exportUrl.href});const report=await waitFor(async()=>{if((await fs.stat(output+'.report.json')).mtimeMs<started)return;return JSON.parse(await fs.readFile(output+'.report.json','utf8'))},'export result',90000);assert(report.success,'Export succeeds');
 const probe=spawnSync(require('ffprobe-static').path,['-v','error','-show_streams','-of','json',output],{windowsHide:true,encoding:'utf8'});assert(probe.status===0,'Export decodes');const streams=JSON.parse(probe.stdout).streams;assert(streams.some(s=>s.codec_type==='audio'),'Audio retained');assert(streams.some(s=>s.codec_type==='video'&&Math.abs(s.width/s.height-16/9)<.001),'16:9 output');encode(['-ss','0.25','-i',output,'-frames:v','1',path.join(out,'export-frame.png')]);assert(await hash(camera)===originalHash,'Original camera file untouched');checks.push('MP4 export with audio; original source hash unchanged');
 await fs.writeFile(path.join(out,'results.json'),JSON.stringify({success:true,exe,packageHash,checks,small,large,beforeCrop,afterCrop,restored,streams,report},null,2));console.log('PORTRAIT EDITING PASSED '+JSON.stringify(checks));
}catch(error){if(client){try{const s=await client.send('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(out,'failure.png'),Buffer.from(s.data,'base64'))}catch{}}throw error}
finally{client?.close();child.kill();await logfile.close()}

