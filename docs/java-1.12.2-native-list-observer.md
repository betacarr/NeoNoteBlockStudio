# Java 1.12.2: fresh original native-list observations

The actual JNI argument can now be observed through a bounded, safely readable, terminated native list while leaving the original regular-device call unchanged. Four fresh silent calls completed successfully. Their lists differed between processes: `[0]`, 19 integers, seven integers, and `[0]`. Each successful call had the same complete list immediately before and after its native invocation. This is new evidence about those individual invocations; it does not repair the missing evidence in the old 49 normalized-loopback recordings or establish a valid allocation contract for the outside-buffer address.

The frozen independent evidence is [java-1.12.2-native-list-observer.json](verification.md), SHA-256 `550d1607ede345796de4984cd4f917505fecd55cb878f3f09c768df720fbdf8d`. Strict review is exported as `reviewLwjgl2122NativeListEvidence(filename?)` from `scripts/review-lwjgl2122-native-list.mjs`. Classification remains **observer-only original regular context**, with zero added world scenes and `archived49Promoted=false`.

The previous [context correction](java-1.12.2-context-correction.md), old six-class audit, 49 recordings, capture agent, original reports, source reports, exclusion evidence and shared facts are unchanged. In particular, no fresh `[0]` observation can be projected backwards onto an archived recording.

## Original identities and Windows ABI

The new reader independently rechecks the [official 1.12.2 metadata](https://piston-meta.mojang.com/v1/packages/832d95b9f40699d4961394dcf6cf549e65f15dc5/1.12.2.json), the selected Windows dependency artifacts, every fixture classpath entry, the original ALC10 class and method, and the actual loaded audio-module paths. It also strictly consumes the existing six-class/twelve-method source audit. It does not choose dependencies by comparing DLL hashes with another Minecraft release.

| Original artifact | Verified identity |
|---|---|
| Official metadata SHA-1 | `832d95b9f40699d4961394dcf6cf549e65f15dc5` |
| Original client SHA-1 | `0f275bc1547d01fa5f56ba34bdc87d981ee12daf` |
| LWJGL 2.9.4-nightly-20150209 Java artifact SHA-1 | `697517568c68e78ae0b4544145af031c81082dfe` |
| Selected Windows native archive SHA-1 | `b84d5102b9dbfabfeb5e43c7e2828d98a7fc80e0` |
| Original OpenAL64.dll SHA-256 | `9261b66010a845ddef9f61d5e4266fe2f08a53f3605da002e9e8f8d202bdbc5e` |
| Original lwjgl64.dll SHA-256 | `ebdcedbc3e24b911aacd7bb666ab426397ca7d7883a8d4e3cf28946041c95425` |

Both PE headers are AMD64 (`0x8664`). The actual running JVM reports Windows/amd64, 8-byte pointers, 4-byte C longs and little endian. Its executable and loaded `jvm.dll` are hashed. The observer uses the fixture's official JNA 4.4.0 artifact; the actual temporary `jnidispatch` binary is hashed before exit and matches that JAR's `com/sun/jna/win32-x86-64/jnidispatch.dll` resource. ASM 9.7.1 is separately identified as research instrumentation, not a game dependency. The original Paulscode-to-AL.create chain is source-bound; this silent component runner calls original `AL.create()` directly and does not initialize a complete SoundSystem pool or game world.

The read binding explicitly targets the [Microsoft x64 ABI](https://learn.microsoft.com/en-us/cpp/build/x64-calling-convention?view=msvc-170): pointer/handle/SIZE_T arguments are 64-bit and BOOL is 32-bit. It reads only its own process through [GetCurrentProcess](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-getcurrentprocess) and [ReadProcessMemory](https://learn.microsoft.com/en-us/windows/win32/api/memoryapi/nf-memoryapi-readprocessmemory). Each four-byte read requires success and an exact four-byte transfer. An unreadable address records an explicit failure instead of using an unchecked Java pointer dereference. This safety applies to the observer, not to the unchanged original native parser.

## Observation timing and bounds

The observer adds exactly three instruction pairs to original `ALC10.alcCreateContext(ALCdevice,IntBuffer)`:

1. At entry, `ALOAD 1` and the observer call record position/limit/capacity, base address and full backing contents through a duplicate. The original buffer is not consumed, flipped, rewound or replaced.
2. Immediately before original `nalcCreateContext(JJ)J`, `DUP2` and a callback observe the actual top-of-stack pointer argument. The original device and pointer stay on the stack, and the original native instruction executes unchanged.
3. Immediately after that instruction, `DUP2` and a callback record its original return value and take a second snapshot at the same address. The original return value remains available to subsequent original instructions.

The strict helper disassembles both saved original and instrumented classes, removes only these three declared pairs, and checks all 42 original instructions against the resulting stream, including operands and branch targets. The transformed method has 48 instructions. No extra argument store or conditional native-call rejection is introduced.

Each snapshot reads at most 257 integers: up to 128 key/value pairs and the next key. A zero is a terminator only at an even, key position. A zero value is retained and does not stop the reader. Separate states record zero-key termination, safety-bound exhaustion, unreadable memory and a null pointer. The reader's self-checks exercise zero value followed by zero key, bound exhaustion and an unreadable null address. Strict review requires an observed terminator and identical before/after lists for the final successful result. It does not accept an exhausted bound as a complete list.

The fixed-size memory-mapped journal is allocated before the original AL call and records each stage without serializing properties inside the immediate before/after callbacks. It retains the complete observed words even when a later stage fails. Normal JNA Function invocation still allocates Java argument objects and can change timing or allocation layout. Instrumentation, journal setup and native logging can also change allocation placement. These effects are explicit limitations: matching two snapshots cannot prove every intermediate native read or an unobserved archived process's contents.

In every successful observation, the declared backing buffer remains `[4103,44100,4104,60,4105,0,0]` at position=limit=capacity=7. The actual JNI argument remains base+28, outside that declared allocation. These are two different lists. The new measurements do not turn that outside-buffer access into defined Java buffer behavior.

## Actual process results

All attempts have terminal `process.json` records, complete console logs, compiled-agent identities and any available raw journal. Earlier failures were not restarted merely because observation timed out. Their process handles reached terminal states before subsequent diagnostics.

| PID / ignored run suffix | Result | What was actually observed |
|---|---|---|
| 66260 / `1792800773110` | exit 1 | Observer JNA direct registration rejected calling convention 63 before original AL initialization. |
| 39116 / `1792800787205` | exit `3221226356` | Explicit-convention direct registration attempt terminated before journal/AL initialization. No claim about original context support. |
| 74976 / `1792800839035` | exit 0 | Original call succeeded; complete native list `[0]` before and after. |
| 45092 / `1792800924641` | exit `3221226519` | Native logging to a file was enabled; context entry count stayed zero. No original context-list result exists for this attempt. |
| 64684 / `1792800962069` | exit 0 | Original call succeeded with 19 observed integers: nine pairs and a zero key. The ninth value was also zero, but reading continued to the following zero key. |
| 65844 / `1792801025498` | exit 0 | Original call succeeded with seven integers: three pairs and a zero key; native trace went to stderr. |
| 49864 / `1792801163629` | exit 0 | Final strict observation: `[0]` before/after, source/ABI/module closure, native trace and clean context/device shutdown. |

The 19-integer list is retained verbatim in the evidence. Its keys were `568,568,-1878975176,32762,32762,32762,1,568,-1878974920`; none matches the three regular-device keys recognized by the separately audited official parser source. Its successful original call refutes any rule that an unknown nonzero first word should itself cause failure. The seven-integer list was `[12004138,-1241207803,11642112,1192992149,-1879034368,88710682,0]`. These allocation-specific observations must not become a constant version fact.

All four successful regular contexts returned this actual `ALC_ALL_ATTRIBUTES` list:

```text
[4103,48000,4104,50,4105,0,4112,255,4113,1,131075,4,0]
```

The final context was on `Mi Monitor (NVIDIA High Definition Audio)`. The raw original endpoint query, including its trailing NULs, is preserved rather than silently normalized in the evidence.

The three earlier failures remain in `previousAttempts`. The first two belong to the observer's rejected direct-mapping implementation. The logging-file attempt used a path that was not subsequently reused. Official source contains `fopen(...,"wat")`; the exit value is consistent with an invalid-parameter status, but this audit has no native failure stack proving that exact cause. These failures are not evidence that arbitrary nonzero context attributes fail. The final implementation uses normal JNA Function calls, and its stderr-only child environment explicitly removes `ALSOFT_LOGFILE`. Global environment and user preferences are untouched.

## Official parser source versus actual DSP observations

The official OpenAL Soft 1.15.1 release is pinned to [commit 9b6a226](https://github.com/kcat/openal-soft/commit/9b6a226da55a987cb883f425eeb568776ea12c8d). Its [Alc/ALc.c](https://github.com/kcat/openal-soft/blob/9b6a226da55a987cb883f425eeb568776ea12c8d/Alc/ALc.c), cached SHA-256 `091b855db93d8f2ee8d5f52186071339614b1ed51276729e0538260d3d714a85`, supplies a separate source-level explanation: regular-device parsing advances by pairs, stops at a zero key, and selects frequency, stereo-source count and auxiliary-send count. Unrecognized keys are skipped. A nonempty unknown-key list also enters a different control-flow branch from a list starting with zero; this audit does not call them universally equivalent. That source additionally has regular-only HRTF and wide-stereo conditions, while crossfeed depends on effective device configuration.

The actual loaded official game DLL reports `1.1 ALSOFT 1.15.1`. Its own stderr trace in both logged successful calls supplies the following runtime evidence. A matching version string is not used to prove that the tagged source is the exact source of that compiled binary.

| State | Runtime evidence | Limit |
|---|---|---|
| Playback backend | Native trace adds `mmdevapi` for playback. | Local run and actual endpoint only. |
| Output format/rate | Native post-reset trace: Stereo, Float, 48000 Hz, 960 update size ×4. | Does not measure a different loopback device's state. |
| HRTF | Native trace explicitly says disabled. | `ALC_SOFT_HRTF=false` alone would not establish this internal state. |
| BS2B crossfeed | Native trace explicitly says disabled. | No crossfeed PCM comparison was run. |
| Wide stereo | Native config lookup says key not found; the tagged source's branch uses a false default. | The actual internal flag was not directly read; retain the distinction between source inference and runtime flag observation. |
| Resampler | Native config lookup says key not found. | Actual internal selected enum was not directly read. No configured/default resampler equivalence is inferred. |
| Source limits/sends | Actual attributes: 255 mono, one stereo, four sends. | No SoundSystem voice-pool allocation or source creation in this silent probe. |
| Cleanup | Native trace logs FreeContext and FreeDevice; terminal exit 0. | Applies to these fresh calls. |

## Bridge proposal and remaining work

No world or loopback context was created by this audit. A new recorder must not reuse the old Java-remaining parser. The candidate design is to observe each new original regular call at the JNI boundary, require a complete stable native list, retain every observed pair in its original order—including unknown keys, duplicates and zero values—and separately create a legal direct copy for the recording context. Only channel type, sample type and recording rate may be replaced/appended, with the exact transformation recorded. The declared seven-int backing buffer must never substitute for the actual native list. The original regular call's bytes and arguments must remain unchanged.

That design still needs an independently implemented, silent context bridge before any world capture: record both devices' full effective attributes, output formats, actual native DSP logs, and cleanup; check unchanged source limits/sends and every non-recording attribute. A traced runtime state for one default device cannot be inherited by another process or endpoint. If the original list is unreadable, unterminated within the bound or unstable, it is recorded as unavailable; it must not be replaced with `[0]` and called equivalent. A future bridge may decline recording without preventing the original regular call.

The exact shipped binary's parsing/DSP behavior is supported here by its own execution and logs, with the official tagged source kept in a separate scope. There is no direct trace of each native dereference, no proven binary-to-tag build provenance, no direct read of wide-stereo/resampler internals and no regular-versus-loopback PCM comparison. These are bridge requirements and scope limits, not a claim that the actual observed regular DSP state was wrong. The parent explicitly requested delivery of this observer evidence and bridge gap before additional context experiments or worlds.

## Review and frozen files

```text
node scripts/review-lwjgl2122-native-list.mjs
node scripts/verify-lwjgl2122-native-list.mjs
```

The positive strict review and all 15 corrupted-evidence fixtures pass. Negative fixtures reject old49 promotion, invented world counts, argument replacement, an incorrect pointer/list, an unterminated or unstable list, forged DSP/ABI/native-module/method/source identities, missing source closure, erased failures and a nonterminal result. Validation is `.local/lwjgl2122-native-list/validation-1792801232298/results.json`. These checks add no native calls and no measured scenes.

New files are `scripts/audit-lwjgl2122-native-list.mjs`, `scripts/review-lwjgl2122-native-list.mjs`, `scripts/verify-lwjgl2122-native-list.mjs`, `scripts/java/Lwjgl2122NativeListObserver.java`, the independent evidence JSON and this document. Raw originals and all seven attempts remain ignored under `.research/lwjgl2122-native-list` and `.local/lwjgl2122-native-list`. The final raw result is `.local/lwjgl2122-native-list/run-1792801163629`; the public JSON additionally binds the six preceding attempts. No product, common facts, old evidence, registry, old capture agent or old PCM was edited; no commit or release was made.
