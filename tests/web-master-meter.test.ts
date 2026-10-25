import { afterEach, describe, expect, it, vi } from 'vitest';
import { AudioEngine } from '../src/audio/engine';
import { createProject, newNote, newTrack, validateProject } from '../src/core/project';

// Execute the actual engine schedule/play and meter readers. These inert Web
// Audio boundary nodes sum the PCM on their real connect edges and apply gain;
// they do not emulate spatial DSP, the analyser window, or a physical device.
class SignalBuffer {
  readonly channels: Float32Array[];
  readonly sampleRate: number;
  constructor(values: number[] = [.5], sampleRate = 32, frames = sampleRate) {
    this.sampleRate = sampleRate; this.channels = values.map(value => new Float32Array(frames).fill(value));
  }
  get numberOfChannels() { return this.channels.length; }
  get length() { return this.channels[0].length; }
  get duration() { return this.length / this.sampleRate; }
  getChannelData(channel: number) { return this.channels[channel]; }
  copyToChannel(values: Float32Array, channel: number) { this.channels[channel].set(values); }
}
class SignalNode {
  outputs = new Set<SignalNode>(); connectCalls: SignalNode[] = []; disconnectCalls = 0;
  constructor(readonly context: SignalContext, readonly kind: string) { context.nodes.push(this); }
  connect(target: SignalNode) { this.connectCalls.push(target); this.outputs.add(target); return target; }
  disconnect() { this.disconnectCalls++; this.outputs.clear(); }
  valueAt(time: number, visiting = new Set<SignalNode>()): number {
    if (visiting.has(this)) throw new Error('Unexpected audio graph cycle');
    visiting.add(this);
    try { let sum = 0; for (const input of this.context.nodes) if (input.outputs.has(this)) sum += input.valueAt(time, visiting); return sum; }
    finally { visiting.delete(this); }
  }
}
class SignalGain extends SignalNode {
  gain = { value: 1 };
  constructor(context: SignalContext) { super(context, 'gain'); }
  valueAt(time: number, visiting?: Set<SignalNode>) { return super.valueAt(time, visiting) * this.gain.value; }
}
class SignalPanner extends SignalNode {
  panningModel = ''; distanceModel = ''; refDistance = 0; maxDistance = 0; rolloffFactor = 0;
  positionX = { value: 0 }; positionY = { value: 0 }; positionZ = { value: 0 };
  constructor(context: SignalContext) { super(context, 'panner'); }
}
class SignalAnalyser extends SignalNode {
  fftSize = 2048; reads = 0;
  constructor(context: SignalContext) { super(context, 'analyser'); }
  getFloatTimeDomainData(data: Float32Array) {
    this.reads++;
    for (let frame = 0; frame < data.length; frame++) data[frame] = this.valueAt(this.context.currentTime + frame / this.context.sampleRate);
  }
}
class SignalSource extends SignalNode {
  buffer?: SignalBuffer; playbackRate = { value: 1 }; onended?: () => void;
  when = Infinity; offset = 0; duration = Infinity; stopped = false; stopCalls = 0; queuedEnd = false;
  constructor(context: SignalContext) { super(context, 'source'); }
  start(when = this.context.currentTime, offset = 0, duration = Infinity) { this.when = when; this.offset = offset; this.duration = duration; }
  stop() { this.stopCalls++; this.end(); }
  end() { this.stopped = true; if (!this.queuedEnd) { this.queuedEnd = true; this.context.ended.push(() => this.onended?.()); } }
  valueAt(time: number) {
    if (!this.buffer || this.stopped || time < this.when || time - this.when >= this.duration) return 0;
    const frame = Math.floor((this.offset + (time - this.when) * this.playbackRate.value) * this.buffer.sampleRate);
    return this.buffer.channels[0][frame] ?? 0;
  }
}
class SignalContext {
  currentTime = 0; sampleRate = 32; nodes: SignalNode[] = []; ended: (() => void)[] = [];
  destination = new SignalNode(this, 'destination');
  sources: SignalSource[] = []; gains: SignalGain[] = []; panners: SignalPanner[] = []; analysers: SignalAnalyser[] = [];
  decoded: SignalBuffer[] = [];
  resume = vi.fn(async () => {});
  decodeAudioData = vi.fn(async () => this.decoded.shift() ?? new SignalBuffer([.25]));
  createBufferSource() { const node = new SignalSource(this); this.sources.push(node); return node; }
  createGain() { const node = new SignalGain(this); this.gains.push(node); return node; }
  createPanner() { const node = new SignalPanner(this); this.panners.push(node); return node; }
  createAnalyser() { const node = new SignalAnalyser(this); this.analysers.push(node); return node; }
  createBuffer(channels: number, frames: number, sampleRate: number) { return new SignalBuffer(Array(channels).fill(0), sampleRate, frames); }
  flushEnded() { while (this.ended.length) this.ended.shift()!(); }
}
function fixture({ reference = true, reservedTrack = false, secondTrack = true } = {}) {
  vi.useFakeTimers();
  const context = new SignalContext(); vi.stubGlobal('AudioContext', class { constructor() { return context; } });
  const engine = new AudioEngine(), project = createProject('Master signal routing');
  project.ppq = 100; project.tempos = [{ tick: 0, bpm: 60 }]; project.audio.mode = 'studio'; project.audio.masterGain = .5;
  project.patterns[0].length = project.regions[0].length = 100;
  project.patterns[0].notes = [{ ...newNote(0, 66, 10), velocity: .5 }];
  if (reservedTrack) { project.tracks[0].id = '__master'; project.regions[0].trackId = '__master'; }
  if (secondTrack) {
    const track = newTrack('Second', 1, 'bass'), pattern = { id: 'second-pattern', name: 'Second', length: 100, notes: [{ ...newNote(0, 66, 10), velocity: .5 }] };
    project.tracks.push(track); project.patterns.push(pattern); project.regions.push({ id: 'second-region', trackId: track.id, patternId: pattern.id, start: 0, length: 100, offset: 0, loop: false });
  }
  if (reference) { project.reference = { assetId: 'ref', startTick: 0, gain: 1 }; project.assets.push({ id: 'ref', name: 'reference.wav', mime: 'audio/wav', data: 'AA==' }); context.decoded.push(new SignalBuffer([.25])); }
  engine.buffers.set('harp', new SignalBuffer([.5]) as unknown as AudioBuffer);
  engine.buffers.set('bass', new SignalBuffer([.25]) as unknown as AudioBuffer);
  const masterNode = () => {
    const tracks = new Set([...engine.analysers.values()] as unknown as SignalAnalyser[]);
    return context.analysers.filter(node => !tracks.has(node) && node.outputs.has(context.destination)).at(-1)!;
  };
  return { engine, project, context, masterNode };
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('actual Web engine master meter signal routes', () => {
  it('collects the actual summed track and reference signal in one master analyser, not a maximum of track peaks', async () => {
    const { engine, project, context, masterNode } = fixture();
    expect(await engine.play(project, 0)).toBe(true); context.currentTime = .05;
    const meters = engine.meterLevels(), [first, second] = project.tracks;
    expect(meters.tracks[first.id]).toBe(.125); expect(meters.tracks[second.id]).toBe(.0625);
    expect(meters.master).toBe(.3125); // .5*.5*.5 + .25*.5*.5 + .25*1*.5
    expect(meters.master).toBeGreaterThan(Math.max(...Object.values(meters.tracks)));
    const master = masterNode(); expect(master.fftSize).toBe(512); expect(master.reads).toBeGreaterThan(0);
    expect(master.connectCalls).toEqual([context.destination]); expect(context.analysers).toHaveLength(3);
    for (const analyser of engine.analysers.values() as Iterable<unknown>) expect((analyser as SignalAnalyser).connectCalls).toEqual([master]);
    expect(context.gains[0].outputs).toEqual(new Set([master])); // scheduleReference is enqueued before the two note chains.
    expect(context.panners.every(node => !node.outputs.has(context.destination))).toBe(true);
    engine.stop(); context.flushEnded();
  });

  it('reports reference-only playback in the master while leaving the track meter map empty', async () => {
    const { engine, project, context, masterNode } = fixture({ secondTrack: false }); project.patterns[0].notes = [];
    await engine.play(project, 0); context.currentTime = .05;
    expect(engine.analysers.size).toBe(0); expect(engine.meterLevels()).toEqual({ tracks: {}, master: .125 });
    expect(context.sources).toHaveLength(1); expect(context.sources[0].outputs).toEqual(new Set([context.gains[0]]));
    expect(context.gains[0].outputs).toEqual(new Set([masterNode()])); expect(masterNode().connectCalls).toEqual([context.destination]);
    engine.stop(); context.flushEnded();
  });

  it('reuses one analyser per track and one destination connection through subsequent notes and reference loop cycles', async () => {
    const { engine, project, context, masterNode } = fixture({ secondTrack: false });
    project.patterns[0].notes.push({ ...newNote(4, 66, 10), velocity: .5 }, { ...newNote(8, 66, 10), velocity: .5 });
    await engine.play(project, 0, true); const track = engine.analysers.get(project.tracks[0].id) as unknown as SignalAnalyser, master = masterNode();
    expect(context.panners).toHaveLength(3); expect(context.analysers).toHaveLength(2);
    context.currentTime = .95; vi.advanceTimersByTime(25);
    expect(context.panners.length).toBeGreaterThan(3); expect(context.analysers).toHaveLength(2);
    expect(track.connectCalls).toEqual([master]); expect(master.connectCalls).toEqual([context.destination]);
    const references = context.sources.filter(source => source.buffer?.getChannelData(0)[0] === .25);
    expect(references).toHaveLength(2);
    for (const source of references) { const gain = [...source.outputs][0]; expect(gain.outputs).toEqual(new Set([master])); }
    engine.stop(); context.flushEnded();
  });

  it('disconnects source chains on their real onended callback and all meters on stop, then creates a clean graph for replay', async () => {
    const { engine, project, context, masterNode } = fixture(); await engine.play(project, 0);
    const oldNodes = context.nodes.slice(1), oldAnalysers = context.analysers.slice(), oldMaster = masterNode();
    context.sources[1].end(); context.flushEnded();
    expect(context.sources[1].outputs.size).toBe(0); expect(context.gains[1].outputs.size).toBe(0); expect(context.panners[0].outputs.size).toBe(0);
    expect(oldMaster.outputs.has(context.destination)).toBe(true);
    engine.stop(); context.flushEnded();
    expect(engine.analysers.size).toBe(0); expect(engine.meterLevels()).toEqual({ tracks: {}, master: 0 });
    expect(oldNodes.every(node => node.outputs.size === 0)).toBe(true); expect(oldAnalysers.every(node => node.disconnectCalls === 1)).toBe(true);
    await engine.play(project, 0); const nextMaster = masterNode();
    expect(nextMaster).not.toBe(oldMaster); expect(nextMaster.connectCalls).toEqual([context.destination]); expect(oldMaster.outputs.size).toBe(0);
    engine.stop(); context.flushEnded();
  });

  it('also cleans a notes-only graph whose legal track ID is __master, keeping its individual meter separate from the sum', async () => {
    const { engine, project, context, masterNode } = fixture({ reference: false, reservedTrack: true });
    expect(validateProject(project)).toBe(project); await engine.play(project, 0); context.currentTime = .05;
    const track = engine.analysers.get('__master') as unknown as SignalAnalyser, master = masterNode();
    expect(track).toBeDefined(); expect(master).toBeDefined(); expect(track).not.toBe(master);
    expect(engine.meterLevels().tracks.__master).toBe(.125); expect(engine.meterLevels().master).toBe(.1875);
    expect(track.outputs).toEqual(new Set([master])); expect(master.outputs).toEqual(new Set([context.destination]));
    engine.stop(); context.flushEnded();
    expect(context.nodes.every(node => node.outputs.size === 0)).toBe(true); expect(track.disconnectCalls).toBe(1); expect(master.disconnectCalls).toBe(1);
  });

  it('separates a __master track from the reference and other tracks when the reference creates the master first', async () => {
    const { engine, project, context, masterNode } = fixture({ reservedTrack: true }); await engine.play(project, 0); context.currentTime = .05;
    const values = engine.meterLevels(); expect(values.tracks.__master).toBe(.125); expect(values.master).toBe(.3125);
    expect(engine.analysers.get('__master')).not.toBe(masterNode());
    engine.stop(); context.flushEnded(); expect(context.nodes.every(node => node.outputs.size === 0)).toBe(true);
  });

  it('keeps offline Web rendering directly routed to its own destination without touching live meter nodes', async () => {
    const { engine, project, context, masterNode } = fixture(); await engine.play(project, 0); context.currentTime = .05;
    const liveAnalysers = context.analysers.slice(), liveMaster = masterNode(), before = engine.meterLevels();
    const offline: SignalContext[] = [];
    vi.stubGlobal('OfflineAudioContext', class extends SignalContext {
      frames: number;
      constructor(_channels: number, frames: number, sampleRate: number) { super(); this.frames = frames; this.sampleRate = sampleRate; offline.push(this); }
      async startRendering() { return new SignalBuffer([0, 0], this.sampleRate, this.frames); }
    });
    const wav = await engine.renderWeb(project), rendered = offline[0];
    expect(new TextDecoder().decode(wav.slice(0, 4))).toBe('RIFF'); expect(rendered.panners).toHaveLength(2);
    expect(rendered.analysers).toEqual([]); for (const panner of rendered.panners) expect(panner.connectCalls).toEqual([rendered.destination]);
    expect(rendered.nodes.every(node => [...node.outputs].every(target => target.context === rendered))).toBe(true);
    expect(context.analysers).toEqual(liveAnalysers); expect(masterNode()).toBe(liveMaster); expect(engine.meterLevels()).toEqual(before);
    engine.stop(); context.flushEnded();
  });
});
