import {describe,it,expect,vi} from 'vitest';
import {AudioEngine} from '../src/audio/engine';
import {createProject} from '../src/core/project';
function fixture(){
 const project=createProject();project.patterns=[];project.regions=[];project.tracks[0].kind='audio';project.assets=[{id:'asset',name:'x.wav',mime:'audio/wav',data:'AA=='}];project.audioClips=[{id:'clip',name:'x',trackId:project.tracks[0].id,assetId:'asset',start:0,offsetSeconds:0,durationSeconds:1}];
 let resolve!:(buffer:AudioBuffer)=>void;const pending=new Promise<AudioBuffer>(r=>resolve=r),sources:any[]=[];const node=()=>({connect:vi.fn(),disconnect:vi.fn()});
 const context={currentTime:0,destination:{},sampleRate:44100,decodeAudioData:vi.fn(()=>pending),createAnalyser:()=>({...node(),fftSize:512}),createBufferSource:()=>{const s={...node(),start:vi.fn(),stop:vi.fn()};sources.push(s);return s;},createGain:()=>({...node(),gain:{value:1}}),createStereoPanner:()=>({...node(),pan:{value:0}})} as unknown as AudioContext;
 const engine=new AudioEngine();engine.context=context;vi.spyOn(engine,'ensure').mockResolvedValue(context);
 const buffer={duration:1,numberOfChannels:2,sampleRate:44100,getChannelData:()=>new Float32Array(44100)} as unknown as AudioBuffer;
 return {project,engine,context,sources,finish:()=>resolve(buffer)};
}
describe('cold audio-region transport preparation',()=>{
 it('waits for decoded region assets before scheduling project playback',async()=>{
  const f=fixture();try{const play=f.engine.play(f.project,0);await Promise.resolve();await Promise.resolve();expect(f.sources).toHaveLength(0);f.finish();expect(await play).toBe(true);expect(f.sources).toHaveLength(1);expect(f.sources[0].start).toHaveBeenCalledWith(.05,0,1);}finally{f.engine.stop();}
 });
 it('a stop during loading invalidates startup and never schedules late audio',async()=>{
  const f=fixture();try{const play=f.engine.play(f.project,0);await Promise.resolve();await Promise.resolve();f.engine.stop();f.finish();expect(await play).toBe(false);expect(f.sources).toHaveLength(0);expect(f.engine.playing).toBe(false);}finally{f.engine.stop();}
 });
 it('local-cycle seek replaces the audio graph and plays the matching source offset without decoding twice',async()=>{
  const f=fixture();try{
   const play=f.engine.play(f.project,0,true,{start:480,end:1440});f.finish();expect(await play).toBe(true);
   expect(f.sources[0].start).toHaveBeenCalledWith(expect.closeTo(.05,10),.25,.5);
   expect(await f.engine.seek(960)).toBe(true);expect(f.sources[0].stop).toHaveBeenCalledTimes(1);
   expect(f.sources).toHaveLength(2);expect(f.sources[1].start).toHaveBeenCalledWith(expect.closeTo(.05,10),.5,.25);
   expect(f.context.decodeAudioData).toHaveBeenCalledTimes(1);expect(f.engine.position()?.tick).toBe(960);
   f.engine.stop();const sources=f.sources.length;expect(await f.engine.seek(1200)).toBe(false);expect(f.sources).toHaveLength(sources);
  }finally{f.engine.stop();}
 });
});
