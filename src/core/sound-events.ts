export interface GameSoundFile { name: string; type?: string; volume?: number; pitch?: number; attenuation_distance?: number; weight?: number }
export interface GameSoundEvent { sounds?: (string | GameSoundFile)[] }
export interface ResolvedSound { event: string; path: string; volume: number; pitch: number; attenuationDistance: number }
const canonical = ['harp', 'bass', 'basedrum', 'snare', 'hat', 'guitar', 'flute', 'bell', 'chime', 'xylophone', 'iron_xylophone', 'cow_bell', 'didgeridoo', 'bit', 'banjo', 'pling', 'trumpet', 'trumpet_exposed', 'trumpet_weathered', 'trumpet_oxidized'];

// Resolve the event played by the block, not a similarly named unused sample.
// For example modern harp uses harp2.ogg and bass uses bassattack.ogg.
export function resolveNoteBlockSounds(events: Record<string, GameSoundEvent>): Record<string, ResolvedSound> {
  const result: Record<string, ResolvedSound> = {};
  for (const id of canonical) {
    const oldName = id === 'basedrum' ? 'bd' : id === 'bass' ? 'bassattack' : id;
    const event = [`block.note_block.${id}`, `block.note.${id}`, `note.${oldName}`].find(name => events[name]);
    if (!event) continue;
    const sounds = events[event].sounds ?? [];
    if (sounds.length !== 1) throw new Error(`声音事件 ${event} 包含多个变体，需要明确变体策略后才能原版渲染。`);
    const sound = typeof sounds[0] === 'string' ? { name: sounds[0] } : sounds[0];
    if (sound.type && sound.type !== 'file') throw new Error(`声音事件 ${event} 的间接引用暂未支持。`);
    if (!/^(?:minecraft:)?[a-z0-9_./-]+$/.test(sound.name) || sound.name.includes('..')) throw new Error(`声音事件 ${event} 的采样路径无效。`);
    const relative = sound.name.replace(/^minecraft:/, '');
    const volume = sound.volume ?? 1, pitch = sound.pitch ?? 1, attenuationDistance = sound.attenuation_distance ?? 16;
    if (![volume, pitch, attenuationDistance].every(Number.isFinite) || volume < 0 || pitch <= 0 || attenuationDistance <= 0) throw new Error(`声音事件 ${event} 的参数无效。`);
    result[id] = { event, path: `minecraft/sounds/${relative}.ogg`, volume, pitch, attenuationDistance };
  }
  return result;
}
