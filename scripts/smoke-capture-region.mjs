import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),root=process.cwd(),out=path.join(root,'.tmp/free-region-smoke');
await fs.mkdir(out,{recursive:true});
const installed=process.argv.includes('--installed'), packaged=process.argv.includes('--packaged');
const profile=path.join(out,installed?'installed-profile':packaged?'packaged-profile':'profile'), runner=path.join(out,'app.cjs');
const fixture=`<html><body style="margin:0;background:rgb(220,0,220);overflow:hidden"><div style="position:absolute;left:20%;top:20%;width:60%;height:60%;background:rgb(24,170,80)"><div style="position:absolute;left:40%;top:35%;width:20%;height:30%;background:rgb(30,90,240)"></div><h1 style="color:white;margin:30px">REGION RECORDING TEST</h1></div><script>setInterval(()=>document.title='region-test-pattern '+Date.now(),200)</script></body></html>`;
await fs.writeFile(runner,`const {app,BrowserWindow,screen}=require('electron');app.setPath('userData',${JSON.stringify(profile)});app.getAppPath=()=>${JSON.stringify(root)};app.on('browser-window-created',(_e,w)=>{const show=w.show.bind(w);w.show=()=>{if(w.__testFixture||w.webContents.getURL().includes('region-selector'))show();};});require(${JSON.stringify(path.join(root,'dist-electron/main.cjs'))});require('electron').ipcMain.on('test-fixture-front',e=>{const w=BrowserWindow.fromWebContents(e.sender);w.setAlwaysOnTop(true,'screen-saver');w.show();w.focus();});app.whenReady().then(()=>setTimeout(()=>{const w=new BrowserWindow({...screen.getPrimaryDisplay().bounds,frame:false,alwaysOnTop:true,fullscreen:true,show:false,webPreferences:{backgroundThrottling:false,nodeIntegration:true,contextIsolation:false}});w.__testFixture=true;require('node:fs').writeFileSync(${JSON.stringify(path.join(out,'fixture-window.json'))},JSON.stringify({id:'window:'+Number(w.getNativeWindowHandle().readBigUInt64LE())+':0',name:'region-test-pattern',sourceType:'window',display_id:String(screen.getPrimaryDisplay().id),thumbnail:null,appIcon:null}));w.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(${JSON.stringify(fixture)})).then(()=>w.show());},1800));`);
const env={...process.env,RECORDLY_DEV_OPEN_RECORDING_INPUT:path.join(root,'.tmp/region-smoke/region.mp4')};delete env.ELECTRON_RUN_AS_NODE;delete env.VITE_DEV_SERVER_URL;
const log=await fs.open(path.join(out,'app.log'),'w');
let fixtureChild;
if(installed||packaged){const fixtureRunner=path.join(out,'fixture.cjs');const boot=(await fs.readFile(runner,'utf8')).split('app.whenReady()')[1];await fs.writeFile(fixtureRunner,`const {app,BrowserWindow,screen}=require('electron');app.setPath('userData',${JSON.stringify(path.join(out,'fixture-profile'))});require('electron').ipcMain.on('test-fixture-front',e=>{const w=BrowserWindow.fromWebContents(e.sender);w.setAlwaysOnTop(true,'screen-saver');w.show();w.focus();});app.whenReady()${boot}`);fixtureChild=spawn(require('electron'),[fixtureRunner,'--remote-debugging-port=9342','--remote-debugging-address=127.0.0.1','--autoplay-policy=no-user-gesture-required'],{env,cwd:root,windowsHide:true,stdio:['ignore',log.fd,log.fd]});}
const exe=installed?path.join(process.env.LOCALAPPDATA,'Programs/recordly/Recordly.exe'):packaged?path.join(root,'release/screen-layout/win-unpacked/Recordly.exe'):require('electron');
const child=spawn(exe,[...(installed||packaged?[`--user-data-dir=${profile}`]:[runner]),'--remote-debugging-port=9341','--remote-debugging-address=127.0.0.1','--disable-background-timer-throttling','--disable-renderer-backgrounding','--autoplay-policy=no-user-gesture-required'],{env,cwd:root,windowsHide:true,stdio:['ignore',log.fd,log.fd]});
const delay=ms=>new Promise(r=>setTimeout(r,ms)),assert=(v,m)=>{if(!v)throw Error(m)},sockets=[];
const pages=async()=>await (await fetch('http://127.0.0.1:9341/json/list')).json();
const fixturePages=()=>installed||packaged?fetch('http://127.0.0.1:9342/json/list').then(r=>r.json()):pages();
const wait=async(fn,label)=>{for(let i=0;i<200;i++){try{const v=await fn();if(v)return v;}catch(e){if(i===199)throw e}await delay(100)}throw Error(label)};
async function connect(page){const ws=new WebSocket(page.webSocketDebuggerUrl);sockets.push(ws);await new Promise(r=>ws.onopen=r);let id=0;const pending=new Map();ws.onmessage=e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result)}};ws.onclose=()=>{for(const p of pending.values())p.reject(Error('closed'));pending.clear()};const send=(method,params={})=>new Promise((resolve,reject)=>{const i=++id;pending.set(i,{resolve,reject});ws.send(JSON.stringify({id:i,method,params}))});const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||JSON.stringify(r.exceptionDetails));return r.result.value};return {send,evaluate};}
try{
 const editorPage=await wait(async()=> (await pages()).find(p=>p.url.includes('windowType=editor')),'editor');const editor=await connect(editorPage); await wait(()=>editor.evaluate("!!document.querySelector('[data-testid=screen-layout-toggle]')"),'editor ready');console.log('EDITOR_READY');
 await wait(async()=> (await fixturePages()).find(p=>p.url.startsWith('data:')),'fixture');await delay(800);
 const sources=await editor.evaluate(`window.electronAPI.getSources({types:['screen'],thumbnailSize:{width:1,height:1}})`);assert(sources.length,'no screens');
 await editor.evaluate(`window.regionSource=${JSON.stringify(sources.find(s=>s.name.includes('Primary'))||sources[0])};'source ready'`);
 const displayId=(sources.find(s=>s.name.includes('Primary'))||sources[0]).display_id;
 const preferencesPath=path.join(profile,'capture-region.json');
 await fs.writeFile(preferencesPath,'{}');
 let selector, context;
 const openSelector=async()=>{
   await editor.evaluate(`window.regionPromise=window.electronAPI.selectCaptureRegion(window.regionSource);'opened'`);
   const page=await wait(async()=> (await pages()).find(p=>p.url.includes('region-selector')),'selector');selector=await connect(page);
   context=await wait(()=>selector.evaluate('window.electronAPI.getCaptureRegionContext()'),'context');
   await wait(()=>selector.evaluate(`!!document.querySelector('[data-testid=region-confirm]')`),'selector ready');await delay(250);
   await selector.evaluate(`window.pointerTrace=[];for(const type of ['pointerdown','pointermove','pointerup','gotpointercapture','lostpointercapture','pointercancel'])window.addEventListener(type,e=>window.pointerTrace.push({type,x:e.clientX,y:e.clientY,target:e.target.getAttribute?.('data-testid')}),true);`);
   assert(await selector.evaluate(`!document.querySelector('[data-testid=capture-rectangle]') && !document.querySelector('select') && document.querySelector('[data-testid=region-confirm]').disabled`),'selector did not start empty and unlocked');
 };
 const box=()=>selector.evaluate(`(()=>{const e=document.querySelector('[data-testid=capture-rectangle]');if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()`);
 const mouse=(type,x,y,buttons=0)=>selector.send('Input.dispatchMouseEvent',{type,x,y,button:type==='mouseMoved'?'none':'left',buttons,clickCount:type==='mouseMoved'?0:1});
 const drag=async(x,y,dx,dy,release=true)=>{await mouse('mousePressed',x,y,1);for(let i=1;i<=8;i++){await mouse('mouseMoved',x+dx*i/8,y+dy*i/8,1);await delay(18)}if(release)await mouse('mouseReleased',x+dx,y+dy);await delay(70)};
 const key=async name=>{await selector.send('Input.dispatchKeyEvent',{type:'keyDown',key:name,code:name,windowsVirtualKeyCode:name==='Enter'?13:27}).catch(()=>{});await selector.send('Input.dispatchKeyEvent',{type:'keyUp',key:name,code:name,windowsVirtualKeyCode:name==='Enter'?13:27}).catch(()=>{})};
 const click=async testId=>{const r=await selector.evaluate(`(()=>{const r=document.querySelector('[data-testid=${testId}]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);await mouse('mousePressed',r.x,r.y,1);await mouse('mouseReleased',r.x,r.y);await delay(70)};
 const reset=async()=>{if(await box())await click('region-reset')};
 const closeEnough=(actual,expected,label)=>{for(const k of Object.keys(expected))assert(Math.abs(actual[k]-expected[k])<1.1,label+' '+k+': '+JSON.stringify(actual))};
 await openSelector();assert(!context.previousRegion,'clean setup has saved region');
 await drag(200,200,800,150);const firstWide=await box();console.log('FIRST_DRAW',JSON.stringify(firstWide));closeEnough(firstWide,{x:200,y:200,width:800,height:150},'first direct wide draw');
 await key('Escape');assert(await editor.evaluate('window.regionPromise')===null,'Escape cancellation');
 // Old stored aspect must never silently lock drawing again.
 await fs.writeFile(preferencesPath,JSON.stringify({[displayId]:{region:{x:.25,y:.25,width:.5,height:.5},aspect:'4:3'}}));
 await openSelector();assert(context.previousRegion?.width===.5,'legacy coordinates lost');
 await click('region-restore');const restored=await box();closeEnough(restored,{x:context.width*.25,y:context.height*.25,width:context.width*.5,height:context.height*.5},'explicit restore');
 await drag(restored.x+restored.width,restored.y+restored.height/2,80,0);const restoredResized=await box();closeEnough(restoredResized,{width:restored.width+80,height:restored.height},'restored region freely resizes');
 await reset();await drag(250,250,0,0);assert(await selector.evaluate(`document.querySelector('[data-testid=region-confirm]').disabled`),'click creates valid region');
 await reset();await drag(250,250,4,4);assert(await selector.evaluate(`document.querySelector('[data-testid=region-confirm]').disabled`),'tiny region confirm enabled');
 await reset();await drag(400,600,150,-400);closeEnough(await box(),{x:400,y:200,width:150,height:400},'reverse tall draw');
 await reset();await drag(700,500,-320,-320);closeEnough(await box(),{x:380,y:180,width:320,height:320},'reverse square draw');
 await reset();await drag(250,220,400,240,false);await key('Enter');assert((await pages()).some(p=>p.url.includes('region-selector')),'confirmed during drag');await mouse('mouseReleased',650,460);await delay(80);
 const base=await box();await drag(base.x+base.width/2,base.y+base.height/2,20,15);const moved=await box();closeEnough(moved,{...base,x:base.x+20,y:base.y+15},'move');
 for(const handle of ['n','s','e','w','nw','ne','sw','se']){
   await reset();await drag(250,220,400,240);const before=await box();
   const point={x:handle.includes('w')?before.x:handle.includes('e')?before.x+before.width:before.x+before.width/2,y:handle.includes('n')?before.y:handle.includes('s')?before.y+before.height:before.y+before.height/2};
   const dx=handle==='n'||handle==='s'?0:45,dy=handle==='e'||handle==='w'?0:25;
   await drag(point.x,point.y,dx,dy);const after=await box();
   closeEnough(after,{x:before.x+(handle.includes('w')?dx:0),y:before.y+(handle.includes('n')?dy:0),width:before.width+(handle.includes('w')?-dx:handle.includes('e')?dx:0),height:before.height+(handle.includes('n')?-dy:handle.includes('s')?dy:0)},'handle '+handle);
 }
 const patternPage=(await fixturePages()).find(p=>p.url.startsWith('data:'));const pattern=await connect(patternPage);
 await pattern.evaluate(`(async()=>{window.tone=new AudioContext();const osc=tone.createOscillator(),gain=tone.createGain();gain.gain.value=.025;osc.connect(gain).connect(tone.destination);osc.start();await tone.resume();return tone.state})()`);
 const captures=[];let selected,video,center;
 for(const shape of ['wide','tall']){
   if(shape==='tall')await openSelector();else await reset();
   const x=Math.floor(context.width*(shape==='wide'?.25:.43)),y=Math.floor(context.height*(shape==='wide'?.38:.25));
   const width=Math.floor(context.width*(shape==='wide'?.5:.14)),height=Math.floor(context.height*(shape==='wide'?.24:.5));
   await drag(x,y,width,height);const drawn=await box();closeEnough(drawn,{x,y,width,height},shape+' final mouse rectangle');
   const screenshot=await selector.send('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(out,shape+'-selector.png'),Buffer.from(screenshot.data,'base64'));
   const sizeText=await selector.evaluate(`document.querySelector('[data-testid=region-size]').textContent`);
   await click('region-confirm').catch(e=>{if(!/closed|destroyed/.test(String(e)))throw e});
   selected=await editor.evaluate('window.regionPromise');assert(selected?.captureRegion,'selection result lost');
   const r=selected.captureRegion;closeEnough({x:r.x*context.width,y:r.y*context.height,width:r.width*context.width,height:r.height*context.height},drawn,'confirmed actual mouse rectangle');
   await editor.evaluate(`window.electronAPI.selectSource(${JSON.stringify(selected)})`);
   // Closing the selector can reactivate its owner editor; restore the test pattern.
   await pattern.evaluate(`require('electron').ipcRenderer.send('test-fixture-front')`); await delay(350);
   const started=await editor.evaluate(`window.electronAPI.startNativeScreenRecording(${JSON.stringify(selected)},{capturesSystemAudio:true,capturesMicrophone:false})`);assert(started.success,'native start: '+JSON.stringify(started));
   await delay(800);assert((await editor.evaluate('window.electronAPI.pauseNativeScreenRecording()')).success,'pause');await delay(200);assert((await editor.evaluate('window.electronAPI.resumeNativeScreenRecording()')).success,'resume');await delay(900);
   const stopped=await editor.evaluate('window.electronAPI.stopNativeScreenRecording()');assert(stopped.success&&stopped.path,'stop: '+JSON.stringify(stopped));
   const probe=spawnSync(require('ffprobe-static').path,['-v','error','-show_streams','-of','json',stopped.path],{windowsHide:true,encoding:'utf8'});assert(probe.status===0,'video probe');video=JSON.parse(probe.stdout).streams.find(s=>s.codec_type==='video');
   const expectedW=Math.floor((Math.floor((x+width)/context.width*context.pixelWidth+1e-7)-Math.ceil(x/context.width*context.pixelWidth-1e-7))/2)*2;
   const expectedH=Math.floor((Math.floor((y+height)/context.height*context.pixelHeight+1e-7)-Math.ceil(y/context.height*context.pixelHeight-1e-7))/2)*2;
   assert(video.width===expectedW&&video.height===expectedH,shape+' video dimensions differ from pointer region');assert(sizeText===`${expectedW} × ${expectedH} px`,'size label differs');
   const systemPath=stopped.path.replace(/\.mp4$/,'.system.wav');assert((await fs.stat(systemPath)).size>44,'system audio missing');
   const basename=shape==='wide'?'region':shape;await fs.copyFile(stopped.path,path.join(out,basename+'.mp4'));await fs.copyFile(systemPath,path.join(out,basename+'.system.wav'));await fs.copyFile(systemPath+'.json',path.join(out,basename+'.system.wav.json'));
   const raw=spawnSync(require('ffmpeg-static'),['-v','error','-ss','0.5','-i',stopped.path,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{windowsHide:true,maxBuffer:50e6});assert(raw.status===0,'decode');
   const pixel=(px,py)=>Array.from(raw.stdout.subarray((py*video.width+px)*3,(py*video.width+px)*3+3));
   for(const [px,py]of[[4,4],[video.width-5,4],[4,video.height-5],[video.width-5,video.height-5]]){const p=pixel(px,py);assert(p[1]>130&&p[0]<70&&p[2]<110,shape+' boundary mismatch: '+p)}
   center=pixel(Math.floor(video.width/2),Math.floor(video.height/2));assert(center[2]>190&&center[0]<70,shape+' center mismatch');
   spawnSync(require('ffmpeg-static'),['-y','-v','error','-ss','0.5','-i',stopped.path,'-frames:v','1',path.join(out,shape+'-recorded-frame.png')],{windowsHide:true});
   captures.push({shape,drawn,sizeText,selected,width:video.width,height:video.height,center});console.log('FREE_POINTER_RECORDING_PASS',shape,video.width,video.height);
 }
 await openSelector();assert(context.previousRegion,'latest region not remembered');await key('Escape');assert(await editor.evaluate('window.regionPromise')===null,'cancel failed');
 assert(JSON.stringify((await editor.evaluate('window.electronAPI.getSelectedSource()')).captureRegion)===JSON.stringify(selected.captureRegion),'cancel changed source');
 const stored=JSON.parse(await fs.readFile(preferencesPath,'utf8'))[displayId];assert(!('aspect' in stored),'old aspect persisted');

 const fixtureWindow=JSON.parse(await fs.readFile(path.join(out,'fixture-window.json'),'utf8'));assert(fixtureWindow.id,'fixture window source missing');
 for(const [label,target] of [['full-screen',sources.find(s=>s.name.includes('Primary'))||sources[0]],['window',fixtureWindow]]){
   const start=await editor.evaluate(`window.electronAPI.startNativeScreenRecording(${JSON.stringify(target)},{capturesSystemAudio:false,capturesMicrophone:false})`);assert(start.success,label+' start '+JSON.stringify(start));
   await delay(700);const stop=await editor.evaluate('window.electronAPI.stopNativeScreenRecording()');assert(stop.success,label+' stop');
   const probe=spawnSync(require('ffprobe-static').path,['-v','error','-show_streams','-of','json',stop.path],{windowsHide:true,encoding:'utf8'});assert(probe.status===0,label+' decode');
   const stream=JSON.parse(probe.stdout).streams.find(s=>s.codec_type==='video');assert(stream.width>1000&&stream.height>700,label+' dimensions');
   if(label==='full-screen')assert(stream.width===context.pixelWidth&&stream.height===context.pixelHeight,'full screen unexpectedly cropped');
   console.log('REGRESSION_PASS',label,stream.width,stream.height);
 }
 const bundled=await require('esbuild').build({entryPoints:[path.join(root,'src/lib/regionCaptureStream.ts')],bundle:true,write:false,format:'iife',globalName:'RegionCapture',platform:'browser'});
 await editor.evaluate(bundled.outputFiles[0].text);
 const browserClip=await editor.evaluate(`(async()=>{
   const canvas=document.createElement('canvas');canvas.width=640;canvas.height=480;const ctx=canvas.getContext('2d');
   const paint=()=>{ctx.fillStyle='rgb(220,0,220)';ctx.fillRect(0,0,640,480);ctx.fillStyle='rgb(24,170,80)';ctx.fillRect(160,120,320,240);ctx.fillStyle='rgb(30,90,240)';ctx.fillRect(280,210,80,60)};
   paint();const input=canvas.captureStream(30),tick=setInterval(paint,33);
   const crop=await RegionCapture.createRegionCaptureTrack(input.getVideoTracks()[0],{x:.25,y:.25,width:.5,height:.5});
   const chunks=[],stream=new MediaStream([crop.track]);const rec=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp9'});
   rec.ondataavailable=e=>chunks.push(e.data);rec.start(100);await new Promise(r=>setTimeout(r,1100));await new Promise(r=>{rec.onstop=r;rec.stop()});
   const settings=crop.track.getSettings();crop.cleanup();clearInterval(tick);
   const data=await new Promise(r=>{const f=new FileReader();f.onload=()=>r(f.result);f.readAsDataURL(new Blob(chunks,{type:'video/webm'}))});
   return {settings,data,ended:input.getVideoTracks()[0].readyState};
 })()`);
 assert(browserClip.settings.width===320&&browserClip.settings.height===240&&browserClip.ended==='ended','browser crop or cleanup failed');
 const browserPath=path.join(out,'browser-region.webm');await fs.writeFile(browserPath,Buffer.from(browserClip.data.split(',')[1],'base64'));
 const browserRaw=spawnSync(require('ffmpeg-static'),['-v','error','-ss','0.5','-i',browserPath,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{windowsHide:true,maxBuffer:5e6});
 assert(browserRaw.status===0,'browser decode');
 for(const offset of [0,(320*240-1)*3])assert(browserRaw.stdout[offset+1]>130&&browserRaw.stdout[offset]<70,'browser crop leaked');
 console.log('BROWSER_REGION_SUCCESS');
 const invalid=await editor.evaluate(`window.electronAPI.startNativeScreenRecording({...${JSON.stringify(selected)},captureRegion:{x:.9,y:0,width:.5,height:.5}})`);assert(!invalid.success,'invalid selection accepted');
 await fs.writeFile(path.join(out,installed?'installed-results.json':packaged?'packaged-results.json':'results.json'),JSON.stringify({success:true,installed,packaged,context,firstWide,restored,restoredResized,captures,checks:['empty initial state','legacy 4:3 ignored','mouse-only wide and tall recording','all eight free resize handles','move','reverse tall and square drawing','no confirm during drag','tiny and click rejected','explicit restore without ratio lock','reset','Escape preserves source','actual dimensions match mouse','boundary and center pixels','audio and pause/resume','browser cropped track','full-screen and window regression']},null,2));
 console.log('FREE_REGION_SMOKE_SUCCESS',out);
}catch(e){console.error(e);throw e}finally{for(const ws of sockets)ws.close();child.kill();fixtureChild?.kill();await log.close()}
