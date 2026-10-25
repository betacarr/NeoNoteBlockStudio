# Preserving the original output limiter

The original Java 1.20.2 audio `Library` explicitly enables the OpenAL output limiter when it creates its context. The editor previously omitted that request, and the research capture agent also lost it while rebuilding context attributes for loopback recording. Matching PCM from those two paths therefore did not establish that they preserved the original game's limiter behavior.

This correction changes both production rendering and the recording method. Earlier 1.20.5 and 26.3 matrices made with the old capture agent are invalid under the corrected context requirements. Their full suites were recorded again on 2026-10-24 and all 127 / 165 replacement scenes pass with original attributes and applied limiter state checked. See the [current recording matrix](game-recording-acceptance.md). Replacement recordings replace the corresponding earlier cases; they must not be added to them as extra coverage. This document reports only the completed checks below and does not assign an overall accepted-scene total.

## Original request and specification

The checked original 1.20.1 `Library.init` calls `alcCreateContext` with a null attribute list. In 1.20.2 it instead supplies a terminated list containing `6554, 1, 0`. Decimal `6554` is `0x199A`, the `ALC_OUTPUT_LIMITER_SOFT` attribute, and `1` requests `ALC_TRUE`.

| Checked boundary | Original context creation | Evidence identity |
| --- | --- | --- |
| Java 1.20.1 | No explicit limiter attribute | Client SHA-1 `0c3ec587af28e5a785c0b4a7b8a30f9a8f78f838`; `Library` class SHA-1 `3d714dd73361c9853b3176f748a6a86ab86e7429` |
| Java 1.20.2 | Explicit `6554 = 1` | Client SHA-1 `82d1974e75fc984c5ed4b038e764e50958ac61a0`; `Library` class SHA-1 `5fe58a4726df09b958e4d768e357aca2272454f9` |

These identities come from the original official clients and the local source comparison, rather than an inference from the LWJGL dependency version. The 1.20.2 original client is identified by [Mojang's checksum-addressed client artifact](https://launcher.mojang.com/v1/objects/82d1974e75fc984c5ed4b038e764e50958ac61a0/client.jar). Decompiled sources remain in ignored `.research/source-comparison/`; they are not shipped with the application. [The facts generator](../scripts/generate-audio-facts.mjs) records the checked request as `outputLimiter: "enabled"`, distinguishes omitted attributes as `"device-default"`, and rejects a newly encountered `6554` form that its checked rule does not recognize.

The [official `ALC_SOFT_output_limiter` specification](https://openal-soft.org/openal-extensions/SOFT_output_limiter.txt) defines the default state as implementation-defined. An application can request on, off, or no preference at context creation/device reset. It can query the actual enabled/disabled state with `alcGetIntegerv` and `ALC_OUTPUT_LIMITER_SOFT`. Consequently, omitting this attribute cannot stand in for an explicit original-game request, even if one machine's default happens to give matching audio.

## Production and capture corrections

The production path now carries the checked setting through [version context selection](../src/audio/context.ts), [the engine's native request](../src/audio/engine.ts) and [the native worker](../electron/audio-worker.ts). In vanilla mode, a profile whose source facts explicitly enable the limiter requests `true`; an omitted original request remains omitted. This is a version compatibility rule, not an added user preference.

When a setting is requested, the worker requires the extension and supplies `ALC_OUTPUT_LIMITER_SOFT` in its context attributes. After context creation it queries the actual state and stops rendering if the requested state was not applied. The returned native result also records that actual state. An unavailable extension or unapplied explicit setting does not silently fall back to the device default.

[WorldCaptureAgent](../scripts/java/WorldCaptureAgent.java) and [CurrentWorldCaptureAgent](../scripts/java/CurrentWorldCaptureAgent.java) now copy the original attribute list before making the controlled recording overrides. Those overrides specify loopback channel/sample format, sample rate and the selected HRTF state. They retain the original limiter request and other supplied attributes. Each scene records `originalContextAttributes`, `captureContextAttributes`, extension availability and the limiter state queried from the real device.

The corrected 1.20.2 recordings demonstrate this directly:

```text
originalContextAttributes = {6554=1}
captureContextAttributes  = {6554=1, 6544=5377, 6545=5126, 4103=48000, 6546=0 or 1}
outputLimiter             = 1
editorOutputLimiter       = true
```

The capture remains a real integrated world using original note-block events, original sound-engine calls, original sample files and the checked original native libraries. Loopback format/rate and HRTF controls still make it a controlled mixer recording, rather than a hardware-output recording or a test of network/onset scheduling.

## Native check with the default deliberately disabled

[`verify-output-limiter.mjs`](../scripts/verify-output-limiter.mjs) starts a fresh process with an isolated OpenAL configuration containing `output-limiter = false`. It verifies the DLL against the official native archive, renders the same 32 simultaneous harp sources with an omitted setting, explicit off and the production profile's explicit on request, and inspects both the queried state and actual PCM.

The retained [component evidence](verification.md) records:

| Check | Actual result |
| --- | --- |
| Original native backend | OpenAL Soft 1.23.0, Windows x64 |
| Official archive | `org/lwjgl/lwjgl-openal/3.3.2/lwjgl-openal-3.3.2-natives-windows.jar`, SHA-1 `e74f299a602192faaf14b917632e4cbbb493c940` |
| Extracted DLL SHA-256 | `3b80d08aeedf818fdbbaff9b633e09f34ecb389288c72a11dc3545c2a9ac6b30` |
| Omitted setting with isolated default disabled | Actual limiter `false` |
| Explicit off control | Actual limiter `false`; byte-identical WAV to the omitted-setting control |
| Production 1.20.2 profile request | Requests `true`; actual limiter `true` despite the disabled default |
| Dense-mix PCM difference, off versus on | 52,104 changed signed 16-bit sample values; maximum absolute difference 65,535 |

The changed-sample count measures individual interleaved channel sample values, not stereo frames. This proves that the setting reaches the original library and materially changes dense mixing. It is a component check and adds no integrated-world scenes to the recording matrix.

## Continuous context state and exact world comparisons

Enabling the correct limiter exposed a second comparison problem: its lookahead/release state persists across successive three-second recording blocks in the same game context. An early comparison that created a fresh editor context for every scene produced residual differences of 1–607 signed 16-bit least-significant units. Resetting the editor's limiter between scenes compared a different state history from the original continuous capture.

The correction is in [the world verifier](../scripts/verify-game-world.mjs): it sends the scenes through the production renderer in the original capture order using one continuous context, then splits the resulting PCM at the original scene boundaries. It retains the captured source play order, verifies compatible listener settings, and preserves the limiter history across the boundaries. It does not change samples, fit gain, trim PCM to hide differences, or relax the comparison threshold.

The completed 1.20.2 results are retained in [the HRTF-off report](verification.md) and [the HRTF-on report](verification.md):

| Actual integrated-world cohort | Scenes | Simultaneous voices per scene | Maximum PCM error | Changed sample values |
| --- | --- | --- | --- | --- |
| HRTF off, limiter explicitly enabled | 5 | 3, 6, 16, 32, 64 | 0 LSB in every scene | 0 |
| HRTF on, limiter explicitly enabled | 5 | 3, 6, 16, 32, 64 | 0 LSB in every scene | 0 |

Both reports record the original and capture attributes, actual original/editor limiter states, native provenance and source hashes. Their recording and rendered PCM hashes agree for all ten scenes. The earlier residual diagnostic is not a tolerance accepted by these reports: the final acceptance remains exact byte equality.

## Evidence boundaries and reproduction

These results cover the original 1.20.2 library/component setting and the two specific corrected world cohorts. They do not establish equivalent defaults in other OpenAL versions, certify every later Minecraft release, or validate the invalidated earlier 1.20.5/26.3 captures. An identical dependency version alone does not establish equivalent game context behavior. Full replacement matrices require their own preserved attributes, queried states, original artifacts and successful PCM comparisons.

With the existing verified 1.20.2 research fixture, the component check can be repeated without changing the machine's OpenAL defaults:

```powershell
node scripts/verify-output-limiter.mjs
```

Use `--write-evidence` only when intentionally replacing the retained component report. The two linked world reports are separate integrated-world comparisons; repeating the component command does not reproduce or add those scenes. Overall coverage and replacement progress are maintained by the recording matrix, rather than by this defect note.
