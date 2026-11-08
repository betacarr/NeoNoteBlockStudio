import { projectUsesExternalAudio } from '../../src/core/audio-assist';
import { renderNoteEvents } from '../../src/core/project';

/** Inert host/UI boundaries for the legacy note-only App callback harnesses.
 * Audio selection begins empty, text has no mounted pending editor, and no
 * cycle is enabled. Actual numeric flush, state and core operations supplied
 * by each fixture override these defaults. Audio/cycle behavior is exercised
 * separately by their dedicated core and UI integration tests.
 */
export function noteOnlyAppHarnessBoundaries() {
  const selectedAudioClipsRef = { current: new Set<string>() };
  return {
    projectUsesExternalAudio, renderNoteEvents,
    selectedAudioClipsRef, selectedAudioClips: selectedAudioClipsRef.current,
    selectedGlobalChord: undefined,
    primaryAudioClip: '', audioSelectionIssue: '', audioCopyIssue: '',
    audioClipboard: { current: undefined },
    setSelectedAudioClips: (ids: Set<string>) => { selectedAudioClipsRef.current = ids; },
    setPrimaryAudioClip: (_id: string) => {},
    clearAudioSelection: () => { selectedAudioClipsRef.current = new Set(); },
    flushActiveTextInput: () => true,
    lastSaveError: { current: '' },
    seekGeneration: { current: 0 },
    cycleEnabled: false, cycleRange: undefined,
    setLoop: (_enabled: boolean) => {},
    finishHeld: { current: () => {} },
    stop: () => {},
  };
}
