// Exercise the packaged Windows app with generated fixtures and an isolated user profile.
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..");
const out = path.join(root, ".tmp", "portrait-smoke");
const exe = path.join(root, "release", "portrait-frame", "win-unpacked", "Recordly.exe");
await fs.access(exe);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.VITE_DEV_SERVER_URL;
env.RECORDLY_DEV_OPEN_RECORDING_INPUT = path.join(out, "screen-source.mp4");
env.RECORDLY_DEV_OPEN_RECORDING_WEBCAM = path.join(out, "camera-source.mp4");
const child = spawn(exe, ["--remote-debugging-port=9337", "--remote-debugging-address=127.0.0.1", `--user-data-dir=${path.join(out, "packaged-profile")}`], { env, cwd: path.dirname(exe), windowsHide: true, stdio: "ignore" });
const pause = (ms) => new Promise(resolve => setTimeout(resolve, ms));
let socket;
try {
	let page;
	for (let i = 0; i < 100; i++) {
		try { page = (await (await fetch("http://127.0.0.1:9337/json/list")).json()).find(p => p.type === "page" && p.url.includes("windowType=editor")); } catch {}
		if (page) break;
		if (child.exitCode !== null) throw new Error(`App exited: ${child.exitCode}`);
		await pause(200);
	}
	if (!page) throw new Error("Packaged editor did not open");
	socket = new WebSocket(page.webSocketDebuggerUrl);
	await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
	const pending = new Map(); let nextId = 0;
	socket.onmessage = (event) => { const message = JSON.parse(event.data); if (message.id) { const operation = pending.get(message.id); pending.delete(message.id); if (message.error) operation?.reject(new Error(JSON.stringify(message.error))); else operation?.resolve(message.result); } };
	const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++nextId; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
	const evaluate = async (expression) => { const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || JSON.stringify(result.exceptionDetails)); return result.result.value; };
	await send("Runtime.enable");
	await evaluate(`window.electronAPI.setCurrentRecordingSession(${JSON.stringify({ videoPath: env.RECORDLY_DEV_OPEN_RECORDING_INPUT, webcamPath: env.RECORDLY_DEV_OPEN_RECORDING_WEBCAM })})`);
	await send("Page.reload"); await pause(2000);
	const result = await evaluate(`(async()=>{
 const wait=async(fn,label)=>{for(let i=0;i<150;i++){const value=fn();if(value)return value;await new Promise(r=>setTimeout(r,100));}throw new Error(label);};
 const button=label=>Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===label||b.title===label||b.getAttribute('aria-label')===label);
 (await wait(()=>button('摄像头'),'No webcam tab')).click();
 const portrait=await wait(()=>button('参考图 · 撕纸竖框'),'No portrait option');
 portrait.click();
 const frame=()=>Array.from(document.querySelectorAll('[style]')).filter(el=>el.style.clipPath?.startsWith('path(')&&Array.from(el.querySelectorAll('video')).some(v=>v.src.includes('camera-source'))).sort((a,b)=>a.getBoundingClientRect().width-b.getBoundingClientRect().width)[0];
 const ratio=()=>{const el=frame();return el?el.getBoundingClientRect().width/el.getBoundingClientRect().height:0;};
 await wait(()=>Math.abs(ratio()-0.6)<0.01,'Bad portrait ratio');
 button('原有圆形 / 圆角').click();await wait(()=>Math.abs(ratio()-1)<0.01,'Bad original ratio');
 portrait.click();await wait(()=>Math.abs(ratio()-0.6)<0.01,'Could not restore portrait');
 const crop=document.querySelector('[aria-label="Move webcam crop"]');
 if(!crop)throw new Error('Missing crop adjustment');
 crop.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));
 await new Promise(r=>setTimeout(r,300));
 const prefs=JSON.parse(localStorage.getItem('recordly.editor.preferences')||'{}');
 if(prefs.webcam?.frameStyle!=='portrait')throw new Error('Preference not saved');
 if(!(prefs.webcam.cropRegion.width<1))throw new Error('Crop adjustment did not persist');
 return {success:true,ratio:ratio(),selected:portrait.getAttribute('aria-pressed'),savedStyle:prefs.webcam.frameStyle,crop:prefs.webcam.cropRegion,videoCount:document.querySelectorAll('video').length};
})()`);
	const shot = await send("Page.captureScreenshot", { format: "png" });
	await fs.writeFile(path.join(out, "packaged-app-preview.png"), Buffer.from(shot.data, "base64"));
	await fs.writeFile(path.join(out, "packaged-results.json"), JSON.stringify(result, null, 2));
	console.log("PACKAGED APP SMOKE " + JSON.stringify(result));
} finally { socket?.close(); child.kill(); }
