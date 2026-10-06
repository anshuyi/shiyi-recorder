import { describe, expect, it } from 'vitest';
import { evaluateAudioHealth, type PlaybackSample } from './audioPreviewHealth';
const sample = (now: number, extra: Partial<PlaybackSample> = {}): PlaybackSample => ({now, videoTime: now / 1000, audioTime: now / 1000, target: now / 1000, rate: 1, expected: true, seeking: false, paused: false, readyState: 4, error: false, ...extra});
describe('audio health', () => {
  it('detects a stalled clock after a stable window', () => {
    let state; let result;
    for(let t=0;t<=2500;t+=500) { result=evaluateAudioHealth(state,sample(t,{audioTime:0})); state=result.state; }
    expect(result?.action).toBe('recover');
  });
  it.each([{expected:false},{seeking:true}])('does not recover intentional inactive states %j', extra => {
    let state;
    for(let t=0;t<5000;t+=500){const r=evaluateAudioHealth(state,sample(t,{audioTime:0,...extra}));expect(r.action).not.toBe('recover');state=r.state;}
  });
  it('does not treat normal progress or a stopped video as audio failure', () => {
    for(const stopped of [false,true]) {let state;for(let t=0;t<5000;t+=500){const r=evaluateAudioHealth(state,sample(t,stopped?{videoTime:0,audioTime:0}:{}));expect(r.action).not.toBe('recover');state=r.state;}}
  });
  it('resets after background timer gaps, seeks and rate changes', () => {
    const state=evaluateAudioHealth(undefined,sample(0)).state;
    for(const s of [sample(5000,{audioTime:0}),sample(500,{target:90,videoTime:90,audioTime:0}),sample(500,{rate:.25,audioTime:0})])expect(evaluateAudioHealth(state,s).action).not.toBe('recover');
  });
  it('allows data to arrive before a bounded loading timeout', () => {
    let state;let r;for(let t=0;t<=5500;t+=500){r=evaluateAudioHealth(state,sample(t,{audioTime:0,readyState:0}));state=r.state;if(t<5000)expect(r.action).not.toBe('recover');}expect(r?.action).toBe('recover');
  });
});
