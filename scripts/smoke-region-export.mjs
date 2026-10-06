// Verify the installed executable using a generated region recording and camera fixture.
import fs from "node:fs/promises";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, "..");
const out = path.join(root, ".tmp", "free-region-export-smoke");
const profile = path.join(out, "profile");
await fs.mkdir(out, {recursive:true});
const screen = path.join(root, ".tmp/free-region-smoke/region.mp4"), camera = path.join(out, "camera.mp4");
const generated = spawnSync(require("ffmpeg-static"), ["-y","-v","error","-f","lavfi","-i","testsrc2=s=360x600:r=30:d=3","-c:v","libx264","-pix_fmt","yuv420p",camera], {windowsHide:true});
if(generated.status!==0)throw Error("Camera fixture generation failed");
const project = path.join(out, "reference.recordly"), output = path.join(out, "reference.mp4");
const userSettings = JSON.parse(await fs.readFile(path.join(process.env.APPDATA, "Recordly", "app-settings.json"), "utf8"));
const preferences = userSettings["recordly.editor.preferences"];
await fs.mkdir(profile, { recursive: true });
await fs.writeFile(project, JSON.stringify({ version: 1, videoPath: screen, editor: {
	...preferences, wallpaper: "/wallpapers/paper-collage.png", aspectRatio: "9:16", zoomRegions: [],
	screenTransform: { centerX: .5, centerY: .25, scale: 1 },
	webcam: { ...preferences.webcam, sourcePath: camera, enabled: true, frameStyle: "rounded", size: 40 },
} }, null, 2));
const exe = process.argv.includes("--installed") ? path.join(process.env.LOCALAPPDATA, "Programs", "recordly", "Recordly.exe") : path.join(root,"release/screen-layout/win-unpacked/Recordly.exe");
const env = { ...process.env, RECORDLY_DEV_OPEN_RECORDING_INPUT: screen, RECORDLY_DEV_OPEN_RECORDING_WEBCAM: camera };
delete env.ELECTRON_RUN_AS_NODE; delete env.VITE_DEV_SERVER_URL;
const log = await fs.open(path.join(out, "app.log"), "w");
const child = spawn(exe, ["--remote-debugging-port=9339", "--remote-debugging-address=127.0.0.1", "--disable-background-timer-throttling", `--user-data-dir=${profile}`], { env, cwd: root, windowsHide: true, stdio: ["ignore", log.fd, log.fd] });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const assert = (value, message) => { if (!value) throw Error(message); };
let socket;
try {
	let page;
	for (let i = 0; i < 150; i++) {
		try { page = (await (await fetch("http://127.0.0.1:9339/json/list")).json()).find(p => p.type === "page" && p.url.includes("windowType=editor")); } catch {}
		if (page) break; await pause(200);
	}
	assert(page, "Installed editor did not open");
	socket = new WebSocket(page.webSocketDebuggerUrl);
	await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
	const pending = new Map(); let id = 0;
	socket.onmessage = event => { const m = JSON.parse(event.data), p = pending.get(m.id); if (p) { pending.delete(m.id); m.error ? p.reject(Error(JSON.stringify(m.error))) : p.resolve(m.result); } };
	socket.onclose = () => { for (const p of pending.values()) p.reject(Error("Browser disconnected")); pending.clear(); };
	const send = (method, params = {}) => new Promise((resolve, reject) => { const n = ++id; pending.set(n, { resolve, reject }); socket.send(JSON.stringify({ id: n, method, params })); });
	const evaluate = async expression => { const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description); return r.result.value; };
	const wait = async fn => { for (let i = 0; i < 100; i++) { try { if (await fn()) return; } catch {} await pause(100); } throw Error("Timed out waiting for editor"); };
	const opened = await evaluate(`window.electronAPI.openProjectFileAtPath(${JSON.stringify(project)})`); assert(opened.success, "Project did not open");
	const url = new URL(page.url); url.searchParams.delete("devOpenInput"); url.searchParams.delete("devOpenWebcam");
	await evaluate("window.__oldDocument=true"); await send("Page.navigate", { url: url.href });
	await wait(() => evaluate('!window.__oldDocument && !!document.querySelector("[data-testid=apply-portrait-frame]")'));
	await evaluate('document.querySelector("[data-testid=apply-portrait-frame]").click();document.querySelector("[data-testid=screen-layout-toggle]").click()');
	await pause(500);
	await evaluate('document.querySelector("[data-testid=screen-scale-up]").click()'); await pause(500);
	const sizes = await evaluate(`(()=>{const s=document.querySelector('[data-testid=screen-transform-box]').getBoundingClientRect(), c=document.querySelector('[data-testid=webcam-preview]').getBoundingClientRect(), p=document.querySelector('[data-testid=screen-transform-box]').parentElement.getBoundingClientRect();return {screen:s.toJSON(),camera:c.toJSON(),canvas:p.toJSON()};})()`);
	assert(sizes.screen.width > sizes.canvas.width, "Real recording did not enlarge beyond canvas");
	assert(Math.abs(sizes.camera.width / sizes.camera.height - .6) < .01, "Real portrait is not 3:5");
	for (const type of ["keyDown", "keyUp"]) await send("Input.dispatchKeyEvent", { type, key: "s", code: "KeyS", modifiers: 2, windowsVirtualKeyCode: 83 });
	await wait(async () => { const p = JSON.parse(await fs.readFile(project, "utf8")); return p.editor.webcam.frameStyle === "portrait" && p.editor.screenTransform.scale === 1.25; });
	await evaluate('document.querySelector("[data-testid=screen-layout-toggle]").click()'); await pause(400);
	const shot = await send("Page.captureScreenshot", { format: "png" }); await fs.writeFile(path.join(out, "installed-editor.png"), Buffer.from(shot.data, "base64"));
	const crop = await send("Page.captureScreenshot", { format: "png", clip: { x: sizes.canvas.x, y: sizes.canvas.y, width: sizes.canvas.width, height: sizes.canvas.height, scale: 1 } });
	await fs.writeFile(path.join(out, "preview.png"), Buffer.from(crop.data, "base64"));
	const exportUrl = new URL(url.href);
	for (const [key, value] of Object.entries({ smokeExport: "1", smokeProject: project, smokeOutput: output, smokePipelineModel: "modern", smokeBackendPreference: "webcodecs", smokeFps: "30", smokeQuality: "medium" })) exportUrl.searchParams.set(key, value);
	const started = Date.now(); await send("Page.navigate", { url: exportUrl.href });
	let report;
	for (let i = 0; i < 120; i++) { try { if ((await fs.stat(output + ".report.json")).mtimeMs >= started) { report = JSON.parse(await fs.readFile(output + ".report.json", "utf8")); break; } } catch {} await pause(500); }
	assert(report?.success, "Real recording export failed");
	const probe = spawnSync(require("ffprobe-static").path, ["-v", "error", "-show_streams", "-of", "json", output], { encoding: "utf8", windowsHide: true });
	assert(probe.status === 0, probe.stderr);
	const streams = JSON.parse(probe.stdout).streams;
	assert(streams.some(s => s.codec_type === "video" && s.width / s.height === 9 / 16), "Export dimensions incorrect");
	assert(streams.some(s => s.codec_type === "audio"), "Export lost audio");
	const frame = spawnSync(require("ffmpeg-static"), ["-y", "-v", "error", "-ss", "0.25", "-i", output, "-frames:v", "1", path.join(out, "export-frame.png")], { windowsHide: true }); assert(frame.status === 0, "Export frame decode failed");
	await fs.writeFile(path.join(out, "results.json"), JSON.stringify({ success: true, exe, project, output, sizes, streams }, null, 2));
	console.log("REGION EXPORT TEST PASSED", output);
} finally { socket?.close(); child.kill(); await log.close(); }
