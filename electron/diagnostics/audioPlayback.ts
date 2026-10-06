import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { AudioPlaybackDiagnostic } from '../../src/lib/audioPlaybackDiagnostics';
const eventNames=new Set('sample fault recovering recovered failed cancelled manual-retry snapshot devicechange visibilitychange play playing pause waiting stalled seeking seeked ended error emptied play-rejected attached removed'.split(' '));
const numericKeys=['videoTime','audioTime','target','rate','volume','readyState','networkState','errorCode','generation','bufferedEnd'] as const;
const booleanKeys=['expected','paused','ended','seeking','muted','hidden'] as const;
export function sanitizeAudioDiagnostic(input:unknown):AudioPlaybackDiagnostic|null {
  if(!input || typeof input!=='object')return null;
  const d=input as Record<string,unknown>;
  if(typeof d.session!=='string'||!/^[a-z0-9-]{1,80}$/i.test(d.session)||typeof d.track!=='string'||!/^[a-z0-9-]{1,80}$/i.test(d.track)||typeof d.event!=='string'||!eventNames.has(d.event)||typeof d.now!=='number'||!Number.isFinite(d.now)||d.now<0)return null;
  const result:Record<string,unknown>={session:d.session,track:d.track,event:d.event,now:d.now};
  for(const k of numericKeys){if(d[k]!==undefined){if(typeof d[k]!=='number'||!Number.isFinite(d[k])||Math.abs(d[k])>1e10)return null;result[k]=d[k];}}
  for(const k of booleanKeys){if(d[k]!==undefined){if(typeof d[k]!=='boolean')return null;result[k]=d[k];}}
  return result as unknown as AudioPlaybackDiagnostic;
}
export class AudioPlaybackLog {
  private queue=Promise.resolve();private queued=0;
  constructor(readonly file:string,private limit=2*1024*1024,private build='unknown'){}
  append(data:unknown):boolean {
    const d=sanitizeAudioDiagnostic(data);if(!d||this.queued>=100)return false;
    this.queued++;
    this.queue=this.queue.then(async()=>{
      await fs.mkdir(path.dirname(this.file),{recursive:true});
      if(((await fs.stat(this.file).catch(()=>null))?.size??0)>=this.limit){
        await fs.rm(this.file+'.2',{force:true});
        if(await fs.stat(this.file+'.1').catch(()=>null))await fs.rename(this.file+'.1',this.file+'.2');
        await fs.rename(this.file,this.file+'.1');
      }
      await fs.appendFile(this.file,JSON.stringify({at:new Date().toISOString(),build:this.build,...d})+'\n');
    }).catch(()=>undefined).finally(()=>{this.queued--;});
    return true;
  }
  async flush(){await this.queue;}
  async contents(){await this.flush();return (await Promise.all([this.file+'.2',this.file+'.1',this.file].map(p=>fs.readFile(p,'utf8').catch(()=>'')))).join('');}
}
let registered=false;
export function registerAudioPlaybackDiagnostics() {
  if(registered)return;registered=true;
  const file=path.join(app.getPath('userData'),'logs','audio-playback.jsonl');
  const log=new AudioPlaybackLog(file,undefined,`${app.getVersion()}-audio-reliability-20261003`);
  const rates=new Map<number,{at:number;count:number}>();
  const valid=(event:Electron.IpcMainEvent|Electron.IpcMainInvokeEvent)=>{
    if(event.senderFrame!==event.sender.mainFrame || !BrowserWindow.fromWebContents(event.sender))return false;
    try{return new URL(event.sender.getURL()).searchParams.get('windowType')==='editor';}catch{return false;}
  };
  ipcMain.on('audio-playback-diagnostic',(event,data:unknown)=>{
    if(!valid(event))return;
    const now=Date.now(),old=rates.get(event.sender.id),rate=old&&now-old.at<1000?old:{at:now,count:0};
    rates.set(event.sender.id,rate);if(++rate.count>100)return;log.append(data);
  });
  const saving=new Set<number>();
  ipcMain.handle('save-audio-playback-diagnostic',async event=>{
    if(!valid(event)||saving.has(event.sender.id))return {success:false};
    saving.add(event.sender.id);
    try {
      const win=BrowserWindow.fromWebContents(event.sender)!;
      const result=await dialog.showSaveDialog(win,{title:'Save audio playback diagnostics',defaultPath:'Recordly-audio-diagnostics.jsonl',filters:[{name:'Diagnostic log',extensions:['jsonl']}]});
      if(result.canceled||!result.filePath)return {success:false,canceled:true};
      await fs.writeFile(result.filePath,await log.contents(),'utf8');return {success:true};
    }catch{return {success:false};}finally{saving.delete(event.sender.id);}
  });
  app.on('browser-window-created',(_event,win)=>{const id=win.webContents.id;win.once('closed',()=>{rates.delete(id);saving.delete(id);});});
}
