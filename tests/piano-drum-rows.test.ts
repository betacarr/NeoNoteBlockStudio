import { describe, expect, it } from 'vitest';
import { pianoGridTick, pianoGridX, pianoRowHeaderWidth, visibleDrumRows, planPianoView } from '../src/ui/piano-view';
import { newNote } from '../src/core/project';

describe('drum trigger row geometry without changing source MIDI numbers', () => {
  it.each([96,480,960,1920])('keeps grid drawing and pointer conversion inverse at PPQ %i', ppq => {
    for (const drums of [false,true]) {
      const width = pianoRowHeaderWidth(drums);
      expect(width).toBe(drums ? 204 : 58);
      for (const scroll of [0,100,500]) for (const tick of [0,ppq/32,ppq,ppq*4]) {
        const x = pianoGridX(tick,scroll,ppq,72,width);
        expect(pianoGridTick(x,scroll,ppq,72,width)).toBeCloseTo(tick,10);
      }
    }
  });

  it('moves the grid origin for readable mapping names, retaining header clicks outside the draw area', () => {
    const width=pianoRowHeaderWidth(true);
    expect(pianoGridX(0,0,960,72,width)-pianoGridX(0,0,960,72,58)).toBe(146);
    expect(pianoGridTick(100,0,960,72,width)).toBeLessThan(0);
    expect(pianoGridTick(width,0,960,72,width)).toBe(0);
  });

  it('retains every semitone in descending numeric order, including unmapped gaps and custom keys', () => {
    const rows = visibleDrumRows([{midi:36,label:'底鼓',mapped:true},{midi:38,label:'军鼓',mapped:true},{midi:39,label:'拍手',mapped:false}],(127-40)*18,18,108);
    expect(rows.map(row=>row.midi)).toEqual([40,39,38,37,36,35]);
    expect(rows.find(row=>row.midi===36)).toEqual({midi:36,label:'底鼓',mapped:true});
    expect(rows.find(row=>row.midi===37)).toEqual({midi:37,label:'未映射',mapped:false});
    expect(rows.find(row=>row.midi===39)?.mapped).toBe(false);
  });

  it('supports both extreme MIDI rows and never invents out-of-range rows', () => {
    expect(visibleDrumRows([],0,18,36).map(row=>row.midi)).toEqual([127,126]);
    expect(visibleDrumRows([],126*18,18,100).map(row=>row.midi)).toEqual([1,0]);
    expect(visibleDrumRows([],0,18,0)).toEqual([]);
  });

  it('locates mapped percussion rows without treating trigger numbers as sounding pitch', () => {
    const notes=[36,38,42,46].map(midi=>newNote(0,midi));
    const before=structuredClone(notes);
    const plan=planPianoView({notes,ppq:960,width:800,height:260,zoom:72,mode:'locate'});
    expect(notes).toEqual(before);
    for(const midi of [36,38,42,46]) {
      const y=(127-midi)*plan.rowHeight-plan.y;
      expect(y).toBeGreaterThanOrEqual(0); expect(y+plan.rowHeight).toBeLessThanOrEqual(260);
    }
  });
});
