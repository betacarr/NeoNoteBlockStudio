import { writeMidi, type MidiEvent } from 'midi-file';
import { base64ToBytes } from './container';
import { cloneMidiEvent, isMidiChannelEvent } from './midi-events';
import { encodeMidiText } from './midi-text';
import { flattenNotes } from './project';
import type { Diagnostic, Project } from './types';

type Event = { tick: number; order: number; occurrence?: number; routeSource?: number; event: MidiEvent };
type Bucket = { source?: number; sort: number; names: string[]; events: Event[]; minimumEnd: number };

/** Actual message occurrences, including a terminal release but not the next loop's start. */
function messageCycles(tick: number, period: number, offset: number, length: number, endExclusive: boolean) {
  const local = (cycle: number) => tick + cycle * period - offset;
  const insideEnd = (cycle: number) => endExclusive ? local(cycle) < length : local(cycle) <= length;
  const sourceEnd = offset + length;
  let maximum = Math.max(0, Math.ceil(sourceEnd / period) - 1);
  let first = Math.max(0, Math.ceil((offset - tick) / period));
  let last = Math.max(-1, endExclusive ? Math.ceil((sourceEnd - tick) / period) - 1 : Math.floor((sourceEnd - tick) / period));
  // Schema coordinates are <= 1e12 and period >= 1: quotient rounding is less
  // than one cycle. Check neighbouring integers against the emitted expression,
  // rather than letting a large offset or fractional period lose an endpoint.
  for (let correction = 0; correction < 2; correction++) {
    if (maximum > 0 && maximum * period >= sourceEnd) maximum--;
    else if ((maximum + 1) * period < sourceEnd) maximum++;
    else break;
  }
  for (let correction = 0; correction < 2; correction++) {
    if (first > 0 && local(first - 1) >= 0) first--;
    else if (local(first) < 0) first++;
    else break;
  }
  for (let correction = 0; correction < 2; correction++) {
    if (last >= 0 && !insideEnd(last)) last--;
    else if (insideEnd(last + 1)) last++;
    else break;
  }
  return { first, last: Math.min(last, maximum), maximum };
}

function encodeTrack(events: Event[], minimumEnd = 0): MidiEvent[] {
  let end = minimumEnd;
  const playable: Event[] = [];
  for (const event of events) { end = Math.max(end, event.tick); if (event.event.type !== 'endOfTrack') playable.push(event); }
  playable.sort((a, b) => a.tick - b.tick || (a.occurrence ?? 0) - (b.occurrence ?? 0) || a.order - b.order);
  playable.push({ tick: end, order: 1e13, event: { deltaTime: 0, meta: true, type: 'endOfTrack' } });
  let previous = 0;
  return playable.map(({ tick, event }) => {
    const current = Math.round(tick), deltaTime = current - previous; previous = current;
    if (!Number.isSafeInteger(current) || deltaTime < 0 || deltaTime > 0x0fffffff) throw new Error('MIDI 相邻事件间隔超过格式范围，请缩短工程。');
    return { ...cloneMidiEvent(event), deltaTime };
  });
}

export function originalMidi(project: Project): { bytes: Uint8Array; name: string } | undefined {
  const asset = project.assets.find(asset => asset.id === project.midi?.sourceAssetId);
  return asset?.data ? { bytes: base64ToBytes(asset.data), name: asset.name } : undefined;
}

export function exportArchivedMidi(project: Project): { bytes: Uint8Array; diagnostics: Diagnostic[] } {
  const global: Event[] = [], buckets = new Map<string, Bucket>();
  const sourceBucket = (source: number) => {
    const key = `source:${source}`; let bucket = buckets.get(key);
    if (!bucket) { bucket = { source, sort: source, names: [], events: [], minimumEnd: 0 }; buckets.set(key, bucket); }
    return bucket;
  };
  for (const entry of project.midi?.conductor ?? []) {
    if (['setTempo', 'timeSignature', 'trackName'].includes(entry.event.type)) continue;
    const event = { tick: entry.tick, order: entry.event.type === 'sequenceNumber' ? -1e12 : entry.order, event: entry.event };
    if ((entry.sourceTrack ?? 0) === 0) global.push(event); else sourceBucket(entry.sourceTrack!).events.push(event);
  }
  global.push({ tick: 0, order: -1e12 + 1, event: { deltaTime: 0, meta: true, type: 'trackName', text: encodeMidiText(project.name) } });
  for (const tempo of project.tempos) global.push({ tick: tempo.tick, order: -1e11, event: { deltaTime: 0, meta: true, type: 'setTempo', microsecondsPerBeat: Math.max(1, Math.min(0xffffff, Math.round(60000000 / tempo.bpm))) } });
  for (const meter of project.timeSignatures) global.push({ tick: meter.tick, order: -1e10, event: { deltaTime: 0, meta: true, type: 'timeSignature', numerator: meter.numerator, denominator: meter.denominator, metronome: meter.metronome ?? 24, thirtyseconds: meter.thirtyseconds ?? 8 } });
  const notes = flattenNotes(project, true), patterns = new Map(project.patterns.map(pattern => [pattern.id, pattern]));
  const byTrack = new Map<string, typeof notes>();
  for (const note of notes) { const list = byTrack.get(note.trackId) ?? []; list.push(note); byTrack.set(note.trackId, list); }
  const diagnostics: Diagnostic[] = [];
  let totalEvents = global.length, expressionEvents = 0, croppedExpression = false;
  for (let i = 0; i < project.tracks.length; i++) {
    const track = project.tracks[i], channel = track.midiChannel ?? i % 16;
    const events: Event[] = [];
    if (track.sourceMidiTrack === undefined) events.push({ tick: 0, order: -1e11, event: { deltaTime: 0, type: 'programChange', channel, programNumber: project.instruments.find(instrument => instrument.id === track.instrumentId)?.gmProgram ?? 0 } });
    for (const note of byTrack.get(track.id) ?? []) {
      if (note.velocity <= 0) continue;
      const start = Math.round(note.absoluteTick), end = start + Math.max(0, Math.round(note.duration));
      const occurrence = note.absoluteTick - note.tick;
      events.push({ tick: start, occurrence, order: note.midiSource?.onOrder ?? 1e12, event: { deltaTime: 0, type: 'noteOn', channel, noteNumber: note.midi, velocity: Math.max(1, Math.min(127, Math.round(note.velocity * 127))) } });
      events.push({ tick: end, occurrence, routeSource: track.sourceMidiTrack === undefined ? undefined : note.midiSource?.offSourceTrack, order: note.midiSource?.offOrder ?? (end === start ? 1e12 + 1 : -1e9), event: { deltaTime: 0, type: 'noteOff', channel, noteNumber: note.midi, velocity: note.midiSource?.releaseVelocity ?? 0 } });
    }
    let minimumEnd = 0;
    for (const region of project.regions.filter(region => region.trackId === track.id)) {
      const pattern = patterns.get(region.patternId)!;
      const period = Math.max(1, pattern.length);
      let foundEnd = false;
      for (const stored of pattern.midiEvents ?? []) {
        const type = stored.event.type;
        const local = stored.tick - region.offset;
        const range = region.loop ? messageCycles(stored.tick, period, region.offset, region.length, !!region.midiEndExclusive)
          : { first: 0, last: local < 0 || local > region.length || region.midiEndExclusive && local === region.length ? -1 : 0, maximum: 0 };
        if ((range.first > 0 || range.last < range.maximum) && type !== 'endOfTrack') croppedExpression = true;
        if (type === 'setTempo' || type === 'timeSignature') continue;
        const count = Math.max(0, range.last - range.first + 1);
        if (expressionEvents + count > 4000000) throw new Error('展开后的 MIDI 消息超过 400 万个，请缩短循环范围。');
        expressionEvents += count;
        for (let cycle = range.first; cycle <= range.last; cycle++) {
          const event = cloneMidiEvent(stored.event); if (isMidiChannelEvent(event)) event.channel = channel;
          const onset = stored.tick + cycle * period - region.offset;
          events.push({ tick: region.start + onset, occurrence: region.start + cycle * period - region.offset, order: stored.order, event });
          if (type === 'endOfTrack') foundEnd = true;
        }
      }
      if (!foundEnd || region.loop || region.offset > 0 || region.length !== pattern.length) minimumEnd = Math.max(minimumEnd, region.start + region.length);
    }
    totalEvents += events.length;
    if (totalEvents > 8000000) throw new Error('导出的 MIDI 消息过多，请拆分工程。');
    let bucket: Bucket;
    if (project.midi && track.sourceMidiTrack !== undefined) bucket = sourceBucket(track.sourceMidiTrack);
    else { bucket = { sort: 1e6 + i, names: [], events: [], minimumEnd: 0 }; buckets.set(`editor:${track.id}`, bucket); }
    bucket.names.push(track.name); bucket.minimumEnd = Math.max(bucket.minimumEnd, minimumEnd);
    for (const event of events) {
      const target = project.midi && event.routeSource !== undefined ? sourceBucket(event.routeSource) : bucket;
      target.events.push(event);
    }
  }
  const tracks = [encodeTrack(global)];
  let mergedChannels = false;
  for (const bucket of [...buckets.values()].sort((a, b) => a.sort - b.sort)) {
    const sourceName = bucket.source === undefined ? undefined : project.midi?.sourceTrackNames?.[bucket.source];
    const name = bucket.names.length === 1 ? bucket.names[0] : bucket.names.length ? (sourceName && bucket.names.every(name => name.startsWith(sourceName + ' · Ch ')) ? sourceName : bucket.names.join(' / ')) : sourceName ?? `MIDI ${(bucket.source ?? 0) + 1}`;
    // A source multi-channel track remains one MIDI stream so SysEx, note-offs,
    // bank selection and program changes keep their relative order at a tick.
    const seenPorts = new Set<string>();
    const events = bucket.events.filter(event => {
      if (event.event.type !== 'portPrefix') return true;
      const key = `${event.tick}:${event.occurrence ?? 0}:${event.order}:${event.event.port}`;
      if (seenPorts.has(key)) return false; seenPorts.add(key); return true;
    });
    events.push({ tick: 0, order: -1e12, occurrence: -1e15, event: { deltaTime: 0, meta: true, type: 'trackName', text: encodeMidiText(name) } });
    mergedChannels ||= bucket.names.length > 1;
    tracks.push(encodeTrack(events, bucket.minimumEnd));
  }
  if (mergedChannels) diagnostics.push({ severity: 'info', code: 'midi-source-streams', message: '按通道拆分的编辑轨道已合并回来源 MIDI 轨道，以保留同一时刻的消息顺序；各音符的 MIDI 通道仍保持独立。' });
  if (notes.some(note => note.detune !== 0 || note.pan !== 0 || note.height !== 0 || note.instrumentId)) diagnostics.push({ severity: 'warning', code: 'midi-note-properties', message: 'MIDI 保留原始 GM 音色切换与表情消息；编辑器的单音符空间位置、音符盒音色覆盖和微调音高保留在 NBSX 母版中。' });
  if (croppedExpression) diagnostics.push({ severity: 'warning', code: 'midi-expression-cropped', message: '片段范围外的 MIDI 消息不会导出；裁剪可能改变控制器的初始状态，请检查目标 DAW 中的播放效果。' });
  if (notes.some(note => note.velocity <= 0)) diagnostics.push({ severity: 'info', code: 'midi-zero-velocity', message: '力度为零的静音音符只保留在 NBSX 中；MIDI 的零力度发音消息会被解释为结束音符。' });
  return { bytes: Uint8Array.from(writeMidi({ header: { format: 1, numTracks: tracks.length, ticksPerBeat: project.ppq }, tracks }, { running: false })), diagnostics };
}
