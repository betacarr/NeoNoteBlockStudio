import {describe,it,expect} from 'vitest';
import {createProject,projectEnd,validateProject} from '../src/core/project';
import {appendAudioResult,appendStemResult,audioClipEnd} from '../src/core/audio-clips';
import {createTempoMap} from '../src/core/time';
import {openNbsx,saveNbsx,bytesToBase64} from '../src/core/container';
import {deleteTrack} from '../src/core/track-management';
import {DRUM_ROLES,applyAudioWorkspace,type AudioAssistResult} from '../src/core/audio-assist';
import {applyGlobalChords, applyRegionChords} from '../src/core/chord-track';
import {encodeFloatWav} from '../src/audio/stem-player';
function result(six=false, roles=six?['vocals','drums','bass','guitar','piano','other']:['original']):AudioAssistResult{
 const frames=4410,bytes=encodeFloatWav({sampleRate:44100,channels:[new Float32Array(frames),new Float32Array(frames)]});
 const assets=[{id:crypto.randomUUID(),name:'source.wav',mime:'audio/wav',data:bytesToBase64(bytes)},...roles.map(role=>({id:crypto.randomUUID(),name:role+'.wav',mime:'audio/wav',data:bytesToBase64(bytes)}))];
 return {assets,workspace:{id:crypto.randomUUID(),name:'音频 # &.wav',sourceAssetId:assets[0].id,duration:.1,sampleRate:44100,frames,bpm:120,firstBeat:0,beats:[],chords:[],model:{id:'test',version:'1'},loop:{enabled:false,start:0,end:.1},stems:roles.map((role,i)=>({id:crypto.randomUUID(),role,name:role,assetId:assets[i+1].id,gain:1,muted:false,solo:false}))}};
}
describe('arrangement audio region transactions',()=>{
 it('adds full-file regions to new or existing audio tracks and preserves tempo',()=>{
  const p=createProject();const [a]=appendAudioResult(p,result(),960);const [b]=appendAudioResult(p,result(),1920,undefined,a.trackId);
  expect(p.tracks.filter(t=>t.kind==='audio')).toHaveLength(1);expect(p.audioClips).toHaveLength(2);expect(b.trackId).toBe(a.trackId);expect(p.tempos).toEqual([{tick:0,bpm:120}]);expect(validateProject(p)).toBe(p);
 });
 it('creates a real controlled group below source and mutes only that region',()=>{
  const p=createProject();const [a]=appendAudioResult(p,result(),960);const [other]=appendAudioResult(p,result(),1920,undefined,a.trackId);
  a.analysis={...result().workspace,sourceAssetId:a.assetId,stems:[],chords:[{id:'c',name:'C',start:0,end:.1,confidence:.9}]};
  const before=structuredClone(p);
  const children=appendAudioResult(p,result(true),0,a.id);const sourceIndex=p.tracks.findIndex(t=>t.id===a.trackId),group=p.tracks[sourceIndex+1];
  expect(group.audioGroup?.sourceClipId).toBe(a.id);expect(children).toHaveLength(6);expect(children.every(c=>c.start===960)).toBe(true);expect(p.tracks.filter(t=>t.parentTrackId===group.id)).toHaveLength(6);expect(a.muted).toBe(true);expect(a.analysis).toEqual(before.audioClips?.[0].analysis);expect(other.muted).not.toBe(true);expect(p.tracks[sourceIndex].muted).toBe(false);expect(before.audioClips?.[0].muted).not.toBe(true);expect(validateProject(p)).toBe(p);
  const reopened=openNbsx(saveNbsx(p));expect(reopened.audioClips).toEqual(p.audioClips);expect(reopened.tracks).toEqual(p.tracks);
 });
 it('supports explicitly selected stems without pretending the omitted stems were combined',()=>{
  const p=createProject(),[a]=appendAudioResult(p,result(),0);const clips=appendAudioResult(p,result(true),0,a.id,undefined,['vocals','piano']);expect(clips.map(c=>c.separation?.role)).toEqual(['vocals','piano']);
 });
 it('creates the original and a nested drum stack when splitting an external file',()=>{
  const p=createProject(), r=result(true, ['vocals',...DRUM_ROLES,'submix']);
  const {group, clips} = appendStemResult(p, r, 320);
  const source = p.audioClips![0], kit = p.tracks.find(track=>track.audioGroup && track.parentTrackId===group.id)!;
  expect(source).toMatchObject({start:320,muted:true,assetId:r.workspace.sourceAssetId});
  expect(source.analysis).toBeUndefined();
  expect(clips.map(clip=>clip.separation?.role)).toEqual(['vocals',...DRUM_ROLES,'submix']);
  expect(clips.every(clip=>clip.start===source.start && clip.durationSeconds===source.durationSeconds)).toBe(true);
  expect(p.tracks.filter(track=>track.parentTrackId===kit.id)).toHaveLength(5);
  expect(openNbsx(saveNbsx(p)).tracks).toEqual(p.tracks);
  deleteTrack(p,group.id);
  expect(p.audioClips).toEqual([source]);
  expect(p.tracks.some(track=>track.parentTrackId)).toBe(false);
 });
 it('writes clip chords to a cycle-bounded global group and reads them back at the original offset',()=>{
  const p=createProject(), [clip]=appendAudioResult(p,result(),960);
  clip.chords = [{id:'first',name:'C',start:0,end:.05,confidence:.9},{id:'second',name:'F',start:.05,end:.1,confidence:.9}];
  const timing = createTempoMap(p), origin = timing.seconds(clip.start);
  const start = timing.tick(origin+.025), end = timing.tick(origin+.075);
  applyRegionChords(p,clip,{start,end});
  expect(p.chordTrack?.[0]).toMatchObject({start,end,chords:[{name:'C',start},{name:'F',end}]});
  const reopened = openNbsx(saveNbsx(p)), target = reopened.audioClips![0];
  expect(reopened.chordTrack).toEqual(p.chordTrack);
  applyGlobalChords(reopened,target);
  expect(target.chords).toEqual([
    expect.objectContaining({name:'C',start:expect.closeTo(.025,9),end:expect.closeTo(.05,9)}),
    expect.objectContaining({name:'F',start:expect.closeTo(.05,9),end:expect.closeTo(.075,9)}),
  ]);
  expect(reopened.tempos).toEqual(p.tempos);
 });
 it('uses recorded seconds across tempo changes and extends project playback to clip end',()=>{
  const p=createProject(),[a]=appendAudioResult(p,result(),100000);p.tempos=[{tick:0,bpm:90},{tick:100010,bpm:180}];const time=createTempoMap(p);expect(time.seconds(audioClipEnd(p,a))-time.seconds(a.start)).toBeCloseTo(.1,8);expect(projectEnd(p)).toBeCloseTo(audioClipEnd(p,a),6);
 });
 it('deletes a whole group with its child clips, retaining original region and unrelated tracks',()=>{
  const p=createProject(),[a]=appendAudioResult(p,result(),0);appendAudioResult(p,result(true),0,a.id);const group=p.tracks.find(t=>t.audioGroup)!;expect(deleteTrack(p,group.id)).toBeDefined();expect(p.audioClips).toHaveLength(1);expect(p.audioClips?.[0].id).toBe(a.id);expect(validateProject(p)).toBe(p);
 });
 it('independent helper analysis preserves assets referenced by arrangement clips',()=>{
  const p=createProject(),r=result();appendAudioResult(p,r,0);p.audioWorkspace=r.workspace;const next=result();const applied=applyAudioWorkspace(p,next.workspace,next.assets);expect(applied.assets.some(a=>a.id===p.audioClips![0].assetId)).toBe(true);expect(()=>saveNbsx(applied)).not.toThrow();
 });
});
