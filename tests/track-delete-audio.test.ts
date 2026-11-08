import {describe,it,expect} from 'vitest';
import {produce} from 'immer';
import {createProject,newTrack,validateProject} from '../src/core/project';
import {deleteTrack,inspectTrackDelete} from '../src/core/track-management';
import {saveNbsx,openNbsx} from '../src/core/container';
function fixture(){const p=createProject();p.regions=[];p.patterns=[];p.tracks=['group','child1','child2','other'].map((name,i)=>({...newTrack(name,i),id:name,kind:'audio' as const}));p.tracks[0].audioGroup={sourceClipId:'other-clip',collapsed:true};p.tracks[1].parentTrackId=p.tracks[2].parentTrackId='group';p.tracks[1].volume=.6;p.tracks[1].pan=.2;p.tracks[2].muted=true;p.assets=[{id:'asset',name:'retained.wav',mime:'audio/wav',data:'AA=='}];p.audioClips=['child1','child2','other'].map(name=>({id:name+'-clip',trackId:name,assetId:'asset',name,start:960,offsetSeconds:0,durationSeconds:2}));return p;}
describe('audio track deletion is project-only and atomic',()=>{
 it('deletes a nonempty collapsed group and all children together, preserving audio resources',()=>{const before=fixture(),after=produce(before,p=>{deleteTrack(p,'group');});expect(after.tracks.map(t=>t.id)).toEqual(['other']);expect(after.audioClips?.map(c=>c.id)).toEqual(['other-clip']);expect(after.assets).toBe(before.assets);validateProject(after);expect(openNbsx(saveNbsx(after)).tracks).toEqual(after.tracks);expect(before.tracks).toHaveLength(4);});
 it('deletes just a child and retains the group, sibling mix, and shared asset',()=>{const p=fixture(),sibling=structuredClone(p.tracks[2]);deleteTrack(p,'child1');expect(p.tracks.map(t=>t.id)).toEqual(['group','child2','other']);expect(p.tracks[1].volume).toBe(sibling.volume);expect(p.tracks[1].muted).toBe(true);expect(p.tracks[1].parentTrackId).toBe('group');expect(p.assets).toHaveLength(1);validateProject(p);});
 it('rejects the whole group when a child is locked, with no partial removal',()=>{const p=fixture();p.tracks[1].locked=true;const before=structuredClone(p);expect(inspectTrackDelete(p,'group').ok).toBe(false);expect(deleteTrack(p,'group')).toBeUndefined();expect(p).toEqual(before);});
});
