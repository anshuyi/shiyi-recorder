import { describe,it,expect,vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const electron=vi.hoisted(()=>({app:{getPath:vi.fn(()=>'/unused-test-profile'),getVersion:vi.fn(()=>'test'),on:vi.fn()},BrowserWindow:{fromWebContents:vi.fn()},dialog:{showSaveDialog:vi.fn()},ipcMain:{on:vi.fn(),handle:vi.fn()}}));
vi.mock('electron',()=>electron);
import { AudioPlaybackLog,sanitizeAudioDiagnostic,registerAudioPlaybackDiagnostics } from './audioPlayback';
const entry={session:'audio-1',track:'mic-1',event:'sample',now:123,audioTime:1,expected:true};
describe('bounded local audio diagnostics',()=>{
  it('validates numbers, ids and events; removes arbitrary fields and paths',()=>{
    expect(sanitizeAudioDiagnostic({...entry,path:'C:/private/file',audio:'secret'})).toEqual(entry);
    for(const patch of [{session:'../../file'},{track:'x'.repeat(81)},{now:NaN},{audioTime:Infinity},{expected:'yes'},{event:'unknown'}])expect(sanitizeAudioDiagnostic({...entry,...patch})).toBeNull();
  });
  it('serializes writes, rotates two generations and bounds queued work',async()=>{
    const root=await fs.mkdtemp(path.join(os.tmpdir(),'recordly-audio-log-'));
    try{const file=path.join(root,'audio.jsonl'),log=new AudioPlaybackLog(file,200,'test');
      for(let i=0;i<12;i++){log.append({...entry,now:i});await log.flush();}
      expect((await fs.readdir(root)).sort()).toEqual(['audio.jsonl','audio.jsonl.1','audio.jsonl.2']);
      const lines=(await log.contents()).trim().split('\n').map(s=>JSON.parse(s));expect(lines.at(-1).now).toBe(11);
      expect(lines.every(l=>l.build==='test')).toBe(true);
      const accepted=Array.from({length:200},()=>log.append(entry)).filter(Boolean);expect(accepted.length).toBe(100);await log.flush();
    }finally{await fs.rm(root,{recursive:true,force:true});}
  });
  it('isolates write failures from playback',async()=>{
    const root=await fs.mkdtemp(path.join(os.tmpdir(),'recordly-audio-log-'));
    try{await fs.writeFile(path.join(root,'file'),'x');const log=new AudioPlaybackLog(path.join(root,'file','invalid'));log.append(entry);await expect(log.flush()).resolves.toBeUndefined();}finally{await fs.rm(root,{recursive:true,force:true});}
  });
  it('accepts only the editor main frame, bounds IPC traffic and registers once',async()=>{
    const append=vi.spyOn(AudioPlaybackLog.prototype,'append').mockReturnValue(true);
    try {
      registerAudioPlaybackDiagnostics();registerAudioPlaybackDiagnostics();
      expect(electron.ipcMain.on).toHaveBeenCalledTimes(1);
      expect(electron.ipcMain.handle).toHaveBeenCalledTimes(1);
      const receive=electron.ipcMain.on.mock.calls[0][1];
      const save=electron.ipcMain.handle.mock.calls[0][1];
      const frame={},sender={id:12,mainFrame:frame,getURL:()=> 'file:///editor.html?windowType=editor'};
      const event={sender,senderFrame:frame};
      electron.BrowserWindow.fromWebContents.mockReturnValue({});
      receive({...event,senderFrame:{}},entry);
      receive({...event,sender:{...sender,getURL:()=> 'file:///editor.html?windowType=recorder'}},entry);
      electron.BrowserWindow.fromWebContents.mockReturnValue(null);receive(event,entry);
      expect(append).not.toHaveBeenCalled();
      expect(await save(event)).toEqual({success:false});
      expect(electron.dialog.showSaveDialog).not.toHaveBeenCalled();
      electron.BrowserWindow.fromWebContents.mockReturnValue({});
      for(let i=0;i<150;i++)receive(event,entry);
      expect(append).toHaveBeenCalledTimes(100);
      electron.dialog.showSaveDialog.mockResolvedValue({canceled:true});
      expect(await save(event)).toEqual({success:false,canceled:true});
    } finally {append.mockRestore();}
  });
});
