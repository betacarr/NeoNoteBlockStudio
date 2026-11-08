import type { DrumPreset, Instrument } from './types';
import { INSTRUMENTS, inNoteBlockRange } from './instruments';

// General MIDI Level 1 Percussion Key Map (MIDI Association RP-003).
// Numeric MIDI keys are authoritative; octave names vary between applications.
export const GM_PERCUSSION = [
  '原声底鼓', '底鼓', '边击', '军鼓', '拍手', '电子军鼓', '低音落地嗵鼓',
  '闭镲', '高音落地嗵鼓', '踏镲', '低音嗵鼓', '开镲', '中低音嗵鼓',
  '中高音嗵鼓', '强音镲 1', '高音嗵鼓', '叮叮镲 1', '中国镲', '镲钟',
  '铃鼓', '水镲', '牛铃', '强音镲 2', '颤音叉', '叮叮镲 2',
  '高音邦戈鼓', '低音邦戈鼓', '闷音高康加鼓', '开放高康加鼓', '低音康加鼓',
  '高音天巴鼓', '低音天巴鼓', '高音阿哥哥铃', '低音阿哥哥铃', '卡巴萨', '沙锤',
  '短哨', '长哨', '短刮瓜', '长刮瓜', '击木', '高音木鱼', '低音木鱼',
  '闷音库伊卡鼓', '开放库伊卡鼓', '闷音三角铁', '开放三角铁',
].map((label, index) => ({ midi: index + 35, label }));

export function gmPercussionName(midi: number): string | undefined {
  return GM_PERCUSSION.find(row => row.midi === midi)?.label;
}

/** Display metadata only: never remaps or migrates stored trigger events. */
export function gmDrumRows(preset: DrumPreset | undefined, instruments: readonly Instrument[] = INSTRUMENTS) {
  const mappings = new Map(preset?.mappings.map(mapping => [mapping.trigger, mapping]) ?? []);
  return Array.from({ length: 128 }, (_, midi) => {
    const mapping = mappings.get(midi);
    const inside = mapping?.notes.filter(hit => {
      const instrument = instruments.find(instrument => instrument.id === hit.instrumentId);
      return instrument && inNoteBlockRange(hit.midi, instrument.rootMidi);
    }).length ?? 0;
    const range: 'in' | 'out' | 'mixed' | 'unmapped' = !mapping?.notes.length ? 'unmapped' : inside === mapping.notes.length ? 'in' : inside ? 'mixed' : 'out';
    return { midi, label: gmPercussionName(midi) ?? '自定义触发', mapped: !!mapping,
      mappingName: mapping ? mapping.name?.trim() || '未命名映射' : undefined, range };
  });
}
