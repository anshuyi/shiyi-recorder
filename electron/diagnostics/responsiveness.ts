import { app, BrowserWindow, ipcMain } from "electron";
import fs from "node:fs/promises";
import path from "node:path";

const phases = new Set(['window','sources','region','monitor','permissions','camera','microphone','capture','recording','save']);
const states = new Set(['start','ready','end','error','cancel','unresponsive','gone','stall']);
let queue = Promise.resolve();
let queued = 0;
export function recordResponsiveness(phase: string, state: string, elapsedMs?: number, operation?: string) {
	if (!phases.has(phase) || !states.has(state) || queued >= 100) return;
	const entry = {at:new Date().toISOString(),phase,state,
		...(Number.isFinite(elapsedMs) ? {elapsedMs:Math.round(Math.max(0,Math.min(elapsedMs!,86400000)))} : {}),
		...(operation && /^[a-z0-9-]{1,64}$/i.test(operation) ? {operation} : {})};
	queued++;
	queue = queue.then(async()=>{
		const dir=path.join(app.getPath('userData'),'logs');await fs.mkdir(dir,{recursive:true});
		const file=path.join(dir,'responsiveness.jsonl');
		if ((await fs.stat(file).catch(()=>null))?.size! > 1024*1024) {
			await fs.rm(file+'.1',{force:true});await fs.rename(file,file+'.1');
		}
		await fs.appendFile(file,JSON.stringify(entry)+'\n');
	}).catch(()=>undefined).finally(()=>{queued--});
}

export function registerResponsivenessDiagnostics() {
	const rates = new Map<number,{at:number,count:number}>();
	ipcMain.on('operation-diagnostic',(event,data:unknown)=>{
		if (event.senderFrame !== event.sender.mainFrame || !BrowserWindow.fromWebContents(event.sender)) return;
		if (!data || typeof data !== 'object') return;
		const d=data as Record<string,unknown>;
		if (typeof d.phase!=='string'||typeof d.state!=='string')return;
		const now=Date.now(),old=rates.get(event.sender.id);
		const limit=old&&now-old.at<1000?old:{at:now,count:0};
		if(++limit.count>20)return;rates.set(event.sender.id,limit);
		recordResponsiveness(d.phase,d.state,typeof d.elapsedMs==='number'?d.elapsedMs:undefined,typeof d.operation==='string'?d.operation:undefined);
	});
	app.on('browser-window-created',(_event,win)=>{
		const started=performance.now();
		win.once('ready-to-show',()=>recordResponsiveness('window','ready',performance.now()-started));
		win.on('unresponsive',()=>recordResponsiveness('window','unresponsive'));
		win.webContents.on('render-process-gone',()=>recordResponsiveness('window','gone'));
		win.webContents.on('did-fail-load',()=>recordResponsiveness('window','error'));
		const id=win.webContents.id;win.once('closed',()=>rates.delete(id));
	});
	let previous=performance.now();const timer=setInterval(()=>{
		const now=performance.now(),lag=now-previous-1000;previous=now;
		if(lag>250)recordResponsiveness('window','stall',lag);
	},1000);timer.unref();app.once('will-quit',()=>clearInterval(timer));
}
