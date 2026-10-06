import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
const require=createRequire(import.meta.url),root=path.resolve(import.meta.dirname,".."),out=path.join(root,".tmp","screen-layout-smoke");
await fs.mkdir(out,{recursive:true});
await fs.writeFile(path.join(out,"render.html"),'<html><body><script type="module" src="/scripts/smoke-screen-layout-render.browser.mjs"></script></body></html>');
const server=await createServer({root,configFile:false,plugins:[react()],resolve:{alias:{"@":path.join(root,"src")}},server:{host:"127.0.0.1",port:5189,strictPort:true}});await server.listen();
const runner=path.join(out,"render.cjs");
await fs.writeFile(runner,`const {app,BrowserWindow}=require('electron');const fs=require('node:fs');const path=require('node:path');app.setPath('userData',path.join(__dirname,'render-profile'));app.whenReady().then(async()=>{const w=new BrowserWindow({show:false,width:800,height:900,webPreferences:{backgroundThrottling:false}});w.webContents.on('console-message',(_e,_l,m)=>console.log(m));try{await w.loadURL('http://127.0.0.1:5189/.tmp/screen-layout-smoke/render.html');const result=await w.webContents.executeJavaScript('(async()=>{for(let i=0;i<100;i++){if(window.smokePromise)return await window.smokePromise;await new Promise(r=>setTimeout(r,100));}throw Error("No test module");})()');for(const [name,data]of Object.entries(result.files))fs.writeFileSync(path.join(__dirname,name),Buffer.from(data,'base64'));delete result.files;fs.writeFileSync(path.join(__dirname,'render-results.json'),JSON.stringify(result,null,2));console.log('RENDER SMOKE '+JSON.stringify(result));app.exit(0);}catch(e){console.error(e.stack||String(e));app.exit(1);}});setTimeout(()=>app.exit(2),180000);`);
try{const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;const child=spawn(require('electron'),[runner],{cwd:root,env,windowsHide:true,stdio:'inherit'});process.exitCode=await new Promise((resolve,reject)=>{child.on('exit',c=>resolve(c??1));child.on('error',reject);});}finally{await server.close();}
