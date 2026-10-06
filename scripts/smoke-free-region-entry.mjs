import fs from 'node:fs/promises';import path from 'node:path';import {spawn} from 'node:child_process';
const out=path.resolve('.tmp/free-region-entry-smoke');await fs.mkdir(out,{recursive:true});const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.RECORDLY_DEV_OPEN_RECORDING_INPUT;delete env.RECORDLY_DEV_OPEN_RECORDING_WEBCAM;delete env.VITE_DEV_SERVER_URL;
const child=spawn(path.join(process.env.LOCALAPPDATA,'Programs/recordly/Recordly.exe'),['--remote-debugging-port=9343',`--user-data-dir=${path.join(out,'profile')}`],{env,windowsHide:true,stdio:'ignore'}),sockets=[];
const sleep=ms=>new Promise(r=>setTimeout(r,ms)),wait=async(fn)=>{for(let i=0;i<150;i++){try{const v=await fn();if(v)return v}catch{}await sleep(100)}throw Error('timed out')},pages=()=>fetch('http://127.0.0.1:9343/json/list').then(r=>r.json());
async function connect(p){const ws=new WebSocket(p.webSocketDebuggerUrl);sockets.push(ws);await new Promise(r=>ws.onopen=r);let id=0;const pending=new Map();ws.onmessage=e=>{const m=JSON.parse(e.data),f=pending.get(m.id);if(f){pending.delete(m.id);m.error?f.reject(Error(JSON.stringify(m.error))):f.resolve(m.result)}};ws.onclose=()=>{for(const f of pending.values())f.reject(Error('closed'))};const send=(method,params)=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params}))});const evaluate=async(expression)=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value};return{send,evaluate}}
try{
 const hud=await connect(await wait(async()=> (await pages()).find(p=>p.url.includes('hud-overlay'))));
 await wait(()=>hud.evaluate(`!!document.querySelector('button[title="Screen"]')`));
 await hud.evaluate(`document.querySelector('button[title="Screen"]').click()`);
 await wait(()=>hud.evaluate(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent.includes('自定义区域'))`));
 await hud.evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('自定义区域')).click()`);
 const selector=await connect(await wait(async()=> (await pages()).find(p=>p.url.includes('region-selector'))));
 await wait(()=>selector.evaluate(`!!document.querySelector('[data-testid=region-confirm]')`));
 if(!await selector.evaluate(`!document.querySelector('[data-testid=capture-rectangle]') && document.querySelector('[data-testid=region-confirm]').disabled`))throw Error('Initial selection not empty');
 const mouse=(type,x,y,buttons=0)=>selector.send('Input.dispatchMouseEvent',{type,x,y,button:type==='mouseMoved'?'none':'left',buttons,clickCount:type==='mouseMoved'?0:1});
 await mouse('mousePressed',200,200,1);for(let i=1;i<=8;i++){await mouse('mouseMoved',200+600*i/8,200+180*i/8,1);await sleep(20)}await mouse('mouseReleased',800,380);await sleep(100);
 const context=await selector.evaluate('window.electronAPI.getCaptureRegionContext()');
 const drawn=await selector.evaluate(`(()=>{const r=document.querySelector('[data-testid=capture-rectangle]').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()`);
 if(drawn.width!==600||drawn.height!==180)throw Error('Pointer rectangle constrained');
 await selector.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13}).catch(()=>{});
 const chosen=await wait(()=>hud.evaluate(`window.electronAPI.getSelectedSource().then(s=>s?.captureRegion?s:null)`));
 if(Math.abs(chosen.captureRegion.width*context.width-600)>1||Math.abs(chosen.captureRegion.height*context.height-180)>1)throw Error('Selected area differs from mouse');
 if(!chosen.name.includes('自定义区域'))throw Error('Selection did not reach HUD');
 await wait(()=>hud.evaluate(`!!Array.from(document.querySelectorAll('button')).find(b=>b.title.includes('自定义区域'))`));
 const shot=await hud.send('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(out,'hud.png'),Buffer.from(shot.data,'base64'));await fs.writeFile(path.join(out,'results.json'),JSON.stringify({success:true,chosen:{...chosen,thumbnail:undefined},drawn},null,2));console.log('INSTALLED_FREE_ENTRY_SUCCESS',chosen.name);
}finally{for(const ws of sockets)ws.close();child.kill()}
