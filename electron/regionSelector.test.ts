import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
const mocks=vi.hoisted(()=>({handlers:new Map<string,Function>(),windows:[] as any[],query:vi.fn(),read:vi.fn(),write:vi.fn()}));
vi.mock('./ipc/state',()=>({nativeScreenRecordingActive:false,isCursorCaptureActive:false}));
vi.mock('./ipc/monitorResolver',()=>({getMonitorHandles:mocks.query}));
vi.mock('./rendererServer',()=>({getPackagedRendererBaseUrl:()=> 'http://localhost'}));
vi.mock('./diagnostics/responsiveness',()=>({recordResponsiveness:vi.fn()}));
vi.mock('node:fs/promises',()=>({default:{readFile:mocks.read,writeFile:mocks.write}}));
vi.mock('electron',async()=>{
	const {EventEmitter}=await import('node:events');
	class Window extends EventEmitter {
		webContents=new EventEmitter();dead=false;show=vi.fn();focus=vi.fn();
		constructor(){super();mocks.windows.push(this)}
		setAlwaysOnTop(){} setContentProtection(){} isDestroyed(){return this.dead}
		destroy(){this.dead=true;this.emit('closed')}
		async loadURL(){this.emit('ready-to-show')} async loadFile(){this.emit('ready-to-show')}
	}
	const screen=Object.assign(new EventEmitter(),{getAllDisplays:()=>[{id:1,bounds:{x:0,y:0,width:1707,height:960},scaleFactor:1.5}],dipToScreenPoint:(p:any)=>({x:p.x*1.5,y:p.y*1.5})});
	return {app:{getPath:()=>'/tmp',getAppPath:()=>'/tmp'},screen,BrowserWindow:Window,ipcMain:{handle:(name:string,handler:Function)=>mocks.handlers.set(name,handler)}};
});
import { screen } from 'electron';
import { registerRegionSelectorHandlers } from './regionSelector';
const source={id:'screen:1:0',display_id:'1',name:'Screen'};
let owner:EventEmitter & {id:number};
const call=(name:string,sender:unknown,value?:unknown)=>mocks.handlers.get(name)!({sender},value);
const open=()=>call('select-capture-region',owner,source) as Promise<unknown>;
async function ready(){await vi.waitFor(()=>expect(mocks.windows.length).toBeGreaterThan(0));const w=mocks.windows.at(-1);call('get-capture-region-context',w.webContents);return w}
beforeEach(()=>{
	mocks.handlers.clear();mocks.windows.length=0;mocks.query.mockReset().mockResolvedValue([{handle:1,x:0,y:0,width:2560,height:1440}]);mocks.read.mockReset().mockResolvedValue('{}');mocks.write.mockReset().mockResolvedValue(undefined);
	owner=Object.assign(new EventEmitter(),{id:4});registerRegionSelectorHandlers();
});
afterEach(()=>{call('cancel-capture-region',owner);vi.useRealTimers()});
describe('region window recovery',()=>{
	it('cancels before slow lookup returns without leaving a late window',async()=>{
		let resolve!:Function;mocks.query.mockImplementationOnce(()=>new Promise(r=>resolve=r));const p=open();expect(call('cancel-capture-region',owner)).toBe(true);expect(await p).toBeNull();resolve([]);await Promise.resolve();await Promise.resolve();expect(mocks.windows).toHaveLength(0);
	});
	it('never lets an old lookup close a new selection',async()=>{
		let resolve!:Function;mocks.query.mockImplementationOnce(()=>new Promise(r=>resolve=r));const old=open();call('cancel-capture-region',owner);await old;const next=open();const w=await ready();resolve([]);await Promise.resolve();expect(w.dead).toBe(false);call('finish-capture-region',w.webContents,null);expect(await next).toBeNull();
	});
	it('rejects unavailable monitors and allows retry',async()=>{
		mocks.query.mockResolvedValueOnce([]);await expect(open()).rejects.toThrow();const p=open();const w=await ready();call('finish-capture-region',w.webContents,null);await p;
	});
	it('recovers a crashed renderer and releases listeners',async()=>{
		const p=open();const rejection=expect(p).rejects.toThrow('退出');const w=await ready();w.webContents.emit('render-process-gone');await rejection;expect(w.dead).toBe(true);expect(screen.listenerCount('display-removed')).toBe(0);
	});
	it('handles Escape in the main process before renderer code can respond',async()=>{
		const p=open();const w=await ready();const e={preventDefault:vi.fn()};w.webContents.emit('before-input-event',e,{type:'keyDown',key:'Escape'});expect(await p).toBeNull();expect(e.preventDefault).toHaveBeenCalled();
	});
	it('does not block confirmation on preference writes',async()=>{
		mocks.write.mockImplementationOnce(()=>new Promise(()=>{}));const p=open();const w=await ready();await call('finish-capture-region',w.webContents,{region:{x:.1,y:.1,width:.5,height:.4}});expect(await p).toMatchObject({captureRegion:{width:.5}});expect(w.dead).toBe(true);
	});
	it('bounds preparation but never times out an active drawing session',async()=>{
		vi.useFakeTimers();const p=open();await vi.advanceTimersByTimeAsync(20);const w=mocks.windows.at(-1);expect(w).toBeTruthy();call('get-capture-region-context',w.webContents);await vi.advanceTimersByTimeAsync(30000);expect(w.dead).toBe(false);call('cancel-capture-region',owner);await p;
	});
	it('preparation timeout releases the request even if disk read never resolves',async()=>{
		vi.useFakeTimers();mocks.read.mockImplementationOnce(()=>new Promise(()=>{}));const p=open();const check=expect(p).rejects.toThrow('超时');await vi.advanceTimersByTimeAsync(12001);await check;expect(mocks.windows).toHaveLength(0);
	});
});
