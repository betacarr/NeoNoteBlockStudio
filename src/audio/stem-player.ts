import { activeStemGain, playableAudioStems, validateAudioWorkspace, type AudioWorkspace } from '../core/audio-assist';
import { base64ToBytes } from '../core/container';
import type { Asset } from '../core/types';

export interface StemPcm { sampleRate: number; channels: Float32Array[] }
/** Full-buffer Web Audio preview budget, including the largest encoded transfer. */
export const STEM_PREVIEW_MEMORY_LIMIT = 2 * 1024 ** 3;
function previewMemoryError(): Error { return new Error('分轨试听所需内存过大，当前全缓冲播放器无法安全载入。请缩小音频范围或减少同时载入的分轨；工程与原始侧车文件保持完整，不会截短音频。'); }
function managedAudioUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('托管音频地址无效。'); }
  if (url.protocol !== 'nbsx:' || url.hostname !== 'app' || url.port || url.username || url.password || url.search || url.hash || !/^\/audio-assets\/[A-Za-z0-9_-]+$/.test(url.pathname)) throw new Error('托管音频地址未获授权。');
  return url.href;
}
/** IEEE float WAV keeps peaks above 0 dBFS intact; no per-stem normalization/clipping. */
export function encodeFloatWav(pcm: StemPcm): Uint8Array {
  const channels = pcm.channels.length, frames = pcm.channels[0]?.length ?? 0;
  if (channels < 1 || channels > 8 || pcm.channels.some(c => c.length !== frames) || !Number.isInteger(pcm.sampleRate) || pcm.sampleRate < 8000 || pcm.sampleRate > 192000 || frames * channels * 4 > 0xffffffff - 36) throw new Error('WAV 音频数据无效或超过格式长度限制。');
  const bytes = new Uint8Array(44 + frames * channels * 4), view = new DataView(bytes.buffer);
  const text = (at: number, s: string) => [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  text(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); text(8, 'WAVE'); text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 3, true); view.setUint16(22, channels, true); view.setUint32(24, pcm.sampleRate, true); view.setUint32(28, pcm.sampleRate * channels * 4, true); view.setUint16(32, channels * 4, true); view.setUint16(34, 32, true); text(36, 'data'); view.setUint32(40, bytes.length - 44, true);
  for (let frame = 0; frame < frames; frame++) for (let ch = 0; ch < channels; ch++) { const value = pcm.channels[ch][frame]; if (!Number.isFinite(value)) throw new Error('音频含无效采样。'); view.setFloat32(44 + (frame * channels + ch) * 4, value, true); }
  return bytes;
}
export function mixStemPcm(workspace: AudioWorkspace, buffers: Map<string, StemPcm>, stemId?: string): StemPcm {
  const stems = playableAudioStems(workspace);
  if (stemId !== undefined && !stems.some(s => s.id === stemId)) throw new Error('分轨不存在。');
  const selected = stems.filter(s => stemId === undefined || s.id === stemId);
  const channels = Math.max(1, ...selected.map(s => buffers.get(s.id)?.channels.length ?? 0));
  const output = Array.from({ length: channels }, () => new Float32Array(workspace.frames));
  for (const s of selected) {
    const pcm = buffers.get(s.id);
    if (!pcm || pcm.sampleRate !== workspace.sampleRate || !pcm.channels.length || pcm.channels.some(c => c.length !== workspace.frames)) throw new Error('音频分轨未对齐，无法导出。');
    const gain = stemId === undefined ? activeStemGain(s, stems) : s.gain;
    for (let ch = 0; ch < channels; ch++) { const src = pcm.channels[Math.min(ch, pcm.channels.length - 1)]; for (let i = 0; i < workspace.frames; i++) output[ch][i] += src[i] * gain; }
  }
  return { sampleRate: workspace.sampleRate, channels: output };
}

export class StemPlayer {
  private ctx?: AudioContext;
  private ownsContext: boolean;
  private workspace?: AudioWorkspace;
  private buffers = new Map<string, AudioBuffer>();
  private sources = new Map<string, { source: AudioBufferSourceNode; gain: GainNode }>();
  private origin = 0;
  private position = 0;
  private running = false;
  private generation = 0;
  private transportGeneration = 0;
  private loadAbort?: AbortController;
  constructor(context?: AudioContext) { this.ctx = context; this.ownsContext = !context; }
  get context(): AudioContext | undefined { return this.ctx; }
  get playing(): boolean { return this.running && this.currentTime < (this.workspace?.duration ?? 0); }
  get currentTime(): number {
    const w = this.workspace;
    if (!this.running || !this.ctx || !w) return this.position;
    const at = this.position + Math.max(0, this.ctx.currentTime - this.origin);
    if (w.loop.enabled && at >= w.loop.end) return w.loop.start + (at - w.loop.start) % (w.loop.end - w.loop.start);
    return Math.min(w.duration, at);
  }
  async load(workspace: AudioWorkspace, assets: Asset[]): Promise<void> {
    validateAudioWorkspace(workspace, assets); this.stop(); this.workspace = undefined; this.buffers.clear(); this.loadAbort?.abort(); const abort = this.loadAbort = new AbortController(); const ticket = ++this.generation;
    const ctx = this.ctx ??= new AudioContext({ sampleRate: workspace.sampleRate });
    const buffers = new Map<string, AudioBuffer>();
    const stems = playableAudioStems(workspace);
    const selectedAssets = stems.map(s => assets.find(a => a.id === s.assetId)!);
    const decodedEstimate = selectedAssets.reduce((total, asset) => total + Math.ceil(workspace.duration * ctx.sampleRate) * (asset.audioFile?.channels ?? 2) * 4, 0);
    const transferEstimate = Math.max(0, ...selectedAssets.map(asset => asset.audioFile?.bytes ?? (asset.data?.length ?? 0) * .75));
    if (decodedEstimate + transferEstimate > STEM_PREVIEW_MEMORY_LIMIT) throw previewMemoryError();
    try { for (const s of stems) {
      const asset = assets.find(a => a.id === s.assetId);
      let encoded: ArrayBuffer;
      if (asset?.data) {
        const bytes = base64ToBytes(asset.data); encoded = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      } else if (asset?.audioFile) {
        if (typeof window === 'undefined' || !window.desktop?.resolveAudioAsset) throw new Error(`“${s.name}”使用托管音频侧车，请在桌面版中打开工程与对应的 .assets 文件夹。`);
        const url = managedAudioUrl(await window.desktop.resolveAudioAsset(asset.audioFile));
        if (ticket !== this.generation) return;
        const response = await fetch(url, { signal: abort.signal });
        if (!response.ok) throw new Error(`“${s.name}”的音频侧车无法读取（${response.status}），请重新定位音频资源。`);
        encoded = await response.arrayBuffer();
        if (encoded.byteLength !== asset.audioFile.bytes) throw new Error(`“${s.name}”的音频侧车大小不匹配，文件可能损坏，请重新定位。`);
      } else throw new Error(`“${s.name}”缺少嵌入或托管音频资源，无法试听。`);
      if (ticket !== this.generation) return;
      let decoded: AudioBuffer;
      try { decoded = await ctx.decodeAudioData(encoded); }
      catch (error) { if (error instanceof RangeError || error instanceof DOMException && error.name === 'QuotaExceededError') throw previewMemoryError(); throw new Error(`“${s.name}”的音频解码失败，文件可能损坏或格式不受支持。`); }
      if (ticket !== this.generation) return;
      // decodeAudioData resamples to context sample rate. Duration must still match within two samples.
      if (Math.abs(decoded.duration - workspace.duration) > 2 / decoded.sampleRate) throw new Error('分轨长度不一致，无法保证对齐试听。');
      if (asset?.audioFile && decoded.numberOfChannels !== asset.audioFile.channels) throw new Error(`“${s.name}”的音频声道信息不匹配，文件可能损坏。`);
      buffers.set(s.id, decoded);
    } } catch (error) { if (ticket !== this.generation) return; if (error instanceof RangeError) throw previewMemoryError(); throw error; }
    if (ticket === this.generation) { this.workspace = structuredClone(workspace); this.buffers = buffers; this.position = 0; }
  }
  async play(position = this.position): Promise<void> {
    const w = this.workspace, ctx = this.ctx;
    if (!w || !ctx) throw new Error('请先载入分轨。');
    this.stop(); const ticket = this.transportGeneration; await ctx.resume();
    if (ticket !== this.transportGeneration || ctx !== this.ctx) return;
    this.position = Math.max(0, Math.min(w.duration, position));
    if (w.loop.enabled && this.position >= w.loop.end) this.position = w.loop.start;
    if (this.position >= w.duration) return;
    this.origin = ctx.currentTime + .025; this.running = true;
    for (const s of playableAudioStems(w)) {
      const source = ctx.createBufferSource(), gain = ctx.createGain(); source.buffer = this.buffers.get(s.id)!;
      source.loop = w.loop.enabled; source.loopStart = w.loop.start; source.loopEnd = w.loop.end;
      gain.gain.value = activeStemGain(s, playableAudioStems(w)); source.connect(gain); gain.connect(ctx.destination);
      this.sources.set(s.id, { source, gain }); source.start(this.origin, this.position);
    }
  }
  update(workspace: AudioWorkspace): void {
    if (!this.workspace) return; // Initial UI settings may arrive while load is decoding.
    if (workspace.id !== this.workspace.id || workspace.stems.some(s => !this.buffers.has(s.id))) throw new Error('分轨已改变，请重新载入。');
    const loopingChanged = JSON.stringify(workspace.loop) !== JSON.stringify(this.workspace.loop);
    const position = this.currentTime, wasRunning = this.playing;
    this.workspace = structuredClone(workspace);
    for (const s of workspace.stems) { const node = this.sources.get(s.id); if (node) node.gain.gain.setValueAtTime(activeStemGain(s, workspace.stems), this.ctx!.currentTime); }
    if (loopingChanged && wasRunning) void this.play(position);
  }
  stop(): void {
    ++this.transportGeneration;
    this.position = this.currentTime; this.running = false;
    for (const { source, gain } of this.sources.values()) { try { source.stop(); } catch {} source.disconnect(); gain.disconnect(); }
    this.sources.clear();
  }
  peaks(stemId?: string, bins = 240): number[] {
    const buffer = stemId ? this.buffers.get(stemId) : this.buffers.values().next().value;
    if (!buffer) return [];
    const count = Math.max(1, Math.min(4096, Math.floor(bins)));
    const result = Array(count).fill(0) as number[];
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < data.length; i++) { const bin = Math.min(count - 1, Math.floor(i * count / data.length)); result[bin] = Math.max(result[bin], Math.abs(data[i])); }
    }
    return result;
  }
  async exportWav(stemId?: string): Promise<Uint8Array> {
    const w = this.workspace;
    if (!w) throw new Error('请先载入分轨。');
    const selected = stemId === undefined ? [...this.buffers.values()] : [this.buffers.get(stemId)].filter((b): b is AudioBuffer => !!b);
    const channels = Math.max(1, ...selected.map(b => b.numberOfChannels));
    const existingBytes = [...this.buffers.values()].reduce((sum, b) => sum + Math.ceil(b.duration * b.sampleRate) * b.numberOfChannels * 4, 0);
    if (existingBytes + w.frames * channels * 8 > STEM_PREVIEW_MEMORY_LIMIT) throw new Error('WAV 导出所需内存过大，请导出较短的音频范围或减少载入分轨。工程和原始侧车文件保持完整。');
    // A supplied context may use another sample rate. Render export at the original rate.
    const pcm = new Map<string, StemPcm>();
    for (const [id, buffer] of this.buffers) {
      let decoded = buffer;
      if (buffer.sampleRate !== w.sampleRate) { const offline = new OfflineAudioContext(buffer.numberOfChannels, w.frames, w.sampleRate); const source = offline.createBufferSource(); source.buffer = buffer; source.connect(offline.destination); source.start(); decoded = await offline.startRendering(); }
      pcm.set(id, { sampleRate: decoded.sampleRate, channels: Array.from({ length: decoded.numberOfChannels }, (_, ch) => decoded.getChannelData(ch)) });
    }
    return encodeFloatWav(mixStemPcm(w, pcm, stemId));
  }
  dispose(): void { ++this.generation; this.loadAbort?.abort(); this.loadAbort = undefined; this.stop(); this.buffers.clear(); this.workspace = undefined; if (this.ownsContext && this.ctx) void this.ctx.close(); this.ctx = undefined; }
}
