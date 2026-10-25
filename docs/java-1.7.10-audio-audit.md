# Java 1.7.10 audio applicability and context boundary

Java 1.7.10 remains **code-reviewed**. This audit adds **zero accepted world scenes and zero formal world comparison reports**. The original component probes support the version-specific math and delivery facts; the retained world recordings use a context normalization whose equivalence to the original native call has not been proved.

## Original identities and source scope

The [official version metadata](https://piston-meta.mojang.com/v1/packages/ed5d8789ed29872ea2ef1c348302b0c55e3f3468/1.7.10.json) identifies client SHA-1 `e80d9b3bf5085002218d4be59e668bac718abbc6`. Official client mappings are unavailable. Every semantic label here is a manual role bound to the original class, descriptor and Code hash in [the source report](verification.md), independently checked by `reviewLwjgl21710Source()` in `scripts/review-lwjgl21710-source.mjs`.

The source report covers 55 original client/dependency classes and 49 selected method bindings. It checks the complete material → block event → server sound packet → client sound instance chain, including the silent client-local listener that prevents a second unquantized note sound. Actual support materials select five instruments: default/dirt→harp, wood→bass, stone→basedrum, sand→snare, glass→hat. `pling` is a resolvable sixth resource, not a selectable support-material instrument in this client.

Original `bqo` splits the indexed name at its first slash to obtain the namespace, while `btp` requests `sounds.json` and `sounds/<sample>.ogg`. The [official asset index](https://launchermeta.mojang.com/v1/packages/1863782e33ce7b584fc45b037325a1964e095d3e/1.7.10.json) therefore resolves `minecraft/sounds.json` and `minecraft/sounds/note/harp.ogg`, `bassattack.ogg`, `bd.ogg`, `snare.ogg`, `hat.ogg`, `pling.ogg`. These indexed bytes and their original `record` category were verified. The isolated fixture is `.local/game-fixtures/1.7.10`; no user game directory or preference profile is used.

The official [Windows native artifact](https://libraries.minecraft.net/org/lwjgl/lwjgl/lwjgl-platform/2.9.1/lwjgl-platform-2.9.1-natives-windows.jar) has SHA-1 `4c517eca808522457dd95ee8fc1fbcdbb602efbe`. Its `OpenAL64.dll` SHA-256 is `9261b66010a845ddef9f61d5e4266fe2f08a53f3605da002e9e8f8d202bdbc5e`, identical to the checked 1.12.2 OpenAL DLL. Its **LWJGL JNI bridge differs**: 1.7.10 `lwjgl64.dll` SHA-256 is `19ddc120c3f382cebc249da69f7cec7d71f7a665054f8d6f5c6f5bde6cfd2297`. The source report's phrase “not a new native family” is limited to this OpenAL binary; it must not be read as equality of the whole native dependency set or of game behavior. The original backend reports `1.1 ALSOFT 1.15.1`, supports loopback, and exposes neither HRTF nor output-limiter extensions.

## Component results which remain valid

[Original numeric evidence](verification.md) invokes the original methods for 1,049 finite engine gain/pitch inputs, all 25 original note values through NoteBlock → original packet constructor/getter → original engine clamp, and 39 packet float-boundary inputs. It adds no world coverage.

Original `btj` widens the instance float before multiplying by event **double** scalars. Volume is the left-associated double product of instance volume, event volume, and widened category float, clamped as double and converted once to float. Pitch multiplies the widened instance float by the event double, clamps to `[.5,2]`, then converts to float. This differs from precombining the event volume as a float: input `0.8827458620071411 × 0.6290736794471741 × 0.1719992607831955` produces original gain `0.09551328420639038`; premature float multiplication produces `0.09551329165697098`.

Original `amj.a(Lahb;IIIII)Z` computes note pitch with `Math.pow`, converts to float, and emits volume 3. The server delivery chain actually uses original `hc`, which truncates the float product `pitch*63f` to an integer, clamps to `[0,255]`, and transports an unsigned byte. Its getter returns `(float)byte/63f`; the engine applies its pitch clamp afterwards. Note 0 therefore transports `31/63f` and becomes `.5f` after the clamp; note 1 reaches the native source as `33/63f`, not the unquantized power result. This rule is established for 1.7.10, not inferred for neighboring releases.

Original `oi` compares squared source-to-server-player-entity distance strictly below range squared, in the same dimension. Volume 3 gives range 48. The separate radius-64 block-event notification is not the sound delivery range. Original client listener `btj.a(Lyz;F)V` interpolates the client player's existing coordinates; it does not add another eye height. Server `mw` uses `L=0`, the ordinary client player uses `L=1.62f`, and original `nh.a(DDDFF)V` transports server feet Y plus widened `1.62f`. The normalized candidates observed server `[.5,80,2.5]`, client `[.5,81.62000000476837,2.5]`, and float AL listener `[.5,81.62000274658203,2.5]`. These observations are diagnostic candidates, not accepted original-context world measurements.

The original configured source pool is 28 normal plus 4 streaming, and normal note sources can be stolen/reused when the original pool is exhausted. Actual allocation can be smaller than configured. Both normalized recording candidates allocated 28+4 without changing the original configuration; no accepted original-context capacity or polyphony measurement follows from that observation.

## Context pointer finding

[The independent context report](verification.md) binds seven exact methods in four original LWJGL classes, including all three `MemoryUtil` methods needed to follow the pointer. The original call chain is:

1. Original `LibraryLWJGLOpenAL.init()` calls `AL.create()`.
2. `AL.create()` supplies stored values 44100 Hz, refresh 60, synchronous false.
3. `ALCcontext.createAttributeList(III)` allocates seven integers and writes `[4103,44100,4104,60,4105,0,0]`. It returns without `flip()` or `rewind()`, so position, limit and capacity are all 7.
4. `AL.init(...)` passes that buffer directly to `ALC10.alcCreateContext(...)`.
5. `ALC10` calls `MemoryUtil.getAddressSafe(IntBuffer)`. This delegates to `getAddress(buffer,buffer.position())`, which returns base address plus `position << 2`: **base+28 bytes**, outside the declared Java buffer. The integer terminator stored at index 6 is before that pointer.

The research hook runs at `alcCreateContext` method entry (`visitCode`), before any original instruction. The independent no-sound regular-device probe records via `duplicate()` and returns void, neither replacing the original argument nor moving its position/limit. It then permits the original call to run unchanged. In that one process, the first integer at the native pointer was observed as zero and the original context succeeded. Actual `ALC_ALL_ATTRIBUTES` were:

```text
[4103,48000,4104,50,4105,0,4112,255,4113,1,131075,4,0]
```

Thus the stored 44100/60 values were not established as applied settings. A direct read at base+28 is explicitly outside the declared allocation; one observed zero does not turn it into a stable zero-terminated native list.

Two later recording processes observed first words **12004138** and **25455**. The enhanced observer deliberately rejected each before executing original `nalcCreateContext`. Their subsequent silent-mode fallback was caused by this research guard. **These attempts do not prove that an uninstrumented original native call would fail.** They prove that an empty Java remaining range and one earlier zero observation are insufficient to assert a stable native attribute list across allocations.

The original candidate recorder copied the remaining Java pairs and supplied explicit loopback stereo/float/48000 attributes. Its `originalContextAttributes="[]"` means only “no remaining Java pairs.” Its `contextAttributePolicy="retain-original-pairs-except-loopback-channel-format-rate"` is not a proof that it preserved the native pointed list. These fields must not be used to claim context equivalence. The later recorder adds the observed pointer word, bounds and actual context state, but no recording completed under that stricter guard. No threshold was loosened.

## Retained attempts and acceptance decision

The [candidate/guard boundary manifest](verification.md) records hashes of logs, copied agents, source evidence and archived candidate recording manifests. All run paths below are under `.local/lwjgl21710-world-comparison/1.7.10/` and remain ignored.

| Run | Result | Recorded scenes | Acceptance |
|---|---|---:|---|
| `run-1792791567495` | Preparation only | 0 | None |
| `run-1792791573510` | Startup rejected missing original `--userProperties` argument; terminal exit 1 | 0 | None |
| `run-1792791594312` | Pilot completed, terminal exit 0 | 9 | Candidate only; context normalization unproved |
| `run-1792791676248` | Five instruments × 25 notes plus 6 spatial/delivery cases completed, terminal exit 0 | 131 | Candidate only; context normalization unproved |
| `run-1792791906967` | Master .7; observer guard rejected native first word 12004138 before original call | 0 | None |
| `run-1792791926975` | Repeat 131; observer guard rejected native first word 25455 before original call | 0 | None |

The two guard-failed Java processes were stopped only after explicit audio initialization failure, with their full own-agent/profile command lines checked. Their runner records are terminal. All own capture processes have exited; no process was restarted just because an observation timer expired. The planned polyphony series `[3,6,16,24,28]` was not collected. Pilot cases overlap the 131 set and are not extra coverage. No 1.7.10 production PCM comparison or official world report was generated.

The draft `scripts/verify-lwjgl21710-world.mjs` requires explicit `--candidate-only`, refuses `--evidence-name`, writes only inside an ignored capture directory, and records zero added world scenes. It was syntax-checked but not run as a PCM comparison. It derives packet/event pitch and volume from production helpers instead of using captured AL pitch as input; it explicitly includes the common source manifest plus `electron/vorbis.ts`, `electron/java-decoder.ts`, `electron/java/NbsxVorbisDecoder.java`, `src/core/project.ts`, `src/core/time.ts` and its own verifier. This draft does not resolve the context boundary.

## Frozen evidence review and files

The frozen source report and generated 1.7.10 legacy/world facts do **not** assert empty native attributes or native-attribute preservation. The `lwjgl-default-context-settings` binding proves the original caller's stored arguments only. Existing `originalLoopbackSupported`, `hrtfControl`, arithmetic, codec and delivery facts retain their established source/component scope. `gameRecording` remains pending. No shared facts, product source, generator, old source report, old component evidence or previous world report was modified by this capture/context follow-up.

Files added for the independent capture/context follow-up:

- `scripts/capture-lwjgl21710-world.mjs`
- `scripts/java/Lwjgl21710WorldCaptureAgent.java`
- `scripts/probe-lwjgl21710-context.mjs`
- `scripts/java/Lwjgl21710ContextAudit.java`
- `scripts/verify-lwjgl21710-world.mjs` (candidate-only draft)
- `docs/evidence/java-1.7.10-context-pointer.json`
- `docs/evidence/java-1.7.10-context-capture-boundary.json`
- this document

Earlier source/component audit deliverables, retained without edits in this follow-up: `scripts/audit-lwjgl21710-source.mjs`, `scripts/review-lwjgl21710-source.mjs`, `scripts/probe-lwjgl21710-methods.mjs`, `scripts/java/Lwjgl21710MethodProbe.java`, `docs/evidence/java-1.7.10-audio-world-source.json`, and `docs/evidence/java-1.7.10-numeric-components.json`. The parent agent owns the separate production parameter verification and shared fact integration.

Final read-only verification passed: the strict original-source helper rechecked all 55 classes and 49 bindings; the supplemental context's seven method Code/class hashes, probe/script hashes and original regular-device raw properties match; all six attempt records, archived agents/logs/source references and 140 retained candidate PCM/property pairs match their manifests; the parent's nine production parameter source hashes and two original evidence references match. All capture process records are terminal. The three new capture/context/verifier JavaScript files pass syntax checks. The context Java observer compiled and ran once; the capture agent compiled in the archived attempts. The candidate verifier was not run, no product test suite was rerun for this research-only documentation follow-up, and no PCM equality result is claimed.
