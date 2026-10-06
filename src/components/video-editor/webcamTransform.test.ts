import {describe,it,expect} from 'vitest';
import {DEFAULT_WEBCAM_OVERLAY as defaults} from './types';
import {getWebcamEditGeometry,transformWebcam,webcamSettingsFromTransform} from './webcamTransform';
describe('independent portrait geometry',()=>{
 for(const stage of [{width:1920,height:1080},{width:1080,height:1920}])for(const frameStyle of ['portrait','rounded'] as const){
  it(`round trips ${stage.width} ${frameStyle} including screen zoom`,()=>{
   const settings={...defaults,frameStyle,size:40,positionPreset:'custom' as const,positionX:.3,positionY:.6};
   const g=getWebcamEditGeometry(stage,settings,2)!;
   const next=webcamSettingsFromTransform(stage,settings,g.transform,2);
   expect(next.size).toBeCloseTo(40);expect(next.positionX).toBeCloseTo(.3);expect(next.positionY).toBeCloseTo(.6);
   expect(next.cropRegion).toEqual(settings.cropRegion);
  });
  it(`keeps opposite corner anchored and clamps inside ${stage.width} ${frameStyle}`,()=>{
   const s={...defaults,frameStyle,reactToZoom:false,positionPreset:'center' as const};const g=getWebcamEditGeometry(stage,s)!;
   const v=transformWebcam(stage,s,g.transform,'se',80,100);const next=getWebcamEditGeometry(stage,webcamSettingsFromTransform(stage,s,v))!;
   expect(next.rect.x).toBeCloseTo(g.rect.x);expect(next.rect.y).toBeCloseTo(g.rect.y);
   const moved=getWebcamEditGeometry(stage,webcamSettingsFromTransform(stage,s,transformWebcam(stage,s,g.transform,undefined,-9999,9999)))!;
   expect(moved.rect.x).toBeGreaterThanOrEqual(0);expect(moved.rect.y+moved.rect.height).toBeLessThanOrEqual(stage.height);
  });
 }
 it('ignores invalid stages',()=>expect(getWebcamEditGeometry({width:0,height:10},defaults)).toBeNull());
});
