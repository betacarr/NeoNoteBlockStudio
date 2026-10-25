# NBSX project format, version 2

`.nbsx` is a ZIP container with `mimetype`, `project.json` and optional `assets/<asset-id>` entries. The MIME value is `application/vnd.exnoteblock.project+zip`. Asset filenames are IDs rather than untrusted external paths. Loading is in-memory with traversal, compressed-size and expanded-size checks.

New files have `format: "nbsx"` and `version: 2`. The reader migrates version-1 manifests in memory and writes version 2 on the next save; existing files are not changed merely by opening them. Unknown versions are rejected. Earlier version-1-only editors reject these new files rather than shallow-copying MIDI messages they do not understand. Object IDs are unique throughout a project, including retained MIDI messages. Tracks and regions refer to stable IDs, never positions in an array.

## Musical model

- `ppq`: integer ticks per quarter note. MIDI import preserves its original PPQ.
- FLP import also preserves source PPQ and note duration. Playlist copies become independent patterns with original region start/offset/length; mixed source channels split into separate tracks.
- `tempos`: sorted `{tick, bpm}` events, including tick zero. Seconds are calculated piecewise across tempo changes.
- `timeSignatures`: `{tick, numerator, denominator}` events, optionally retaining MIDI metronome and thirty-second-note fields.
- `tracks`: names, colours, default instrument, volume, pan, mute/solo and edit lock, plus MIDI source association.
- `patterns`: note content, a musical period (`length`) and optional retained `midiEvents`.
- `regions`: track and pattern references, absolute start, range, offset and an explicit loop switch.
- Ordinary copies receive a new pattern and new note IDs. There is no implicit linked-copy mode.

Notes contain `tick`, `duration`, MIDI pitch, velocity `[0,1]`, pan `[-1,1]`, detune in cents, a vertical preview parameter and optional instrument override. Duration can be zero for a same-tick MIDI note. Optional `midiSource` retains original on/off order, release velocity and cross-track note-off association. `duration` describes musical/editing information and MIDI note-off timing; it never gates a vanilla sample. Looping repeats note-on events and allows sample tails to overlap.

Each retained MIDI message has an ID, local `tick`, source `order`, optional `sourceTrack`, and a validated MIDI event object with `deltaTime: 0`. Byte payloads are ordinary numeric arrays. Messages follow region start, offset, length and loop period. End-boundary releases are retained; an earlier loop's final messages precede the next loop's initial messages. An optional region boolean `midiEndExclusive` marks a split-created left range: retained messages exactly at its right boundary are excluded from that occurrence, while note durations and generated note-offs remain complete. Absent/false keeps the previous inclusive retained-message endpoint. The right half inherits the previous endpoint rule. This prevents duplicate boundary controllers, SysEx and meta events without deleting them from either complete source. The flag survives save/open and region copy/paste. Ordinary region copies receive independent note metadata, message IDs and payload arrays. Tempo and meter remain project-level events.

## Instrument conventions

`rootMidi` is the pitch at which a sampler plays the original sample without rate change. Playback rate is `2^((midi - rootMidi + detune/100)/12)`.

OpenNBS's custom sound-key is a transposition convention. It is converted using `rootMidi = 111 - nbsSoundKey`, with inverse conversion on NBS export. The default NBS key 45 maps to MIDI 66. This avoids reversing the tuning of imported custom instruments.

## Resources and provenance

Assets declare ID, name, MIME type, optional external reference and optional SHA-1. Binary data resides in ZIP entries. Runtime code may hold a base64 `data` field, but the serializer removes it from JSON and writes the corresponding binary entry.

FLP imports use `provenance.kind: "flp"`; `metadata.sourceAssetId` references an embedded `application/x-fl-studio-project` asset. Its exact bytes are mandatory on save/open. Metadata retains source SHA-256, version/PPQ/BPM, mapping choices, raw channel parameters and skipped-content summaries. This archive does not imply reconstruction of FL plugins or automation. See [FLP import](flp-import.md).

The portable-save option embeds the game samples actually used by the song. A MIDI import always embeds its exact original bytes in an `audio/midi` asset. The optional root `midi` record has its own `schema: 1`, original format, `sourceAssetId`, source track names and conductor messages. This archive is required to be present when a project claims to retain it. The original file can be saved independently from the editor. MIDI controllers, bends, pressure, lyrics, SysEx, unknown meta messages and safety releases are retained with their musical content. They are not continuous-control UI or note-block playback automation.

Older version-1 MIDI projects may only contain Tonejs source JSON in `provenance`; the compatibility exporter keeps that saved information but cannot reconstruct data absent from the old file. Source NBS metadata and special functional events remain in `provenance`. Recognised `Tempo Changer` events become native tempo events. Unrecognised functional instruments are reported for review.

Audio configuration records the requested profile, sample rate, master gain, directionality, preview engine and studio/vanilla mode. A selected profile ID is not a certificate of accuracy: measured compatibility belongs to a separate evidence registry.

No redstone layout model is defined. A preview coordinate is not a physical placement or proof of buildability. Future generation must preserve musical intent separately from generated structure data.

## Compatibility exports

NBS export flattens regions and loops, integrates musical tempo into absolute onset times, quantises to the chosen NBS grid, allocates extra layers for simultaneous notes and reports relevant loss, including MIDI messages and unsupported meter metadata. NBS stores neither note duration nor vertical preview position.

Edited MIDI export uses SMF format 1. Editor channel splits from one source track merge back into the source stream so same-tick program/bank, SysEx and note-off order stays meaningful. Channels remain distinct, and new editor tracks create separate MIDI streams. Track names are regenerated as UTF-8, and running-status/note-off byte encodings are canonicalised. This is a semantic export; the separately archived original file provides the exact-byte copy. SMPTE timing and independent format-2 sequences are explicitly rejected on import. Per-note note-block rendering parameters remain in NBSX. See [MIDI verification](midi-interop.md).
