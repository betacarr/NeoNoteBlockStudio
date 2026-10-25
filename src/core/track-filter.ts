import type { Instrument, Track } from './types';

/** A display filter only. Original track order and object identities are retained. */
export function filterTracks<T extends Pick<Track, 'instrumentId'>>(tracks: readonly T[], instrumentId: string): readonly T[] {
  return instrumentId === '' ? tracks : tracks.filter(track => track.instrumentId === instrumentId);
}

export interface TrackInstrumentOption { id: string; name: string; count: number }

/** Project instrument order first; missing definitions follow their first track occurrence. */
export function trackInstrumentOptions(tracks: readonly Track[], instruments: readonly Instrument[], selected = ''): TrackInstrumentOption[] {
  const counts = new Map<string, number>();
  for (const track of tracks) counts.set(track.instrumentId, (counts.get(track.instrumentId) ?? 0) + 1);
  const options: TrackInstrumentOption[] = [], seen = new Set<string>();
  for (const instrument of instruments) {
    if (seen.has(instrument.id)) continue;
    seen.add(instrument.id);
    const count = counts.get(instrument.id) ?? 0;
    if (count > 0 || instrument.id === selected) options.push({ id: instrument.id, name: instrument.name || instrument.englishName || instrument.id, count });
  }
  for (const [id, count] of counts) if (!seen.has(id)) {
    options.push({ id, name: `未知乐器 · ${id}`, count }); seen.add(id);
  }
  if (selected && !seen.has(selected)) options.push({ id: selected, name: `未知乐器 · ${selected}`, count: 0 });
  return options;
}
