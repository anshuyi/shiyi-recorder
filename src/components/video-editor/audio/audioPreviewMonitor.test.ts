import { describe,it,expect,vi } from 'vitest';
import { AudioPreviewMonitor } from './audioPreviewMonitor';
function setup(){
  let videoTime=0,expected=true,seeking=false;
  const a={src:'blob:voice',currentTime:0,paused:false,ended:false,seeking:false,muted:false,volume:1,readyState:4,networkState:1,error:null,duration:100,
    getAttribute:()=>a.src,addEventListener:vi.fn(),removeEventListener:vi.fn(),pause:vi.fn(()=>{a.paused=true;}),play:vi.fn(()=>{a.paused=false;return Promise.resolve();})} as unknown as HTMLAudioElement;
  const report=vi.fn(),status=vi.fn(),reload=vi.fn();
  const m=new AudioPreviewMonitor({target:()=>({videoTime,target:videoTime,rate:1,expected,seeking}),report,status});m.attach(a,'mic',reload);
  return {a,m,report,status,reload,tick:(t:number)=>{videoTime=t/1000;m.tick(t);},setExpected:(v:boolean)=>{expected=v;},setSeeking:(v:boolean)=>{seeking=v;}};
}
const flush=async()=>{for(let i=0;i<5;i++)await Promise.resolve();};
describe('actual recovery coordination',()=>{
  it('detects a frozen clock, synchronizes once and confirms two seconds of progress',async()=>{
    const s=setup();s.a.paused=true;
    for(let t=0;t<=2500;t+=500)s.tick(t);
    expect(s.status).toHaveBeenCalledWith('recovering');expect(s.a.currentTime).toBe(2.5);await flush();
    for(let t=3000;t<=5500;t+=500){s.a.currentTime=t/1000;s.tick(t);}
    expect(s.status).toHaveBeenLastCalledWith('recovered');expect(s.reload).not.toHaveBeenCalled();
  });
  it('reloads once then fails and blocks ordinary sync after persistent stalls',async()=>{
    const s=setup();s.a.paused=true;s.a.play=vi.fn(()=>Promise.reject(Error('blocked')));
    for(let t=0;t<=11500;t+=500){s.tick(t);await flush();}
    expect(s.reload).toHaveBeenCalledTimes(1);expect(s.status).toHaveBeenLastCalledWith('failed');expect(s.m.canSynchronize(s.a)).toBe(false);
    const count=vi.mocked(s.a.play).mock.calls.length;for(let t=12000;t<=18000;t+=500)s.tick(t);expect(vi.mocked(s.a.play).mock.calls.length).toBe(count);
    s.m.retry();expect(s.m.canSynchronize(s.a)).toBe(true);
  });
  it('cancels recovery when the user pauses and rejects a late play result',async()=>{
    const s=setup();let resolve!:()=>void;s.a.paused=true;s.a.play=vi.fn(()=>new Promise<void>(r=>{resolve=r;}));
    for(let t=0;t<=2500;t+=500)s.tick(t);
    s.setExpected(false);s.tick(3000);resolve();await flush();
    expect(s.a.pause).toHaveBeenCalled();expect(s.status).not.toHaveBeenCalledWith('failed');expect(s.reload).not.toHaveBeenCalled();
  });
  it('removes listeners and cancels work on detach',()=>{
    const s=setup();s.m.detach(s.a);expect(s.a.removeEventListener).toHaveBeenCalledTimes(10);expect(s.m.size).toBe(0);
    for(let t=0;t<10000;t+=500)s.tick(t);expect(s.status).not.toHaveBeenCalled();
  });
  it('never treats an inactive or seeking track as stalled',()=>{
    for(const mode of ['pause','seek']){const s=setup();if(mode==='pause')s.setExpected(false);else s.setSeeking(true);for(let t=0;t<10000;t+=500)s.tick(t);expect(s.status).not.toHaveBeenCalled();}
  });
  it('allows at most one pending play request',async()=>{
    const s=setup();let resolve!:()=>void;s.a.paused=true;s.a.play=vi.fn(()=>new Promise<void>(r=>{resolve=r;}));
    for(let i=0;i<10;i++)s.m.requestPlay(s.a,()=>{});expect(s.a.play).toHaveBeenCalledTimes(1);resolve();await flush();
  });
  it('clears an obsolete recovery notice when its track is removed',()=>{
    const s=setup();s.a.paused=true;for(let t=0;t<=2500;t+=500)s.tick(t);
    expect(s.status).toHaveBeenLastCalledWith('recovering');s.m.detach(s.a);
    expect(s.status).toHaveBeenLastCalledWith('cancelled');
  });
  it('does not emit a status update while the editor unmounts',()=>{
    const s=setup();s.a.paused=true;for(let t=0;t<=2500;t+=500)s.tick(t);
    s.status.mockClear();s.m.clear();expect(s.status).not.toHaveBeenCalled();
  });
});
