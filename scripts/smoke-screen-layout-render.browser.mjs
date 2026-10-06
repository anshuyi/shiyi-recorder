import { FrameRenderer } from "/src/lib/exporter/frameRenderer.ts";
import { FrameRenderer as ModernFrameRenderer } from "/src/lib/exporter/modernFrameRenderer.ts";
import { ModernVideoExporter } from "/src/lib/exporter/modernVideoExporter.ts";
import { VideoExporter } from "/src/lib/exporter/videoExporter.ts";
import { GifExporter } from "/src/lib/exporter/gifExporter.ts";
import { DEFAULT_WEBCAM_OVERLAY } from "/src/components/video-editor/types.ts";
history.replaceState(null, "", "/?screen-layout-smoke");
const assert = (v,m) => { if(!v)throw Error(m); };
const base64 = bytes => {let s="";for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(s);};
const ready = url => new Promise((resolve,reject)=>{const v=document.createElement("video");v.muted=true;v.src=url;v.onloadeddata=()=>{v.onloadeddata=null;v.onseeked=()=>resolve(v);v.currentTime=.25;};v.onerror=()=>reject(Error(v.error?.message));});
const capture = source => {const c=document.createElement("canvas");c.width=source.videoWidth||source.width;c.height=source.videoHeight||source.height;c.getContext("2d").drawImage(source,0,0);return c;};
function contentRect(canvas, limitY = canvas.height) {
	const w=canvas.width,h=canvas.height,p=canvas.getContext("2d").getImageData(0,0,w,h).data;
	let left=w,top=h,right=-1,bottom=-1;
	for(let y=0;y<limitY;y++)for(let x=0;x<w;x++){const i=(y*w+x)*4;if(p[i]>210&&p[i+1]>210&&p[i+2]>210){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}}
	return {x:left,y:top,width:right-left+1,height:bottom-top+1};
}
const expectRect = (actual, expected, label) => {for(const k of ["x","y","width","height"])assert(Math.abs(actual[k]-expected[k])<=2,`${label} ${k}: ${actual[k]} != ${expected[k]}`);};
window.smokePromise=(async()=>{
	const files={},checks=[];
	const url=new URL("/.tmp/screen-layout-smoke/screen.mp4",location.href).href;
	const config={width:384,height:640,videoWidth:640,videoHeight:480,wallpaper:"#071427",zoomRegions:[],padding:0,showShadow:false,shadowIntensity:0,backgroundBlur:0,borderRadius:0,zoomMotionBlur:0,zoomTemporalMotionBlur:0,cropRegion:{x:0,y:0,width:1,height:1},screenTransform:{centerX:.3,centerY:.15,scale:1.8},showCursor:false,preferredRenderBackend:"webgl"};
	const expected={x:0,y:0,width:384,height:355.2};
	const source=capture(await ready(url));
	for(const [name,Renderer] of [["legacy",FrameRenderer],["modern",ModernFrameRenderer]]){
		const renderer=new Renderer(config);await renderer.initialize();
		const frame=new VideoFrame(source,{timestamp:0});await renderer.renderFrame(frame,0);frame.close();
		const canvas=capture(renderer.getCanvas());expectRect(contentRect(canvas),expected,name);files[name+"-frame.png"]=canvas.toDataURL().split(",")[1];renderer.destroy();checks.push(name+" actual pixel bounds");
		const zoom=new Renderer({...config,zoomRegions:[{id:"z",startMs:500,endMs:1500,depth:2,focus:{cx:.5,cy:.5},mode:"manual"}],zoomClassicMode:true});await zoom.initialize();
		for(const ms of [0,1000,3000]){const f=new VideoFrame(source,{timestamp:ms*1000});await zoom.renderFrame(f,ms*1000);f.close();const c=capture(zoom.getCanvas());if(ms!==1000)expectRect(contentRect(c),expected,name+" zoom endpoint "+ms);files[name+"-zoom-"+ms+".png"]=c.toDataURL().split(",")[1];}zoom.destroy();checks.push(name+" zoom returns to custom base");
	}
	for(const [name,Exporter] of [["modern",ModernVideoExporter],["legacy",VideoExporter],["gif",GifExporter]]){
		console.log("Exporting "+name);
		const result=await new Exporter({...config,videoUrl:url,frameRate:15,bitrate:2000000,backendPreference:"webcodecs",encodingMode:"quality",loop:true,sizePreset:"original"}).export();
		assert(result.success&&result.blob,name+" export failed: "+result.error);
		files["layout-"+name+(name==="gif"?".gif":".mp4")]=base64(new Uint8Array(await result.blob.arrayBuffer()));
		const objectUrl=URL.createObjectURL(result.blob);
		const decoded=name==="gif"?await new Promise((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(i);i.onerror=reject;i.src=objectUrl;}):await ready(objectUrl);
		const canvas=capture(decoded);expectRect(contentRect(canvas),expected,name+" exported content");files[name+"-export-decoded.png"]=canvas.toDataURL().split(",")[1];URL.revokeObjectURL(objectUrl);checks.push(name+" export reopened and pixels verified");
	}
	const combined=new ModernFrameRenderer({...config,webcam:{...DEFAULT_WEBCAM_OVERLAY,enabled:true,frameStyle:"portrait",size:25,reactToZoom:false},webcamUrl:new URL("/.tmp/portrait-smoke/camera-source.mp4",location.href).href});await combined.initialize();const f=new VideoFrame(source,{timestamp:0});await combined.renderFrame(f,0);f.close();const c=capture(combined.getCanvas());expectRect(contentRect(c,500),expected,"screen with portrait overlay");assert(combined.webcamLayoutCache.positionY>320,"Portrait moved with screen");files["combined-portrait.png"]=c.toDataURL().split(",")[1];combined.destroy();checks.push("portrait overlay remains independent");
	return {success:true,expected,checks,files};
})().catch(e=>{console.error(String(e),e?.stack);throw e;});
