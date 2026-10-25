import layouts from '../data/sound-asset-layouts.json';
import { resolveNoteBlockSounds, type ResolvedSound } from './sound-events';
import type { SampleLibrary } from './types';

export interface SoundAssetObject { hash: string; size?: number }
export interface SoundAssetIndex { objects?: Record<string, SoundAssetObject> }
export type SoundAssetLayout = 'namespaced' | 'default-domain-root' | 'legacy-newsound' | 'legacy-sound3' | 'legacy-sound';

/** Original 1.7.3–1.7.9 ResourceIndex prefixes every raw key with minecraft:.
 * Later indexes include the namespace in their raw keys. See docs/legacy-sound-assets.md.
 * Select by checked client identity, never by whichever similarly named file exists.
 */
export function soundAssetLayout(clientSha1: string | undefined, index: SoundAssetIndex): SoundAssetLayout {
  if (clientSha1 && Object.prototype.hasOwnProperty.call(layouts.legacyNewsound.clients, clientSha1)) return 'legacy-newsound';
  if (clientSha1 && Object.prototype.hasOwnProperty.call(layouts.legacySound3.clients, clientSha1)) return 'legacy-sound3';
  if (clientSha1 && Object.prototype.hasOwnProperty.call(layouts.legacySound.clients, clientSha1)) return 'legacy-sound';
  // 1.7.2 has no ResourceIndex: its original File-root pack walks the launcher's
  // virtual/legacy tree. Its checked logical paths map to root keys here too.
  if (clientSha1 && Object.prototype.hasOwnProperty.call(layouts.virtualLegacyRoot.clients, clientSha1)) return 'default-domain-root';
  if (clientSha1 && Object.prototype.hasOwnProperty.call(layouts.defaultDomainRoot.clients, clientSha1)) return 'default-domain-root';
  if (index.objects?.['minecraft/sounds.json']) return 'namespaced';
  throw new Error('该历史版本的声音资源索引布局尚未核对；不会凭根目录 sounds.json 或采样文件名猜测路径。');
}

/** Convert a canonical minecraft resource path into its actual asset-index key. */
export function soundAssetObjectPath(layout: SoundAssetLayout, resourcePath: string): string {
  if (!resourcePath.startsWith('minecraft/') || resourcePath.includes('..') || resourcePath.includes('\\')) throw new Error('声音资源路径无效。');
  if (layout === 'legacy-newsound' || layout === 'legacy-sound3' || layout === 'legacy-sound') {
    if (!resourcePath.startsWith('minecraft/sounds/')) throw new Error('旧版声音资源路径无效。');
    const prefix = layout === 'legacy-newsound' ? 'newsound' : layout === 'legacy-sound3' ? 'sound3' : 'sound';
    return `${prefix}/${resourcePath.slice('minecraft/sounds/'.length)}`;
  }
  return layout === 'default-domain-root' ? resourcePath.slice('minecraft/'.length) : resourcePath;
}

function legacyNoteEvents(index: SoundAssetIndex, layout: 'legacy-newsound' | 'legacy-sound3' | 'legacy-sound'): Record<string, ResolvedSound> {
  const sourcePrefix = layout === 'legacy-newsound' ? 'newsound' : layout === 'legacy-sound3' ? 'sound3' : 'sound';
  const definitions = layout === 'legacy-newsound' ? layouts.legacyNewsound : layout === 'legacy-sound3' ? layouts.legacySound3 : layouts.legacySound;
  const groups = new Map<string, string[]>();
  for (const key of Object.keys(index.objects ?? {})) {
    // Original Minecraft accepts sound/newsound prefixes, then SoundPool removes
    // the extension and trailing digits before grouping '/' as '.'.
    const prefix = (layout === 'legacy-newsound' ? /^(?:sound|newsound)\/(.+)$/i : layout === 'legacy-sound3' ? /^sound3\/(.+)$/i : /^sound\/(.+)$/i).exec(key); if (!prefix) continue;
    let stem = prefix[1].split('.')[0];
    // Original Character.isDigit(char) examines one UTF-16 unit at a time;
    // supplementary-plane decimal digits are not a numbered Java variant.
    while (stem && /\p{Nd}/u.test(stem[stem.length - 1])) stem = stem.slice(0, -1);
    stem = stem.replaceAll('/', '.');
    const candidates = groups.get(stem) ?? []; candidates.push(key); groups.set(stem, candidates);
  }
  return Object.fromEntries(Object.entries(definitions.events).map(([id, name]) => {
    const event = `note.${name}`, expected = `${sourcePrefix}/note/${name}.ogg`, candidates = groups.get(event) ?? [];
    if (candidates.length > 1) throw new Error(`声音事件 ${event} 包含多个变体，需要明确变体策略后才能原版渲染。`);
    if (candidates.length === 1 && candidates[0] !== expected) throw new Error(`旧版声音事件 ${event} 的资源路径尚未核对：${candidates[0]}`);
    return [id, { event, path: `minecraft/sounds/note/${name}.ogg`, volume: 1, pitch: 1, attenuationDistance: 16 }];
  }));
}

export async function loadNoteBlockSoundAssets(index: SoundAssetIndex, layout: SoundAssetLayout, readObject: (object: SoundAssetObject) => Promise<Uint8Array>): Promise<Pick<SampleLibrary, 'soundEvents' | 'samples'>> {
  let soundEvents: Record<string, ResolvedSound>;
  if (layout === 'legacy-newsound' || layout === 'legacy-sound3' || layout === 'legacy-sound') soundEvents = legacyNoteEvents(index, layout);
  else {
    const definitionsPath = soundAssetObjectPath(layout, 'minecraft/sounds.json');
    const definitionsObject = index.objects?.[definitionsPath];
    if (!definitionsObject) throw new Error(`资源索引缺少已核对的声音配置：${definitionsPath}`);
    soundEvents = resolveNoteBlockSounds(JSON.parse(new TextDecoder().decode(await readObject(definitionsObject))));
  }
  const samples: SampleLibrary['samples'] = {};
  for (const [id, sound] of Object.entries(soundEvents)) {
    const assetPath = soundAssetObjectPath(layout, sound.path), object = index.objects?.[assetPath];
    if (!object) throw new Error(`声音事件缺少资源：${assetPath}`);
    samples[id] = { name: assetPath, bytes: await readObject(object), sha1: object.hash };
  }
  if (!Object.keys(samples).length) throw new Error('此索引没有完整的音符盒采样，请选择其他资源版本。');
  return { soundEvents, samples };
}
