import React from "react";
import { createRoot } from "react-dom/client";
import { useScreenRecorder } from "../src/hooks/useScreenRecorder";
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
async function until(check: () => boolean) { for (let i=0;i<150;i++) { if(check()) return; await sleep(20); } throw Error("state timeout"); }
function assert(value: unknown, message: string) { if(!value) throw Error(message); }
const originalGet = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
const originalEnum = navigator.mediaDevices.enumerateDevices.bind(navigator.mediaDevices);
const OriginalRecorder = window.MediaRecorder;
async function scenario(mode: string) {
 let current: ReturnType<typeof useScreenRecorder>;
 let starts=0, stops=0, ready=0, gets=0, finished=false;
 const tracks: MediaStreamTrack[]=[];
 const microphoneEnabled=mode!=="disabled";
 let late: ((stream: MediaStream) => void) | undefined;
 const api = {
  getPlatform:async()=>"win32", getRecordingPreferences:async()=>({success:true,microphoneEnabled,microphoneDeviceId:mode==="missing"?"removed":"old-id",microphoneDeviceLabel:mode==="missing"?undefined:"Test Mic",systemAudioEnabled:false}),
  getCountdownDelay:async()=>({success:true,delay:0}),getRecordingAudioLabConfig:async()=>({browserMicrophoneProfile:"processed"}),
  setRecordingPreferences:async()=>({success:true}),getSelectedSource:async()=>({id:"screen:1:0",name:"Test screen",sourceType:"screen",display_id:"1"}),
  isNativeWindowsCaptureAvailable:async()=>({available:true}),startNativeScreenRecording:async()=>{starts++;return{success:true,microphoneFallbackRequired:microphoneEnabled};},
  stopNativeScreenRecording:async()=>{stops++;return{success:true,path:"test.mp4"};},deleteRecordingFile:async()=>({success:true}),
  setRecordingState:async(value:boolean)=>{if(value)ready++;else finished=true;},hudOverlaySetSourceSelectionActive:()=>{},reportOperation:()=>{},
 };
 Object.defineProperty(window,"electronAPI",{configurable:true,value:api});
 navigator.mediaDevices.enumerateDevices=async()=>[{kind:"audioinput",deviceId:"new-id",label:"Test Mic",groupId:"test"} as MediaDeviceInfo];
 navigator.mediaDevices.getUserMedia=async()=>{
  gets++;
  if(mode==="denied")throw new DOMException("denied","NotAllowedError");
  if(mode==="cancel")return await new Promise<MediaStream>(r=>{late=r;});
  const stream=await originalGet({audio:true}); tracks.push(...stream.getTracks()); return stream;
 };
 if(mode==="recorder-error") window.MediaRecorder=class { constructor(){throw Error("encoder failed");} } as unknown as typeof MediaRecorder;
 const host=document.createElement("div"); document.body.append(host);const root=createRoot(host);
 function App(){current=useScreenRecorder();return <div>{String(current.recording)}</div>;}
 root.render(<App/>);await sleep(100);
 await current!.toggleRecording();
 if(mode==="cancel") {
  await until(()=>!!late);current!.cancelStarting();
  const stream=await originalGet({audio:true}); tracks.push(...stream.getTracks());late!(stream);
 }
 await until(()=>ready>0||finished);
 await sleep(30);
 await until(()=>!current!.starting);
 if(mode==="success"||mode==="disabled") {
  assert(current!.recording&&ready===1,"ready state expected");
  assert(starts===1,"native capture starts once");
  if(mode==="disabled")assert(gets===0,"disabled microphone must not acquire audio");
  current!.cancelRecording();await sleep(150);
 } else {
  assert(!current!.recording&&ready===0,"failure must never declare recording");
  if(mode==="recorder-error")assert(starts===1&&stops===1,`partial native startup must be stopped: starts=${starts}, stops=${stops}, gets=${gets}`);
  else assert(starts===0,"capture must not start with a failed microphone");
 }
 assert(tracks.every(track=>track.readyState==="ended"),"cancel must release tracks before unmount");
 root.unmount();host.remove();await sleep(50);
 assert(tracks.every(track=>track.readyState==="ended"),"all acquired tracks must be released");
 navigator.mediaDevices.getUserMedia=originalGet;navigator.mediaDevices.enumerateDevices=originalEnum;window.MediaRecorder=OriginalRecorder;
 return mode;
}
(window as any).smokePromise=(async()=>{const checks=[];for(const mode of ["missing","denied","recorder-error","cancel","disabled","success"])checks.push(await scenario(mode));return{checks};})();
