import { diagnosticError, type DiagnosticInput } from '../core/diagnostics';
import type { Project } from '../core/types';
import type { AudioEngine } from '../audio/engine';
import { INSTRUMENTS } from '../core/instruments';

/** Diagnostic failures must never interrupt editing or audio. */
export function recordDiagnostic(input: DiagnosticInput) {
  try {
    const value = input.fields?.error;
    const safe = value === undefined ? input : { ...input, fields: { ...input.fields, error: diagnosticError(value) } };
    void window.desktop?.recordDiagnostic?.(safe)?.catch(() => {});
  } catch { /* Main-process logging may be unavailable during shutdown. */ }
}
export function audioDiagnosticSnapshot(project: Project, engine: AudioEngine, mode: string) {
  const solo = project.tracks.some(track => track.solo);
  const mixed = project.instruments.some(instrument => project.assets.some(asset => asset.id === instrument.assetId && !!asset.data))
    || !!engine.library && INSTRUMENTS.some(instrument => engine.bufferFor(instrument.id) && !engine.bufferFor(instrument.id, false));
  return { mode, playing: engine.playing, source: mixed ? 'mixed' : engine.library ? 'local' : 'builtin', profileId: project.audio.profileId,
    contextState: engine.context?.state ?? 'uninitialized', sampleRate: engine.context?.sampleRate ?? project.audio.sampleRate,
    tracks: project.tracks.length, audibleTracks: project.tracks.filter(track => !track.muted && (!solo || track.solo) && track.volume > 0).length,
    mutedTracks: project.tracks.filter(track => track.muted).length, soloTracks: project.tracks.filter(track => track.solo).length,
    masterGain: project.audio.masterGain, loadedSamples: INSTRUMENTS.filter(instrument => !!engine.bufferFor(instrument.id)).length,
    missingBuiltins: INSTRUMENTS.filter(instrument => !engine.bufferFor(instrument.id)).map(instrument => instrument.id) };
}
export function installRendererDiagnostics() {
  const error = (event: ErrorEvent) => recordDiagnostic({ level: 'error', event: 'renderer.error', fields: { error: event.error ?? event.message } });
  const rejection = (event: PromiseRejectionEvent) => recordDiagnostic({ level: 'error', event: 'renderer.rejection', fields: { error: event.reason } });
  window.addEventListener('error', error); window.addEventListener('unhandledrejection', rejection);
  recordDiagnostic({ level: 'info', event: 'renderer.ready' });
  return () => { window.removeEventListener('error', error); window.removeEventListener('unhandledrejection', rejection); };
}
