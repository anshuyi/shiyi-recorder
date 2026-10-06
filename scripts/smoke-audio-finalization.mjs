import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { build } from 'esbuild';
const require = createRequire(import.meta.url), root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, '.tmp/audio-finalization-20261006', `real-${Date.now()}`);
await fs.mkdir(out, {recursive:true});
await build({ entryPoints:[path.join(root,'scripts/smoke-audio-finalization.browser.tsx')], bundle:true, platform:'browser', format:'iife', outfile:path.join(out,'harness.js'), alias:{'@':path.join(root,'src')} });
await build({ stdin:{contents:`export {publishMicrophoneSidecar,validatePcmWave} from './electron/ipc/recording/microphoneSidecarPublication'; export {ensureMediaServer,buildMediaUrl} from './electron/mediaServer'; export {approvedLocalReadPaths} from './electron/ipc/state';`,resolveDir:root,loader:'ts'}, bundle:true,platform:'node',format:'cjs',external:['electron'],outfile:path.join(out,'production.cjs') });
await fs.writeFile(path.join(out,'index.html'), '<html><body><script src="harness.js"></script></body></html>');
await fs.writeFile(path.join(out,'preload.cjs'), `const {contextBridge,ipcRenderer}=require('electron'); contextBridge.exposeInMainWorld('audioFinalizationTest',Object.fromEntries(['setup','completeLegacy','completeRetry','startPublication','finishPublication'].map(name=>[name,()=>ipcRenderer.invoke(name)]))); contextBridge.exposeInMainWorld('electronAPI',{getVideoAudioFallbackPaths:p=>ipcRenderer.invoke('lookup',p),getLocalMediaUrl:p=>ipcRenderer.invoke('url',p)});`);
await fs.writeFile(path.join(out,'main.cjs'), `
const {app,BrowserWindow,ipcMain}=require('electron'), fs=require('node:fs/promises'),path=require('node:path');
const {publishMicrophoneSidecar,validatePcmWave,ensureMediaServer,buildMediaUrl,approvedLocalReadPaths}=require('./production.cjs');
app.setPath('userData',path.join(__dirname,'profile'));app.commandLine.appendSwitch('mute-audio');app.commandLine.appendSwitch('autoplay-policy','no-user-gesture-required');
function wav(seconds,growing=false){const size=seconds*96000,b=Buffer.alloc(44+size);b.write('RIFF');b.writeUInt32LE(growing?0xffffffff:36+size,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(48000,24);b.writeUInt32LE(96000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(growing?0xffffffff:size,40);for(let i=0;i<size/2;i++)b.writeInt16LE(Math.round(5000*Math.sin(i*440*2*Math.PI/48000)),44+i*2);return b;}
const paths=Object.fromEntries(['legacy','retry','atomic','short'].map(k=>[k,path.join(__dirname,'中文 '+k+'.mic.wav')]));let release,job,base;
ipcMain.handle('setup',async()=>{base=await ensureMediaServer();await fs.writeFile(paths.legacy,wav(2,true));await fs.writeFile(paths.retry,wav(2,true));await fs.writeFile(paths.short,wav(2));return paths;});
ipcMain.handle('lookup',async(_,p)=>({success:true,paths:await fs.stat(p).then(()=>[p],()=>[]),startDelayMsByPath:{}}));
ipcMain.handle('url',async(_,p)=>{approvedLocalReadPaths.add(await fs.realpath(p));return {success:true,url:buildMediaUrl(base,p)};});
ipcMain.handle('completeLegacy',()=>fs.writeFile(paths.legacy,wav(12)));ipcMain.handle('completeRetry',()=>fs.writeFile(paths.retry,wav(12)));
ipcMain.handle('startPublication',async()=>{let started;const ready=new Promise(r=>started=r);job=publishMicrophoneSidecar(paths.atomic,async temp=>{await fs.writeFile(temp,wav(2,true));await new Promise(r=>{release=r;started();});await fs.writeFile(temp,wav(12));},validatePcmWave);await ready;});
ipcMain.handle('finishPublication',async()=>{release();await job;});
app.whenReady().then(async()=>{const w=new BrowserWindow({show:false,webPreferences:{sandbox:true,preload:path.join(__dirname,'preload.cjs'),backgroundThrottling:false}});try{await w.loadFile(path.join(__dirname,'index.html'));const result=await w.webContents.executeJavaScript('window.smokePromise');await fs.writeFile(path.join(__dirname,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({out:__dirname,...result}));app.exit(0);}catch(e){console.error(e.stack);app.exit(1);}});setTimeout(()=>app.exit(2),45000);
`);
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const child=spawn(require('electron'),[path.join(out,'main.cjs'),'--mute-audio'],{env,windowsHide:true,stdio:'inherit'});
process.exitCode=await new Promise((resolve,reject)=>{child.on('exit',c=>resolve(c??1));child.on('error',reject);});
