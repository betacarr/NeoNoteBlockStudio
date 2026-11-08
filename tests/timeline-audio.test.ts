import {describe,it,expect,vi} from 'vitest';
import {TimelineAudio} from '../src/audio/timeline-audio';
import {createProject} from '../src/core/project';
function fixture(){
 const p=createProject();p.tracks[0].kind='audio';p.regions=[];p.patterns=[];p.audio.masterGain=.5;
 p.assets=[{id:'source',name:'x.wav',mime:'audio/wav',data:'AA=='}];p.audioClips=[{id:'clip',trackId:p.tracks[0].id,assetId:'source',name:'x',start:960,offsetSeconds:.25,durationSeconds:1}];
 const sources:any[]=[];const node=()=>({connect:vi.fn(),disconnect:vi.fn()});
 const context={currentTime:0,sampleRate:44100,decodeAudioData:vi.fn(async()=>({duration:2,numberOfChannels:2,sampleRate:44100,getChannelData:()=>new Float32Array(88200).fill(.1)})),createBufferSource:()=>{const s={...node(),start:vi.fn(),stop:vi.fn(),onended:null};sources.push(s);return s;},createGain:()=>({...node(),gain:{value:1}}),createStereoPanner:()=>({...node(),pan:{value:0}})};
 return {p,context:context as unknown as AudioContext,sources};
}
describe('audio regions share the project clock',()=>{
 it('does not allocate even a single voice for a 1-tick loop',async()=>{
  const {p,context,sources}=fixture(),player=new TimelineAudio();await player.load(p,context);
  expect(()=>player.schedule(p,context,{} as AudioNode,0,0,true,1/1920)).toThrow('50');expect(sources).toHaveLength(0);
 });
 it('seeks through leading silence and source offset without stretching recorded seconds',async()=>{
  const {p,context,sources}=fixture(),player=new TimelineAudio();await player.load(p,context);player.schedule(p,context,{} as AudioNode,10,.75,false,4);
  expect(sources[0].start).toHaveBeenCalledWith(10,.5,.75);expect(player.peaks('source')?.duration).toBe(2);
 });
 it('schedules a future region after its project start and never plays outside its duration',async()=>{
  const {p,context,sources}=fixture(),player=new TimelineAudio();await player.load(p,context);player.schedule(p,context,{} as AudioNode,10,0,false,4);expect(sources[0].start).toHaveBeenCalledWith(10.5,.25,1);
 });
 it('adds successive loops on the same clock and stops every scheduled audio source',async()=>{
  const {p,context,sources}=fixture(),player=new TimelineAudio();await player.load(p,context);const pump=player.schedule(p,context,{} as AudioNode,0,0,true,4);(context as any).currentTime=3.9;pump();expect(sources).toHaveLength(2);expect(sources[1].start.mock.calls[0][0]).toBe(4.5);player.stop();expect(sources.every(s=>s.stop.mock.calls.length===1)).toBe(true);
 });
 it('coalesces concurrent waveform/transport decoding of identical assets',async()=>{
  const {p,context}=fixture(),player=new TimelineAudio();await Promise.all([player.load(p,context),player.load(p,context)]);expect(context.decodeAudioData).toHaveBeenCalledTimes(1);
 });
 it('does not retain decoded assets when another empty document replaces the project',async()=>{
  const {p,context}=fixture(),player=new TimelineAudio();await player.load(p,context);player.clear();expect(player.peaks('source')).toBeUndefined();
 });
 it('trims a clip across both nonzero cycle locators and schedules the next cycle only once',async()=>{
  const {p,context,sources}=fixture(),player=new TimelineAudio();await player.load(p,context);
  // Clip occupies [.5,1.5), cycle occupies [1,1.4): each pass must play
  // the same .4 seconds at source offset .75, without stretching.
  const pump=player.schedule(p,context,{} as AudioNode,10,1,true,1.4,1);
  expect(sources[0].start.mock.calls[0]).toEqual([10,.75,expect.closeTo(.4,10)]);
  (context as any).currentTime=10.3;pump();pump();
  expect(sources).toHaveLength(2);
  expect(sources[1].start.mock.calls[0]).toEqual([expect.closeTo(10.4,10),.75,expect.closeTo(.4,10)]);
  player.stop();expect(sources.every(source=>source.stop.mock.calls.length===1)).toBe(true);
 });
});
