# Java 1.12.2: one independent silent context bridge candidate

One fresh process successfully preserved the original regular `AL.create()`/JNI call, observed its complete stable outside-buffer native list, copied that list into a valid independent allocation, and created both a legal regular mirror and a separate loopback context. This establishes feasibility of that bounded experiment. It does **not** establish original-context equivalence, a game recording bridge, waveform equality, or measured world coverage.

Evidence: [java-1.12.2-silent-bridge.json](verification.md), SHA-256 `b5d59d2ad854b412b829c197ed25d3142c9860247bcf9e5b597292424ebccd81`. Strict entry point: `reviewLwjgl2122SilentBridge(filename?)` in `scripts/review-lwjgl2122-silent-bridge.mjs`, SHA-256 `f4a2d376913239b09892870ff67a5435d61d3433e6fd3e94d6859570e3b63d28`.

The sole native attempt is `.local/lwjgl2122-silent-bridge/run-1792803708663`, PID **61068**, terminal **exit 0**, signal null. The earlier compile preflight and `--prepare-only` directory opened no OpenAL context. No additional native attempt was started after this result. The source/buffer/render-samples application-call counters are zero; there was no game, audio rendering, system-audio recording or world capture. The old 49 normalized recordings remain excluded. The six frozen files of the previous [native-list observer](java-1.12.2-native-list-observer.md), all older reports, original recordings, shared facts, generators and product files are unchanged.

## Original call and observed list

The new Java agent instruments the original `org/lwjgl/openal/ALC10.alcCreateContext(ALCdevice,IntBuffer)` with three observation pairs. Entry observes the original Java buffer through a duplicate. Immediately before original `nalcCreateContext(JJ)J`, `DUP2` exposes its actual pointer argument without replacing it. Immediately afterwards another `DUP2` exposes the original return value and permits a second snapshot. The original device and pointer arguments and native invocation remain intact. Managed observation failures are caught in these callbacks and make the subsequent bridge unavailable; the bridge eligibility check runs only after the original call has executed.

Strict review independently disassembles this new agent's saved original and observed ALC10 classes. Removing the three declared pairs restores all **42 original instructions**, their operands and branch targets; the observed method has **48 instructions**. This proof is independently bound to the new source/JAR/raw class hashes. It does not reuse an assertion about the old recorder's normalization helper.

The declared backing allocation remains:

```text
[4103,44100,4104,60,4105,0,0]
position = limit = capacity = 7
```

The actual JNI pointer is still base+28, outside that allocation. Bounded `ReadProcessMemory` observations at that exact argument address produced the same 15 integers before and after the original native call:

```text
[657,-19377792,
 657,-747655153,
 -1878940271,-5974224,
 657,-5142240,
 657,-5975264,
 657,-5143200,
 657,0,
 0]
```

This run therefore contains actual repeated unknown keys and a zero **value**, followed by a separate zero **key** terminator. The observer retains all of them. It reads at most 257 integers, distinguishes a zero key from a zero value, checks each read succeeded with four bytes transferred, and records termination or unavailability explicitly. The original call returned a nonzero context. Neither its unknown first word nor the empty Java remaining range was used to reject or rewrite that call.

The legal regular mirror received the complete 15-integer list verbatim in a new 60-byte native allocation. The loopback received a separate 84-byte allocation containing the same seven original pairs, in order, followed only by:

```text
6544,5377, 6545,5126, 4103,48000, 0
```

These are stereo channels, float sample type and 48 kHz. They were missing from the observed list, so they were appended. The transformation also handles existing recording keys by replacing **every** corresponding value, including duplicate occurrences. It never changes other pairs, reorders keys, removes duplicates or converts an unavailable list into `[0]`. `[0]` is accepted only as an explicitly witnessed terminated input in the pure-memory tests; it was not the native list in this attempt.

## Independent contexts and actual results

All new ALC functions come from the actually loaded original `OpenAL64.dll`. The two loopback extension addresses are obtained from that same DLL's `alcGetProcAddress`. Strict review verifies every recorded function pointer lies inside that loaded PE image. No API is borrowed from a different OpenAL driver.

The original context remains current while the new contexts exist. The Java SDK's original context is not replaced by either mirror, and the new JNA dispatch has no `alcMakeContextCurrent` operation. The five recorded checks—before the bridge, after each new context, before cleanup and after bridge cleanup—all return the original pointer `2824733230080`. After original `AL.destroy()` the observed current pointer is zero. These are explicit checkpoints; this audit does not claim a continuous native-internal pointer trace.

| Actual state | Original regular | Legal regular mirror | Loopback candidate |
|---|---|---|---|
| Full attribute query | `[4103,48000,4104,50,4105,0,4112,255,4113,1,131075,4,0]` | Identical to original | `[4103,48000,6544,5377,6545,5126,4112,255,4113,1,131075,4,0]` |
| Native post-reset format | Stereo, Float, 48000 Hz | Stereo, Float, 48000 Hz | Stereo, Float, 48000 Hz |
| Native update size/count | 960 ×4 | 960 ×4 | 0 ×0 |
| Actual mono/stereo source limits | 255 /1 | 255 /1 | 255 /1 |
| Actual auxiliary sends | 4 | 4 | 4 |
| Native HRTF trace | disabled | disabled | disabled |
| Native BS2B trace | disabled | disabled | disabled |
| Wide-stereo lookup | key not found | key not found | no corresponding lookup logged |
| Context/device cleanup | original SDK destroy; native FreeContext/FreeDevice | destroy; close returned true | destroy; close returned true |

The original regular attribute query is repeated after both new contexts are created and remains unchanged. The regular mirror's same attribute words are a result of this experiment, not an inheritance rule for future devices or releases.

The loopback's different attribute shape is real. It exposes channel/sample type in place of regular refresh/sync. The [official ALC_SOFT_loopback specification](https://openal-soft.org/openal-extensions/SOFT_loopback.txt) defines this distinction and requires all three recording format/rate attributes; the exact actual arrays remain separate in the evidence. The zero loopback update size/count is likewise retained as a native log observation rather than silently treated as the regular device's 960 ×4 update cycle. No render call was made to advance its mixer.

Wide-stereo and the selected resampler enum were not directly read from internal binary state. The official tagged source contains a regular-only wide-stereo branch with a false default; the actual regular logs report its configuration lookup missing, while the loopback log has no such lookup. This is a distinction between source reasoning and runtime observation. HRTF and BS2B, in contrast, have explicit disabled messages from the actual DLL in each context-creation stage. No unobserved DSP difference is asserted, and no matching DSP messages are treated as proof of waveform equivalence.

## Zero-source scope and cleanup

New counters instrument public source/buffer-related wrappers in the original AL10/AL11 classes. Their original and transformed class/method Code identities are retained. Both observed SDK counters remain zero. The probe's separate JNA ALC dispatch uses an explicit silent-operation allowlist and a per-function call ledger. It never binds or invokes a source/buffer API or `alcRenderSamplesSOFT`; its corresponding application-call counts remain zero as well. This is application/SDK-boundary accounting, not interception of every function inside the DLL.

The native log records exactly three context creations, three FreeContext messages and three FreeDevice messages. Both independently opened devices return true from `alcCloseDevice`. The original SDK context/device is destroyed last. These actions and the process terminal record are all preserved.

One lifetime detail must remain explicit: after original SDK destruction, JNA's library disposal and current-context zero, `GetModuleHandleW` still returned a nonzero OpenAL module base. This experiment therefore does **not** claim the DLL had already unmapped at `dispose()`. The JVM then exited 0. The observer did not replace this observation with an assumed unload result or start another process to obtain a different result.

## Source, ABI and provenance

The new strict consumer rechecks official 1.12.2 metadata/client identities, Windows-selected LWJGL 2.9.4-nightly-20150209 and native archive identities, every fixture classpath artifact, and the previous source audit. Actual audio-module paths match the official fixture artifacts:

- OpenAL64.dll SHA-256: `9261b66010a845ddef9f61d5e4266fe2f08a53f3605da002e9e8f8d202bdbc5e`.
- lwjgl64.dll SHA-256: `ebdcedbc3e24b911aacd7bb666ab426397ca7d7883a8d4e3cf28946041c95425`.

The Windows x64 binding uses 8-byte pointers/SIZE_T and 4-byte C longs; BOOL and ALC integer APIs are handled separately from the byte-sized ALC boolean return type. Function addresses, actual JVM and Kernel32 module hashes, JNA artifact identity, native dispatch hash, byte order and process architecture are retained. JNA and ASM instrumentation identities are explicit; shared native-library hashes are not used to inherit a context result from another game version.

Three independent primary-source snapshots are hash-bound under ignored `.research/lwjgl2122-silent-bridge`:

- [Alc/ALc.c at official release commit 9b6a226](https://github.com/kcat/openal-soft/blob/9b6a226da55a987cb883f425eeb568776ea12c8d/Alc/ALc.c), SHA-256 `091b855db93d8f2ee8d5f52186071339614b1ed51276729e0538260d3d714a85`.
- [The same release's alext.h](https://github.com/kcat/openal-soft/blob/9b6a226da55a987cb883f425eeb568776ea12c8d/include/AL/alext.h), SHA-256 `5232aa9d524113d74ee7554bd989f39d6e2615c3a34b69bac96b636aba53e409`.
- [The official loopback specification](https://openal-soft.org/openal-extensions/SOFT_loopback.txt), snapshot SHA-256 `633c0b63fe1e6dbae3b8a7041c6ead134c7eff196cdb94ce7ec698cf07ae754c`.

Tagged source semantics and actual original DLL execution retain separate scopes. An exact reproducible binary build mapping from that tag to the shipped DLL is not established by the runtime version string.

## Verification, limitations and files

Nine pure-memory cases run before the original AL call. They reject null, empty, unterminated and early-zero-key input; retain zero values and unknown repeated keys; rewrite every duplicate recording key; append only absent recording keys; and check the input is not mutated. Their actual Java inputs/results are stored alongside the native run and compared with hardcoded expectations by the independent consumer.

```text
node scripts/review-lwjgl2122-silent-bridge.mjs
node scripts/verify-lwjgl2122-silent-bridge.mjs
```

Strict review passes. All 16 corrupted-evidence fixtures are rejected, including invented equivalence/world promotion, changed original arguments or pointer, fabricated/collapsed native lists, accepting null as `[0]`, changing an unknown pair, nonzero source/render counters, a changed current context, incorrect module identity, missing terminal status and a missing source closure. Validation results are `.local/lwjgl2122-silent-bridge/validation-1792803760490/results.json`. Review and negative checks open no context.

The actual pointer is still outside its declared Java allocation. Matching before/after lists cannot prove every intermediate native dereference or eliminate instrumentation-induced allocation changes. This process's endpoint, effective attributes and DSP messages cannot be projected onto another process, the old recorder or an unobserved machine configuration. There are no samples, source positions, decoded notes, mixer advancement, sound onset, regular-versus-loopback PCM comparisons or musical scheduling results here. The next stage, if authorized separately, would need an independently reviewable recording bridge and new recordings; the previous 49 recordings cannot supply this missing per-process evidence.

New files only:

- `scripts/audit-lwjgl2122-silent-bridge.mjs`
- `scripts/review-lwjgl2122-silent-bridge.mjs`
- `scripts/verify-lwjgl2122-silent-bridge.mjs`
- `scripts/java/Lwjgl2122SilentBridge.java`
- `docs/evidence/java-1.12.2-silent-bridge.json`
- this document

The native result remains a **bridge candidate**, with `equivalenceProven=false`, zero new world scenes and no promotion of the old 49. No product build, common-fact update, original-recording edit, release or commit was performed by this work.
