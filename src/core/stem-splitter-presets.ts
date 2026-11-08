import { selectedStemSources, STEM_ROLES, stemSourceRoles, type StemRole, type StemSelection, type StemSourceRole } from './audio-assist';

export interface StemSplitterSettings extends StemSelection { includeSubmix: boolean }

export function omittedStemSources(settings: StemSplitterSettings) {
  const selected = selectedStemSources(settings);
  return stemSourceRoles(settings.drumPieces).filter(role => !selected.includes(role));
}

function preset(stems: StemRole[], includeSubmix: boolean, drumPieces = false, submix?: StemSourceRole[]): StemSplitterSettings {
  const settings = { stems, drumPieces, submix: [], includeSubmix };
  return { ...settings, submix: submix ?? omittedStemSources(settings) };
}

export const STEM_SPLITTER_PRESETS = {
  vocals: { label: '无伴奏合唱', settings: preset(['vocals'], false) },
  instrumental: { label: '器乐', settings: preset([], true, false, STEM_ROLES.filter(role => role !== 'vocals')) },
  vocalsInstrumental: { label: '人声与器乐', settings: preset(['vocals'], true) },
  vocalsDrums: { label: '人声、乐器与鼓', settings: preset(['vocals', 'drums'], true) },
  vocalsDrumsBass: { label: '人声、乐器、鼓与贝斯', settings: preset(['vocals', 'drums', 'bass'], true) },
  drums: { label: '鼓（完整架子鼓）', settings: preset(['drums'], false) },
  drumPieces: { label: '鼓（单个鼓件）', settings: preset(['drums'], false, true) },
  all: { label: '分离所有大分轨', settings: preset([...STEM_ROLES], false) },
};
export type StemSplitterPreset = keyof typeof STEM_SPLITTER_PRESETS;
export const STEM_SPLITTER_PRESET_IDS = Object.keys(STEM_SPLITTER_PRESETS) as StemSplitterPreset[];

export function requestedStemSelection(settings: StemSplitterSettings): StemSelection {
  const { includeSubmix, ...selection } = settings;
  return { ...selection, submix: includeSubmix && settings.submix.length >= 2 ? settings.submix : [] };
}
