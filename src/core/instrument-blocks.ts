/**
 * A representative vanilla support block for each pitched note-block instrument.
 * This is an identity map, not a complete list of blocks that select an instrument.
 * The original vector artwork lives in ui/InstrumentBlock.tsx; no game textures
 * or resource-pack assets are bundled with these definitions.
 *
 * The first sixteen entries are covered by scripts/capture-game-world.mjs.
 * Copper variants were checked against the SHA-1 verified Java 26.3 Blocks class:
 * e877b6a07acd633fb3bb475002175cec036e7b87. See docs/instrument-block-icons.md.
 */
export type InstrumentBlockKey =
  | 'dirt' | 'oak_planks' | 'stone' | 'sand' | 'glass' | 'white_wool'
  | 'clay' | 'gold_block' | 'packed_ice' | 'bone_block' | 'iron_block'
  | 'soul_sand' | 'pumpkin' | 'emerald_block' | 'hay_block' | 'glowstone'
  | 'copper_block' | 'exposed_copper' | 'weathered_copper' | 'oxidized_copper'
  | 'note_block';

export interface InstrumentBlockDefinition {
  readonly key: InstrumentBlockKey;
  readonly blockId: `minecraft:${InstrumentBlockKey}`;
  readonly name: string;
}

const block = (key: InstrumentBlockKey, name: string): InstrumentBlockDefinition => ({ key, blockId: `minecraft:${key}`, name });

export const INSTRUMENT_BLOCKS: Readonly<Record<string, InstrumentBlockDefinition>> = {
  harp: block('dirt', '泥土'),
  bass: block('oak_planks', '橡木木板'),
  basedrum: block('stone', '石头'),
  snare: block('sand', '沙子'),
  hat: block('glass', '玻璃'),
  guitar: block('white_wool', '白色羊毛'),
  flute: block('clay', '黏土'),
  bell: block('gold_block', '金块'),
  chime: block('packed_ice', '浮冰'),
  xylophone: block('bone_block', '骨块'),
  iron_xylophone: block('iron_block', '铁块'),
  cow_bell: block('soul_sand', '灵魂沙'),
  didgeridoo: block('pumpkin', '南瓜'),
  bit: block('emerald_block', '绿宝石块'),
  banjo: block('hay_block', '干草块'),
  pling: block('glowstone', '荧石'),
  trumpet: block('copper_block', '铜块'),
  trumpet_exposed: block('exposed_copper', '斑驳的铜块'),
  trumpet_weathered: block('weathered_copper', '锈蚀的铜块'),
  trumpet_oxidized: block('oxidized_copper', '氧化的铜块'),
};

const fallback = block('note_block', '音符盒');

/** Unknown and custom instruments keep an explicit, recognisable note-block icon. */
export const instrumentBlock = (instrumentId: string): InstrumentBlockDefinition =>
  Object.prototype.hasOwnProperty.call(INSTRUMENT_BLOCKS, instrumentId) ? INSTRUMENT_BLOCKS[instrumentId] : fallback;
