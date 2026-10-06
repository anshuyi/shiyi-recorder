// Run with Electron after vite build and smoke-webcam-portrait.mjs.
// Uses only generated fixtures and a separate profile; it never records the user's camera.
const { app } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const out = path.join(root, ".tmp", "portrait-smoke");
app.setPath("userData", path.join(out, "app-profile"));
app.getAppPath = () => root;
process.env.RECORDLY_DEV_OPEN_RECORDING_INPUT = path.join(out, "screen-source.mp4");
process.env.RECORDLY_DEV_OPEN_RECORDING_WEBCAM = path.join(out, "camera-source.mp4");
let started = false;
let sourcesRegistered = false;
app.on("browser-window-created", (_event, window) => {
	window.show = () => {};
	window.webContents.on("console-message", (_e, level, message) => {
		if (level >= 3) console.error(message);
	});
	window.webContents.on("did-finish-load", async () => {
		if (started || !window.webContents.getURL().includes("windowType=editor")) return;
		if (!sourcesRegistered) {
			sourcesRegistered = true;
			await window.webContents.executeJavaScript(`window.electronAPI.setCurrentRecordingSession(${JSON.stringify({ videoPath: process.env.RECORDLY_DEV_OPEN_RECORDING_INPUT, webcamPath: process.env.RECORDLY_DEV_OPEN_RECORDING_WEBCAM })})`);
			window.webContents.reload();
			return;
		}
		started = true;
		try {
			const result = await window.webContents.executeJavaScript(`(async()=>{
 const wait=async(fn,label)=>{for(let i=0;i<150;i++){const value=fn();if(value)return value;await new Promise(r=>setTimeout(r,100));}throw new Error(label);};
 const button=label=>Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===label||b.title===label||b.getAttribute('aria-label')===label);
 const cameraTab=await wait(()=>button('摄像头'),'Webcam tab not found');cameraTab.click();
 const portrait=await wait(()=>button('参考图 · 撕纸竖框'),'Portrait option not found');
 await wait(()=>Array.from(document.querySelectorAll('video')).some(v=>v.readyState>=2),'Video not ready');
 const frame=()=>Array.from(document.querySelectorAll('[style]')).filter(el=>el.style.clipPath?.startsWith('path(')&&Array.from(el.querySelectorAll('video')).some(v=>v.src.includes('camera-source'))).sort((a,b)=>a.getBoundingClientRect().width-b.getBoundingClientRect().width)[0];
 const ratio=()=>{const el=frame();return el?el.getBoundingClientRect().width/el.getBoundingClientRect().height:0;};
 await wait(()=>Math.abs(ratio()-0.6)<0.01,'Portrait preview ratio incorrect');
 button('原有圆形 / 圆角').click();await wait(()=>Math.abs(ratio()-1)<0.01,'Original frame did not restore');
 portrait.click();await wait(()=>Math.abs(ratio()-0.6)<0.01,'Portrait did not restore');
 const prefs=JSON.parse(localStorage.getItem('recordly.editor.preferences')||'{}');
 if(prefs.webcam?.frameStyle!=='portrait')throw new Error('Frame preference not saved');
 return {success:true,ratio:ratio(),selected:portrait.getAttribute('aria-pressed'),savedStyle:prefs.webcam.frameStyle,videoCount:document.querySelectorAll('video').length};
})()`);
			fs.writeFileSync(path.join(out, "app-results.json"), JSON.stringify(result, null, 2));
			fs.writeFileSync(path.join(out, "app-preview.png"), (await window.webContents.capturePage()).toPNG());
			console.log("APP SMOKE " + JSON.stringify(result));
			app.exit(0);
		} catch (error) { fs.writeFileSync(path.join(out, "app-failure.png"), (await window.webContents.capturePage()).toPNG()); console.error(error); app.exit(1); }
	});
});
require(path.join(root, "dist-electron", "main.cjs"));
setTimeout(() => { console.error("App smoke timed out"); app.exit(2); }, 90000);
