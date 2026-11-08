import { describe, expect, it } from 'vitest';
import { GM_PERCUSSION, gmDrumRows, gmPercussionName } from '../src/core/gm-percussion';
import type { DrumPreset } from '../src/core/types';
import { INSTRUMENTS, inNoteBlockRange, noteBlockMidiRange } from '../src/core/instruments';
import { createProject, newNote } from '../src/core/project';
import { saveNbsx, openNbsx } from '../src/core/container';
describe('GM source trigger display metadata', () => {
  it('lists the 47 GM1 percussion numbers in numeric order with standard common names', () => {
    expect(GM_PERCUSSION.map(row => row.midi)).toEqual(Array.from({length:47},(_,index)=>index+35));
    expect([36,38,42,46].map(gmPercussionName)).toEqual(['底鼓','军鼓','闭镲','开镲']);
    expect(gmPercussionName(34)).toBeUndefined();
  });
  it('preserves custom and legacy trigger numbers, exposing mapping state without editing the preset', () => {
    const preset: DrumPreset = {id:'old',name:'legacy',mappings:[{id:'a',trigger:60,notes:[{id:'hit',instrumentId:'snare',midi:72,offsetBeats:.03125,durationBeats:.25,velocity:.7}]}]};
    const before=structuredClone(preset), rows=gmDrumRows(preset);
    expect(rows).toHaveLength(128); expect(rows[60]).toMatchObject({midi:60,mapped:true});
    expect(rows[36]).toMatchObject({midi:36,mapped:false}); expect(rows[90]).toMatchObject({label:'自定义触发',mapped:false});
    expect(preset).toEqual(before);
  });
  it('shows independently editable mapping names and evaluates actual outputs, never trigger pitch', () => {
    const hit=(midi:number,instrumentId='snare')=>({id:'hit-'+midi,instrumentId,midi,offsetBeats:0,durationBeats:.25,velocity:1});
    const preset:DrumPreset={id:'kit',name:'整体预设名',mappings:[
      {id:'low',trigger:0,name:'自定义低音重击',notes:[hit(54),hit(78)]},
      {id:'out',trigger:66,name:'越界层',notes:[hit(53)]},
      {id:'mixed',trigger:100,name:'混合层',notes:[hit(66),hit(79)]},
      {id:'legacy',trigger:38,notes:[hit(66)]},
    ]};
    const before=structuredClone(preset),rows=gmDrumRows(preset);
    expect(rows[0]).toMatchObject({mappingName:'自定义低音重击',range:'in'});
    expect(rows[66].range).toBe('out');expect(rows[100].range).toBe('mixed');
    expect(rows[38].mappingName).toBe('未命名映射');expect(rows[37].range).toBe('unmapped');
    expect(preset).toEqual(before);
    preset.mappings[0].name='已更新映射名';preset.mappings[0].notes[0].midi=53;
    expect(gmDrumRows(preset)[0]).toMatchObject({mappingName:'已更新映射名',range:'mixed'});
  });
  it('includes both original-game boundaries and follows the selected sample root offset', () => {
    expect(noteBlockMidiRange()).toEqual({min:54,max:78});
    expect([53,54,78,79].map(midi=>inNoteBlockRange(midi))).toEqual([false,true,true,false]);
    expect(noteBlockMidiRange(72)).toEqual({min:60,max:84});
    const preset:DrumPreset={id:'kit',name:'Kit',mappings:[{id:'a',trigger:36,notes:[{id:'hit',instrumentId:'snare',midi:54,offsetBeats:0,durationBeats:.25,velocity:1}]}]};
    expect(gmDrumRows(preset,INSTRUMENTS.map(i=>({...i,rootMidi:72})))[36].range).toBe('out');
  });
  it('preserves custom mapping names through project save and reopen', () => {
    const p=createProject();p.tracks[0].drumPresetId='kit';p.patterns[0].notes=[newNote(0,36)];
    p.drumPresets=[{id:'kit',name:'整组',mappings:[{id:'mapping',trigger:36,name:'我的分层底鼓',notes:[{id:'hit',instrumentId:'basedrum',midi:66,offsetBeats:0,durationBeats:.25,velocity:1}]}]}];
    expect(openNbsx(saveNbsx(p)).drumPresets).toEqual(p.drumPresets);
  });
});
