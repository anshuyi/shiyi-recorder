import type { AudioPlaybackDiagnostic, AudioPlaybackEvent } from '@/lib/audioPlaybackDiagnostics';
import { evaluateAudioHealth, type HealthState, type PlaybackSample } from './audioPreviewHealth';
import { AudioPreviewRecovery } from './audioPreviewRecovery';

export interface AudioTarget { expected:boolean; target:number; rate:number; videoTime:number; seeking:boolean; }
export interface MonitorOptions {
  target:(audio:HTMLAudioElement)=>AudioTarget;
  report:(entry:AudioPlaybackDiagnostic)=>void;
  status:(status:'recovering'|'recovered'|'failed'|'cancelled')=>void;
}
type Entry={id:string;audio:HTMLAudioElement;reload:()=>void;control:AudioPreviewRecovery;health?:HealthState;
  ring:AudioPlaybackDiagnostic[];pending?:Promise<void>;cleanup:()=>void;serial:number;lastSummary:number;
  step?:number;stepAt?:number;progressAt?:number;lastProgress?:number;stepTarget?:number;};
const events=['play','playing','pause','waiting','stalled','seeking','seeked','ended','error','emptied'] as const;

/** One timer for the editor; no PCM analysis and no React updates on normal ticks. */
export class AudioPreviewMonitor {
  private entries=new Map<HTMLAudioElement,Entry>();
  private sequence=0;
  private readonly session=`audio-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;
  constructor(private options:MonitorOptions) {}
  private log(e:Entry,event:AudioPlaybackEvent,now=performance.now()) {
    const a=e.audio,t=this.options.target(a);
    const d:AudioPlaybackDiagnostic={session:this.session,track:e.id,event,now,videoTime:t.videoTime,audioTime:a.currentTime,target:t.target,rate:t.rate,expected:t.expected,paused:a.paused,ended:a.ended,seeking:a.seeking,muted:a.muted,volume:a.volume,readyState:a.readyState,networkState:a.networkState,errorCode:a.error?.code??0,hidden:typeof document!=='undefined'&&document.hidden,generation:e.serial};
    try{if(a.buffered?.length)d.bufferedEnd=a.buffered.end(a.buffered.length-1);}catch{/* detached resource */}
    if(event==='sample'){e.ring.push(d);if(e.ring.length>60)e.ring.shift();}
    else this.options.report(d);
    return d;
  }
  attach(audio:HTMLAudioElement,kind:string,reload:()=>void) {
    if(this.entries.has(audio))return;
    const e:Entry={audio,id:`${kind}-${++this.sequence}`,reload,control:new AudioPreviewRecovery(),ring:[],serial:0,lastSummary:0,cleanup:()=>{}};
    const listeners=events.map(event=>{const fn=()=>this.log(e,event);audio.addEventListener?.(event,fn);return ()=>audio.removeEventListener?.(event,fn);});
    e.cleanup=()=>listeners.forEach(fn=>fn());this.entries.set(audio,e);this.log(e,'attached');
  }
  detach(audio:HTMLAudioElement,notify=true) {const e=this.entries.get(audio);if(!e)return;const wasUnhealthy=e.control.busy||e.control.blocked;e.control.cancel();e.serial++;e.cleanup();this.log(e,'removed');this.entries.delete(audio);if(notify&&wasUnhealthy)this.settled('cancelled');}
  clear() {for(const a of this.entries.keys())this.detach(a,false);}
  get size(){return this.entries.size;}
  snapshot(event:AudioPlaybackEvent='snapshot') {
    const budget=Math.max(1,Math.floor(60/Math.max(1,this.entries.size)));
    for(const e of this.entries.values()){
      this.log(e,event);
      const stride=Math.max(1,Math.ceil(e.ring.length/budget));
      for(let i=0;i<e.ring.length;i+=stride)this.options.report({...e.ring[i],event:'snapshot'});
    }
  }
  retry() {for(const e of this.entries.values()){e.control.retry();e.serial++;e.pending=undefined;e.health=undefined;e.step=undefined;this.log(e,'manual-retry');}}
  canSynchronize(a:HTMLAudioElement){const e=this.entries.get(a);return !e || (!e.control.busy&&!e.control.blocked&&e.health?.suspectSince===undefined);}
  requestPlay(a:HTMLAudioElement,onError:(error:unknown)=>void,force=false) {
    const e=this.entries.get(a);
    if(!a.getAttribute('src') || (e && (!force && !this.canSynchronize(a) || e.pending)))return;
    if(e && !this.options.target(a).expected)return;
    if(!a.paused)return;
    const serial=e?.serial;
    const promise=a.play();
    if(e)e.pending=promise;
    void promise.then(()=>{
      if(e && (this.entries.get(a)!==e || e.serial!==serial || !this.options.target(a).expected)) {
        // Do not pause a newer valid playback operation on the same element.
        if(this.entries.get(a)!==e || !this.options.target(a).expected)a.pause();
      }
    }).catch(error=>{if(!e || this.entries.get(a)===e && e.serial===serial){if(e)this.log(e,'play-rejected');onError(error);}})
      .finally(()=>{if(e?.pending===promise)e.pending=undefined;});
  }
  private settled(status:'recovered'|'cancelled') {if([...this.entries.values()].every(e=>!e.control.busy&&!e.control.blocked))this.options.status(status);}
  private cancel(e:Entry) {if(e.control.busy){e.control.cancel();e.serial++;e.pending=undefined;e.step=undefined;this.log(e,'cancelled');this.settled('cancelled');}e.health=undefined;}
  private fail(e:Entry,token:number|null) {
    if(token!==null)e.control.fail(token);
    e.audio.pause();this.log(e,'failed');this.options.status('failed');
  }
  private attempt(e:Entry,step:number,now:number) {
    const t=this.options.target(e.audio);
    if(!t.expected || t.seeking){this.cancel(e);return;}
    e.step=step;e.stepAt=now;e.stepTarget=t.target;e.progressAt=undefined;e.lastProgress=e.audio.currentTime;e.serial++;e.pending=undefined;
    if(step===2){e.audio.pause();e.reload();}
    else this.startReady(e);
  }
  private startReady(e:Entry) {
    const a=e.audio,t=this.options.target(a);
    if(!t.expected || t.seeking || !a.getAttribute('src') || a.readyState<2)return;
    try{a.currentTime=t.target;a.playbackRate=t.rate;}catch{return;}
    this.requestPlay(a,()=>{},true);
  }
  tick(now=performance.now()) {
    for(const e of this.entries.values()) {
      const a=e.audio,t=this.options.target(a);
      const sample:PlaybackSample={...t,now,audioTime:a.currentTime,paused:a.paused,readyState:a.readyState,error:Boolean(a.error)};
      const prev=e.health?.last;
      const discontinuity=Boolean(prev && (now-prev.now>1500 || t.rate!==prev.rate || Math.abs(t.target-prev.target)>(now-prev.now)/1000*Math.max(t.rate,prev.rate)+.75));
      const d=this.log(e,'sample',now);
      if(now-e.lastSummary>=10000){this.options.report(d);e.lastSummary=now;}
      if(!t.expected || t.seeking || discontinuity){this.cancel(e);e.health={last:sample};continue;}
      if(e.control.blocked)continue;
      if(e.control.busy) {
        // Verify actual progression, not merely a resolved play() promise or our own seek.
        const advancing=!a.paused && !a.seeking && a.readyState>=2 && a.currentTime-(e.lastProgress??a.currentTime)>.01;
        e.lastProgress=a.currentTime;
        e.progressAt=advancing?(e.progressAt??now):undefined;
        if(e.progressAt!==undefined && now-e.progressAt>=2000){
          e.control.cancel();e.step=undefined;e.health={last:sample};this.log(e,'recovered');this.settled('recovered');continue;
        }
        if(e.step===2 && a.readyState>=2 && !e.pending && a.paused)this.startReady(e);
        const limit=e.step===1?3000:5000;
        if(now-(e.stepAt??now)>=limit){if(e.step===1)this.attempt(e,2,now);else {e.control.blocked=true;this.fail(e,null);}}
        e.health={last:sample};continue;
      }
      const result=evaluateAudioHealth(e.health,sample);e.health=result.state;
      if(result.action==='recover') {
        const token=e.control.begin(now);
        this.snapshot('fault');
        if(token===null){if(e.control.blocked)this.fail(e,null);continue;}
        this.log(e,'recovering');this.options.status('recovering');this.attempt(e,1,now);
      }
    }
  }
}
