import data from '../data/audio-facts.json';
import identities from '../data/java-release-identities.json';
import type { AudioProfile } from '../core/types';
import validation from '../data/audio-validation.json';
import legacyData from '../data/legacy-audio-facts.json';
import earlyData from '../data/early-audio-facts.json';

export const releaseIdentity = (version: string) => identities.find(v => v.id === version);
export const audioFacts = (profileId: string) => data.profiles.find(p => p.id === profileId) ?? earlyData.profiles.find(p => p.id === profileId);
export const gameHrtfControl = (profileId: string): boolean | undefined => audioFacts(profileId)?.hrtfControl ?? legacyData.profiles.find(p => p.id === profileId)?.hrtfControl;
export function audioProfile(profileId: string): AudioProfile {
  const facts = audioFacts(profileId), version = profileId.replace(/^java-/, '');
  const legacy = legacyData.profiles.find(p => p.id === profileId);
  const configuredPool = legacy && 'originalRequestedVoicePool' in legacy ? legacy.originalRequestedVoicePool?.normal : undefined;
  const measured = validation.profiles.find(p => p.id === profileId && p.clientSha1 === (facts?.clientSha1??legacy?.clientSha1));
  return { id: profileId, name: `Java ${version}`, versions: version,
    backend: facts ? `OpenAL / ${facts.decoder === 'stb' ? 'STB Vorbis' : 'JOrbis'}` : legacy ? 'Paulscode / JOrbis / OpenAL' : '版本行为待核对',
    status: measured ? 'partially-measured' : facts || legacy ? 'code-reviewed' : 'unverified', attenuationDistance: facts?.attenuationDistance ?? 16,
    noteBlockVolume: facts?.blockVolume ?? 3, voiceWarning: configuredPool ?? 128,
    measurementSummary: measured ? `已对照 ${measured.singleNoteWorldCases + measured.simultaneousWorldCases} 个游戏场景（Windows / 48 kHz），${measured.hrtf.includes(true) ? '受控后端 HRTF 关闭/开启' : measured.hrtfUnsupported ? 'HRTF 关闭（原版库不支持开启）' : '仅 HRTF 关闭场景，开启待验收'}，最多 ${measured.maxSimultaneousVoices} 音合奏。其他设置仍待验收。` : undefined,
    source: 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json' };
}
