// Runs the real renderers and MP4 exporter in an isolated Electron process.
import fs from "node:fs/promises";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, "..");
const out = path.join(root, ".tmp", "portrait-smoke");
await fs.mkdir(out, { recursive: true });
for (const camera of [false, true]) {
	const args = ["-y", "-f", "lavfi", "-i", camera ? "color=c=0x50819c:s=640x480:r=15:d=2" : "color=c=0xeeeeee:s=640x480:r=15:d=2"];
	if (!camera) args.push("-f", "lavfi", "-i", "sine=frequency=440:duration=2");
	if (camera) args.push("-vf", "drawbox=x=220:y=170:w=200:h=310:color=0xc97660:t=fill,drawbox=x=258:y=32:w=125:h=150:color=0xf4cba9:t=fill,drawbox=x=258:y=22:w=125:h=35:color=0x26323e:t=fill,drawbox=x=190:y=0:w=40:h=480:color=0xfb4141:t=fill,drawbox=x=410:y=0:w=40:h=480:color=0x30db50:t=fill");
	args.push("-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", path.join(out, camera ? "camera-source.mp4" : "screen-source.mp4"));
	const encoded = spawnSync(require("ffmpeg-static"), args, { windowsHide: true, encoding: "utf8" });
	if (encoded.status !== 0) throw new Error(encoded.stderr);
}
const workerName = (await fs.readdir(path.join(root, "dist", "assets"))).find(name => /^webcamBackgroundBlur\.worker-.*\.js$/.test(name));
if (!workerName) throw new Error("Run vite build before this smoke test");
await fs.writeFile(path.join(out, "test.html"), `<!doctype html><html><body style="background:#eee"><script>window.smokeWorkerUrl='/smoke-assets/${workerName}'</script><script type="module" src="/scripts/smoke-webcam-portrait.browser.mjs"></script></body></html>`);
// Test the production worker: Vite rewrites MediaPipe's dynamic public JS imports in dev mode.
const staticWorker = { name: "smoke-production-worker", configureServer(server) { server.middlewares.use(async (req, res, next) => { if (req.url !== `/smoke-assets/${workerName}`) return next(); res.setHeader("Content-Type", "application/javascript"); res.end(await fs.readFile(path.join(root, "dist", "assets", workerName))); }); } };
const server = await createServer({ root, configFile: false, plugins: [staticWorker, react()], resolve: { alias: { "@": path.join(root, "src") } }, server: { host: "127.0.0.1", port: 5187, strictPort: true } });
await server.listen();
const runner = path.join(out, "runner.cjs");
await fs.writeFile(runner, `
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
app.setPath('userData',path.join(__dirname,'electron-profile'));
app.commandLine.appendSwitch('autoplay-policy','no-user-gesture-required');
app.whenReady().then(async()=>{
 const w=new BrowserWindow({show:false,width:1200,height:800,webPreferences:{backgroundThrottling:false}});
 w.webContents.on('console-message',(_e,_l,m)=>console.log(m));
 try{
  await w.loadURL('http://127.0.0.1:5187/.tmp/portrait-smoke/test.html');
  const result=await w.webContents.executeJavaScript('(async()=>{for(let i=0;i<100;i++){if(window.smokePromise)return await window.smokePromise;await new Promise(r=>setTimeout(r,100));}throw new Error("Smoke module did not load");})()');
  for(const [name,data] of Object.entries(result.files)){ fs.writeFileSync(path.join(__dirname,name),Buffer.from(data,'base64')); }
  delete result.files;
  fs.writeFileSync(path.join(__dirname,'smoke-results.json'),JSON.stringify(result,null,2));
  fs.writeFileSync(path.join(__dirname,'render-comparison.png'),(await w.webContents.capturePage()).toPNG());
  console.log('SMOKE RESULT '+JSON.stringify(result));
  app.exit(0);
 }catch(e){console.error(e?.stack||e?.message||String(e));app.exit(1)}
});
setTimeout(()=>{console.error('SMOKE timeout');app.exit(2)},150000);
`);
try {
	const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
	const child = spawn(require("electron"), [runner], { cwd: root, env, windowsHide: true, stdio: "inherit" });
	process.exitCode = await new Promise((resolve, reject) => { child.on("exit", (code) => resolve(code ?? 1)); child.on("error", reject); });
} finally { await server.close(); }
