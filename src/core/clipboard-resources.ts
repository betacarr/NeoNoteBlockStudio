import type { Asset, Instrument, Note } from './types';

const MAX_NOTES = 2000000, MAX_TICK = 1e12;
const MAX_MANIFEST = 64 * 1024 * 1024, MAX_EXPANDED = 512 * 1024 * 1024;
// saveNbsx replaces any stored timestamp with a 24-byte ISO save time.
export const NBSX_SAVE_TIMESTAMP = '2000-01-01T00:00:00.000Z';
const finite = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const identifier = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

export function assertNotes(notes: readonly Note[]): void {
  if (!Array.isArray(notes) || notes.length > MAX_NOTES) throw new Error('剪贴板音符超过 200 万个或内容无效。');
  const ids = new Set<string>();
  for (const note of notes) {
    if (!note || !identifier(note.id) || ids.has(note.id) || !finite(note.tick, 0, MAX_TICK) || !finite(note.duration, 0, MAX_TICK)
      || !finite(note.midi, 0, 127) || !Number.isInteger(note.midi) || !finite(note.velocity, 0, 1) || !finite(note.pan, -1, 1)
      || !finite(note.detune, -32768, 32767) || !finite(note.height, -64, 64)
      || note.instrumentId !== undefined && !identifier(note.instrumentId)) throw new Error('剪贴板包含无效音符参数或重复音符 ID。');
    ids.add(note.id);
    if (note.midiSource !== undefined) {
      const midi = note.midiSource;
      if (!midi || !Number.isInteger(midi.onOrder) || !finite(midi.onOrder, 0, MAX_TICK)
        || !Number.isInteger(midi.offOrder) || !finite(midi.offOrder, 0, MAX_TICK)
        || !Number.isInteger(midi.releaseVelocity) || !finite(midi.releaseVelocity, 0, 127)
        || midi.offSourceTrack !== undefined && (!Number.isInteger(midi.offSourceTrack) || !finite(midi.offSourceTrack, 0, 65535))) throw new Error('剪贴板包含无效 MIDI 来源信息。');
    }
  }
}

export function resourceIndex<T extends { id: string }>(resources: readonly T[]): Map<string, T> {
  if (!Array.isArray(resources)) throw new Error('剪贴板资源清单无效。');
  const index = new Map<string, T>();
  for (const resource of resources) {
    if (!resource || !identifier(resource.id) || index.has(resource.id)) throw new Error('剪贴板资源 ID 缺失或重复。');
    index.set(resource.id, resource);
  }
  return index;
}
export function assertInstrument(instrument: Instrument): void {
  if (![instrument.name, instrument.englishName, instrument.block, instrument.color].every(value => typeof value === 'string')
    || !finite(instrument.rootMidi, 0, 127) || !Number.isInteger(instrument.gmProgram) || !finite(instrument.gmProgram, 0, 127)
    || instrument.nbsIndex !== undefined && (!Number.isInteger(instrument.nbsIndex) || !finite(instrument.nbsIndex, 0, 255))
    || instrument.sound !== undefined && typeof instrument.sound !== 'string'
    || instrument.assetId !== undefined && !identifier(instrument.assetId)) throw new Error('剪贴板音色定义无效。');
}
export function assetBytes(asset: Asset): number {
  if (!/^[\w-]+$/.test(asset.id) || typeof asset.name !== 'string' || typeof asset.mime !== 'string'
    || asset.path !== undefined && typeof asset.path !== 'string' || asset.sha1 !== undefined && typeof asset.sha1 !== 'string') throw new Error('剪贴板采样资源无效。');
  if (asset.data === undefined) {
    return 0;
  }
  if (typeof asset.data !== 'string' || asset.data.length > Math.ceil(MAX_EXPANDED / 3) * 4) throw new Error('剪贴板采样超过 512 MB 或编码无效。');
  const data = asset.data.replace(/[\t\n\f\r ]/g, '');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(data) || data.length % 4 === 1 || data.includes('=') && data.length % 4 !== 0) throw new Error('剪贴板采样 Base64 编码无效。');
  return Math.floor(data.length * 3 / 4) - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0);
}

// Compare actual fields, ignoring only IDs. Optional absent/undefined fields agree.
const instrumentFields = { name: true, englishName: true, nbsIndex: true, sound: true, assetId: true, rootMidi: true, block: true, color: true, gmProgram: true } satisfies Record<Exclude<keyof Instrument, 'id'>, true>;
const assetFields = { name: true, mime: true, data: true, path: true, sha1: true } satisfies Record<Exclude<keyof Asset, 'id'>, true>;
export const sameInstrument = (a: Instrument, b: Instrument) => (Object.keys(instrumentFields) as (keyof typeof instrumentFields)[]).every(key => a[key] === b[key]);
export const sameAsset = (a: Asset, b: Asset) => (Object.keys(assetFields) as (keyof typeof assetFields)[]).every(key => a[key] === b[key]);

/** Count the existing NBSX limits without decoding audio or a giant notes array. */
export function sizeBudget() {
  const encoder = new TextEncoder();
  let manifest = 0, binary = 'application/vnd.exnoteblock.project+zip'.length;
  const addJson = (value: unknown) => {
    manifest += encoder.encode(JSON.stringify(value)).length;
    if (manifest > MAX_MANIFEST) throw new Error('粘贴后工程清单超过 64 MB，请减少音符或资源。');
  };
  const addItems = (items: readonly unknown[]) => {
    for (const item of items) addJson(item);
    manifest += Math.max(0, items.length - 1);
  };
  const addAsset = (asset: Asset) => {
    binary += assetBytes(asset);
    const { data, ...metadata } = asset;
    addJson(data ? metadata : asset);
    if (binary > MAX_EXPANDED) throw new Error('粘贴后工程资源超过 512 MB，请减少采样资源。');
  };
  const finish = () => {
    if (manifest > MAX_MANIFEST) throw new Error('粘贴后工程清单超过 64 MB，请减少音符或资源。');
    if (binary + manifest > MAX_EXPANDED) throw new Error('粘贴后工程资源展开后超过 512 MB，请减少采样资源。');
  };
  return { addJson, addItems, addAsset, comma: () => { manifest++; }, finish };
}
