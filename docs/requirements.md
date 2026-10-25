# EX NoteBlock Studio: agreed product scope

Updated 2026-10-25. User decisions supersede implementation defaults.

- A new desktop application using a web UI; rewrite the application, reference OpenNBS rather than port its UI.
- Windows first, retain an architecture suitable for macOS. MIDI import is the principal entry workflow; NBS import and export are required interoperability paths. MIDI export is required.
- Project extension: `.nbsx`, a versioned portable container distinct from `.nbs`.
- Logic Pro-style arrangement, inspector, piano roll and mixer. Default mouse/key behaviour follows an FL-style preset; provide other presets and editable bindings.
- Single-note properties in the first phase. No automation curves. Note display length never truncates a vanilla sample; retain duration for MIDI and future semantics.
- Java Edition only. Research audio-relevant changes across released versions; snapshots and prereleases are excluded. Track game logic, native audio backend, samples, instruments and settings independently. Do not label unverified versions as accurate.
- Preview spatial scope is the left/right and up/down plane; front/back movement is excluded. Prioritise editor parameters, not freely placed sound sources.
- Warn about voice pressure rather than reproducing lag or dropping notes to imitate an overloaded client.
- Warn when a pitch requires a resource pack or mod. Specific mod integrations are future work.
- Future generation targets physical in-game redstone music, but generation algorithms, layout, build constraints, listening positions and construction legality are deliberately undecided. Do not implement a structure generator or claim acoustic feasibility proves buildability.
- Sound acceptance is measurements against in-game recordings, with version/settings/sample provenance. Mathematical tests or same-library comparisons alone do not prove game equivalence.
- Track default instrument with per-note override is the working default (explained to user). All region copies are independent. Looping is an explicit mode within a region; no linked-copy workflow.
- MIDI recording, audio reference waveform, autosave/recovery, meaningful undo/redo, per-note volume/pan/detune, instrument selection and project round trips belong to the editor workflow.

## Latest priority — 2026-10-24

The user explicitly asked to focus on editor optimization and advance the sound engine gradually later. Prioritize the piano roll, arrangement interaction, FL mouse gestures, selection/editing consistency, navigation, performance and the complete MIDI-to-save/export workflow. Defer further audio-version/settings research and matrix expansion; do not make that research a prerequisite for editor delivery. Fix audio defects promptly only when they block normal preview or export. Structure generation remains deferred. This changes the work order; it does not declare unfinished audio scope complete.

The active goal also asks to prioritize existing open-source DAW approaches and learn from community experience. Record official interaction rules, fixed implementation references and dated user reports separately from this application's own decisions. A single community report is a usability signal, not a survey or proof of every current release. First applied to cross-track arrangement movement in 0.1.42; see [reference notes](daw-arrangement-reference.md).

0.1.43 extends arrangement selection to multiple regions: view-only marquee/Shift selection, one shared time/visible-row delta, atomic rejection of hidden/locked/invalid members, independent group duplication and deletion, and selection-aware Undo/Redo. Per-region inspector attributes and trims remain single-target. See [group workflow](arrangement-groups.md).

0.1.44 adds focus-aware note/region Copy/Cut/Paste, cross-document beat-resolution conversion and portable resources, independent complete-source copies, and one transaction for new tracks/resources/regions. On 2026-10-25 the user confirmed automatic tail-track creation when destination rows are insufficient, inheriting source settings for the new tracks; existing target settings remain. The earliest source onset aligns to the snapped playhead, the top source row to the selected destination. Original row gaps remain; the pasted primary stays in that first row for stable repeated paste. See [region clipboard](region-clipboard.md).

0.1.45 follows the user's 2026-10-25 export decision: NBS TPS is calculated from the starting BPM, with BPM/7.5 as default and BPM/5 as an optional preset (150 or 100 BPM respectively map to 20 TPS). Export performs conversion/check/save from one action; blocking failures are reported inline, conversion warnings do not require a separate approval. See [export workflow](export-workflow.md).

0.1.46 adds splitting at the playhead: independent full sources on both sides, unchanged loop period/phase and note durations, right-side ownership of cut-point MIDI expressions, atomic refusal of locked/hidden/invalid groups and selection-aware Undo/Redo. Playback may continue; no merge, mouse-cut tool, note splitting or structure generation is implied. See [region splitting](region-splitting.md).

0.1.47 follows the user's request to refer to NBS's actual MIDI-import logic: fixed musical spacing and floor placement, not a rounded-TPS seconds round trip. This application retains its selected 8/12-tick presets; 12 is a project preset, not an asserted upstream precision-menu option. Genuine subdivisions and format/player limits remain explicit; the user did not authorize an automatic LCM or lossless-grid escalation policy. See [NBS musical timing](nbs-musical-timing.md).

0.1.48 continues the editor-improvement goal with visible-neighbor track ordering and undoable current-track deletion. Arrangement and mixer share document order, implicit MIDI channels are preserved across index changes, archival source routing remains intact, and deletion keeps shared sources and portable assets. This is an editor organization increment, not a new generation or audio-engine scope. See [track management](track-management.md).

0.1.49 preserves MIDI dynamics during multi-note velocity dragging: one relative delta constrained at the whole selection's 0/1 boundary, with single-note absolute placement and the inspector's uniform absolute setting retained. A stationary multi-selection click does not edit. Minimum-pixel note geometry is shared by point/marquee/erase hit tests at full-range zoom. See [velocity editing](note-velocity.md). Further editor audit findings remain tracked rather than declared complete in [the follow-up audit](editor-quality-followups.md).

0.1.50 adds one final note-edit transaction boundary for canvas, keyboard and inspector updates, complete rejection before document writes, fresh numeric-draft gesture entry and project/history ownership for held piano gestures. Valid recording-appended numeric drafts remain supported; stale ordinary callbacks reject. See [note-edit transactions](note-edit-transactions.md). The overall editor-improvement goal remains active for complete-workflow audit.

0.1.51 closes the current editor-workflow audit: Inspector velocity/pan drags retain continuous temporary preview and one release transaction; valid drafts and rejected native input remain safe. MIDI loop-message export now visits actual included occurrences. Current MIDI/NBS/FLP import, edit/history, complete save/reopen and export files are independently checked; historical physical and untested device/platform scopes retain their qualifiers. See [workflow audit](editor-workflow-audit.md). This does not complete the deliberately deferred audio matrix or structure generation.

## Sources to inspect

- OpenNBS / NoteBlockStudio: https://github.com/OpenNBS/NoteBlockStudio (reference commit `7dd79ecb313d981c12bc4b69ad13201c4995a3ae` inspected).
- NBS format: https://noteblock.studio/nbs
- Independent NBS interop oracle: https://github.com/OpenNBS/nbs.js
- MIDI reference: https://github.com/Tonejs/Midi
- Offline audio reference: https://github.com/OpenNBS/nbswave
- Native backend: https://github.com/kcat/openal-soft

Game binaries, decompiled code, original samples and machine-specific filesystem inventories stay in ignored local research storage. Shipping code describes independently implemented behaviour and records evidence; no game runtime is bundled into the editor by default.
