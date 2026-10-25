import type { MidiEvent } from 'midi-file';
export type InstrumentId = string;
export interface StoredMidiEvent { id: string; tick: number; order: number; sourceTrack?: number; event: MidiEvent }
export interface Note {
  id: string;
  tick: number;
  duration: number;
  midi: number;
  velocity: number;
  pan: number;
  detune: number;
  height: number;
  instrumentId?: InstrumentId;
  midiSource?: { onOrder: number; offOrder: number; releaseVelocity: number; offSourceTrack?: number };
}
export interface Pattern { id: string; name: string; length: number; notes: Note[]; midiEvents?: StoredMidiEvent[] }
export interface Region {
  id: string; trackId: string; patternId: string;
  start: number; length: number; offset: number; loop: boolean;
  /** Split playback borders own expression messages on their right side only. */
  midiEndExclusive?: boolean;
}
export interface DelayEffect {
  enabled: boolean;
  mode: 'gate' | 'tail';
  timeUnit: 'beats' | 'seconds';
  interval: number; feedback: number; wet: number;
  panAmount?: number;
  attack: number; decay: number; sustain: number; release: number;
  releaseOffset: number; tail: number;
}
export interface Track {
  id: string; name: string; color: string; instrumentId: InstrumentId;
  volume: number; pan: number; muted: boolean; solo: boolean; locked: boolean;
  midiChannel?: number; sourceMidiTrack?: number;
  delay?: DelayEffect;
}
export interface Instrument {
  id: InstrumentId; name: string; englishName: string;
  nbsIndex?: number; sound?: string; assetId?: string; rootMidi: number;
  block: string; color: string; gmProgram: number;
}
export interface Asset { id: string; name: string; mime: string; data?: string; path?: string; sha1?: string }
export interface Tempo { tick: number; bpm: number }
export interface TimeSignature { tick: number; numerator: number; denominator: number; metronome?: number; thirtyseconds?: number }
export interface Project {
  format: 'nbsx'; version: 2; id: string; name: string; author: string; description: string;
  createdAt: string; modifiedAt: string; ppq: number;
  tempos: Tempo[]; timeSignatures: TimeSignature[];
  tracks: Track[]; patterns: Pattern[]; regions: Region[];
  instruments: Instrument[]; assets: Asset[];
  audio: { profileId: string; sampleRate: number; masterGain: number; directional: boolean; mode: 'vanilla' | 'studio'; previewEngine?: 'native' | 'web' };
  reference?: { assetId: string; startTick: number; gain: number };
  provenance?: { kind: 'midi' | 'nbs' | 'flp'; filename: string; metadata: Record<string, unknown> };
  midi?: { schema: 1; format: 0 | 1; sourceAssetId: string; sourceTrackNames?: string[]; conductor: StoredMidiEvent[] };
}
export interface FlatNote extends Note {
  trackId: string; regionId: string; patternId: string; absoluteTick: number; gain: number; effectivePan: number; effectiveInstrument: InstrumentId;
  delaySource?: { noteId: string; occurrenceTick: number; tap: number; factor: number };
}
export interface Diagnostic { severity: 'info' | 'warning' | 'error'; code: string; message: string; noteId?: string }
export type ShortcutPreset = 'fl' | 'logic' | 'nbs';
export interface Preferences { preset: ShortcutPreset; snap: number; noteLength: number; shortcuts: Record<string, string>; showMixer: boolean; showLibrary: boolean; showInspector: boolean; appearance: 'classic' | 'liquid-glass' }
export interface AudioProfile {
  id: string; name: string; versions: string; backend: string;
  status: 'unverified' | 'code-reviewed' | 'partially-measured' | 'game-measured';
  attenuationDistance: number; noteBlockVolume: number; voiceWarning: number;
  source: string;
  measurementSummary?: string;
}
export interface SampleLibrary {
  root: string; version: string; profileId: string; nativeLibrary?: string; nativeDecoder?: string;
  instanceVersion?: string; assetIndex?: string; clientSha1?: string; resourceIndexSha1?: string; warnings?: string[];
  decoderKind?: 'stb' | 'jorbis' | 'legacy-jorbis' | 'unknown';
  attenuationModel?: 'openal-linear' | 'paulscode-linear';
  javaDecoder?: JavaDecoder;
  soundEvents?: Record<string, { event: string; path: string; volume: number; pitch: number; attenuationDistance: number }>;
  samples: Record<string, { name: string; bytes: Uint8Array; sha1: string }>;
}
export interface DesktopAPI {
  openFile: (kind: 'project' | 'reference' | 'sample') => Promise<{ path: string; name: string; bytes: Uint8Array } | null>;
  inspectFlpSamples: (sourcePath: string, samples: { id: number; path: string }[]) => Promise<Record<number, { sha256: string; path: string }>>;
  saveFile: (name: string, bytes: Uint8Array, path?: string) => Promise<string | null>;
  discoverMinecraft: () => Promise<{ root: string; versions: string[]; indexes: string[] }[]>;
  selectMinecraftRoot: () => Promise<{ root: string; versions: string[]; indexes: string[] } | null>;
  loadMinecraft: (root: string, index: string, version: string) => Promise<SampleLibrary>;
  autosave: (project: Uint8Array) => Promise<void>;
  recover: () => Promise<{ name: string; bytes: Uint8Array; projectId?: string } | null>;
  clearRecovery: (projectId?: string) => Promise<void>;
  onOpenFile: (callback: (file: { name: string; path: string; bytes: Uint8Array }) => void) => () => void;
  rendererReady: () => Promise<void>;
  renderNative: (request: NativeRenderRequest) => Promise<NativeRenderResult>;
  notifyDirty: (dirty: boolean) => Promise<void>;
  closeAfterSave: () => Promise<void>;
  onMenu: (callback: (command: string) => void) => () => void;
  platform: string;
}
export interface PcmSample { id: string; channels: number; sampleRate: number; data: Float32Array[] }
export interface JavaDecoder { executable: string; classpath: string[]; kind: 'jorbis' | 'legacy-jorbis' }
export type NativeHrtfPolicy = 'device-default' | 'enable-only-reset' | 'explicit-reset' | 'context-attributes' | 'first-profile';
export interface NativeHrtfDevice {
  name: string; directional: boolean; profile?: string; status: number; sampleRate: number;
  control: Exclude<NativeHrtfPolicy, 'first-profile'>; option: boolean; requestedProfile?: string;
  contextAttributes: number[]; resetAttributes?: number[]; resetSucceeded?: boolean; resetError?: number;
}
export interface NativeRenderRequest {
  nativeLibrary: string; nativeDecoder?: string; javaDecoder?: JavaDecoder; encodedSamples?: { id: string; bytes: Uint8Array }[]; sampleRate: number; directional: boolean;
  samples: PcmSample[]; duration: number;
  attenuationModel?: 'openal-linear' | 'paulscode-linear';
  listener?: { position: [number, number, number]; orientation: [number, number, number, number, number, number]; gain?: number };
  hrtf?: NativeHrtfPolicy;
  outputLimiter?: boolean;
  broadcast?: { listenerPosition: [number, number, number]; range: number };
  /** frame is authoritative at sampleRate; tick retains the musical origin for loop expansion. */
  events: { time: number; frame?: number; tick?: number; instrument: string; pitch: number; gain: number; x: number; y: number; z: number; maxDistance: number }[];
}
export interface NativeRenderResult { wav: Uint8Array; backend: string; directional?: boolean; hrtfProfile?: string; hrtfRequestedProfile?: string; hrtfStatus?: number; hrtfGameDevice?: NativeHrtfDevice; hrtfDefaultDevice?: NativeHrtfDevice; outputLimiter?: boolean; warnings: string[] }

declare global { interface Window { desktop?: DesktopAPI } }
