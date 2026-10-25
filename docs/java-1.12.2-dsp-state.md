# Java 1.12.2: directly observed native DSP state

One new, independent, zero-source process directly observed the original regular device, a legal regular mirror, and a loopback candidate. Their selected initial DSP fields match, including fields that the earlier log-only experiment could not establish. The real update-cycle and device-type differences remain. This is neither PCM equivalence nor a complete recording bridge; the old 49 normalized recordings remain excluded.

Evidence: [java-1.12.2-dsp-state.json](verification.md), SHA-256 `09ad1c3a8f341938256492d44c2b5ce56de1cf77470b49a704690cffbdba7fe3`. Strict consumer: `reviewLwjgl2122DspStateObserver()` in `scripts/review-lwjgl2122-dsp-state.mjs`. The previous [native-list observer](java-1.12.2-native-list-observer.md), [silent bridge](java-1.12.2-silent-bridge.md), original reports, recordings, exclusions and shared facts are unchanged.

## Binary provenance and manual roles

The actual fixture DLL is SHA-256 `9261b66010a845ddef9f61d5e4266fe2f08a53f3605da002e9e8f8d202bdbc5e`, 382,464 bytes. It matches the [official LWJGL repository binary at commit 2df01dd](https://github.com/LWJGL/lwjgl/blob/2df01dd762e20ca0871edb75daf670ccacc89b60/libs/windows/OpenAL64.dll) byte for byte. This is additional binary provenance, independent of the Minecraft metadata/native-archive checks already performed by the frozen inputs gate.

The [official OpenAL Soft binary directory](https://openal-soft.org/openal-binaries/) supplies a 1.15.1 Win64 release archive, but its `soft_oal.dll` is **different**: 417,320 bytes, SHA-256 `f42706c862bc3d66550eb0a929bd5cb195c7a1f6a181cc854d59fc124d771023`. The archive SHA-256 is `2f609c26383330db174cd3365a91f6d2d8e89ee111f3668789ec38487218e782`. Its version label cannot substitute for the shipped DLL or prove a reproducible build relationship.

The shipped PE is AMD64, MSVC linker version 9, timestamp `0x514ff603`, with no COFF symbols or debug directory. `scripts/lwjgl2122-dsp-binary.mjs` therefore uses manual roles, exported entries, direct machine-code calls, embedded function-name/configuration strings, PE exception-directory boundaries and exact code hashes. Internal role names are **not official debug symbols**. It checks 15 instruction anchors against the original DLL without executing it.

| Manual role | Actual shipped RVA | Evidence |
|---|---|---|
| `alcCreateContext` | `0x12440` | PE export; direct call at `0x1248a` targets `0x10df4` |
| `UpdateDeviceParams` | `0x10df4` | Original creator caller, embedded diagnostic names, exact routine bytes |
| `alcLoopbackOpenDeviceSOFT` | `0x1311c` | PE export; actual device initialization stores |
| `alcRenderSamplesSOFT` | `0x133d0` | PE export; call at `0x1340c` targets common mixer |
| `aluMixData` | `0x157e8` | Same direct target from loopback and ordinary-device backend |
| `MMDevApiProc` | `0x20198` | Containing PE runtime-function range; embedded `MMDevApiProc` diagnostics; its call at `0x202c8` targets `0x157e8` |
| Default resampler global | `0x5a000` | Original source initializer loads the global at `0xc02d`, then stores it at source offset `0x68` |

Official OpenAL source is pinned separately to release commit `9b6a226da55a987cb883f425eeb568776ea12c8d`. Its [context setup](https://github.com/kcat/openal-soft/blob/9b6a226da55a987cb883f425eeb568776ea12c8d/Alc/ALc.c), [device declaration](https://github.com/kcat/openal-soft/blob/9b6a226da55a987cb883f425eeb568776ea12c8d/OpenAL32/Include/alMain.h), and other source snapshots have independent hashes. The binary anchors support the specific roles and fields used here; an exact source-to-shipped-binary build is still unproved.

## The one native attempt

The sole attempt is `.local/lwjgl2122-dsp-state/run-1792805521203`, PID **73188**, terminal **exit 0**, signal null. The earlier `--prepare-only` directory compiled the agent and opened no context. No second native attempt was started after success.

The new Java agent retains the previous bounded observer design. Independent disassembly removes only three observation pairs from its new saved ALC10 class and restores all **42 original instructions**, including operands and branches; the observed method has 48 instructions. The original native device/pointer arguments and native instruction are retained. The observer does not flip, consume, rewrite or replace the original attribute buffer.

This process's original declared buffer is `[4103,44100,4104,60,4105,0,0]`, position/limit/capacity 7. Actual JNI pointer `2119527041372` is base `2119527041344` plus 28 and is still outside that allocation. Its complete native list was actually witnessed as `[0]` before and after the original call. This is an observation of this process, not a synthetic fallback or a claim about the older recordings. Instrumentation, native logging and memory allocations can perturb which surrounding words happen to exist.

Only after the original call returned did the probe copy that complete stable list into an independent legal allocation for the regular mirror. The loopback copy adds the required stereo/float/48 kHz format attributes. No unknown word was dropped from the witnessed list. The original context pointer `2119538082816` remained current at all five bridge checkpoints; final original SDK destruction made it zero. No extra context switch was requested by the observer. Original `AL.create()` still performs its own normal initial current-context setup.

## Bounded internal reads and actual values

The new internal reader first requires the exact shipped DLL hash. Offsets are bound to that DLL's instructions rather than assumed C structure packing. It uses `ReadProcessMemory` only on its own process, with 64-bit pointers/SIZE_T, 32-bit BOOL and an exact returned-byte-count check.

For each of original-before, mirror, loopback and original-after, the reader records two snapshots of each range:

| Range | Size | What is retained |
|---|---|---|
| Device `+0x00000` | `0x170` bytes | Full raw header, plus selected decoded fields |
| Device `+0x16190` | `0x80` bytes | Raw click-removal/tail fields, including default effect pointer |
| Module `+0x5a000` | 4 bytes | Actual global default resampler |

All **24 reads** succeeded with their complete requested sizes. Each selected-field snapshot pair was stable. The complete raw header and tail byte pairs were also stable in this run, but header bytes include synchronization/pointer fields that are not used as a cross-device equivalence test. The consumer independently decodes every raw snapshot, compares both passes, checks public ALC values against internal fields, and compares the original selected state before and after candidate creation.

| Directly observed state | Original regular | Regular mirror | Loopback candidate |
|---|---|---|---|
| Device type | 0 | 0 | 2 |
| Frequency / output channels / type | 48000 / stereo / float | Same | Same |
| Update size × count | 960 ×4 | 960 ×4 | 0 ×0 |
| HRTF pointer | 0 | 0 | 0 |
| BS2B pointer / level | 0 /0 | 0 /0 | 0 /0 |
| Wide-stereo bit | false | false | false |
| Default resampler enum | 1, linear | 1 | 1 |
| Actual driver source limits | 255 mono /1 stereo | Same | Same |
| Auxiliary sends / effect-slot limit | 4 /4 | Same | Same |
| Number of output channels | 2 | 2 | 2 |
| Channel offsets | `[0,1,-1,-1,-1,-1,-1,-1,-1]` | Same | Same |
| Speaker-channel array | `[0,1,0,0,0,0,0,0,0]` | Same | Same |
| Speaker-angle float bits | `[-1077342245,1070141403,0,0,0,0,0,0,0]` | Same | Same |
| Initial click-removal / pending arrays | All zero | Same | Same |
| Default effect-slot pointer | 0 | 0 | 0 |

All 20 selected format/DSP comparisons match. The consumer separately retains device type, update size/count and ALC refresh/sync differences. The observed driver limit does not establish a game SoundSystem voice pool: this probe calls original `AL.create()` directly and creates no game sources.

Native traces independently report HRTF and BS2B disabled in each setup. Both independent devices close successfully; native logs contain three context/device frees. All source/buffer/render-samples counters are zero at the instrumented SDK and permitted JNA API boundaries. The JNA allowlist contains no context-current setter. This accounting does not claim that the ordinary output backend never internally calls its zero-source mixer. JNA disposal is recorded; as in the earlier probe, a nonzero module handle after disposal is retained rather than claiming immediate DLL unmapping.

## What the source and binary establish

Tagged context setup has explicit regular-only HRTF and wide-stereo gates. The actual binary contains those gates and writes the observed pointer/flag offsets. Regular open reads BS2B configuration; loopback initializes its level to zero. The new direct runtime values rule out an unseen active wide/HRTF/BS2B/default-effect difference in this particular silent attempt. They do not prove future user configurations will match.

The [source initializer](https://github.com/kcat/openal-soft/blob/9b6a226da55a987cb883f425eeb568776ea12c8d/OpenAL32/alSource.c) supplies a shared linear default resampler. The actual shipped initializer reads its actual module-global enum; that runtime enum was 1 in all snapshots. No source was created, so the probe observes the default, not every source's selected resampling function or history.

The [ordinary MMDevAPI backend](https://github.com/kcat/openal-soft/blob/9b6a226da55a987cb883f425eeb568776ea12c8d/Alc/backends/mmdevapi.c) obtains device-sized output buffers and calls the mixer on a playback thread. The [loopback backend](https://github.com/kcat/openal-soft/blob/9b6a226da55a987cb883f425eeb568776ea12c8d/Alc/backends/loopback.c) has no equivalent timed output thread. Actual binary call sites reach the same common mixer, but their buffer lengths and invocation schedules differ. Sharing a mixer entry does not make those schedules equal.

The [mixing code](https://github.com/kcat/openal-soft/blob/9b6a226da55a987cb883f425eeb568776ea12c8d/Alc/ALu.c) consumes pending source/listener updates when mixing, splits work into bounded chunks, and carries click-removal state. Initial zero arrays say nothing about state after note onsets, overlapping sources, updates or chunk boundaries. This is the remaining practical gap, even though the selected initial DSP fields now agree.

## Next gate and verification

The evidence narrows the next experiment: repeated static configuration queries are no longer useful for this machine's default silent case. A new recording bridge must observe the **ordinary device's own mixed output** and actual callback lengths/order, together with source/listener/update timing, without substituting the native context list. The binary provides concrete caller/mixer RVAs for designing a bounded observer. No detour, trampoline, output-buffer hook, system-audio capture or PCM bridge was implemented here. A hook would first require its own instruction-restoration/ABI/lifetime proof and explicit checks that it does not change parameters or mix scheduling.

Nonzero regular-output PCM and independently reproduced loopback PCM under the observed sequence would then be compared. Unknown differences, unstable native lists, changed DSP fields or unavailable observations must remain failures or unresolved boundaries. Neither a matching silent state nor the old normalized PCM may satisfy that next gate.

`node scripts/review-lwjgl2122-dsp-state.mjs` passes and launches no context. `node scripts/verify-lwjgl2122-dsp-state.mjs` passes all **20 negative fixtures**, including invented internal resampler/wide-stereo values and changed binary offsets/routine hashes, in addition to the original nine pure-memory rules. Validation results are `.local/lwjgl2122-dsp-state/validation-1792805593353/results.json`; this verification launches no native context. The raw process, ABI/module identities, 24 binary snapshots, primary-source caches, actual disassembly and all cleanup records remain independently hash-bound. This work creates seven new public files only:

- `scripts/audit-lwjgl2122-dsp-state.mjs`
- `scripts/review-lwjgl2122-dsp-state.mjs`
- `scripts/verify-lwjgl2122-dsp-state.mjs`
- `scripts/lwjgl2122-dsp-binary.mjs`
- `scripts/java/Lwjgl2122DspStateObserver.java`
- `docs/evidence/java-1.12.2-dsp-state.json`
- this document

There are zero new accepted world scenes, no product/shared-fact changes and no promotion of the excluded 49.
