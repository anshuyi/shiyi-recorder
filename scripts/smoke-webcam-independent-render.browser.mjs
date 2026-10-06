import {FrameRenderer as Legacy} from '/src/lib/exporter/frameRenderer.ts';
import {FrameRenderer as Modern} from '/src/lib/exporter/modernFrameRenderer.ts';
import {VideoExporter} from '/src/lib/exporter/videoExporter.ts';
import {ModernVideoExporter} from '/src/lib/exporter/modernVideoExporter.ts';
import {GifExporter} from '/src/lib/exporter/gifExporter.ts';
import {DEFAULT_WEBCAM_OVERLAY} from '/src/components/video-editor/types.ts';
history.replaceState(null,'','/?portrait-render-test');
const assert=(v,m)=>{if(!v)throw Error(m)},base64=b=>{let s='';for(let i=0;i<b.length;i+=8192)s+=String.fromCharCode(...b.subarray(i,i+8192));return btoa(s)};
const ready=url=>new Promise((r,j)=>{const v=document.createElement('video');v.muted=true;v.src=url;v.onloadeddata=()=>{v.onloadeddata=null;v.onseeked=()=>r(v);v.currentTime=.25};v.onerror=()=>j(Error(v.error?.message))});
function capture(v){const c=document.createElement('canvas');c.width=v.videoWidth||v.width;c.height=v.videoHeight||v.height;c.getContext('2d').drawImage(v,0,0);return c}
function expected(config){const w=config.width,h=config.height,s=Math.min(w,h),margin=24*s/1080,height=s*.6,width=height*(config.webcam.frameStyle==='portrait'?.6:1);return{x:margin+(w-width-2*margin)*.35,y:margin+(h-height-2*margin)*.45,width,height}}
function check(canvas,config,label){
 const e=expected(config),ctx=canvas.getContext('2d'),p=ctx.getImageData(0,0,canvas.width,canvas.height).data;let x0=canvas.width,y0=canvas.height,x1=-1,y1=-1;
 for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++){const i=(y*canvas.width+x)*4;if(Math.max(p[i],p[i+1],p[i+2])>150){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y)}}
 const actual={x:x0,y:y0,width:x1-x0+1,height:y1-y0+1};
 for(const[k,a,b]of [['left',actual.x,e.x],['top',actual.y,e.y],['right',actual.x+actual.width,e.x+e.width],['bottom',actual.y+actual.height,e.y+e.height]])assert(Math.abs(a-b)<=2,`${label} ${k}: ${a} vs ${b}`);
 // The crop spans red→green→blue. Mirroring reverses those colored markers.
 const left=ctx.getImageData(Math.round(e.x+e.width*.12),Math.round(e.y+e.height*.51),1,1).data;
 const right=ctx.getImageData(Math.round(e.x+e.width*.88),Math.round(e.y+e.height*.51),1,1).data;
 const red=v=>v[0]>v[1]+60&&v[0]>v[2]+60,blue=v=>v[2]>v[0]+60&&v[2]>v[1]+60;
 assert(config.webcam.mirror?blue(left)&&red(right):red(left)&&blue(right),`${label} source crop and mirror markers: ${[...left]} / ${[...right]}`);
 return actual;
}
window.smokePromise=(async()=>{
 const files={},checks=[];const screenUrl=new URL('/.tmp/independent-portrait/render/screen.mp4',location.href).href,cameraUrl=new URL('/.tmp/independent-portrait/render/camera.mp4',location.href).href;
 const source=capture(await ready(screenUrl));
 const config=(width,height,style,mirror)=>({width,height,videoWidth:640,videoHeight:360,videoUrl:screenUrl,webcamUrl:cameraUrl,wallpaper:'#08090a',zoomRegions:[],padding:0,showShadow:false,shadowIntensity:0,backgroundBlur:0,borderRadius:0,zoomMotionBlur:0,zoomTemporalMotionBlur:0,cropRegion:{x:0,y:0,width:1,height:1},showCursor:false,preferredRenderBackend:'webgl',webcam:{...DEFAULT_WEBCAM_OVERLAY,enabled:true,frameStyle:style,mirror,reactToZoom:false,shadow:0,size:60,margin:24,cornerRadius:0,positionPreset:'custom',positionX:.35,positionY:.45,cropRegion:{x:.2,y:.1,width:.45,height:.8}}});
 for(const [w,h]of [[1280,720],[1920,1080],[720,1280]])for(const style of ['portrait','rounded'])for(const mirror of [false,true]){
  let last;for(const[name,R]of [['legacy',Legacy],['modern',Modern]]){
   const c=config(w,h,style,mirror),renderer=new R(c);await renderer.initialize();const frame=new VideoFrame(source,{timestamp:250000});await renderer.renderFrame(frame,250000);frame.close();const canvas=capture(renderer.getCanvas());
   const label=`${name}-${w}x${h}-${style}-${mirror}`;last=check(canvas,c,label);if(w===1280&&mirror)files[label+'.png']=canvas.toDataURL().split(',')[1];renderer.destroy();checks.push({label,bounds:last});
  }
 }
 for(const[name,E]of [['modern',ModernVideoExporter],['legacy',VideoExporter],['gif',GifExporter]]){
  const c=config(1280,720,'rounded',true);console.log('Portrait export '+name);
  const result=await new E({...c,frameRate:15,bitrate:6000000,backendPreference:'webcodecs',encodingMode:'quality',loop:true,sizePreset:'original'}).export();assert(result.success&&result.blob,`${name} export: ${result.error}`);
  files[name+(name==='gif'?'.gif':'.mp4')]=base64(new Uint8Array(await result.blob.arrayBuffer()));
  const url=URL.createObjectURL(result.blob);const media=name==='gif'?await new Promise((r,j)=>{const i=new Image();i.onload=()=>r(i);i.onerror=j;i.src=url}):await ready(url);const canvas=capture(media);const bounds=check(canvas,c,name+' reopened');files[name+'-decoded.png']=canvas.toDataURL().split(',')[1];URL.revokeObjectURL(url);checks.push({label:name+' encoded/reopened',bounds});
 }
 return{success:true,checks,files};
})().catch(e=>{console.error(e.stack||String(e));throw e});
