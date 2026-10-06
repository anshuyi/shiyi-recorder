export const pause=ms=>new Promise(r=>setTimeout(r,ms));
export async function waitFor(fn,label='condition',timeout=30000){const end=Date.now()+timeout;while(Date.now()<end){try{const r=await fn();if(r)return r}catch{}await pause(50)}throw Error('Timed out: '+label)}
export async function connectPage(page){
 const ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j});let id=0;const pending=new Map();
 ws.onmessage=e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result)}};
 ws.onclose=()=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('Page closed'))}pending.clear()};
 const send=(method,params={},timeout=45000)=>new Promise((resolve,reject)=>{const n=++id,timer=setTimeout(()=>{pending.delete(n);reject(Error(method+' timeout'))},timeout);pending.set(n,{resolve,reject,timer});ws.send(JSON.stringify({id:n,method,params}))});
 const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||JSON.stringify(r.exceptionDetails));return r.result.value};
 return{send,evaluate,close:()=>ws.close()};
}
