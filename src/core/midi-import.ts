import type { MidiEvent } from 'midi-file';
import { bytesToBase64 } from './container';
import { drumInstrument, instrumentForProgram } from './instruments';
import { cloneMidiEvent, isMidiChannelEvent, validStoredMidiMessage } from './midi-events';
import { decodeMidiText } from './midi-text';
import { createProject, newNote, newTrack, uid, validateProject } from './project';
import { readStandardMidi } from './smf';
import { createMeterMap } from './meter';
import type { Diagnostic, Note, Pattern, Project, StoredMidiEvent, Track } from './types';

type Entry = { tick: number; source: number; order: number; event: MidiEvent };
type Group = { track: Track; pattern: Pattern; firstProgram?: number };
type Pending = { note: Note; source: number; done: boolean };
type Queue = { notes: Pending[]; head: number };
type Active = Queue & { bySource: Map<number, Queue>; remaining: number };

export function importMidi(bytes: Uint8Array, filename: string): { project: Project; diagnostics: Diagnostic[] } {
  const { data, extraChunks } = readStandardMidi(bytes);
  const firstName = data.tracks[0].find(event => event.type === 'trackName');
  const p = createProject(firstName?.type === 'trackName' && firstName.text ? decodeMidiText(firstName.text) : filename.replace(/\.midi?$/i, ''));
  p.ppq = data.header.ticksPerBeat!; p.tracks = []; p.patterns = []; p.regions = []; p.tempos = []; p.timeSignatures = [];
  const conductor: StoredMidiEvent[] = [], entries: Entry[] = [], ends: number[] = [], groups = new Map<string, Group>();
  const channels = data.tracks.map(track => [...new Set(track.filter(isMidiChannelEvent).map(event => event.channel))]);
  const names = data.tracks.map((track, i) => { const name = track.find(event => event.type === 'trackName'); return name?.type === 'trackName' && name.text ? decodeMidiText(name.text) : `MIDI ${i + 1}`; });
  data.tracks.forEach((track, source) => {
    let tick = 0;
    track.forEach((event, order) => { tick += event.deltaTime; if (!Number.isSafeInteger(tick) || tick > 1e12) throw new Error('MIDI 时间范围过大。'); entries.push({ tick, source, order, event }); });
    ends[source] = tick;
    for (const channel of channels[source]) {
      const name = channels[source].length > 1 ? `${names[source]} · Ch ${channel + 1}` : names[source];
      const editorTrack = newTrack(name, p.tracks.length); editorTrack.midiChannel = channel; editorTrack.sourceMidiTrack = source;
      const pattern: Pattern = { id: uid(), name, length: 1, notes: [], midiEvents: [] };
      groups.set(`${source}:${channel}`, { track: editorTrack, pattern }); p.tracks.push(editorTrack); p.patterns.push(pattern);
    }
  });
  if (p.tracks.length > 10000) throw new Error('按 MIDI 通道分轨后超过 1 万条轨道，请拆分文件。');
  entries.sort((a, b) => a.tick - b.tick || a.source - b.source || a.order - b.order);
  const programs = new Map<string, number>(), ports = new Map<number, number>(), prefix = new Map<number, number>();
  const active = new Map<string, Active>();
  let danglingOn = 0, danglingOff = 0, programChanges = 0, expression = false, missingEnd = 0;
  const store = (entry: Entry, target: StoredMidiEvent[]) => {
    const event = cloneMidiEvent(entry.event);
    const type = event.type;
    if (!validStoredMidiMessage(event)) throw new Error(`MIDI 消息参数无效：${type}`);
    target.push({ id: uid(), tick: entry.tick, order: entry.order, sourceTrack: entry.source, event });
  };
  entries.forEach((entry, globalOrder) => {
    entry.order = globalOrder;
    const event = entry.event, group = isMidiChannelEvent(event) ? groups.get(`${entry.source}:${event.channel}`)! : undefined;
    if (event.type === 'portPrefix') ports.set(entry.source, event.port);
    const port = ports.get(entry.source) ?? 0;
    if (event.type === 'setTempo') { if (!event.microsecondsPerBeat) throw new Error('MIDI 速度不能为零。'); p.tempos.push({ tick: entry.tick, bpm: 60000000 / event.microsecondsPerBeat }); return; }
    if (event.type === 'timeSignature') { p.timeSignatures.push({ tick: entry.tick, numerator: event.numerator, denominator: event.denominator, metronome: event.metronome, thirtyseconds: event.thirtyseconds }); return; }
    if (event.type === 'trackName' && entry.tick === 0) return;
    if (event.type === 'noteOn') {
      const program = programs.get(`${port}:${event.channel}`) ?? 0;
      const instrument = event.channel === 9 ? drumInstrument(event.noteNumber) : instrumentForProgram(program, false);
      if (group!.firstProgram === undefined) { group!.firstProgram = program; group!.track.instrumentId = instrumentForProgram(program, event.channel === 9); }
      const note: Note = { ...newNote(entry.tick, event.noteNumber, 0), velocity: event.velocity / 127, midiSource: { onOrder: globalOrder, offOrder: globalOrder, releaseVelocity: 0 }, ...(event.channel === 9 || instrument !== group!.track.instrumentId ? { instrumentId: instrument } : {}) };
      group!.pattern.notes.push(note);
      const key = `${port}:${event.channel}:${event.noteNumber}`, queue = active.get(key) ?? { notes: [], head: 0, bySource: new Map<number, Queue>(), remaining: 0 };
      const pending = { note, source: entry.source, done: false }, sourceQueue = queue.bySource.get(entry.source) ?? { notes: [], head: 0 };
      queue.notes.push(pending); sourceQueue.notes.push(pending); queue.bySource.set(entry.source, sourceQueue); queue.remaining++; active.set(key, queue); return;
    }
    if (event.type === 'noteOff') {
      const key = `${port}:${event.channel}:${event.noteNumber}`, queue = active.get(key), sourceQueue = queue?.bySource.get(entry.source);
      if (sourceQueue) while (sourceQueue.head < sourceQueue.notes.length && sourceQueue.notes[sourceQueue.head].done) sourceQueue.head++;
      if (queue) while (queue.head < queue.notes.length && queue.notes[queue.head].done) queue.head++;
      const pending = sourceQueue && sourceQueue.head < sourceQueue.notes.length ? sourceQueue.notes[sourceQueue.head++] : queue?.notes[queue.head++];
      if (pending) { pending.done = true; pending.note.duration = entry.tick - pending.note.tick; pending.note.midiSource!.offOrder = globalOrder; pending.note.midiSource!.offSourceTrack = entry.source; pending.note.midiSource!.releaseVelocity = event.velocity; if (--queue!.remaining === 0) active.delete(key); }
      else { danglingOff++; store(entry, group!.pattern.midiEvents!); }
      return;
    }
    if (event.type === 'programChange') { programs.set(`${port}:${event.channel}`, event.programNumber); programChanges++; }
    if (event.type === 'controller' || event.type === 'pitchBend' || event.type === 'noteAftertouch' || event.type === 'channelAftertouch') expression = true;
    if (group) { store(entry, group.pattern.midiEvents!); return; }
    if (event.type === 'channelPrefix') prefix.set(entry.source, event.channel);
    const targets = channels[entry.source].map(channel => groups.get(`${entry.source}:${channel}`)!);
    if (event.type === 'endOfTrack' || event.type === 'portPrefix') {
      if (targets.length) for (const target of targets) store(entry, target.pattern.midiEvents!); else store(entry, conductor);
    } else if (['keySignature', 'marker', 'cuePoint', 'copyrightNotice', 'sequenceNumber', 'smpteOffset'].includes(event.type) || !targets.length) {
      if (event.type === 'copyrightNotice' && !p.author) p.author = decodeMidiText(event.text);
      store(entry, conductor);
    } else {
      const target = groups.get(`${entry.source}:${prefix.get(entry.source)}`) ?? targets[0]; store(entry, target.pattern.midiEvents!);
    }
  });
  for (const queue of active.values()) for (const pending of queue.notes) if (!pending.done) {
    const { note, source } = pending; note.duration = Math.max(1, ends[source] - note.tick); note.midiSource!.offOrder = entries.length + danglingOn++; }
  const uniqueAtTick = <T extends { tick: number }>(items: T[], fallback: T): T[] => {
    const byTick = new Map(items.map(item => [item.tick, item])); if (!byTick.has(0)) byTick.set(0, fallback); return [...byTick.values()].sort((a, b) => a.tick - b.tick);
  };
  p.tempos = uniqueAtTick(p.tempos, { tick: 0, bpm: 120 }); p.timeSignatures = uniqueAtTick(p.timeSignatures, { tick: 0, numerator: 4, denominator: 4 });
  const meter = createMeterMap(p);
  for (let i = 0; i < data.tracks.length; i++) if (!data.tracks[i].some(event => event.type === 'endOfTrack')) missingEnd++;
  for (const group of groups.values()) {
    const source = group.track.sourceMidiTrack!, end = group.pattern.notes.reduce((last, note) => Math.max(last, note.tick + Math.max(1, note.duration)), ends[source]);
    group.pattern.length = Math.max(meter.at(0).barEnd, meter.barSnap(end, 'ceil'));
    p.regions.push({ id: uid(), trackId: group.track.id, patternId: group.pattern.id, start: 0, length: group.pattern.length, offset: 0, loop: false });
  }
  if (!p.tracks.length) { const empty = newTrack(names[0]), pattern: Pattern = { id: uid(), name: names[0], length: Math.max(meter.at(0).barEnd, meter.barSnap(ends[0], 'ceil')), notes: [], midiEvents: [] }; p.tracks.push(empty); p.patterns.push(pattern); p.regions.push({ id: uid(), trackId: empty.id, patternId: pattern.id, start: 0, length: pattern.length, offset: 0, loop: false }); }
  const sourceAssetId = uid(); p.assets.push({ id: sourceAssetId, name: filename, mime: 'audio/midi', data: bytesToBase64(bytes) });
  p.midi = { schema: 1, format: data.header.format as 0 | 1, sourceAssetId, sourceTrackNames: names, conductor };
  p.provenance = { kind: 'midi', filename, metadata: { sourceFormat: data.header.format, sourceTracks: data.tracks.length, sourceAssetId } };
  const diagnostics: Diagnostic[] = [{ severity: 'info', code: 'midi-mapped', message: '已按原轨道和通道分轨，保留音高、力度、时值、速度与拍号；原始 MIDI 已嵌入 NBSX。GM 乐器映射可逐轨或逐音符调整。' }];
  if (programChanges) diagnostics.push({ severity: 'info', code: 'midi-programs', message: '音色切换消息已保留；跨越切换的长音完整保留，后续音符按当时音色建议映射。' });
  if (expression) diagnostics.push({ severity: 'info', code: 'midi-expression', message: '控制器、弯音与触后消息随片段保留供 MIDI 导出；本阶段音符盒试听不应用连续控制曲线。' });
  if (danglingOn || missingEnd) diagnostics.push({ severity: 'warning', code: 'midi-incomplete-notes', message: `源文件含 ${danglingOn} 个缺少结束消息的音符和 ${missingEnd} 条缺少结束标记的轨道。缺失时值已补足到可编辑长度；原始字节完整保留。` });
  if (danglingOff) diagnostics.push({ severity: 'info', code: 'midi-safety-releases', message: `${danglingOff} 条未对应显示音符的结束消息已随片段保留，供 MIDI 导出继续使用。` });
  if (extraChunks) diagnostics.push({ severity: 'warning', code: 'midi-extra-chunks', message: `${extraChunks} 个非标准 MIDI 数据块只保留在嵌入的原始文件中；编辑后导出使用标准格式 1。` });
  return { project: validateProject(p), diagnostics };
}
