import { base64ToBytes } from '../core/container';
import { renderNoteEvents, clamp } from '../core/project';
import { createTempoMap, tickToSeconds } from '../core/time';
import type { Diagnostic, FlatNote, NativeRenderRequest, PcmSample, Project, SampleLibrary, Track } from '../core/types';
import { gameHrtfControl } from './profiles';
import { noteAudioParameters, renderDuration, listenerForProject } from './parameters';
import { legacySourceGain } from './legacy';
import { broadcastForProject, withinBroadcastRange } from './delivery';
import { hrtfContextForProject, outputLimiterForProject } from './context';
import { playbackEndTick, referenceSegment } from '../core/reference';
import { transportPosition, type TransportClock } from '../core/transport';

export const PROFILE_STATUS = { unverified: '待代码核对与游戏实测', 'code-reviewed': '核心参数已核对 · 待游戏实测', 'partially-measured': '部分游戏场景已对照 · 其余待验收', 'game-measured': '游戏实测通过' };
export const linearAttenuation = (distance: number, maxDistance: number): number => maxDistance > 0 ? clamp(1 - Math.max(0, distance) / maxDistance, 0, 1) : 0;
const SAMPLE_NAMES: Record<string, string> = { basedrum: 'bd', chime: 'icechime', xylophone: 'xylobone' };

interface NoteOccurrence { index: number; cycle: number; at: number }
/** Merge sorted cycle streams: an old cycle's echo cannot hold up a new dry note. */
class NoteOccurrenceQueue {
  private heap: NoteOccurrence[] = [];
  private nextCycle = 0;
  constructor(private times: readonly number[], private period: number, private loop: boolean, from: number) {
    if (!times.length) return;
    const first = loop ? Math.max(0, Math.ceil((from - times[times.length - 1]) / period)) : 0;
    const last = loop ? Math.floor((from - times[0]) / period) : 0;
    if (last - first > 2000000) throw new Error('循环试听的活动回声周期过多，请缩短尾音。');
    for (let cycle = first; cycle <= last; cycle++) {
      let low = 0, high = times.length;
      while (low < high) { const mid = (low + high) >>> 1; if (times[mid] + cycle * period < from) low = mid + 1; else high = mid; }
      if (low < times.length) this.push({ index: low, cycle, at: times[low] + cycle * period });
    }
    this.nextCycle = Math.max(0, last + 1);
  }
  private before(a: NoteOccurrence, b: NoteOccurrence) { return a.at < b.at || a.at === b.at && (a.cycle < b.cycle || a.cycle === b.cycle && a.index < b.index); }
  private push(value: NoteOccurrence) {
    let index = this.heap.length; this.heap.push(value);
    while (index > 0) {
      const parent = (index - 1) >>> 1; if (!this.before(value, this.heap[parent])) break;
      this.heap[index] = this.heap[parent]; index = parent;
    }
    this.heap[index] = value;
  }
  private pop(): NoteOccurrence {
    const first = this.heap[0], last = this.heap.pop()!;
    if (this.heap.length) {
      let index = 0;
      while (index * 2 + 1 < this.heap.length) {
        let child = index * 2 + 1;
        if (child + 1 < this.heap.length && this.before(this.heap[child + 1], this.heap[child])) child++;
        if (!this.before(this.heap[child], last)) break;
        this.heap[index] = this.heap[child]; index = child;
      }
      this.heap[index] = last;
    }
    return first;
  }
  takeThrough(horizon: number): NoteOccurrence | undefined {
    if (this.loop && this.times.length) {
      const at = this.nextCycle * this.period + this.times[0];
      // Introduce only the next due stream, rather than allocating every future
      // cycle or a heap node for every note in a large imported project.
      if (at <= horizon && (!this.heap.length || at <= this.heap[0].at)) {
        this.push({ index: 0, cycle: this.nextCycle++, at });
      }
    }
    if (!this.heap.length || this.heap[0].at > horizon) return;
    const occurrence = this.pop(), index = occurrence.index + 1;
    if (index < this.times.length) this.push({ index, cycle: occurrence.cycle, at: occurrence.cycle * this.period + this.times[index] });
    return occurrence;
  }
  get pending() { return this.heap.length > 0; }
}

interface LiveVoice {
  source: AudioBufferSourceNode; gain: GainNode; panner: PannerNode; note: FlatNote; when: number; panOffset: number;
}
interface LivePlayback {
  project: Project; events: FlatNote[]; queue: NoteOccurrenceQueue; end: number; endTick: number; loop: boolean;
  reference?: AudioBuffer; scheduleReference: () => void; pump: () => void; epoch: number;
}

export function wavFromChannels(channels: Float32Array[], sampleRate: number): Uint8Array {
  const frames = channels[0]?.length ?? 0, count = channels.length;
  const bytes = new Uint8Array(44 + frames * count * 2), view = new DataView(bytes.buffer);
  const text = (at: number, value: string) => [...value].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  text(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, count, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * count * 2, true); view.setUint16(32, count * 2, true); view.setUint16(34, 16, true);
  text(36, 'data'); view.setUint32(40, frames * count * 2, true);
  for (let frame = 0; frame < frames; frame++) for (let ch = 0; ch < count; ch++) {
    const value = clamp(channels[ch][frame], -1, 1);
    view.setInt16(44 + (frame * count + ch) * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
  }
  return bytes;
}
export class AudioEngine {
  context?: AudioContext;
  buffers = new Map<string, AudioBuffer>();
  private previewBuffers = new Map<string, AudioBuffer>();
  library?: SampleLibrary;
  playing = false;
  renderDiagnostics: Diagnostic[] = [];
  private sources = new Set<AudioBufferSourceNode>();
  private interval?: ReturnType<typeof setInterval>;
  private startedAt = 0;
  private startSeconds = 0;
  private playbackEpoch = 0;
  private clock?: TransportClock;
  analysers = new Map<string, AnalyserNode>();
  private masterAnalyser?: AnalyserNode;
  private live?: LivePlayback;
  private liveVoices = new Map<AudioBufferSourceNode, LiveVoice>();
  private referenceVoices = new Map<AudioBufferSourceNode, GainNode>();
  private trackPreviews = new Map<string, Partial<Track>>();
  private masterPreview?: number;
  private requestedLiveProject?: Project;
  private sampleLoadTicket = 0;
  private pendingProjectSamples?: { ticket: number; project: Project };
  private reference?: { data: string; buffer: AudioBuffer };
  private referenceLoading?: { data: string; promise: Promise<AudioBuffer> };
  onPosition?: (tick: number) => void;
  onEnded?: () => void;

  async ensure() { this.context ??= new AudioContext({ sampleRate: 48000 }); await this.context.resume(); return this.context; }
  async setPreviewSamples(samples: SampleLibrary['samples']) {
    const context = this.context ??= new AudioContext({ sampleRate: 48000 });
    const decoded = await Promise.all(Object.entries(samples).map(async ([id, sample]) =>
      [id, await context.decodeAudioData(Uint8Array.from(sample.bytes).buffer)] as const));
    this.previewBuffers = new Map(decoded);
    return decoded.length;
  }
  async setLibrary(library: SampleLibrary) {
    const context = await this.ensure();
    const decoded = new Map<string, AudioBuffer>();
    await Promise.all(Object.entries(library.samples).map(async ([key, sample]) => {
      const copied = Uint8Array.from(sample.bytes);
      const buffer = await context.decodeAudioData(copied.buffer);
      decoded.set(key, buffer);
    }));
    this.stop(); this.library = library; this.buffers = decoded;
    return decoded.size;
  }
  async loadProjectSamples(project: Project) {
    const ticket = ++this.sampleLoadTicket;
    this.pendingProjectSamples = { ticket, project };
    try {
      const ctx = await this.ensure(), decoded: { id: string; data: string; buffer: AudioBuffer }[] = [];
      for (const ins of project.instruments) {
        const asset = project.assets.find(a => a.id === ins.assetId);
        if (asset?.data) decoded.push({ id: ins.id, data: asset.data, buffer: await ctx.decodeAudioData(Uint8Array.from(base64ToBytes(asset.data)).buffer) });
      }
      if (ticket !== this.sampleLoadTicket) return;
      const current = this.requestedLiveProject;
      for (const sample of decoded) {
        const definition = current?.instruments.find(ins => ins.id === sample.id);
        if (current && (current.id !== project.id || current.assets.find(asset => asset.id === definition?.assetId)?.data !== sample.data)) continue;
        this.buffers.set(sample.id, sample.buffer);
      }
      if (current && this.live && current.id === project.id) this.updateProject(current);
    } finally {
      if (this.pendingProjectSamples?.ticket === ticket) this.pendingProjectSamples = undefined;
    }
  }
  async loadReference(project: Project) {
    const asset = project.assets.find(a => a.id === project.reference?.assetId);
    if (!asset?.data) { this.reference = undefined; return; }
    const data = asset.data;
    if (this.reference?.data === data) return this.reference.buffer;
    if (this.referenceLoading?.data === data) return this.referenceLoading.promise;
    const promise = (async () => {
      // Decoding a waveform does not need to resume the output device.
      const context = this.context ??= new AudioContext({ sampleRate: 48000 });
      return context.decodeAudioData(Uint8Array.from(base64ToBytes(data)).buffer);
    })();
    const loading = { data, promise }; this.referenceLoading = loading;
    try {
      const buffer = await promise;
      if (this.referenceLoading === loading) {
        this.reference = { data, buffer };
        const current = this.live?.project;
        if (current && current.assets.find(a => a.id === current.reference?.assetId)?.data === data) this.updateProject(current, true);
      }
      return buffer;
    } finally { if (this.referenceLoading === loading) this.referenceLoading = undefined; }
  }
  private scheduleReference(project: Project, buffer: AudioBuffer | undefined, when: number, from: number, loop: boolean, period: number) {
    if (!buffer || !project.reference || !this.context) return () => {};
    const context = this.context;
    const offset = tickToSeconds(project.reference.startTick, project);
    const enqueue = (cycle: number, localFrom: number) => {
      const at = when + (cycle * period + localFrom - from);
      const late = Math.max(0, context.currentTime - at);
      const segment = referenceSegment(offset, buffer.duration, localFrom + late, period);
      if (!segment) return;
      const source = context.createBufferSource(), gain = context.createGain();
      const mix = this.live ? this.mixedProject(this.live.project) : project;
      gain.gain.value = (mix.reference?.gain ?? 0) * mix.audio.masterGain;
      source.buffer = buffer; source.connect(gain); gain.connect(this.masterOutput(context));
      source.start(at + late + segment.delay, segment.offset, segment.duration);
      this.sources.add(source); this.referenceVoices.set(source, gain);
      source.onended = () => { this.sources.delete(source); this.referenceVoices.delete(source); source.disconnect(); gain.disconnect(); };
    };
    const cycle = loop ? Math.floor(from / period) : 0;
    enqueue(cycle, from - cycle * period);
    let nextCycle = cycle + 1;
    return () => {
      if (!loop) return;
      const elapsed = context.currentTime - when + from;
      while (nextCycle * period <= elapsed + .15) { enqueue(nextCycle, 0); nextCycle++; }
    };
  }
  position() { return this.clock && this.context ? transportPosition(this.clock, this.context.currentTime) : undefined; }
  bufferFor(id: string, includePreview = true) { return this.buffers.get(id) ?? this.buffers.get(SAMPLE_NAMES[id] ?? id)
    ?? (includePreview ? this.previewBuffers.get(id) : undefined); }
  private mixedProject(project: Project): Project {
    if (!this.trackPreviews.size && this.masterPreview === undefined) return project;
    return { ...project, tracks: project.tracks.map(track => this.trackPreviews.has(track.id) ? { ...track, ...this.trackPreviews.get(track.id) } : track),
      audio: this.masterPreview === undefined ? project.audio : { ...project.audio, masterGain: this.masterPreview } };
  }
  private configureLiveVoice(voice: LiveVoice, project: Project, tracks: Map<string, Track>, solo: boolean) {
    const track = tracks.get(voice.note.trackId), audible = track && !track.muted && (!solo || track.solo);
    const note = { ...voice.note, gain: voice.note.velocity * (track?.volume ?? 0),
      effectivePan: clamp(clamp(voice.note.pan + (track?.pan ?? 0), -1, 1) + voice.panOffset, -1, 1) };
    const parameters = noteAudioParameters(project, note, this.library, 'musical'), legacy = this.library?.attenuationModel === 'paulscode-linear';
    voice.source.playbackRate.value = parameters.pitch;
    voice.gain.gain.value = audible && withinBroadcastRange(parameters.x, parameters.y, parameters.z, broadcastForProject(project))
      ? (legacy ? legacySourceGain(parameters.gain, parameters.x, parameters.y, parameters.z, parameters.maxDistance) : parameters.gain) * (listenerForProject(project)?.gain ?? 1) : 0;
    const panner = voice.panner;
    panner.panningModel = project.audio.directional ? 'HRTF' : 'equalpower';
    panner.distanceModel = 'linear'; panner.refDistance = 0; panner.maxDistance = parameters.maxDistance; panner.rolloffFactor = project.audio.mode === 'vanilla' && !legacy ? 1 : 0;
    panner.positionX.value = parameters.x; panner.positionY.value = parameters.y; panner.positionZ.value = parameters.z;
  }
  private refreshLiveMix() {
    if (!this.live) return;
    const project = this.mixedProject(this.live.project), tracks = new Map(project.tracks.map(track => [track.id, track])), solo = project.tracks.some(track => track.solo);
    for (const voice of this.liveVoices.values()) this.configureLiveVoice(voice, project, tracks, solo);
    for (const gain of this.referenceVoices.values()) gain.gain.value = (project.reference?.gain ?? 0) * project.audio.masterGain;
  }
  /** Temporary slider audition is independent of document/history state. */
  previewTrack(id: string, patch: Partial<Track> | undefined) {
    if (patch === undefined) this.trackPreviews.delete(id);
    else {
      const track = this.live?.project.tracks.find(track => track.id === id);
      if (!track || track.locked || Object.keys(patch).some(key => key !== 'volume' && key !== 'pan')
        || patch.volume !== undefined && (!Number.isFinite(patch.volume) || patch.volume < 0 || patch.volume > 4)
        || patch.pan !== undefined && (!Number.isFinite(patch.pan) || patch.pan < -1 || patch.pan > 1)) return;
      this.trackPreviews.set(id, patch);
    }
    this.refreshLiveMix();
  }
  previewMaster(value: number | undefined) {
    if (value !== undefined && (!Number.isFinite(value) || value < 0 || value > 2 || !this.live)) return;
    this.masterPreview = value; this.refreshLiveMix();
  }
  private startLiveVoice(note: FlatNote, when: number) {
    const live = this.live, context = this.context, buffer = this.bufferFor(note.effectiveInstrument);
    if (!live || !context || !buffer) return;
    const source = context.createBufferSource(), gain = context.createGain(), panner = context.createPanner(); source.buffer = buffer;
    const track = live.project.tracks.find(track => track.id === note.trackId);
    const panOffset = note.delaySource ? (note.delaySource.tap % 2 ? -1 : 1) * (track?.delay?.panAmount ?? 0) : 0;
    const voice: LiveVoice = { source, gain, panner, note, when, panOffset };
    const mix = this.mixedProject(live.project);
    this.configureLiveVoice(voice, mix, new Map(mix.tracks.map(track => [track.id, track])), mix.tracks.some(track => track.solo));
    let analyser = this.analysers.get(note.trackId);
    if (!analyser) { analyser = context.createAnalyser(); analyser.fftSize = 256; analyser.connect(this.masterOutput(context)); this.analysers.set(note.trackId, analyser); }
    source.connect(gain); gain.connect(panner); panner.connect(analyser);
    this.sources.add(source); this.liveVoices.set(source, voice);
    source.onended = () => { this.sources.delete(source); this.liveVoices.delete(source); source.disconnect(); gain.disconnect(); panner.disconnect(); };
    source.start(when);
  }
  private schedule(context: BaseAudioContext, project: Project, note: FlatNote, when: number, sources?: Set<AudioBufferSourceNode>, live = false) {
    if (live) { this.startLiveVoice(note, when); return; }
    const buffer = this.bufferFor(note.effectiveInstrument);
    if (!buffer || note.gain <= 0) return;
    const source = context.createBufferSource(); source.buffer = buffer;
    const parameters = noteAudioParameters(project, note, this.library, 'musical');
    if (!withinBroadcastRange(parameters.x, parameters.y, parameters.z, broadcastForProject(project))) return;
    source.playbackRate.value = parameters.pitch;
    const legacy = this.library?.attenuationModel === 'paulscode-linear';
    const gain = context.createGain(); gain.gain.value = (legacy ? legacySourceGain(parameters.gain, parameters.x, parameters.y, parameters.z, parameters.maxDistance) : parameters.gain) * (listenerForProject(project)?.gain ?? 1);
    const panner = context.createPanner();
    panner.panningModel = project.audio.directional ? 'HRTF' : 'equalpower';
    panner.distanceModel = 'linear'; panner.refDistance = 0; panner.maxDistance = parameters.maxDistance; panner.rolloffFactor = project.audio.mode === 'vanilla' && !legacy ? 1 : 0;
    panner.positionX.value = parameters.x; panner.positionY.value = parameters.y; panner.positionZ.value = parameters.z;
    source.connect(gain); gain.connect(panner);
    if (context === this.context && note.trackId) {
      let analyser = this.analysers.get(note.trackId);
      if (!analyser) { analyser = context.createAnalyser(); analyser.fftSize = 256; analyser.connect(this.masterOutput(context as AudioContext)); this.analysers.set(note.trackId, analyser); }
      panner.connect(analyser);
    } else panner.connect(context.destination);
    source.start(when);
    // The note's displayed duration never schedules a stop on the sample.
    sources?.add(source); source.onended = () => { sources?.delete(source); source.disconnect(); gain.disconnect(); panner.disconnect(); };
  }
  async audition(project: Project, midi: number, instrumentId: string, velocity = 0.8, pan = 0, height = 0, detune = 0) {
    const epoch = this.playbackEpoch, ctx = await this.ensure();
    if (epoch !== this.playbackEpoch) return;
    if (!this.bufferFor(instrumentId)) throw new Error('此乐器尚未加载采样，请先加载 Minecraft 资源或定位自定义采样。');
    this.schedule(ctx, project, { id: 'audition', midi, tick: 0, duration: 1, velocity, pan, height, detune,
      trackId: '', regionId: '', patternId: '', absoluteTick: 0, gain: velocity, effectivePan: pan, effectiveInstrument: instrumentId }, ctx.currentTime + 0.005, this.sources);
  }
  /** Audition the App's single-note preview, including its track's derived echoes. */
  async auditionProject(project: Project): Promise<void> {
    const epoch = this.playbackEpoch, context = await this.ensure();
    if (epoch !== this.playbackEpoch) return;
    const plan = renderNoteEvents(project); this.renderDiagnostics = plan.diagnostics;
    const timing = createTempoMap(project), duration = renderDuration(project, plan.notes, id => this.bufferFor(id)?.duration ?? 0, this.library, timing, 'musical');
    if (duration > 1800) throw new Error('单次音频导出最长 30 分钟，请拆分较长工程或缩短延迟尾音。');
    for (const note of plan.notes) if (!this.bufferFor(note.effectiveInstrument)) throw new Error(`缺少采样：${note.effectiveInstrument}`);
    const when = context.currentTime + .005;
    for (const note of plan.notes) this.schedule(context, project, note, when + timing.seconds(note.absoluteTick), this.sources);
  }
  async play(project: Project, fromTick: number, loop = false) {
    this.stop();
    const epoch = this.playbackEpoch, ctx = await this.ensure();
    const reference = await this.loadReference(project);
    if (epoch !== this.playbackEpoch) return false;
    const timing = createTempoMap(project);
    const endTick = playbackEndTick(project, reference?.duration), end = timing.seconds(endTick);
    if (!Number.isFinite(end) || end <= 0) throw new Error('工程播放周期无效。');
    const plan = renderNoteEvents(project, true), events = plan.notes; this.renderDiagnostics = plan.diagnostics;
    this.startSeconds = Math.max(0, loop ? timing.seconds(fromTick) % end : timing.seconds(fromTick)); this.startedAt = ctx.currentTime + 0.05;
    const solo = project.tracks.some(track => track.solo), audible = new Set(project.tracks.filter(track => !track.muted && (!solo || track.solo)).map(track => track.id));
    const missing = [...new Set(events.filter(n => audible.has(n.trackId) && n.gain > 0 && !this.bufferFor(n.effectiveInstrument)).map(n => project.instruments.find(i => i.id === n.effectiveInstrument)?.name ?? n.effectiveInstrument))];
    if (missing.length) throw new Error(`缺少采样：${missing.join('、')}。请加载对应版本的资源。`);
    const queue = new NoteOccurrenceQueue(events.map(note => timing.seconds(note.absoluteTick)), end, loop, this.startSeconds);
    this.playing = true;
    this.clock = { timing, startedAt: this.startedAt, from: this.startSeconds, endTick, loop };
    const live: LivePlayback = { project, events, queue, end, endTick, loop, reference, scheduleReference: () => {}, pump: () => {}, epoch };
    this.live = live;
    this.requestedLiveProject = project;
    live.scheduleReference = this.scheduleReference(project, reference, this.startedAt, this.startSeconds, loop, end);
    const schedule = () => {
      if (!this.playing || epoch !== this.playbackEpoch || this.context !== ctx || this.live !== live) return;
      const seconds = this.context.currentTime - this.startedAt + this.startSeconds;
      live.scheduleReference();
      let occurrence: NoteOccurrence | undefined;
      while ((occurrence = live.queue.takeThrough(seconds + .15))) {
        this.schedule(ctx, live.project, live.events[occurrence.index], Math.max(ctx.currentTime, this.startedAt + occurrence.at - this.startSeconds), this.sources, true);
      }
      this.onPosition?.(this.position()!.tick);
      if (epoch !== this.playbackEpoch || !this.playing) return;
      if (seconds >= live.end && !live.loop && !live.queue.pending) {
        if (!this.sources.size) { this.onEnded?.(); this.stop(); }
      }
    };
    live.pump = schedule;
    schedule(); if (this.playing && epoch === this.playbackEpoch) this.interval = setInterval(schedule, 25); return true;
  }
  /** Replan only future onsets; already-started samples retain their natural tails. */
  updateProject(project: Project, refreshReference = false): boolean {
    const live = this.live, context = this.context, clock = this.clock;
    if (!live || !context || !clock || !this.playing) return false;
    if (live.project.id !== project.id) return false;
    this.requestedLiveProject = project;
    if (live.project === project && !refreshReference) return true;
    const previous = live.project;
    const structural = previous.patterns !== project.patterns || previous.regions !== project.regions || previous.tempos !== project.tempos || previous.ppq !== project.ppq
      || previous.tracks.length !== project.tracks.length || previous.tracks.some((track, index) => {
        const next = project.tracks[index]; return track.id !== next.id || track.instrumentId !== next.instrumentId || track.delay !== next.delay;
      });
    const referenceMoved = previous.reference?.assetId !== project.reference?.assetId || previous.reference?.startTick !== project.reference?.startTick;
    const plan = structural ? renderNoteEvents(project, true) : undefined, events = plan?.notes ?? live.events;
    const solo = project.tracks.some(track => track.solo), audible = new Set(project.tracks.filter(track => !track.muted && (!solo || track.solo)).map(track => track.id));
    const missing = events.find(note => audible.has(note.trackId) && note.velocity > 0 && !this.bufferFor(note.effectiveInstrument));
    if (missing) {
      const pending = this.pendingProjectSamples?.project;
      const unavailable = (id: string) => new Error(`实时试听缺少采样：${id}，请加载相应声音资源。`);
      if (pending?.id !== project.id) throw unavailable(missing.effectiveInstrument);
      const definitions = new Map(project.instruments.map(ins => [ins.id, ins])), assets = new Map(project.assets.map(asset => [asset.id, asset]));
      const loading = new Map(pending.instruments.map(ins => [ins.id, ins])), loadingAssets = new Map(pending.assets.map(asset => [asset.id, asset]));
      const checked = new Set<string>();
      for (const note of events) {
        const id = note.effectiveInstrument;
        if (checked.has(id) || !audible.has(note.trackId) || note.velocity <= 0 || this.bufferFor(id)) continue;
        checked.add(id);
        const asset = assets.get(definitions.get(id)?.assetId ?? '');
        if (!asset?.data || loadingAssets.get(loading.get(id)?.assetId ?? '')?.data !== asset.data) throw unavailable(id);
      }
      // Retain the audible graph only while every missing sound has that exact
      // embedded data in flight. A genuinely missing resource still reports.
      return false;
    }
    const referenceAsset = project.assets.find(asset => asset.id === project.reference?.assetId);
    const reference = referenceAsset?.data === this.reference?.data ? this.reference?.buffer : undefined;
    const position = this.position()!, timing = createTempoMap(project);
    const endTick = playbackEndTick(project, reference?.duration), end = timing.seconds(endTick);
    if (!Number.isFinite(end) || end <= 0) throw new Error('工程播放周期无效。');
    const referenceClockChanged = previous.ppq !== project.ppq || previous.tempos !== project.tempos || endTick !== live.endTick;
    let queue: NoteOccurrenceQueue | undefined, from = position.seconds;
    if (structural || endTick !== live.endTick) {
      const cycle = live.loop ? Math.floor(position.linearTick / clock.endTick) : 0;
      from = cycle * end + timing.seconds(position.tick);
      queue = new NoteOccurrenceQueue(events.map(note => timing.seconds(note.absoluteTick)), end, live.loop, from + (context.currentTime < clock.startedAt ? 0 : 1e-7));
    }
    // Everything above is validated before touching the currently audible graph.
    live.project = project; live.reference = reference;
    for (const id of this.trackPreviews.keys()) if (!project.tracks.some(track => track.id === id)) this.trackPreviews.delete(id);
    if (queue) {
      for (const [source, voice] of this.liveVoices) if (voice.when > context.currentTime) { source.stop(); this.sources.delete(source); this.liveVoices.delete(source); }
      this.startedAt = Math.max(context.currentTime, clock.startedAt); this.startSeconds = from;
      this.clock = { timing, startedAt: this.startedAt, from, endTick, loop: live.loop };
      live.events = events; live.queue = queue; live.end = end; live.endTick = endTick;
      if (plan) this.renderDiagnostics = plan.diagnostics;
    }
    if (referenceClockChanged || referenceMoved || refreshReference) {
      for (const source of this.referenceVoices.keys()) { source.stop(); this.sources.delete(source); }
      this.referenceVoices.clear();
      live.scheduleReference = this.scheduleReference(project, reference, Math.max(context.currentTime, this.clock!.startedAt), this.position()!.seconds, live.loop, end);
    }
    this.refreshLiveMix();
    if (queue) live.pump();
    return true;
  }
  stop() {
    const position = this.position(); if (position) this.onPosition?.(position.tick);
    this.playbackEpoch++; this.clock = undefined;
    this.playing = false; this.live = undefined; this.requestedLiveProject = undefined; this.trackPreviews.clear(); this.masterPreview = undefined;
    if (this.interval) clearInterval(this.interval); this.interval = undefined;
    for (const source of this.sources) { try { source.stop(); } catch { /* already ended */ } } this.sources.clear();
    this.liveVoices.clear(); this.referenceVoices.clear();
    for (const analyser of this.analysers.values()) analyser.disconnect(); this.analysers.clear();
    this.masterAnalyser?.disconnect(); this.masterAnalyser = undefined;
    return position;
  }
  meterLevels(): { tracks: Record<string, number>; master: number } {
    const peak = (analyser: AnalyserNode) => {
      const samples = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(samples);
      let value = 0; for (const sample of samples) value = Math.max(value, Math.abs(sample)); return value;
    };
    const tracks: Record<string, number> = {};
    for (const [id, analyser] of this.analysers) Object.defineProperty(tracks, id, { value: peak(analyser), enumerable: true, configurable: true, writable: true });
    return { tracks, master: this.masterAnalyser ? peak(this.masterAnalyser) : 0 };
  }
  levels(): Record<string, number> {
    const { tracks, master } = this.meterLevels();
    // Legacy callers retain the old reserved output key. The editor uses the
    // separated result so a perfectly valid track named __master cannot collide.
    return this.masterAnalyser ? { ...tracks, __master: master } : tracks;
  }
  private masterOutput(context: AudioContext) {
    if (!this.masterAnalyser) { const analyser = context.createAnalyser(); analyser.fftSize = 512; analyser.connect(context.destination); this.masterAnalyser = analyser; }
    return this.masterAnalyser;
  }
  async auditionRendered(wav: Uint8Array) {
    const epoch = this.playbackEpoch, context = await this.ensure();
    const buffer = await context.decodeAudioData(Uint8Array.from(wav).buffer);
    if (epoch !== this.playbackEpoch) return;
    const source = context.createBufferSource(); source.buffer = buffer; source.connect(this.masterOutput(context)); this.sources.add(source);
    source.onended = () => { this.sources.delete(source); source.disconnect(); }; source.start();
  }
  async playRendered(project: Project, wav: Uint8Array, fromTick: number, loopStart?: number, loopEnd?: number) {
    this.stop(); const epoch = this.playbackEpoch, context = await this.ensure();
    const reference = await this.loadReference(project);
    let buffer = await context.decodeAudioData(Uint8Array.from(wav).buffer);
    if (epoch !== this.playbackEpoch) return false;
    const timing = createTempoMap(project), endTick = playbackEndTick(project, reference?.duration), period = timing.seconds(endTick);
    if (buffer.duration < period) {
      const padded = context.createBuffer(buffer.numberOfChannels, Math.ceil(period * buffer.sampleRate), buffer.sampleRate);
      for (let ch = 0; ch < buffer.numberOfChannels; ch++) padded.copyToChannel(buffer.getChannelData(ch), ch);
      buffer = padded;
    }
    const source = context.createBufferSource(); source.buffer = buffer; source.connect(this.masterOutput(context));
    if (loopStart !== undefined && loopEnd !== undefined) { source.loop = true; source.loopStart = loopStart; source.loopEnd = loopEnd; }
    const from = Math.max(0, source.loop ? timing.seconds(fromTick) % period : Math.min(buffer.duration - 1 / buffer.sampleRate, timing.seconds(fromTick)));
    const start = context.currentTime + .03;
    // Start in the cold first cycle. The later loop range retains the rendered
    // preceding cycles' sample tails without inventing a previous cycle at start.
    source.start(start, from); this.sources.add(source); this.playing = true;
    this.clock = { timing, startedAt: start, from, endTick, loop: source.loop };
    const scheduleReference = this.scheduleReference(project, reference, start, from, source.loop, period);
    this.interval = setInterval(() => { scheduleReference(); this.onPosition?.(this.position()!.tick); }, 25);
    source.onended = () => { if (this.sources.has(source)) { this.sources.delete(source); this.onEnded?.(); this.stop(); } source.disconnect(); };
    return true;
  }
  async nativeRequest(project: Project): Promise<NativeRenderRequest> {
    if (!this.library?.nativeLibrary) throw new Error('当前资源未找到可用的 OpenAL 本地库。');
    if (project.audio.profileId !== this.library.profileId) throw new Error(`工程目标为 ${project.audio.profileId}，当前加载 ${this.library.profileId}，请加载匹配的资源后再原生渲染。`);
    if (!this.library.nativeDecoder && !this.library.javaDecoder) throw new Error('此版本原版解码器暂不可用。可以在设置中明确选择 Web Audio 近似试听。');
    if (project.audio.mode === 'vanilla' && project.audio.directional && gameHrtfControl(project.audio.profileId) === false) throw new Error('该版本未提供游戏内 HRTF 开关；请关闭方向音频，或切换完整试听模式。');
    const plan = renderNoteEvents(project), notes = plan.notes, ids = [...new Set(notes.map(n => n.effectiveInstrument))]; this.renderDiagnostics = plan.diagnostics;
    const samples: PcmSample[] = ids.map(id => {
      const buffer = this.bufferFor(id, false); if (!buffer) throw new Error(`原生对照缺少目标版本采样：${id}。内置试听采样仅用于实时试听与 Web WAV。`);
      return { id, channels: buffer.numberOfChannels, sampleRate: buffer.sampleRate, data: Array.from({ length: buffer.numberOfChannels }, (_, ch) => buffer.getChannelData(ch).slice()) };
    });
    const timing = createTempoMap(project), events = notes.map(note => ({ time: timing.seconds(note.absoluteTick), frame: timing.frame(note.absoluteTick, project.audio.sampleRate), tick: note.absoluteTick, instrument: note.effectiveInstrument, ...noteAudioParameters(project, note, this.library) }));
    const encodedSamples = ids.flatMap(id => {
      const instrument = project.instruments.find(i => i.id === id), asset = project.assets.find(a => a.id === instrument?.assetId);
      if (asset?.data) return /ogg|vorbis/.test(asset.mime) ? [{ id, bytes: base64ToBytes(asset.data) }] : [];
      return this.library?.samples[id] ? [{ id, bytes: this.library.samples[id].bytes }] : [];
    });
    const duration = renderDuration(project, notes, id => this.bufferFor(id, false)?.duration ?? 0, this.library, timing);
    if (duration > 1800) throw new Error('单次音频导出最长 30 分钟，请拆分较长工程或缩短延迟尾音。');
    return { nativeLibrary: this.library.nativeLibrary, nativeDecoder: this.library.nativeDecoder, javaDecoder: this.library.javaDecoder, attenuationModel: this.library.attenuationModel, listener: listenerForProject(project), hrtf: hrtfContextForProject(project), outputLimiter: outputLimiterForProject(project), broadcast: broadcastForProject(project), encodedSamples, sampleRate: project.audio.sampleRate, directional: project.audio.directional, samples, events, duration };
  }
  async renderWeb(project: Project): Promise<Uint8Array> {
    const plan = renderNoteEvents(project), notes = plan.notes; this.renderDiagnostics = plan.diagnostics;
    const timing = createTempoMap(project), duration = renderDuration(project, notes, id => this.bufferFor(id)?.duration ?? 0, this.library, timing, 'musical');
    if (duration > 1800) throw new Error('单次音频导出最长 30 分钟，请拆分较长工程。');
    const context = new OfflineAudioContext(2, Math.ceil(duration * project.audio.sampleRate), project.audio.sampleRate);
    for (const note of notes) {
      if (!this.bufferFor(note.effectiveInstrument)) throw new Error(`缺少采样：${note.effectiveInstrument}`);
      this.schedule(context, project, note, timing.seconds(note.absoluteTick));
    }
    const rendered = await context.startRendering();
    return wavFromChannels([rendered.getChannelData(0), rendered.getChannelData(1)], rendered.sampleRate);
  }
}
