// Independent binary fixtures from https://noteblock.studio/nbs. This avoids
// @nbsjs/core 6.1.0's writer always using its 20-entry built-in table for v0-v5.
export interface FixtureNote { tick: number; layer?: number; instrument: number; key?: number; velocity?: number; pan?: number; detune?: number }
export interface FixtureLayer { name?: string; volume?: number; pan?: number; locked?: boolean; solo?: boolean; state?: number }
export interface FixtureInstrument { name?: string; soundFile?: string; key?: number; pressKey?: boolean }
export function nbsFixture(options: {
  version: number; builtinCount?: number; length?: number; tempo?: number;
  name?: string; author?: string; originalAuthor?: string; description?: string;
  loop?: { enabled: boolean; count: number; start: number };
  notes: FixtureNote[]; layers?: FixtureLayer[]; custom?: FixtureInstrument[];
}): Uint8Array {
  const { version } = options, bytes: number[] = [];
  const byte = (value: number) => bytes.push(value & 255);
  const short = (value: number) => { byte(value); byte(value >> 8); };
  const integer = (value: number) => { short(value); short(value >> 16); };
  const string = (value: string) => { const encoded = new TextEncoder().encode(value); integer(encoded.length); for (const item of encoded) byte(item); };
  const layers = options.layers ?? [{}], builtinCount = options.builtinCount ?? (version === 0 ? 10 : version >= 6 ? 20 : 16);
  if (version > 0) { short(0); byte(version); byte(builtinCount); }
  if (version === 0 || version >= 3) short(options.length ?? 16);
  short(layers.length); string(options.name ?? 'Interop fixture'); string(options.author ?? 'Fixture author'); string(options.originalAuthor ?? 'Original author'); string(options.description ?? 'Binary specification fixture');
  short(Math.round((options.tempo ?? 10) * 100)); byte(0); byte(5); byte(4);
  for (const value of [123, 456, 789, 12, 3]) integer(value);
  string('source.mid');
  if (version >= 4) { byte(options.loop?.enabled ? 1 : 0); byte(options.loop?.count ?? 0); short(options.loop?.start ?? 0); }
  const notes = [...options.notes].sort((a, b) => a.tick - b.tick || (a.layer ?? 0) - (b.layer ?? 0));
  let tick = -1, cursor = 0;
  while (cursor < notes.length) {
    const nextTick = notes[cursor].tick; short(nextTick - tick); tick = nextTick;
    let layer = -1;
    while (cursor < notes.length && notes[cursor].tick === tick) {
      const note = notes[cursor++], nextLayer = note.layer ?? 0; short(nextLayer - layer); layer = nextLayer;
      byte(note.instrument); byte(note.key ?? 45);
      if (version >= 4) { byte(note.velocity ?? 100); byte(note.pan ?? 100); short(note.detune ?? 0); }
    }
    short(0);
  }
  short(0);
  for (const layer of layers) {
    string(layer.name ?? 'Fixture layer'); if (version >= 4) byte(layer.state ?? (layer.solo ? 2 : layer.locked ? 1 : 0));
    byte(layer.volume ?? 100); if (version >= 2) byte(layer.pan ?? 100);
  }
  byte(options.custom?.length ?? 0);
  for (const instrument of options.custom ?? []) { string(instrument.name ?? 'Custom fixture'); string(instrument.soundFile ?? 'custom.ogg'); byte(instrument.key ?? 45); byte(instrument.pressKey ? 1 : 0); }
  return Uint8Array.from(bytes);
}
