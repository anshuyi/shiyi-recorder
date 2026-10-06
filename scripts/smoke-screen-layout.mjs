// Real Electron pointer gestures, project save/reopen and isolated generated media.
import fs from "node:fs/promises";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, "..");
const out = path.join(root, ".tmp", "screen-layout-smoke");
await fs.mkdir(out, { recursive: true });
const packaged = process.argv.includes("--packaged");
const installed = process.argv.includes("--installed");
const videoPath = path.join(out, "screen.mp4");
const cameraPath = path.join(root, ".tmp", "portrait-smoke", "camera-source.mp4");
const projectPath = path.join(out, packaged ? "packaged.recordly" : "development.recordly");
const encoded = spawnSync(require("ffmpeg-static"), ["-y", "-f", "lavfi", "-i", "color=c=0xeeeeee:s=640x480:r=15:d=2", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-vf", "drawbox=x=300:y=215:w=40:h=50:color=0xee3333:t=fill", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", videoPath], { windowsHide: true, encoding: "utf8" });
if (encoded.status !== 0) throw Error(encoded.stderr);
await fs.writeFile(projectPath, JSON.stringify({ version: 1, videoPath, editor: {
	aspectRatio: "9:16", wallpaper: "#071427", padding: { top: 15, bottom: 15, left: 15, right: 15 }, borderRadius: 0, shadowIntensity: 0,
	screenTransform: { centerX: .5, centerY: .5, scale: 1 }, cropRegion: { x: 0, y: 0, width: 1, height: 1 }, zoomRegions: [],
	webcam: { enabled: true, sourcePath: cameraPath, frameStyle: "rounded", size: 25, mirror: true, reactToZoom: false, backgroundBlurEnabled: false },
} }, null, 2));
const profile = path.join(out, packaged ? "packaged-profile" : "development-profile");
const runner = path.join(out, "app.cjs");
await fs.writeFile(runner, `const {app}=require('electron');const path=require('node:path');app.setPath('userData',${JSON.stringify(profile)});app.getAppPath=()=>${JSON.stringify(root)};app.on('browser-window-created',(_e,w)=>{w.show=()=>{};});require(${JSON.stringify(path.join(root,"dist-electron/main.cjs"))});`);
const env = { ...process.env, RECORDLY_DEV_OPEN_RECORDING_INPUT: videoPath, RECORDLY_DEV_OPEN_RECORDING_WEBCAM: cameraPath };
delete env.ELECTRON_RUN_AS_NODE; delete env.VITE_DEV_SERVER_URL;
const exe = installed ? path.join(process.env.LOCALAPPDATA, "Programs", "recordly", "Recordly.exe") : packaged ? path.join(root, "release", "screen-layout", "win-unpacked", "Recordly.exe") : require("electron");
const args = ["--disable-background-timer-throttling", "--disable-renderer-backgrounding",...(packaged || installed ? [] : [runner]), "--remote-debugging-port=9338", "--remote-debugging-address=127.0.0.1", `--user-data-dir=${profile}`];
const log = await fs.open(path.join(out, packaged ? "packaged-app.log" : "development-app.log"), "w");
const child = spawn(exe, args, { env, cwd: root, windowsHide: true, stdio: ["ignore", log.fd, log.fd] });
const pause = ms => new Promise(r => setTimeout(r, ms));
const assert = (ok, message) => { if (!ok) throw Error(message); };
let socket, send;
try {
	let page;
	for (let i = 0; i < 120; i++) {
		try { page = (await (await fetch("http://127.0.0.1:9338/json/list")).json()).find(p => p.type === "page" && p.url.includes("windowType=editor")); } catch {}
		if (page) break;
		if (child.exitCode !== null) throw Error(`App exited ${child.exitCode}`);
		await pause(200);
	}
	assert(page, "Editor did not open");
	socket = new WebSocket(page.webSocketDebuggerUrl);
	await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
	const pending = new Map(); let id=0;
	socket.onclose = () => { for (const p of pending.values()) p.reject(Error("Test browser disconnected")); pending.clear(); };
	socket.onmessage = e => { const m=JSON.parse(e.data); const p=pending.get(m.id); if(p){pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);} };
	send = (method,params={}) => new Promise((resolve,reject)=>{const i=++id;pending.set(i,{resolve,reject});socket.send(JSON.stringify({id:i,method,params}));});
	const evaluate = async expression => {const r=await send("Runtime.evaluate",{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||JSON.stringify(r.exceptionDetails));return r.result.value;};
	const wait = async (fn,label) => { for(let i=0;i<100;i++){let v;try{v=await fn();}catch(e){if(!/context|navigat/i.test(String(e)))throw e;}if(v)return v;await pause(100);}throw Error(label);};
	await send("Runtime.enable");
	const opened = await evaluate(`window.electronAPI.openProjectFileAtPath(${JSON.stringify(projectPath)})`);
	assert(opened.success, JSON.stringify(opened));
	const url=new URL(page.url);url.searchParams.delete("devOpenInput");url.searchParams.delete("devOpenWebcam");
	await evaluate('window.__screenLayoutOldDocument=true');
	await send("Page.navigate",{url:url.href});
	await wait(()=>evaluate('!window.__screenLayoutOldDocument && Boolean(document.querySelector("[data-testid=screen-layout-toggle]"))'),"No layout button");
	const box = async () => evaluate(`(()=>{const e=document.querySelector('[data-testid="screen-transform-box"]');if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};})()`);
	await evaluate('document.querySelector("[data-testid=screen-layout-toggle]").click()');
	await wait(box,"No transform box"); await pause(500);
	const initial=await box();
	await evaluate(`window.pointerTrace=[];for(const type of ['pointerdown','pointermove','pointerup','lostpointercapture'])window.addEventListener(type,e=>window.pointerTrace.push({type,x:e.clientX,y:e.clientY,target:e.target.getAttribute?.('data-testid')}),true);`);
	const mouse = (type,x,y,buttons=0) => send("Input.dispatchMouseEvent",{type,x,y,button:type==="mouseMoved"?"none":"left",buttons,clickCount:type==="mouseMoved"?0:1});
	const drag = async (x,y,dx,dy,release=true) => {
		await mouse("mouseMoved",x,y);await mouse("mousePressed",x,y,1);
		for(let i=1;i<=8;i++){await mouse("mouseMoved",x+dx*i/8,y+dy*i/8,1);await pause(25);}
		if(release)await mouse("mouseReleased",x+dx,y+dy);
		await pause(350);
	};
	await drag(initial.x+initial.width/2, initial.y+initial.height/2, -12, -100);
	const moved=await box(); console.log("DRAG GEOMETRY", JSON.stringify({ initial, moved, trace: await evaluate('window.pointerTrace') })); assert(Math.abs(moved.y-initial.y+100)<3,"Drag did not move screen 100 px upward");
	const key = async (key,code,modifiers=0) => {await send("Input.dispatchKeyEvent",{type:"keyDown",key,code,modifiers,windowsVirtualKeyCode:key.length===1?key.toUpperCase().charCodeAt(0):27});await send("Input.dispatchKeyEvent",{type:"keyUp",key,code,modifiers});await pause(450);};
	await key("z","KeyZ",2);const undone=await box();assert(Math.abs(undone.y-initial.y)<2,"One undo did not revert whole drag");
	await key("z","KeyZ",10); const redone=await box();assert(Math.abs(redone.y-moved.y)<2,"Redo did not restore drag");
	await drag(moved.x+moved.width-5,moved.y+moved.height-5,-60,-45);
	const resized=await box();assert(resized.width<moved.width-30,"Corner did not resize");assert(Math.abs(resized.width/resized.height-4/3)<.01,"Resize changed aspect ratio");assert(Math.abs(resized.x-moved.x)<2&&Math.abs(resized.y-moved.y)<2,"Resize moved anchor");
	await drag(resized.x+resized.width/2,resized.y+resized.height/2,30,40,false);await key("Escape","Escape");await mouse("mouseReleased",resized.x+resized.width/2+30,resized.y+resized.height/2+40);await pause(300);
	const canceled=await box();assert(Math.abs(canceled.x-resized.x)<2&&Math.abs(canceled.y-resized.y)<2,"Escape did not cancel gesture");
	await key("s","KeyS",2);
	let saved=await wait(async()=>{const p=JSON.parse(await fs.readFile(projectPath,"utf8"));return p.editor.screenTransform?.scale<.95?p:null;},"Save did not persist resized layout");
	const shot=await send("Page.captureScreenshot",{format:"png"});await fs.writeFile(path.join(out,packaged?"packaged-preview.png":"development-preview.png"),Buffer.from(shot.data,"base64"));
	await evaluate('window.__screenLayoutOldDocument=true');
	await send("Page.reload");await wait(()=>evaluate('!window.__screenLayoutOldDocument && Boolean(document.querySelector("[data-testid=screen-layout-toggle]"))'),"Reload failed");
	await evaluate('document.querySelector("[data-testid=screen-layout-toggle]").click()');await wait(box,"No box after reopen");await pause(500);
	const reopened=await box();assert(Math.abs(reopened.x-resized.x)<2&&Math.abs(reopened.y-resized.y)<2&&Math.abs(reopened.width-resized.width)<2,"Reopened project differs from saved layout");
	for (const corner of ["nw","ne","sw","se"]) {
		const before=await box(), east=corner.endsWith("e"),south=corner.startsWith("s");
		await drag(before.x+(east?before.width-5:5),before.y+(south?before.height-5:5),east?-12:12,south?-9:9);
		const after=await box();assert(after.width<before.width-5,corner+" did not resize");
		assert(Math.abs(after.x+(east?0:after.width)-before.x-(east?0:before.width))<2,corner+" anchor X changed");
		assert(Math.abs(after.y+(south?0:after.height)-before.y-(south?0:before.height))<2,corner+" anchor Y changed");
		await key("z","KeyZ",2);
	}
	const canvasBounds=await evaluate(`(()=>{const r=document.querySelector('[data-testid="screen-transform-box"]').parentElement.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};})()`);
	const beforeBoundary=await box();await drag(beforeBoundary.x+beforeBoundary.width/2,beforeBoundary.y+beforeBoundary.height/2,-250,-220);
	const bounded=await box();assert(bounded.x<canvasBounds.x && bounded.x+bounded.width>canvasBounds.x+10,"Off-canvas drag must retain a reachable strip");await key("z","KeyZ",2);
	await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>['居中','Center'].includes(b.textContent.trim())).click()`);await pause(300);
	const centered=await box();assert(Math.abs(centered.x+centered.width/2-canvasBounds.x-canvasBounds.width/2)<2,"Center action failed");await key("z","KeyZ",2);
	await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>['恢复默认布局','Reset layout'].includes(b.textContent.trim())).click()`);await pause(300);assert((await box()).width>resized.width+20,"Reset layout did not restore size");await key("z","KeyZ",2);

	// Existing rounded webcam projects can adopt the reference framing in one click.
	await evaluate('document.querySelector("[data-testid=apply-portrait-frame]").click()');await pause(500);
	const webcamBox=()=>evaluate(`(()=>{const r=document.querySelector('[data-testid=webcam-transform-box]').getBoundingClientRect();const b=document.querySelector('[data-testid=webcam-preview]').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,actual:{x:b.x,y:b.y,width:b.width,height:b.height}};})()`);
	const portrait=await webcamBox();assert(Math.abs(portrait.width/portrait.height-.6)<.01,'Portrait frame is not 3:5');
	for(const k of ['x','y','width','height'])assert(Math.abs(portrait[k]-portrait.actual[k])<2,'Webcam handles differ from rendered portrait: '+k);
	const screenBeforeWebcam=await box();
	await drag(portrait.x+portrait.width/2,portrait.y+portrait.height/2,20,-30);
	const portraitMoved=await webcamBox();assert(Math.abs(portraitMoved.y-portrait.y+30)<2,'Webcam did not drag');
	await drag(portraitMoved.x+portraitMoved.width-5,portraitMoved.y+portraitMoved.height-5,-15,-25);
	const portraitResized=await webcamBox();assert(portraitResized.height<portraitMoved.height-20,'Webcam did not resize');
	await key('Escape','Escape');
	const screenAfterWebcam=await box();assert(Math.abs(screenBeforeWebcam.width-screenAfterWebcam.width)<2,'Webcam gesture changed screen');
	await evaluate('document.querySelector("[data-testid=screen-layout-toggle]").click()');await pause(200);
	for(let i=0;i<4;i++){await evaluate('document.querySelector("[data-testid=screen-scale-up]").click()');await pause(200);}
	await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>['居中','Center'].includes(b.textContent.trim())).click()`);await pause(300);
	const enlarged=await box();assert(enlarged.width>canvasBounds.width*1.5,'Recording still cannot enlarge beyond canvas');
	await drag(canvasBounds.x+20,canvasBounds.y+canvasBounds.height*.5,0,-canvasBounds.height*.35);
	const panned=await box();console.log("OVERSIZE",JSON.stringify({canvasBounds,enlarged,panned}));assert(Math.abs(panned.y-enlarged.y+canvasBounds.height*.35)<3,'Enlarged recording cannot pan');
	await key('s','KeyS',2);
	saved=await wait(async()=>{const p=JSON.parse(await fs.readFile(projectPath,'utf8'));return p.editor.screenTransform?.scale>1.5&&p.editor.webcam.frameStyle==='portrait'?p:null;},'Oversized layout / portrait not saved');
	console.log("SAVED_OVERSIZE",JSON.stringify(saved.editor.screenTransform));
	const enlargedShot=await send('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(out,packaged?'packaged-enlarged.png':'development-enlarged.png'),Buffer.from(enlargedShot.data,'base64'));
	await evaluate('window.__screenLayoutOldDocument=true');await send('Page.reload');
	await wait(()=>evaluate('!window.__screenLayoutOldDocument && Boolean(document.querySelector("[data-testid=screen-layout-toggle]"))'),'Enlarged reload failed');
	await evaluate('document.querySelector("[data-testid=screen-layout-toggle]").click()');await wait(box,'No enlarged box');await pause(500);
	const largeReopened=await box();for(const k of ['x','y','width','height'])assert(Math.abs(largeReopened[k]-panned[k])<2,'Enlarged reload differs: '+k);
	console.log("REOPENED_OVERSIZE",JSON.stringify(largeReopened));
	const portraitReopened=await webcamBox();for(const k of ['x','y','width','height'])assert(Math.abs(portraitReopened[k]-portraitResized[k])<2,'Portrait reload differs: '+k);

	// Export the project saved by the real UI through the packaged/development app.
	const exportPath=path.join(out,packaged?"packaged-export.mp4":"development-export.mp4");
	const exportUrl=new URL(url.href);for(const [k,v]of Object.entries({smokeExport:"1",smokeProject:projectPath,smokeOutput:exportPath,smokePipelineModel:"modern",smokeBackendPreference:"webcodecs",smokeFps:"30",smokeQuality:"medium"}))exportUrl.searchParams.set(k,v);
	const exportStarted=Date.now();await send("Page.navigate",{url:exportUrl.href});
	let report;
	for(let i=0;i<300;i++){try{const stat=await fs.stat(exportPath+".report.json");if(stat.mtimeMs>=exportStarted){report=JSON.parse(await fs.readFile(exportPath+".report.json","utf8"));break;}}catch{}await pause(100);}
	assert(report?.success,"App export failed: "+JSON.stringify(report));
	const probe=spawnSync(require("ffprobe-static").path,["-v","error","-show_streams","-of","json",exportPath],{windowsHide:true,encoding:"utf8"});assert(probe.status===0,probe.stderr);const streams=JSON.parse(probe.stdout).streams;
	assert(streams.some(s=>s.codec_type==="audio"),"App export lost audio");assert(streams.some(s=>s.codec_type==="video"&&s.width/s.height===9/16),"App export aspect ratio incorrect");
	const videoStream=streams.find(s=>s.codec_type==="video"), w=videoStream.width,h=videoStream.height;
	const raw=spawnSync(require("ffmpeg-static"),["-v","error","-ss","0.25","-i",exportPath,"-frames:v","1","-f","rawvideo","-pix_fmt","rgb24","pipe:1"],{windowsHide:true,maxBuffer:50*1024*1024});assert(raw.status===0,"Could not decode app export");
	const p=saved.editor.padding,s=saved.editor.screenTransform,baseScale=Math.min(w*(1-(p.left+p.right)*.002)/640,h*(1-(p.top+p.bottom)*.002)/480),expectedWidth=640*baseScale*s.scale,expectedHeight=480*baseScale*s.scale;
	const x=s.centerX*w-expectedWidth/2,y=s.centerY*h-expectedHeight/2;
	const expected={x:Math.max(0,x),y:Math.max(0,y),width:Math.min(w,x+expectedWidth)-Math.max(0,x),height:Math.min(h,y+expectedHeight)-Math.max(0,y)};
	let left=w,top=h,right=-1,bottom=-1;for(let yy=0;yy<Math.min(h,Math.ceil(expected.y+expected.height)+2);yy++)for(let xx=0;xx<w;xx++){const i=(yy*w+xx)*3;if(raw.stdout[i]>210&&raw.stdout[i+1]>210&&raw.stdout[i+2]>210){left=Math.min(left,xx);right=Math.max(right,xx);top=Math.min(top,yy);bottom=Math.max(bottom,yy);}}
	const actual={x:left,y:top,width:right-left+1,height:bottom-top+1};for(const k of Object.keys(expected))assert(Math.abs(expected[k]-actual[k])<=2,`App export differs from saved preview at ${k}: ${actual[k]} vs ${expected[k]}`);
	spawnSync(require("ffmpeg-static"),["-y","-v","error","-ss","0.25","-i",exportPath,"-frames:v","1",path.join(out,packaged?"packaged-export-frame.png":"development-export-frame.png")],{windowsHide:true});
	await fs.writeFile(path.join(out,packaged?"packaged-pixel-check.json":"development-pixel-check.json"),JSON.stringify({expected,actual},null,2));
	await fs.writeFile(path.join(out,packaged?"packaged-probe.json":"development-probe.json"),probe.stdout);
	const result={success:true,packaged,initial,moved,resized,reopened,savedTransform:saved.editor.screenTransform,projectPath,exportPath,checks:["real pointer drag","all four proportional resize handles","fixed opposite anchors","one-step undo","redo","Escape cancellation","actual Ctrl+S save","project reload","off-canvas pointer capture and boundary clamp","center","reset","app MP4 export with audio", "oversized screen enlargement and panning", "oversized save and reopen", "reference portrait applied to old project", "independent portrait drag and resize", "portrait save and reopen"]};
	await fs.writeFile(path.join(out,packaged?"packaged-results.json":"development-results.json"),JSON.stringify(result,null,2));
	console.log("SCREEN LAYOUT SMOKE "+JSON.stringify(result));
} catch(error) {
	console.error("SMOKE FAILURE", error?.stack || error);
	if(send && socket?.readyState === WebSocket.OPEN)try {const shot=await send("Page.captureScreenshot",{format:"png"});await fs.writeFile(path.join(out,"failure.png"),Buffer.from(shot.data,"base64"));}catch{}
	throw error;
} finally { socket?.close();child.kill();await log.close(); }
