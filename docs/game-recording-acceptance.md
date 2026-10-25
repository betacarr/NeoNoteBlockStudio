# Real game recording acceptance

Thirteen Java profiles have **1,479 selected scenarios with byte-identical original-world and editor PCM** (1,356 single-note / 123 simultaneous). This is a measured Windows x64 subset; compatibility work remains active. Preliminary captures, failed runs, normalized-context candidates and replacement recordings are excluded from the count.

The stricter registry checks pass for all thirteen profiles. The 49 earlier 1.12.2 scenes are excluded after an independent native-context audit: the original JNI pointer addresses beyond the declared buffer, while the recorder replaced that argument using only Java remaining(). Their exact PCM remains diagnostic; original-context equivalence is unproved. This supersedes 0.1.14 and earlier acceptance claims for those scenes. [Correction and archived identities](java-1.12.2-context-correction.md).

The earlier 1.20.5 and 26.3 agents lost the game’s explicit output-limiter attribute while creating loopback contexts. All 127 + 165 scenes have now been recorded again with original attributes preserved and actual limiter state checked. They replace earlier cases without increasing the count. Earlier 1.16.5 replacements likewise corrected missing original HRTF-state fields without adding coverage. See [the limiter correction](output-limiter.md).

## Recorded matrix

All scenes use stereo 48 kHz PCM16, a standing player and the original canonical samples. Record-category volume is 1 except for the two additional 26.3 category-volume cohorts. Single-note matrices cover every instrument at note values 0 / 12 / 24, plus left/right, above/below, distance and delivery-boundary cases.

| Java profile | Single, HRTF off | Single, HRTF on | Master .7, HRTF off | Simultaneous, HRTF off / on | Additional master .7, category .2 | Total |
| --- | ---: | ---: | ---: | --- | --- | ---: |
| 1.13 | [36](verification.md) | [36](verification.md) | [9](verification.md) | [4 off](verification.md) / [4 on](verification.md) | — | 89 |
| 1.14 | [54](verification.md) | [54](verification.md) | [9](verification.md) | [5 off](verification.md) / [5 on](verification.md) | — | 127 |
| 1.14.3 | [54](verification.md) | [54](verification.md) | [9](verification.md) | [5 off](verification.md) / [5 on](verification.md) | — | 127 |
| 1.14.4 | [54](verification.md) | [54](verification.md) | [9](verification.md) | [5 off](verification.md) / [5 on](verification.md) | — | 127 |
| 1.16.5 | [54](verification.md) | [54](verification.md) | [9](verification.md) | [5 off](verification.md) / [5 on](verification.md) | — | 127 |
| 1.19 | [54](verification.md) | [54](verification.md) | [9](verification.md) | [5 off](verification.md) / [5 on](verification.md) | — | 127 |
| 1.19.2 | [54](verification.md) | [54](verification.md) | [9](verification.md) | [5 off](verification.md) / [5 on](verification.md) | — | 127 |
| 1.20.2 | [54](verification.md) | [54](verification.md) | [9](verification.md) | [5 off](verification.md) / [5 on](verification.md) | — | 127 |
| 1.20.5 | [54](verification.md) | [54](verification.md) | [9](verification.md) | [5 off](verification.md) / [5 on](verification.md) | — | 127 |
| 1.21.5 | [54](verification.md) | [54](verification.md) | [9](verification.md) | [5 off](verification.md) / [5 on](verification.md) | — | 127 |
| 26.3 | [66](verification.md) | [66](verification.md) | [9](verification.md) | [5 off](verification.md) / [5 on](verification.md) | [9 single](verification.md) + [5 simultaneous](verification.md), HRTF off | 165 |

The base matrix above comprises 1,284 single-note and 113 simultaneous-note scenes. The additional option-mapping matrix below adds 36 single-note scenes; the volume-boundary subset adds another 36 single-note and 10 simultaneous scenes. Java 1.13 covers ten material-selected instruments and up to 24 sources. The middle full matrices cover sixteen instruments and up to 64 sources; 26.3 covers twenty instruments including four copper trumpet variants, up to 64 sources. HRTF on/off denotes actual backend conditions in these cohorts, not the existence of a game UI switch. The excluded 1.12.2 diagnostics also used ten instruments and an HRTF-unsupported original DLL; neither fact repairs the context proof.

The independent 1.14.3 matrix retains its different original OpenAL/STB binaries, null original context attributes, original 247 static / 8 streaming source pools, and actual rate-selected HRTF profile. It reads the AL listener at capture start and verifies its pose during all 142 render blocks. Its five explicit archives and hashes are in [the capture manifest](verification.md). It does not transfer acceptance to 1.14.1 or 1.14.2.

The two volume-boundary profiles have narrower HRTF-off-only coverage:

| Java profile | Category .5 / master 1 | Category .2 / master .7 | Simultaneous .2 / .7 | Total |
| --- | ---: | ---: | ---: | ---: |
| 1.21.8 | [9](verification.md) | [9](verification.md) | [5, up to 64 voices](verification.md) | 23 |
| 1.21.9 | [9](verification.md) | [9](verification.md) | [5, up to 64 voices](verification.md) | 23 |

These preserve the original HRTF-off/profile-zero/limiter attributes and one continuous limiter context. Original Options values and all 143 camera observations per scene are checked. They verify the actual change in gain ownership without claiming an HRTF-on or full-instrument matrix. [Volume-boundary method, components and signed-zero residual](volume-boundary.md).

The new 1.19 matrix uses normal device defaults: its original disabled option sends no HRTF reset; the production renderer observes the original regular device default before configuring loopback. Its enabled option sends the original profile-zero reset, replayed as initial loopback attributes because a later loopback context would otherwise lose that reset. The new 1.21.5 matrix preserves the original create-context HRTF, profile-zero and limiter attributes directly. Six silent original-Library probes separately cover normal, headphone-auto and forced-on defaults; eight native component configurations separately verify production default-state handling. Neither set adds world scenes. See [HRTF context evidence](hrtf-context.md).

The 1.20.2 / 1.20.5 base HRTF matrices explicitly control loopback state. They remain valid backend comparisons, but do not establish that a regular playback device retains the same state after the game option. The original reset followed by a limiter-only context can re-evaluate HRTF from device defaults.

| Additional original-game condition | Actual HRTF | Scenes |
| --- | --- | ---: |
| 1.19.2 global forced-on, game option off | On; original regular status 3, matched loopback status 1 | [9](verification.md) |
| 1.19.2 global forced-off, game option on | Off; original regular status 2, matched loopback status 0 | [9](verification.md) |
| 1.20.2 speakers/auto, game option on | Off after original limiter-only context | [9](verification.md) |
| 1.20.5 speakers/auto, game option on | Off after original limiter-only context | [9](verification.md) |

All 36 retain isolated backend-configuration hashes, original option/reset/context observations, and 142 stationary-listener checks per scene. Forced conditions first initialize the original regular Library silently in the same game process, observe effective state/profile, call original cleanup, then explicitly match that state in loopback. Normal 1.20.2/.5 cases inject no HRTF attributes: only required capture format/rate accompany the original limiter attribute. The product independently follows the original regular-device sequence; all 36 comparisons have maximum PCM error 0. See [override evidence and reproduction](hrtf-global-overrides.md). Eighty silent original-Library probes and forty production component conditions remain separate from world counts.

The original 1.16.5 proof remains pinned to client SHA-1 `37fd3c903861eeff3bc24b71eed48f828b5269c8`, LWJGL 3.2.2 / OpenAL Soft 1.19.1. The separate 1.20.5 worlds use client SHA-1 `c6b92b2374a629f20802bb284f98a4ee790e950a`, LWJGL 3.3.3 / OpenAL Soft 1.23.1 and the newer JOrbis decoder. The additional native cohorts are OpenAL Soft 1.18.2 for 1.13, 1.21.1 for 1.19.2 and 1.25.2 for 26.3. Reports retain the client, asset, native and adapter identities; shared library versions alone do not establish game equivalence.

## Capture and independent comparison

Each run creates a new test world under its own research game directory; no user save is used. A project-owned research agent hides the graphics window and substitutes a deterministic OpenAL loopback device with stereo/48 kHz and supported HRTF attributes. Current agents preserve the other original context attributes, including an explicit limiter request; older omitted-attribute captures are invalidated. Original world creation, supporting blocks, instrument selection, server block events, sound delivery, SoundEngine or Paulscode path, codec, sources, listener and mixer remain involved. The agent does not replace their sound algorithms. HRTF selection on the research device is independent of whether that release exposes the setting in its UI.

Each scene records three seconds after the original source-play calls, in 1024-frame mixer blocks. Simultaneous scenes wait for every expected source before rendering the mixed output. Missing or unexpected sources fail capture. The window exceeds the checked canonical sample tails at the lowest vanilla pitch; the longest is chime at about 2.21 seconds. This alignment measures mixing after playback starts and excludes musical/server/network onset timing.

The verifier independently derives source pitch, source/listener gain, attenuation range and player-position delivery from product code and checked original facts, then asserts them against observations. It retains the original camera pose and source play order for spatial comparison. It does not copy a captured gain into the editor to force equality. Original asset indexes and native archive contents are rechecked. Archived agent sources/JARs, configuration, original class hashes and provenance accompany the local PCM; committed reports contain hashes and error metrics. Java float strings are restored to float precision before comparison.

The registry generator requires the expected cohort counts/settings, nonzero original note-event counts, exact PCM, original and editor HRTF states, official client identities and current renderer/fact hashes. Rechecking archived recordings after code changes does not add scenarios. A missing field or stale hash must be resolved before publishing a refreshed registry.

For explicitly limited profiles, comparison uses one continuous production-renderer context in original capture order, then splits PCM at the recorded boundaries. This preserves limiter lookahead/release history. The 1.14 HRTF-on simultaneous cohort also uses continuous context. Its archives use the last voice’s listener snapshot immediately before rendering. Taking the first voice’s earlier pose during spawn interpolation produced false differences. Reports explicitly state that these archives have no per-block pose observations; the failed diagnostic is retained. Future 1.14 captures now read the actual listener at capture start and check each block, but that newer instrumentation is only compiled, not retroactively claimed for accepted archives.

## Corrections established by the recordings

**Player and listener positions differ.** Original delivery checks use the player's entity position and a strict 48-block radius for volume-3 note-block sounds; the standing listener is at eye height. A sound can be within the ear-centred attenuation radius while receiving no packet. Original-source evidence and world observations support the delivery model for the measured profiles; [1.13's separately checked bytecode evidence](verification.md) also records the standing-pose limitation. Studio playback keeps its complete-playback behavior.

**The 1.13 attenuation path needs relative coordinates.** Its world listener is nonzero, around `[.5, 81.62, 2.5]`. The editor previously calculated Paulscode attenuation from absolute source coordinates. It now subtracts the listener position using the original float arithmetic before calculating distance. All 89 legacy world comparisons pass with that correction. This client's semantic class/method names are manual research labels verified against descriptors and raw disassembly; no official client mappings exist. They must not be presented as official mapped names.

**Master gain changes ownership in 1.21.9.** Earlier checked clients clamp `sourceVolume × category` for the unattenuated source setting and apply master on the OpenAL listener. From 1.21.9, the checked original code clamps the instance volume independently, multiplies by the final category/master setting per source, and leaves listener gain at 1. The 26.3 world captures verify this newer path: at raw volume 3, master .7 and category .2, actual source gain is .14 and listener gain is 1. The earlier order would yield source .6 and listener .7. Both the nine single scenes and five simultaneous scenes match exactly. This tests those settings in 26.3; it does not transfer world acceptance to every intervening release.

**HRTF must be observed.** Supported capture/render paths check the actual applied device state. The separately checked 1.12.2 / OpenAL Soft 1.15.1 backend lacks `ALC_SOFT_HRTF` and reports an unsupported-setting error instead of silently accepting the request. The fresh 1.16.5 replacement recordings also close the older reports' missing original HRTF-state evidence.

**Output limiting must preserve the game request.** Original Library explicitly enables the limiter from 1.20.2 onward. The editor now carries this fact through the normal project request, sets it and checks the applied state. Every accepted 1.20.2 / 1.20.5 / 26.3 scene retains original `6554=1` and observes the limiter enabled on both sides. A separate original-DLL check disables the implementation default and proves the explicit game request still takes effect. [Method and correction](output-limiter.md).

## Java 26.3 research conditions

This officially named Java 25 client uses the separate `capture-current-world.mjs` / `CurrentWorldCaptureAgent.java` adapter, with SDL window handling, original WorldOpenFlows creation and original `NoteBlock.setInstrument`. Material preflight and per-scene assertions check all 20 actual instrument selections. White wool comes from the block colour collection, and the four trumpet supports come from the copper weathering collection; no instrument is inferred from the editor's icon or material table alone.

The actual option key is `soundCategory_record`, singular (`soundCategory_block` is also singular). An initial requested category-.2 run used the ignored plural key and therefore retained actual category 1; it is marked as a fixture mismatch and excluded. The corrected captures read original `Options.getSoundSourceVolume` and `getFinalSoundSourceVolume`, write `actual-options.properties` and per-scene fields, and assert that the requested settings loaded. Earlier category-1 runs were checked against the original client's saved options. Configuration labels alone are not proof of effective volume.

Two early launches with the JVM's default processor count crashed natively with Windows `0xC0000005` during resource/font startup, before audio capture. The cause remains undetermined. Successful selected runs explicitly used `--processors 4` and OpenGL; this is a recorded research condition, not a demonstrated fix or a product requirement. Failed attempts and the category fixture mismatch are retained locally and do not contribute to the accepted total.

## Reproduction

Prepare the official metadata/client/source cache first. Capture requires a JDK for the agent and checksum-verified original libraries; newer clients also require the prepared runtime. Examples for the mapped adapters:

```powershell
node scripts/prepare-audio-fixture.mjs 1.20.5
node scripts/prepare-java-runtime.mjs 21
node scripts/prepare-world-source.mjs 1.20.5
node scripts/generate-world-audio-facts.mjs
node scripts/capture-game-world.mjs --version 1.20.5
node scripts/verify-game-world.mjs --version 1.20.5 --broadcast --write-evidence --evidence-name java-1.20.5-single-note-world
```

Use the same adapter for 1.16.5, 1.19.2 and 1.20.2 with their version/fixture/source values. After each capture, run the verifier immediately with the matching evidence name. Add `--hrtf` for the full HRTF-on matrix, `--master .7 --quick` for nine master scenes, `--polyphony` for simultaneous scenes, and `--polyphony --hrtf` for their HRTF-on counterparts.

The `capture-lwjgl2-world.mjs` / `verify-lwjgl2-world.mjs` pair produces normalized 1.12.2 diagnostics only. Verification requires `--candidate-only` and refuses public acceptance output; `reverify-world-captures.mjs --version 1.12.2` has the same guard. The three historical reports remain unchanged and are superseded by the context exclusion audit. The `capture-early-world.mjs` / `verify-early-world.mjs` pair covers 1.14; first run `audit-early-world.mjs` and `generate-early-audio-facts.mjs`. These use manually reviewed original bytecode roles, not official mappings. The 1.14 HRTF-on polyphony verification requires `--continuous`.

The context-boundary releases use independent `capture-world119.mjs` / `verify-world119.mjs` and `capture-hrtf1215-world.mjs` / `verify-hrtf1215-world.mjs` adapters. Their original context audit, flags and provenance differences are documented in [HRTF context evidence](hrtf-context.md). The generic mapped capture script does not silently claim support for these adapters.

For 1.13, use its bytecode-audited adapter and verifier:

```powershell
node scripts/prepare-audio-fixture.mjs 1.13
node scripts/capture-legacy-world.mjs --prepare-only
node scripts/generate-legacy-world-delivery-source.mjs
node scripts/capture-legacy-world.mjs --all-instruments
node scripts/verify-legacy-world.mjs --evidence-name java-1.13-single-note-world
```

Its remaining capture flags are `--all-instruments --hrtf`, `--master .7` (nine scenes), `--polyphony`, and `--polyphony --hrtf`. The master report uses the `java-1.13-master-07-world` name.

For 26.3, prepare its fixture, Java 25 runtime and world-source facts, then use the separate adapter:

```powershell
node scripts/prepare-audio-fixture.mjs 26.3
node scripts/prepare-java-runtime.mjs 25
node scripts/prepare-world-source.mjs 26.3
node scripts/generate-world-audio-facts.mjs
node scripts/capture-current-world.mjs --processors 4
node scripts/verify-game-world.mjs --version 26.3 --broadcast --write-evidence --evidence-name java-26.3-single-note-world
```

Repeat with the four mapped-adapter cohort flags above. Also capture `--quick --master .7 --records .2` and `--polyphony --master .7 --records .2`, keeping `--processors 4`, and verify into the category-gain and polyphony-category-gain reports. Run captures sequentially. The current adapter verifies official client/library/native/asset hashes, downloads necessary original bootstrap assets into its own cache, and archives source and runner snapshots.

`verify-game-world.mjs --capture capture-RUN_ID` selects an archived modern/current run; the legacy verifier accepts its full capture-directory path. `reverify-world-captures.mjs --version VERSION` locates hash-matched accepted recordings and reruns comparison against current code. Once every report satisfies the stricter checks, run `node scripts/generate-audio-validation.mjs`. The application does not ship the game client, original samples, agents or test worlds.

## Still outside acceptance

All thirteen profiles remain partially measured. Unrecorded releases/settings, other operating systems and native libraries, hardware/output-driver processing, other sample rates, non-standing poses, custom/stereo resources, larger voice counts, musical onset/tick/network timing and broader project interoperability remain open. The .7/.2 category tests cover HRTF-off in 1.21.8, 1.21.9 and 26.3; they do not certify arbitrary volume/settings combinations. Source/component probes remain separate evidence levels. Physical construction legality and redstone generation remain deferred by the user.

The exact comparisons retain observed absolute camera/listener and entity positions. The editor currently uses an ideal ear-centred reference with nominal standing eye height; these measurements do not establish complete editor-to-world camera projection. In particular, early 1.14 has a first-person forward offset and float eye-height smoothing, and absolute world-to-AL conversion introduces rounding. [Original historical camera evidence](historical-world-delivery.md). Placement and player-position design remain deferred.
