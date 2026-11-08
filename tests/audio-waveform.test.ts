import {describe,it,expect} from 'vitest';
import {pcmWaveformPeaks,waveformEnvelope} from '../src/core/reference';
import {audioWaveformPath} from '../src/ui/audio-waveform';
import {createTempoMap} from '../src/core/time';
import {createProject} from '../src/core/project';
describe('PCM audio region waveform',()=>{
 it('keeps silence flat and preserves signed asymmetric audio without normalizing',()=>{
  const pcm=new Float32Array(48000),p=createProject(),timing=createTempoMap(p);
  expect(audioWaveformPath(pcmWaveformPeaks([pcm],48000),timing,0,0,1,1,0,100)).toBe('');
  pcm[128]=.8;pcm[129]=-.2;const peaks=pcmWaveformPeaks([pcm],48000),e=waveformEnvelope(peaks,0,.01);
  expect(e.maximum).toBeCloseTo(.8);expect(e.minimum).toBeCloseTo(-.2);
 });
 it('does not lose single-frame transients between the old 256 point samples',()=>{
  const pcm=new Float32Array(480000);pcm[12345]=1;const peaks=pcmWaveformPeaks([pcm],48000);
  for(const pixels of [24,300,1200]){
   const hit=Math.floor(12345/pcm.length*pixels);expect(waveformEnvelope(peaks,hit/pixels*10,(hit+1)/pixels*10).maximum).toBe(1);
  }
  expect(waveformEnvelope(peaks,5,6)).toEqual({minimum:0,maximum:0});
 });
 it('retains right-only and opposite-phase stereo instead of averaging away content',()=>{
  const a=new Float32Array(256).fill(.75),b=new Float32Array(256).fill(-.75);
  expect(waveformEnvelope(pcmWaveformPeaks([a,b],48000),0,.005)).toEqual({minimum:-.75,maximum:.75});
  expect(waveformEnvelope(pcmWaveformPeaks([new Float32Array(256),a],48000),0,.005).maximum).toBe(.75);
 });
 it('handles odd pyramid sizes and the last PCM frame',()=>{
  const pcm=new Float32Array(641);pcm[640]=-.9;const peaks=pcmWaveformPeaks([pcm],48000);
  expect(waveformEnvelope(peaks,0,641/48000).minimum).toBeCloseTo(-.9);
  expect(waveformEnvelope(peaks,640/48000,641/48000).minimum).toBeCloseTo(-.9);
 });
 it('maps source offset, tempo changes, move and visible scroll to the same audio seconds',()=>{
  const p=createProject();p.tempos=[{tick:0,bpm:120},{tick:960,bpm:60}];const timing=createTempoMap(p);
  const pcm=new Float32Array(48000*4);pcm[48000*2]=1;const peaks=pcmWaveformPeaks([pcm],48000);
  const full=audioWaveformPath(peaks,timing,0,1,3,1,0,2200);
  // source second 2 = project second 1: after the tempo change, at tick 1440.
  expect(full).toContain('M1440.5,2.000');
  expect(audioWaveformPath(peaks,timing,0,1,3,1,1400,100)).toContain('M40.5,2.000');
  expect(audioWaveformPath(peaks,timing,1920,1,3,1,0,1000)).toContain('M960.5,2.000');
  expect(audioWaveformPath(peaks,timing,0,0,1,1,0,500)).toBe('');
 });
});
