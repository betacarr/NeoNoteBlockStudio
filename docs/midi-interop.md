# MIDI import, arrangement and interoperability

The principal workflow is MIDI -> editable project -> NBSX save/reopen -> edited MIDI or NBS export. New projects use NBSX version 2; version-1 projects remain readable. This work does not close the overall editor/audio goal.

## Verified evidence

[Independent comparison report](verification.md): 24 inputs, comprising two hand-encoded regression files and 22 public Tonejs/Midi example/test files, with 58,730 displayed notes in total. The corpus snapshot is `1d3a1f539a2de55a448687285a393bc3aff7da1a`. Original files stay in ignored local storage; the committed report contains paths, hashes, counts and metrics, not the music files.

Mido 1.3.3 independently reads each source and the editor's export after NBSX save/reopen. All cases pass PPQ, final tick, semantic-message multiset and same-tick per-channel/SysEx ordering comparisons. Normalisation excludes regenerated track names, note-off byte encoding and running-status encoding, adds standard initial tempo/meter defaults, and resolves same-tick tempo/meter state to the last value. Port prefixes are checked through the routing assigned to messages. The embedded original file is compared byte for byte separately.

The hand-coded unit cases additionally cover independent region copies, message-payload isolation under undo transactions, loops, terminal pedal releases, zero-duration notes at a bar boundary, cross-track note-offs, separate ports with identical channels/pitches, unknown file chunks, incomplete input, absent source assets, v1 migration and MIDI-to-NBS loss reporting. Full desktop integration coverage is recorded in the implementation status.

## Behaviour

- Import separates original tracks by MIDI channel, rather than splitting a sustained note when its program changes. Repeated notes pair FIFO within their source voice first; cross-track releases retain their original association. MIDI ports keep their program and note states separate.
- Program changes remain in the source stream. The first sounding program suggests a note-block track instrument; later changes can produce per-note overrides. General MIDI playback, bank-specific synthesis and continuous automation are not emulated by note-block preview.
- Controller, bend, pressure, SysEx, lyric/text, port/prefix, unknown metadata and extra safety-release messages follow copied/moved/looped regions. Tempo, meter and conductor information remain project-level data. No automation-curve UI is introduced.
- Edited MIDI uses format 1 and preserves source-stream ordering. Channel splits from one source stream merge back when exporting. MIDI GM programs and the editor's note-block sound mapping are separate; per-note rendering parameters stay in NBSX.
- Original MIDI bytes can be saved from the File menu or Project settings. Unknown non-track chunks are retained in this original archive and reported as absent from the edited standard export.
- Truncated chunks/events, malformed timing and excessive event counts fail before a partial arrangement is adopted. SMPTE division and format-2 independent sequences require conversion first. Missing note endings are repaired with a warning; unmatched safety-release messages are retained.
- NBS conversion reports unsupported MIDI expression/text messages and meter metadata. Musical note duration continues to leave original Minecraft sample tails untouched.

## Reproduction

```powershell
git clone https://github.com/Tonejs/Midi.git .local/midi-fixtures/tonejs
git -C .local/midi-fixtures/tonejs checkout 1d3a1f539a2de55a448687285a393bc3aff7da1a
python -m venv .local/midi-check-venv
.local/midi-check-venv/Scripts/python.exe -m pip install mido==1.3.3
node scripts/verify-midi-interop.mjs --python .local/midi-check-venv/Scripts/python.exe --write-evidence
npm test
node scripts/smoke-midi-desktop.mjs --packaged "release/0.1.51/win-unpacked/EX NoteBlock Studio.exe" --expected-version 0.1.51
```

The verifier requires the fixture checkout and an available Python/Mido installation. Omitting `--python` uses the current `python` command. Each run has an independent output directory; success requires a fresh oracle report and a zero process exit, so a failed dependency launch cannot reuse a previous pass. It records the actual source commit and code hashes; comparison failures write their local report before exiting nonzero. It does not download or rewrite user projects. Regenerated track-name encoding is covered by separate UTF-8/Chinese-name checks rather than the semantic multiset comparator.

0.1.51 reruns all24 inputs after fixing large-offset loop-message export. The packaged runner now waits for the actual editor rather than Minecraft sample loading, verifies five complete ZIP/JSON saves over two sessions/restart, and binds the tested package to the current five built entries. Original MIDI uses existing menu IPC in that runner; the visible self-drawn File-menu action and actual standard MIDI export panel are separately exercised through the browser. Two composite GUI exports additionally match exact ordered Mido messages including track names; edited velocity is the sole intended MIDI difference. [Current workflow evidence](verification.md), [audit and limitations](editor-workflow-audit.md).

References: [MIDI Association SMF resources](https://midi.org/standard-midi-files), [Mido file API](https://mido.github.io/mido/files/midi.html), [Tonejs/Midi source corpus](https://github.com/Tonejs/Midi/tree/1d3a1f539a2de55a448687285a393bc3aff7da1a/test/midi), [midi-file parser/writer](https://github.com/carter-thaxton/midi-file).
