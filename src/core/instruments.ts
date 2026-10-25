import type { Instrument } from './types';

const definitions = [
  ['harp', '钢琴', 'Harp', '泥土 / 空气', '#70bba0', 0],
  ['bass', '贝斯', 'Bass', '木板', '#b58be3', 32],
  ['basedrum', '底鼓', 'Bass Drum', '石头', '#dd9b6c', 117],
  ['snare', '军鼓', 'Snare', '沙子', '#d7b366', 115],
  ['hat', '踩镲', 'Hat', '玻璃', '#b6c7cf', 119],
  ['guitar', '吉他', 'Guitar', '羊毛', '#b2c775', 24],
  ['flute', '长笛', 'Flute', '黏土', '#72a9d1', 73],
  ['bell', '钟', 'Bell', '金块', '#dfbf66', 14],
  ['chime', '风铃', 'Chime', '浮冰', '#8dc9d0', 10],
  ['xylophone', '木琴', 'Xylophone', '骨块', '#cf9a83', 13],
  ['iron_xylophone', '铁木琴', 'Iron Xylophone', '铁块', '#aeb8cd', 11],
  ['cow_bell', '牛铃', 'Cow Bell', '灵魂沙', '#d89c67', 112],
  ['didgeridoo', '迪吉里杜管', 'Didgeridoo', '南瓜', '#ca817b', 111],
  ['bit', '方波', 'Bit', '绿宝石块', '#80bd84', 80],
  ['banjo', '班卓琴', 'Banjo', '干草块', '#c2b876', 105],
  ['pling', '电钢琴', 'Pling', '荧石', '#b8a4db', 4],
  ['trumpet', '小号', 'Trumpet', '铜块', '#cf9c77', 56],
  ['trumpet_exposed', '斑驳小号', 'Exposed Trumpet', '斑驳的铜块', '#beab86', 57],
  ['trumpet_weathered', '锈蚀小号', 'Weathered Trumpet', '锈蚀的铜块', '#87b49c', 58],
  ['trumpet_oxidized', '氧化小号', 'Oxidized Trumpet', '氧化的铜块', '#69b4a3', 59],
] as const;

export const INSTRUMENTS: Instrument[] = definitions.map(([id, name, englishName, block, color, gmProgram], nbsIndex) => ({
  id, name, englishName, block, color, gmProgram, nbsIndex, rootMidi: 66,
  sound: `minecraft:block.note_block.${id}`,
}));
export const TRACK_COLORS = ['#76bda2', '#86aee1', '#c29cde', '#d7b36f', '#db9696', '#8bc5cc', '#aaba78', '#b3a4df'];
export const instrumentForProgram = (program: number, percussion = false): string => {
  if (percussion) return 'basedrum';
  if (program < 8) return program === 4 || program === 5 ? 'pling' : 'harp';
  if (program < 16) return program === 13 ? 'xylophone' : program === 14 ? 'bell' : 'chime';
  if (program < 24) return 'bit';
  if (program < 32) return 'guitar';
  if (program < 40) return 'bass';
  if (program < 56) return 'harp';
  if (program < 64) return 'trumpet';
  if (program < 80) return 'flute';
  if (program < 104) return 'bit';
  return program === 105 ? 'banjo' : program === 111 ? 'didgeridoo' : program === 112 ? 'cow_bell' : 'harp';
};
export const drumInstrument = (pitch: number): string => pitch === 35 || pitch === 36 ? 'basedrum' : [38, 40].includes(pitch) ? 'snare' : pitch === 56 ? 'cow_bell' : 'hat';
export const noteName = (midi: number): string => `${['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'][((Math.round(midi) % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
