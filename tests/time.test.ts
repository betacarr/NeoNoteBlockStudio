import { describe, expect, it } from 'vitest';
import { MeterMap, grownPatternLength, patternOrigin, patternPlayhead, patternTickAt } from '../src/core/meter';
import { TempoMap } from '../src/core/time';
import { createProject, projectEnd } from '../src/core/project';

const mixed = () => new MeterMap(480, [
  { tick: 0, numerator: 3, denominator: 4 },
  { tick: 2880, numerator: 7, denominator: 8 },
  { tick: 6240, numerator: 4, denominator: 4 },
]);
describe('musical time across meter changes', () => {
  it('counts denominator beats and inverts bar starts across 3/4, 7/8 and 4/4', () => {
    const meter = mixed();
    expect([0,480,1439,1440,2880,3120,4559,4560,6240].map(tick => meter.format(tick))).toEqual(['1.1.00','1.2.00','1.3.99','2.1.00','3.1.00','3.2.00','3.7.99','4.1.00','5.1.00']);
    expect([1,2,3,4,5,6].map(bar => meter.barTick(bar))).toEqual([0,1440,2880,4560,6240,8160]);
    expect(meter.at(3000).fraction).toBe(.5);
  });
  it('truncates a bar at a real change, while repeated identical MIDI signatures retain its phase', () => {
    const meter = new MeterMap(480, [{ tick: 0, numerator: 4, denominator: 4 }, { tick: 700, numerator: 4, denominator: 4, metronome: 36 }, { tick: 1000, numerator: 7, denominator: 8 }]);
    expect(meter.at(999)).toMatchObject({ bar:1,beat:3,barEnd:1000 });
    expect(meter.format(1000)).toBe('2.1.00');
    expect(meter.format(2680)).toBe('3.1.00');
    expect(meter.barSnap(900,'ceil')).toBe(1000);
    expect(meter.barSnap(1000,'ceil')).toBe(1000);
    expect(meter.barTick(2)).toBe(1000);
  });
  it('anchors note-value snapping at each bar without stretching a 1/4 into a denominator beat', () => {
    const meter = mixed();
    expect(meter.snap(4565,480)).toBe(4560);
    expect(meter.snap(4805,480)).toBe(5040);
    expect(meter.snap(6230,480)).toBe(6240);
    expect(meter.snap(4550,120)).toBe(4560);
    expect(meter.snap(3000,0)).toBe(3000);
  });
  it('returns the same visible marks regardless of a preceding long song', () => {
    const meter = mixed(), grid = meter.grid(2800,6500,.2,120);
    expect(grid.filter(mark => mark.kind === 'bar').map(mark => [mark.tick,mark.bar,mark.signature])).toEqual([[2880,3,'7/8'],[4560,4,undefined],[6240,5,'4/4']]);
    expect(grid.find(mark => mark.tick === 3000)?.kind).toBe('division');
    expect(grid.find(mark => mark.tick === 3120)?.kind).toBe('beat');
    const far = meter.grid(1e11,1e11+10000,.1,120);
    expect(far.length).toBeGreaterThan(10); expect(far.length).toBeLessThan(200);
    expect(far.every(mark => mark.tick >= 1e11 && mark.tick <= 1e11+10000)).toBe(true);
    const dense = new MeterMap(1,[{tick:0,numerator:1,denominator:32768}]).grid(0,100000, .01,1);
    expect(dense.length).toBeLessThanOrEqual(4096);
    expect(dense.length).toBeGreaterThan(0);
  });
  it('uses defaults and the last message at a shared tick', () => {
    expect(new MeterMap(480,[]).format(1920)).toBe('2.1.00');
    const meter = new MeterMap(480,[{tick:1920,numerator:3,denominator:4},{tick:1920,numerator:5,denominator:8}]);
    expect(meter.at(1920)).toMatchObject({bar:2,numerator:5,denominator:8,barEnd:3120});
  });
  it('converts trimmed and looped regions to source coordinates, without changing their periods', () => {
    const p = createProject(), region = p.regions[0], pattern = p.patterns[0];
    region.start = 3000; region.offset = 240; pattern.length = 1440; region.length = 2880;
    expect(patternOrigin(region,pattern)).toBe(2760);
    expect(patternTickAt(4000,region,pattern)).toBe(1240);
    expect(patternPlayhead(2999,region,pattern)).toBe(-1);
    region.loop = true;
    expect(patternPlayhead(4200,region,pattern)).toBe(0);
    expect(patternPlayhead(5879,region,pattern)).toBe(239);
    expect(patternPlayhead(5880,region,pattern)).toBe(-1);
    region.offset += 1440;
    expect(patternOrigin(region,pattern)).toBe(2760);
    expect(patternTickAt(4200,region,pattern)).toBe(0);
    expect(grownPatternLength(p,region,pattern,1000)).toBe(1440);
    expect(grownPatternLength(p,region,pattern,1500)).toBe(4920);
    expect(projectEnd(p)).toBe(5880);
  });
});

describe('tempo index', () => {
  it('integrates changing BPM and inverts both sides of each boundary', () => {
    const tempo = new TempoMap(480,[{tick:6240,bpm:150},{tick:0,bpm:120},{tick:2880,bpm:90}]);
    expect(tempo.seconds(2880)).toBe(3);
    expect(tempo.seconds(6240)).toBe(3+14/3);
    expect(tempo.at(6240).bpm).toBe(150);
    for (const tick of [0,1,2879,2880,2881,6239,6240,6241,1e9]) expect(tempo.tick(tempo.seconds(tick))).toBeCloseTo(tick,5);
  });
  it('matches direct interval integration for a long score and snapshots its source', () => {
    const events = Array.from({length:2000},(_,i) => ({tick:i*480,bpm:40+(i*37)%200}));
    const tempo = new TempoMap(480,events);
    const reference = (tick:number) => {
      let result = 0;
      for (let i=0;i<events.length;i++) { const end=Math.min(tick,events[i+1]?.tick??tick); if(end>events[i].tick) result+=(end-events[i].tick)/480*60/events[i].bpm; if(end===tick) break; }
      return result;
    };
    for(const tick of [0,240,480,960.25,250001,959519,960000,1000000]) expect(tempo.seconds(tick)).toBe(reference(tick));
    const previous = tempo.seconds(240); events[0].bpm=300;
    expect(tempo.seconds(240)).toBe(previous);
  });
});
