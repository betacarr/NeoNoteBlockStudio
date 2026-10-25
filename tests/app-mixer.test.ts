import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { produce } from 'immer';
import { describe, expect, it, vi } from 'vitest';
import { openNbsx, saveNbsx } from '../src/core/container';
import { normalizeEditorSelection } from '../src/core/editor-selection';
import { createProject, newNote, newTrack } from '../src/core/project';
import type { Project, Track } from '../src/core/types';

// Real App commands/Immer/container with inert UI setters, not DOM or physical
// mixer input. Component gestures and the actual browser have separate checks.
const source = readFileSync(new URL('../src/ui/App.tsx', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const section = (from: string, to: string) => { const start = source.indexOf(from), end = source.indexOf(to,start); if (start < 0 || end < 0) throw new Error('Mixer App boundary missing'); return source.slice(start,end); };
const code = transformSync([
  section('  function selectTrack(', '\n  function commit('),
  section('  function commit(', '\n  const changeTrack ='),
  section('  function changeMixerTrack(', '\n  const changeRegion ='),
].join('\n'), { loader: 'ts', target:'es2022' }).code;
function fixture() {
  const project = createProject('Mix fixture'); project.patterns[0].notes = [{ ...newNote(120,66,210), pan:.125, velocity:.8 }];
  project.tracks.push({ ...newTrack('Bell track',1,'bell'), id:'bell-track' });
  const projectRef = { current:project }, numberEditOwner = { current:{ project,generation:0 } };
  const history = { current:[] as {label:string;project:Project;selection:unknown}[] }, future = { current:[{label:'Existing redo'}] as unknown[] };
  const state = { filter:'', selectedTrack:project.tracks[0].id, selectedRegion:project.regions[0].id, selectedNotes:new Set([project.patterns[0].notes[0].id]), focus:'piano', dirty:false, revision:0, message:'' };
  const finishNumberDraft = vi.fn(() => true);
  const selectedRegionsRef = { current: new Set([project.regions[0].id]) }, instrumentFilterRef = { current: '' };
  const actions = (captured = projectRef.current, generation = numberEditOwner.current.generation) => {
    const scope = { project:captured, projectRef, numberEditOwner, numberGeneration:generation, produce, history, future,
      region:captured.regions.find(region => region.id === state.selectedRegion), playing:true,
      selectionSnapshot:(project:Project) => normalizeEditorSelection(project,{trackId:state.selectedTrack,regionId:state.selectedRegion,noteIds:[...state.selectedNotes],focus:state.focus as 'piano'}),
      setProject:vi.fn(),setDirty:(value:boolean) => { state.dirty = value; },setRevision:(update:(value:number)=>number) => { state.revision = update(state.revision); },
      setInstrumentFilter:(value:string) => { state.filter = value; },setSelectedTrack:(value:string) => { state.selectedTrack=value; },setSelectedRegion:(value:string) => { state.selectedRegion=value; },
      selectedRegionsRef, instrumentFilterRef, setSelectedRegions:vi.fn(),
      setSelectedNotes:(value:Set<string>) => { state.selectedNotes=value; },setFocus:(value:string) => { state.focus=value; },setMessage:(value:string) => { state.message=value; }, finishNumberDraft };
    return Function(...Object.keys(scope),`${code}\nreturn {changeMixerTrack,changeMixerMaster,filterInstruments,selectMixerTrack};`)(...Object.values(scope)) as {
      changeMixerTrack:(id:string,patch:Partial<Track>)=>void;changeMixerMaster:(value:number)=>void;filterInstruments:(value:string)=>void;selectMixerTrack:(value:Track)=>void;
    };
  };
  return { project, projectRef, numberEditOwner, history, future, state, finishNumberDraft, actions };
}
const normalized = (project:Project) => { const result=structuredClone(project); delete (result as Partial<Project>).modifiedAt; return result; };

describe('App mixer commands and display-only filter',()=>{
  it('filters without changing source, selection, dirty state or redo; numeric flush can block a view transition',()=>{
    const t=fixture(), before=structuredClone(t.project), selected=new Set(t.state.selectedNotes);
    t.actions().filterInstruments('bell'); expect(t.state.filter).toBe('bell'); expect(t.projectRef.current).toBe(t.project);
    expect(t.projectRef.current).toEqual(before); expect(t.history.current).toEqual([]); expect(t.future.current).toHaveLength(1); expect(t.state.dirty).toBe(false); expect(t.state.selectedNotes).toEqual(selected);
    t.finishNumberDraft.mockReturnValue(false); t.actions().filterInstruments('harp'); expect(t.state.filter).toBe('bell');
  });
  it('selects the current real track through the shared selection path, including an empty track, without changing project or filter',()=>{
    const t=fixture(); t.state.filter='harp'; t.actions().selectMixerTrack(t.project.tracks[1]);
    expect(t.state.selectedTrack).toBe('bell-track'); expect(t.state.selectedRegion).toBe(''); expect(t.state.selectedNotes.size).toBe(0); expect(t.state.focus).toBe('arrangement'); expect(t.state.filter).toBe('harp');
    expect(t.history.current).toEqual([]); expect(t.projectRef.current).toBe(t.project); expect(t.future.current).toHaveLength(1);
    t.finishNumberDraft.mockReturnValue(false); t.actions().selectMixerTrack(t.project.tracks[0]); expect(t.state.selectedTrack).toBe('bell-track');
  });
  it('commits one complete track mix edit, supports legal gain above unity and preserves raw notes/regions through NBSX',()=>{
    const t=fixture(), before=structuredClone(t.project); t.actions().changeMixerTrack(t.project.tracks[0].id,{volume:2.5,pan:-.375});
    const expected=structuredClone(before); Object.assign(expected.tracks[0],{volume:2.5,pan:-.375});
    expect(normalized(t.projectRef.current)).toEqual(normalized(expected)); expect(t.history.current).toHaveLength(1); expect(t.history.current[0].project).toBe(t.project); expect(t.future.current).toEqual([]); expect(t.state.dirty).toBe(true);
    expect(normalized(openNbsx(saveNbsx(t.projectRef.current)))).toEqual(normalized(expected)); expect(t.state.message).toBe('');
    t.actions().changeMixerTrack(t.project.tracks[0].id,{volume:2.5,pan:-.375}); expect(t.history.current).toHaveLength(1);
  });
  it.each([{volume:-1},{volume:4.01},{volume:NaN},{pan:Infinity},{pan:-1.01},{muted:3},{solo:'true'},{instrumentId:'bell'}])('rejects invalid or out-of-scope patch %j atomically',patch=>{
    const t=fixture(); t.actions().changeMixerTrack(t.project.tracks[0].id,patch as Partial<Track>); expect(t.projectRef.current).toBe(t.project); expect(t.history.current).toEqual([]); expect(t.future.current).toHaveLength(1);
  });
  it('preserves locked volume/pan while allowing mute/solo, and keeps ordinary no-op changes out of history',()=>{
    const t=fixture(); t.project.tracks[0].locked=true; const id=t.project.tracks[0].id;
    t.actions().changeMixerTrack(id,{volume:2,pan:.5}); expect(t.history.current).toHaveLength(0);
    t.actions().changeMixerTrack(id,{muted:true,solo:true}); expect(t.projectRef.current.tracks[0]).toMatchObject({locked:true,volume:1,pan:0,muted:true,solo:true}); expect(t.history.current).toHaveLength(1);
  });
  it('preserves incrementally recorded notes when a same-generation mix draft commits to the latest project',()=>{
    const t=fixture(), captured=t.actions(), latest=structuredClone(t.project); latest.patterns[0].notes.push(newNote(480,72,99));
    t.projectRef.current=latest; t.numberEditOwner.current={project:latest,generation:0}; captured.changeMixerTrack(latest.tracks[0].id,{volume:1.37});
    expect(t.projectRef.current.patterns).toEqual(latest.patterns); expect(t.projectRef.current.tracks[0].volume).toBe(1.37); expect(t.history.current[0].project).toBe(latest);
  });
  it('rejects stale generation edits and permits only finite master gain 0..2',()=>{
    const t=fixture(), captured=t.actions(); t.numberEditOwner.current={project:t.project,generation:1}; captured.changeMixerTrack(t.project.tracks[0].id,{volume:2}); captured.changeMixerMaster(1.5); expect(t.history.current).toHaveLength(0);
    for(const value of [NaN,Infinity,-.1,2.01]) t.actions().changeMixerMaster(value); expect(t.history.current).toHaveLength(0);
    t.actions().changeMixerMaster(1.5); expect(t.projectRef.current.audio.masterGain).toBe(1.5); expect(t.history.current).toHaveLength(1); expect(t.projectRef.current.patterns).toBe(t.project.patterns);
  });
});
