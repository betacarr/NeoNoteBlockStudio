import { describe, expect, it } from 'vitest';
import { INSTRUMENTS, instrumentForProgram } from '../src/core/instruments';

describe('instrument display names', () => {
  it('labels harp as 竖琴 while preserving its sound and interchange identity', () => {
    expect(INSTRUMENTS.find(instrument => instrument.id === 'harp')).toMatchObject({
      name: '竖琴', englishName: 'Harp', nbsIndex: 0, gmProgram: 0,
      rootMidi: 66, sound: 'minecraft:block.note_block.harp',
    });
    expect(instrumentForProgram(0)).toBe('harp');
    expect(INSTRUMENTS.find(instrument => instrument.id === 'pling')?.name).toBe('电钢琴');
    expect(instrumentForProgram(4)).toBe('pling');
  });
});
