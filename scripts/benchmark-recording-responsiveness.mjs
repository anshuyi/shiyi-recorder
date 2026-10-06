import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
const label=process.argv[process.argv.indexOf('--label')+1]||'after';
if(!/^[a-z0-9-]+$/i.test(label))throw Error('invalid label');
const installed=process.argv.includes('--installed');
const exe=installed?path.join(process.env.LOCALAPPDATA,'Programs/recordly/Recordly.exe'):path.resolve('release/screen-layout/win-unpacked/Recordly.exe');
const out=path.resolve('.tmp/responsiveness',label);await fs.mkdir(out,{recursive:true});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function wait(fn){const end=Date.now()+25000;while(Date.now()<end){try{const r=await fn();if(r)return r}catch{}await sleep(25)}throw Error('benchmark timed out')}
async function connect(p){const ws=new WebSocket(p.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j});let n=0;const pending=new Map();ws.onmessage=e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result)}};ws.onclose=()=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('closed'))}pending.clear()};const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++n;const timer=setTimeout(()=>{pending.delete(id);reject(Error(method+' timed out'))},30000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}))});const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value};return {send,evaluate,close:()=>ws.close()}}
const results={label,installed,pollMs:25,cold:[],selections:[],resources:{},capturedAt:new Date().toISOString(),asarHash:createHash('sha256').update(await fs.readFile(path.join(path.dirname(exe),'resources/app.asar'))).digest('hex')};
for(let run=0;run<5;run++){
 const env={...process.env};for(const k of ['ELECTRON_RUN_AS_NODE','VITE_DEV_SERVER_URL','RECORDLY_DEV_OPEN_RECORDING_INPUT','RECORDLY_DEV_OPEN_RECORDING_WEBCAM'])delete env[k];
 const log=await fs.open(path.join(out,`run-${run}.log`),'w');const start=performance.now();
 const child=spawn(exe,[`--user-data-dir=${path.join(out,`profile-${run}`)}`,'--remote-debugging-port=9353','--remote-debugging-address=127.0.0.1'],{env,windowsHide:true,stdio:['ignore',log.fd,log.fd]});const connections=[];
 const pages=()=>fetch('http://127.0.0.1:9353/json/list').then(r=>r.json());
 try{
  const hud=await connect(await wait(async()=>(await pages()).find(p=>p.url.includes('hud-overlay'))));connections.push(hud);
  await wait(()=>hud.evaluate(`!!document.querySelector('button[title="Screen"]')`));results.cold.push(performance.now()-start);
  if(run===0){
   await hud.evaluate(`window.benchLag=[];window.benchLast=performance.now();window.benchTimer=setInterval(()=>{let n=performance.now();window.benchLag.push(n-window.benchLast);window.benchLast=n},50)`);
   const sourceStart=performance.now();await hud.evaluate(`document.querySelector('button[title="Screen"]').click()`);
   await wait(()=>hud.evaluate(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent.includes('自定义区域'))`));results.sourceListMs=performance.now()-sourceStart;
   for(let i=0;i<20;i++){
    const tick=performance.now();
    if(i===0)await hud.evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('自定义区域')).click()`);
    else await hud.evaluate(`window.benchSelection=window.electronAPI.selectCaptureRegion(window.benchSource);void 0`);
    const selector=await connect(await wait(async()=>(await pages()).find(p=>p.url.includes('region-selector'))));connections.push(selector);
    await wait(()=>selector.evaluate(`!!document.querySelector('[data-testid=region-confirm]')`));
    const openMs=performance.now()-tick;
    const context=await selector.evaluate(`window.electronAPI.getCaptureRegionContext()`);if(!context)throw Error('no context');
    await selector.evaluate(`window.benchPaint=[];window.addEventListener('pointermove',()=>{const t=performance.now();requestAnimationFrame(()=>window.benchPaint.push(performance.now()-t))})`);
    await selector.send('Input.dispatchMouseEvent',{type:'mousePressed',x:240,y:220,button:'left',buttons:1,clickCount:1});
    for(let j=1;j<=8;j++)await selector.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:240+j*50,y:220+j*20,button:'none',buttons:1});
    await selector.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:640,y:380,button:'left',buttons:0,clickCount:1});
    await wait(()=>selector.evaluate(`!document.querySelector('[data-testid=region-confirm]').disabled`));
    const measurements=await selector.evaluate(`({paint:window.benchPaint,resources:performance.getEntriesByType('resource').map(r=>({name:r.name.split('/').pop(),size:r.decodedBodySize})),heap:performance.memory?.usedJSHeapSize})`);
    const confirm=performance.now();await selector.evaluate(`document.querySelector('[data-testid=region-confirm]').click();void 0`).catch(()=>{});
    await wait(async()=>!(await pages()).some(p=>p.url.includes('region-selector')));
    if(i===0){await wait(()=>hud.evaluate(`window.electronAPI.getSelectedSource().then(s=>!!s?.captureRegion)`));await hud.evaluate(`window.electronAPI.getSelectedSource().then(s=>{window.benchSource=s})`)}
    else if(!await hud.evaluate('window.benchSelection'))throw Error('selection lost');
    results.selections.push({openMs,confirmMs:performance.now()-confirm,...measurements});
    console.log(label,'selection',i+1,Math.round(openMs));
   }
   results.resources.hud=await hud.evaluate(`performance.getEntriesByType('resource').map(r=>({name:r.name.split('/').pop(),size:r.decodedBodySize}))`);
   results.hudLag=await hud.evaluate('clearInterval(window.benchTimer);window.benchLag');
   results.heap=await hud.evaluate('performance.memory?.usedJSHeapSize');
  }
 }finally{for(const c of connections)c.close();child.kill();await new Promise(r=>{if(child.exitCode!==null)r();else child.once('exit',r)});await log.close();await sleep(700)}
 await fs.writeFile(path.join(out,'results.json'),JSON.stringify(results,null,2));
}
const stats=a=>{const s=[...a].sort((a,b)=>a-b);return {median:s[Math.floor(s.length/2)],p95:s[Math.ceil(s.length*.95)-1],max:s.at(-1)}};
results.summary={coldMs:stats(results.cold),selectionMs:stats(results.selections.map(s=>s.openMs)),confirmationMs:stats(results.selections.map(s=>s.confirmMs)),pointerPaintMs:stats(results.selections.flatMap(s=>s.paint))};
await fs.writeFile(path.join(out,'results.json'),JSON.stringify(results,null,2));console.log('BENCHMARK_COMPLETE',JSON.stringify(results.summary));
