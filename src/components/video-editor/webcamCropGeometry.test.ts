import {describe,it,expect} from 'vitest';
import {normalizeAspectCropRegion,flipCropHorizontally,resizeCrop,cropAtZoom} from './webcamCropGeometry';
describe('portrait framing',()=>{
 it('uses source dimensions for a 3:5 frame without stretching',()=>{
  const aspect=(16/9)/(.6),c=normalizeAspectCropRegion({x:0,y:0,width:1,height:1},aspect);
  expect(c.width*1920/(c.height*1080)).toBeCloseTo(.6);
  const close=cropAtZoom(c,aspect,2);expect(close.width).toBeCloseTo(c.width/2);expect(close.x+close.width/2).toBeCloseTo(.5);
 });
 it('mirror conversion is reversible',()=>{const c=normalizeAspectCropRegion({x:.1,y:.2,width:.2,height:.4},2);expect(flipCropHorizontally(flipCropHorizontally(c,2),2).x).toBeCloseTo(c.x)});
 it('keeps crop in source at every corner',()=>{for(const h of ['nw','ne','sw','se','move'] as const){const c=resizeCrop({x:.2,y:.2,width:.3,height:.3},h,99,-99,1);expect(c.x).toBeGreaterThanOrEqual(0);expect(c.y).toBeGreaterThanOrEqual(0);expect(c.x+c.width).toBeLessThanOrEqual(1.000001);expect(c.y+c.height).toBeLessThanOrEqual(1.000001)}});
});
