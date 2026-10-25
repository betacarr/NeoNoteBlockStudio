# Audio coverage audit and next recording batches

The current 0.1.20 checkpoint contains 89 selected-core source profiles and 55 world-source entries, distinct from 13 partially measured subsets/1,479 original-world scenes. Five new 1.5/1.6 releases have frozen original methods, resource reads and production comparisons plus packaged decode/render smoke; none inherit world recordings. [Current release](verification.md), [1.5](java-1.5-audio-audit.md), [1.6](java-1.6-audio-audit.md). Counts in dated historical snapshots below remain their original scope.

Audit snapshot: **2026-10-24 01:44 China Standard Time / 2026-10-23 17:44 UTC**. This audit reads the actual local research reports, original client bytecode, generated sources and application registry. It does not add game recordings or extend the acceptance status of any profile. Work on 1.13, 1.19.2 and 26.3 is in progress separately; it is not counted as completed evidence here.

Later checkpoints supersede the snapshot counts below: the strict registry contains 13 partially measured subsets and 1,479 exact original-world scenes, with 84 selected-core source profiles. Seven [independent 1.7 patch reviews](java-1.7-patches-audio-audit.md), nine [1.8 patch reviews](java-1.8-patches-audio-audit.md), full [1.9](java-1.9-audio-audit.md), four [1.9 patch reviews](java-1.9-patches-audio-audit.md) three [1.10 reviews](java-1.10-audio-audit.md), [1.7.2](java-1.7.2-audio-audit.md), three [1.11 reviews](java-1.11-audio-audit.md) and two [1.12 reviews](java-1.12-audio-audit.md) add source/component coverage only; the 1.9–1.12.2 boundary scan does not promote all releases to full profiles. The previously counted 49 Java 1.12.2 scenes are excluded because their normalized context lacks original native-pointer/list equivalence evidence; exact PCM diagnostics and historical reports are retained. [Context correction](java-1.12.2-context-correction.md). The independent [1.8 audit](java-1.8-audio-audit.md) establishes a real category-volume ordering and packet-wire overflow distinction despite an unchanged Windows OpenAL file. The [native archive census](native-archive-census.md) checks all 103 formal releases against official metadata and 51 distinct archives, including actual PE/Mach-O CPU identities. Windows x64 OpenAL has nine contiguous binary-identity groups; these are research boundaries, not complete engine cohorts. Mac boundaries and selected overrides differ. None of this promotes the unrecorded 1.7/1.8/1.9 patches, 1.10/1.11/1.12 families to world-measured or closes the full original goal.

Subsequent resource-path work closed the 1.7.3–1.7.9 default-domain index gap with 49 reads through the original clients' resource classes. See [checked historical sound-index paths](legacy-sound-assets.md). Java 1.0 now has separately checked original directory traversal/dispatch and six actual file reads; its product resource loader matches those files, while the full audio profile remains unverified. See [1.0 resources](java-1.0-resource-selection.md). Java 1.7.2 now has separately reviewed original File-root virtual-directory traversal, seven original reads and six packaged sample loads, without borrowing the later ResourceIndex role. See [1.7.2 resource audit](java-1.7.2-audio-audit.md). Other pre-1.6 layouts remain unreviewed; the original snapshot findings below remain an audit trail.

## Findings that affect the product

1. **The master-volume path changes in 1.21.9.** Earlier checked clients apply master gain on the OpenAL listener. From 1.21.9 onward, `SoundEngine` applies the final master/category setting to each source after clamping the instance volume; `Listener` no longer exposes `setGain` / `getGain`. At discovery, `src/audio/parameters.ts` still applied master to the listener for every version. A master-1 recording cannot detect that incorrect processing order. This is a real implementation defect for newer targets, rather than an unmeasured dependency change. The main agent is implementing the correction; this document records the discovery and required verification, not a claim that the fix has passed.
2. **164 cached clients do not mean 164 formal releases or verified audio engines.** They comprise 103 `release`, 35 `old_alpha` and 26 `old_beta` artifacts. Only 44 formal releases have the modern selected-parameter registry; 59 formal releases do not. Historical clients need their own applicability and behavior review.
3. **The 18 dependency signatures are research leads.** The first entry is the inventory baseline, followed by 17 signature changes. The signature includes all platforms, duplicate library declarations and non-audio LWJGL modules. It misses several original-code setting changes and does not establish 18 behavioral cohorts.
4. **Some apparently empty historical sound indexes have different paths.** For example, the checked `1.7.3` and `1.7.4` indexes contain `sounds.json` and `sounds/note/...`, whereas the current research and application loaders look for `minecraft/sounds.json` and `minecraft/sounds/note/...`. Their empty research event lists do not establish that those clients lack sound-event definitions.

## What the counts actually establish

| Evidence | Actual snapshot | What it establishes | What it does not establish |
| --- | --- | --- | --- |
| Official metadata/client inventory | 164 matrix records, 164 cached client JARs, 164/164 indexed, zero recorded failures | Client identity and indexed bytecode against the official metadata | Correct decoding, mixer behavior, material selection or complete historical applicability |
| Audio-related bytecode inventory | 30,688 selected class records across those clients | Searchable identities, constants and references | A reviewed call graph or equivalence between matching dependencies |
| Modern selected source comparison | 44 releases, 742 class records, 1.14.4 through 26.3, zero extraction failures | Provenance for selected original classes; generated source for targeted review | Whole-engine review: 727 class records still say `source-generated-unreviewed`; 15 have `decompiler-warning` |
| Modern parameter registry | 44 profiles; all client hashes match their source-comparison records | Selected attenuation, pitch, note-block and PCM-conversion checks plus decoder/control classifications | Every engine setting, resource configuration or output-device behavior |
| Sound-index research | 34 unique official asset indexes, zero recorded download failures | Recorded index/sample identities and recognized event definitions | Every historical path convention, original event selection, or every resource pack |
| Original-client codec invocation | 1.16.5: 16 samples; 1.20.5: 16; 26.3: 20 | Those original decoders and the adapter produce identical canonical PCM | Full world/context behavior, stereo/custom inputs, or other clients |
| Original component mix invocation | 18 spatial/pitch/HRTF cases each for 1.16.5, 1.20.5 and 26.3 | Codec/buffer/channel/listener behavior for those components and settings | `SoundEngine` volume composition, server delivery or actual note events |
| Accepted actual-world reports | 1.16.5 and 1.20.5: five reports and 127 cases each; 254 total | Original worlds, materials, note events and game mixers match in the recorded scope | Other releases, hardware output, musical onset scheduling, arbitrary sample rates or resource packs |

All 15 decompiler warnings are `SoundBufferLibrary` in 1.14.4 through 1.18.2. They must be reviewed against the original instructions/call sites before using the generated method as proof of a decoder or buffering cohort. The successful original 1.16.5 codec/world probes remain stronger evidence for that particular client than its decompiled method.

The existing 1.16.5 component report also retains a block-size residual: with unequal 96,000-frame versus 1,024-frame rendering blocks, one HRTF sample differs by one PCM quantization unit; equal 1,024-frame blocks match. A cohort declaration must retain this setting rather than silently increasing the acceptance tolerance.

The 44 generated profiles currently split as follows. These are **selected-parameter groups**, not measured-equivalence groups:

| Versions | Count | Decoder | In-game HRTF control | Existing `volumeRule` |
| --- | ---: | --- | --- | --- |
| 1.14.4–1.18.2 | 15 | STB | No | `category-before-clamp` |
| 1.19–1.20.4 | 10 | STB | Yes | `category-before-clamp` |
| 1.20.5–1.21.8 | 11 | JOrbis | Yes | `category-before-clamp` |
| 1.21.9–26.3 | 8 | JOrbis | Yes | `category-after-clamp` |

“No in-game HRTF control” is not the same as “the native library cannot perform HRTF.” The original 1.16.5 test exercises a controlled device setting; the product deliberately distinguishes that from a game option. Conversely, the checked 1.12.2 / OpenAL Soft 1.15.1 path rejects an unavailable HRTF extension.

## Dependency candidates and platform-specific native identities

The 18 recorded start IDs are:

`rd-132211`, `1.6.1`, `1.7.2`, `1.7.3`, `1.7.5`, `1.8`, `1.8.2`, `1.13`, `1.14`, `1.14.3`, `1.14.4`, `1.15`, `1.19`, `1.20.2`, `1.20.5`, `26.1`, `26.2`, `26.3`.

`scripts/research-audio.mjs` constructs these signatures from the full matching dependency-name list. For example, a platform-specific alternative at 1.7.2, additional LWJGL modules at 1.15, or the different non-audio module set at 26.2 can create a signature boundary without proving an OpenAL or decoder behavior change.

Using the application's actual `nativeArtifacts(release, 'openal', 'win32', 'x64', '10.0.22631')` against the catalog yields **12 contiguous native-archive identity groups**, rather than 18. This calculation was performed in memory without regenerating the registry:

| Catalog range | Selected Windows OpenAL archive | Archive SHA-1 |
| --- | --- | --- |
| rd-132211–1.7.2 | LWJGL 2.9.0 platform natives | `3f11873dc8e84c854ec7c5a8fd2e869f8aaef764` |
| 1.7.3–1.7.4 | LWJGL 2.9.1-nightly-20131120 platform natives | `d2330e003d621521b11dc729a8f8d5aa21875ca7` |
| 1.7.5–1.8.1 | LWJGL 2.9.1 platform natives | `4c517eca808522457dd95ee8fc1fbcdbb602efbe` |
| 1.8.2–1.12.2 | LWJGL 2.9.4-nightly-20150209 platform natives | `b84d5102b9dbfabfeb5e43c7e2828d98a7fc80e0` |
| 1.13–1.13.2 | LWJGL OpenAL 3.1.6 | `351960d5ebb1678ef99016af9e7ca97881af9288` |
| 1.14–1.14.2 | LWJGL OpenAL 3.2.1 | `92fb931e65c637cea209ad5c3ffebd1b325ed41d` |
| 1.14.3–1.18.2 | LWJGL OpenAL 3.2.2 | `ec20a7d42a2438528fca87e60b1705f1e2339ddb` |
| 1.19–1.20.1 | LWJGL OpenAL 3.3.1 | `30a474d0e57193d7bc128849a3ab66bc9316fdb1` |
| 1.20.2–1.20.4 | LWJGL OpenAL 3.3.2 | `e74f299a602192faaf14b917632e4cbbb493c940` |
| 1.20.5–1.21.11 | LWJGL OpenAL 3.3.3 | `cf83862ae95d98496b26915024c7e666d8ab1c8f` |
| 26.1–26.2 | LWJGL OpenAL 3.4.1 | `08e83fdfdf65c80c9877c6fb6cb645d239ed7638` |
| 26.3 | LWJGL OpenAL 3.4.3 | `097c14cc0c264d64e4200fc319d86f559f8a6931` |

An archive group is not an engine cohort. The pre-1.6 rows may be launcher compatibility metadata rather than the original historical deployment; a note-block applicability decision and the original client registration still need review. Conversely, identical archive bytes do not settle Java codec, game-volume composition or context attributes. Extract and record the actual DLL hashes and runtime version strings before accepting a native member.

## Original-code boundaries missing from a dependency-only plan

The following distinctions are visible in the checked original classes. They are reasons to test or split candidates; they do not by themselves certify every intermediate version:

| Boundary | Actual original-code distinction | Remaining acceptance work |
| --- | --- | --- |
| Legacy LWJGL 2 | Original Paulscode library computes attenuation in Java float, with OpenAL rolloff disabled | Client registration, volume composition, world delivery and full native/world recording for each justified legacy family |
| 1.13 port | Original `SoundManager` registers Paulscode `CodecJOrbis`; `SourceLWJGL3` retains Java attenuation | Complete 1.13 game capture; compare 1.13.1/1.13.2 call sites before deriving membership |
| 1.14–1.14.3 | Outside the 44-profile comparison; 3.2.1 and 3.2.2 native candidates differ | Identify original obfuscated roles manually, prove decoder/context/PCM behavior, then record both native candidates |
| 1.19 | `Library` introduces game-controlled HRTF; this first version enables HRTF when requested | Verify its enable-only path, including device defaults; do not inherit the later explicit-disable behavior |
| 1.19.1 | `Library.setHrtf` handles both enable and disable using device reset | 1.19.2 in-progress capture can anchor this narrower candidate; also compare listener and engine call paths |
| 1.20.2 | Explicit context attribute `6554 = 1` appears, alongside the new 3.3.2 native archive | Record requested and applied context settings, default/explicit limiter state and dense mixing |
| 1.20.5 | Original audio decoder changes from STB to `JOrbisAudioStream` / float-sample buffering | Existing 127 worlds anchor this client; decoder/PCM and source identities must be compared before assigning later releases |
| 1.21.5 | HRTF selection moves into context-creation attributes rather than a separate device reset | Actual HRTF off/on and applied-state recording at context creation; existing 1.20.5 context probe does not exercise this path |
| 1.21.9 | Master moves from listener to source; final master/category gain is multiplied after instance clamp | Correct the product path and record category/master sweeps plus polyphony; default-volume tests cannot distinguish it |
| 1.21.11 | `gainBySource` is added and multiplied after the final setting volume | Default 1 and modified category-gain state; reload/stop reset behavior; this is not represented by a separate current fact field |
| 26.1 | New canonical copper instruments and a new native archive candidate | Actual instrument/material selection, every new sample and the current gain/HRTF path; 16-instrument reports do not cover four new sounds |
| 26.3 | Another native archive candidate, plus changed selected source code | In-progress 26.3 worlds must retain master tests and record the actual context/settings; test source changes rather than inheriting 26.1 |

Examples of why whole-class hashes alone are insufficient: `Channel`'s normalized generated source is identical from 1.18.2 through 1.21.10, while `Library`, decoder and volume composition change within that range. Other hashes change because generated locals or surrounding classes change. A stable or changing hash should select work for review, not determine its conclusion.

## Precise master/category evidence for 1.21.9 and later

The official client SHA-1 was rechecked for all nine clients below, and the original `Options` bytecode was inspected with `javap -c -p`. For obfuscated clients the Mojang mapping SHA-1 was also rechecked. No original class was modified or recompiled for this inspection.

| Release | Original client SHA-1 | Options class | Options class SHA-1 |
| --- | --- | --- | --- |
| 1.21.8, preceding behavior | `a19d9badbea944a4369fd0059e53bf7286597576` | `fui` | `89ac18d22b7a948d5e9186c319b3239fbc6d08bf` |
| 1.21.9 | `ce92fd8d1b2460c41ceda07ae7b3fe863a80d045` | `gad` | `d8018102a09109c9c82aeea38eea9f82f2bb70f1` |
| 1.21.10 | `d3bdf582a7fa723ce199f3665588dcfe6bf9aca8` | `gad` | `d8018102a09109c9c82aeea38eea9f82f2bb70f1` |
| 1.21.11 | `ba2df812c2d12e0219c489c4cd9a5e1f0760f5bd` | `gfo` | `efe0da6fabd6378ca83dc2532e3176b8efdb35b9` |
| 26.1 | `191771837687b766537a8c4607cb6fad79c533a1` | `net.minecraft.client.Options` | `75de037762dd8227be6b8c60601f590362948cc2` |
| 26.1.1 | `377031a9e733ba8ab4d355959a8f6fb8eb707556` | same named class | `75de037762dd8227be6b8c60601f590362948cc2` |
| 26.1.2 | `4e618f09a0c649dde3fdf829df443ce0b8831e65` | same named class | `75de037762dd8227be6b8c60601f590362948cc2` |
| 26.2 | `2dc72797acbc1b63fc16a11c4ac393605f453754` | same named class | `ae5e66767d82c64d7f48dab4f2fda9672fb41b8d` |
| 26.3 | `e877b6a07acd633fb3bb475002175cec036e7b87` | same named class | `28a63816deac743caf3bdf1a7457cc101e1ecdc8` |

In every inspected `Options` class, reading a volume option calls `Double.floatValue`: each slider value is first rounded to Java float. `getFinalSoundSourceVolume(MASTER)` returns that master float directly. For `RECORDS` and other non-master categories, it reads the category float, reads the master float, then executes `fmul`: **category × master, rounded to float before returning**. The existence of this helper is not itself the 1.21.9 boundary: 1.21.8 already has it but its `SoundEngine` does not use it for this source calculation.

Let `F(x)` mean IEEE-754 float rounding and `C(x)` mean clamp to [0, 1]. Let `V` be the original float instance volume, `R` the category float, `M` the master float and `G` the additional category-gain float (default 1):

| Checked phase | Source gain, preserving float multiplication order | Listener gain |
| --- | --- | --- |
| Modern checked clients through 1.21.8 | `C(F(V × R))` | `M` |
| 1.21.9 and 1.21.10 | `F(C(V) × C(F(R × M)))` | 1 |
| 1.21.11, 26.1, 26.1.1, 26.1.2, 26.2, 26.3 | `F(F(C(V) × C(F(R × M))) × G)` | 1 |

`gainBySource` defaults to 1. `updateCategoryVolume` stores a clamped float and refreshes affected sources; `stopAll` clears that map. Do not silently treat an arbitrary non-default map state as measured merely because the default is 1. The source attenuation distance is computed from the original instance volume, independently of the final master/category gain; moving master multiplication must not also shrink the distance.

The relevant generated source locations are:

- `1.21.8/named/hwu.java`: listener master assignment at line 125; old volume expression at line 461.
- `1.21.9/named/ihn.java` and `1.21.10/named/ihn.java`: no listener master assignment; new volume expression at line 448.
- `1.21.11/named/iqo.java`: default category-gain map at line 93, update at line 170, reset at line 185, left-associated volume expression at line 448.
- `26.1`, `26.1.1`, `26.1.2`: named `SoundEngine.java`, volume expression at line 452.
- `26.2`: named `SoundEngine.java`, volume expression at line 454.
- `26.3`: named `SoundEngine.java`, volume expression at line 466; named `Listener.java` has no gain setter/getter and `reset` only resets its transform.

All paths above are relative to `.research/source-comparison/`. Original `Options` instructions can be reproduced read-only with `javap -classpath .research/clients/26.3.jar -c -p net.minecraft.client.Options`; use each checked mapping for older obfuscated class/method names. The pinned official [1.21.9 metadata](https://piston-meta.mojang.com/v1/packages/f928a4d0de2b6a48fac1e12e92516df7b5843002/1.21.9.json) and [26.3 metadata](https://piston-meta.mojang.com/v1/packages/61fff1316bd50312624a858bbb5eb18fa45208ed/26.3.json) identify the original clients and mappings used.

The current generator discovers `volumeRule` through a regex for `clamp(...getFinalSoundSourceVolume` in `SoundEngine`. That correctly records the observed 36/8 split, but it does not inspect `Options`, encode listener-master placement, or represent `gainBySource`. `Options` is absent from the 742-class comparison set. A future fact generator should record all three behaviors and their original class/method identities, rather than infer master placement from the label `category-after-clamp` alone.

## What early releases still lack

- **1.14, 1.14.1, 1.14.2, 1.14.3:** no official `client_mappings` in the cached metadata, and the comparison script skips them. Cached original bytecode is available; the absence of mappings is a tooling gap, not evidence that these releases cannot be analyzed. Identify the codec, channel/listener, context and `SoundEngine` methods by original references and instruction bodies, compare against the first mapped 1.14.4 client, and retain a separately reviewed role map. Record 3.2.1 and 3.2.2 native settings independently.
- **1.13.1/1.13.2:** the explicit legacy registry currently covers only 1.13. Shared dependency declarations do not prove these clients use the same codec registration, source arithmetic, volume clamp or world packet behavior.
- **1.6.1–1.12.2:** the application recognizes the exact Paulscode library identity and can choose the legacy decoder, but that metadata match is not a per-client review of registration and gain composition. The existing original 1.12.2 codec invocation, native smoke and 2,005-case Paulscode arithmetic probe do not replace a full 1.12.2 world/mixer capture. The 1.7.3 and 1.7.4 index-path gaps also need handling before claiming resource support.
- **Earlier formal releases and historical alpha/beta clients:** select the actual resource namespace and original configuration first. The `pre-1.6` index contains both `newsound/note/...` and `sound3/note/...`; the `legacy` index contains `sound/note/...`, `sounds/note/...` and root `sounds.json`. Which one the original client selects must be established from its code, rather than guessed from matching filenames. A client predating usable note blocks should get a documented applicability decision, not a fictitious audio pass.

At the snapshot, `audioProfile` derives its status from the modern fact/validation files only. The separate 1.13 legacy fact can enable a checked implementation while the UI still remains `unverified`. `java-releases.json` also retains generic `behaviour: pending` / `gameRecording: pending` fields for every catalog record, including measured clients. Those are inventory fields, not the authoritative accepted measurement status. Any presentation of totals must use the correct registry layer.

## Executable next batches

### Batch 0 — complete the independent work already running

Complete 1.13, 1.19.2 and 26.3 using their actual instrument sets and original context paths. Keep master-0.7 and simultaneous-source scenes in 26.3; a master-1-only pass would hide the defect above. Update the version-aware validation/world-fact generators together with their provenance checks. At this snapshot, their accepted-version loops contain only 1.16.5 and 1.20.5, so regenerating them unchanged would discard later registrations.

### Batch 1 — test the observed modern gain and context boundaries

Use 1.21.8 and 1.21.9 as a before/after pair. First add a small original-class volume probe over source volume, category, master and float-boundary inputs; compare processing order exactly. Then capture the actual world with category settings 0.2, 0.5 and 1, master 0.7 and 1, and representative polyphony at both HRTF settings. For note-block instance volume 3, category 0.5/master 1 distinguishes the old clamped product from the new post-clamp setting product. Master reduction plus polyphony additionally tests source-versus-listener mixing and quantization.

Add a 1.21.5 context-creation representative and a 1.21.11 category-gain state probe; these distinguish original behavior that a 1.20.5-to-26.3 comparison skips. Record requested and applied HRTF/limiter settings and read errors immediately. Do not promote all releases between two anchors until the intervening relevant call paths are reviewed.

### Batch 2 — close the early-1.14 source and decoder gap

Create reviewed obfuscated-role maps for 1.14–1.14.3 from their already checked clients. Check the actual codec registration/read-all path, float PCM quantization, source gain/pitch/attenuation, listener gain, source pools and context attributes. Invoke the original decoder for every available canonical sample before world capture. Record at least a 1.14/3.2.1 candidate and 1.14.3/3.2.2 candidate, then compare 1.14.1, 1.14.2 and mapped 1.14.4 to justify any narrower cohort. The existing `compare-audio-sources.mjs` cannot do this unchanged because it skips clients without mappings.

### Batch 3 — finish the Paulscode/LWJGL 2 pipeline

Start with 1.12.2, where original decoder/native/arithmetic evidence already exists. Capture the full material → note event → sound manager → codec → Java attenuation → OpenAL path, retaining the known legacy tail rather than forcing the modern frame count. Follow with representatives of the earlier distinct Windows native archives, only after resolving their original sample paths and codec registration. Use the 1.13 port as the adjacent transition case, not as proof for all legacy versions.

### Batch 4 — prove memberships inside the remaining modern candidates

Inspect original relevant method bodies and dependencies for the unchecked interval endpoints, particularly 1.14.4–1.18.2, 1.19's enable-only HRTF path, 1.20.2–1.20.4 and 26.1–26.2. Use full source-hash differences only to select methods for review. If codec, gain, spatial, native DLL, event/sample and applied-setting identities match an anchor for a stated scenario set, run boundary/spot regressions and record the derivation. Otherwise split and capture the changed phase. Any unreviewed buffering, source-pool or setting branch stays outside the derived claim.

### Batch 5 — historical applicability and non-default settings

After resource/role mapping, analyze remaining earlier formal releases and applicable historical clients. Separately expand accepted cohorts to 44.1/96 kHz, custom mono/stereo inputs, device selection/default configuration and onset scheduling. The current offline 48 kHz stereo, fixed-listener, aligned-after-`Channel.play` comparisons cannot certify these dimensions. Hardware-output processing and macOS/Linux native libraries require their own evidence.

The established modern reproduction tools remain useful after an adapter supports the selected target: `prepare-audio-fixture.mjs VERSION`, `prepare-world-source.mjs VERSION`, `verify-game-codecs.mjs VERSION`, `verify-game-mix.mjs VERSION --block-size 1024`, then `capture-game-world.mjs --version VERSION` and `verify-game-world.mjs --version VERSION --broadcast --write-evidence`. The world-source helper currently requires official mappings, and capture/validation allowlists must be extended for each new adapter; the commands are not a claim that every listed historical target already runs unmodified.

## Rules for merging a behavior cohort

Before assigning a client to a representative, record all of the following:

1. Original client hash and relevant original class/method identities, including review of changed calls, rather than only a normalized decompiler hash.
2. Actual codec registration, canonical event resolution, sample hashes, decoded rates/channels/frame tails and PCM conversion order.
3. Native DLL identity, Java/OS/architecture, requested and applied context attributes, HRTF dataset/state, output format/rate and render-block size.
4. Source and listener gain placement with Java float/clamp order, pitch and range calculation, attenuation model, source-pool behavior and cleanup.
5. Original support-block/instrument selection and server delivery/player-versus-listener geometry for the claimed game-preview scope.
6. An anchor recording plus explicit boundary/spot regressions, with per-setting counts, source counts, original/editor PCM hashes and all residuals.

Only the client/settings actually captured should be called game-measured. A justified member can reference a narrower source-equivalence derivation, but it must not inherit a “recorded” label or scene count it never produced. This keeps batching efficient without converting shared dependencies into unsupported equivalence claims.

## Audit inputs

- `docs/audio-evidence.md`, `docs/game-recording-acceptance.md`, `docs/status.md`, and the ten accepted `docs/evidence/java-*-world.json` reports present at the snapshot.
- `.research/audio-version-matrix.json`, `.research/release-audio-audit.json`, `.research/audio-source-comparison.json`, `.research/audio-sound-assets.json`, original client JARs, checked mappings and sound-index objects.
- `src/data/java-releases.json`, `audio-facts.json`, `legacy-audio-facts.json`, `world-audio-facts.json`, `audio-validation.json`.
- `src/audio/profiles.ts`, `implementations.ts`, `parameters.ts`, `delivery.ts`, `legacy.ts`; `src/core/releases.ts`, `sound-events.ts`; `electron/main.ts`, `audio-worker.ts`.
- Research and generator scripts named in the sections above. The [official version manifest](https://piston-meta.mojang.com/mc/game/version_manifest_v2.json) and each cached record's `metadataUrl` remain the primary artifact source.

This audit created only this document. It did not change the audio implementation, data registries, existing evidence reports or their accepted scopes.

## Later checkpoint, 2026-10-24

The snapshot above is historical. The current registry contains eight measured subsets and 938 exact scenes, including 1.12.2, 1.14 and 1.20.2. The explicit limiter omission in the editor and recording agent was discovered and fixed; 1.20.5 / 26.3 matrices were completely replaced with preserved-context recordings. Source review now includes 47 selected-parameter profiles (44 mapped modern releases plus three individually audited earlier clients), not 47 full engine reviews. See [current acceptance](game-recording-acceptance.md) and [limiter correction](output-limiter.md) for authoritative counts and limits.


## Windows 0.1.11 checkpoint

The strict registry now contains ten measured subsets and 1,228 exact scenes (1,131 single / 97 simultaneous). All earlier 1,192 recordings were reverified against the current source/fact hashes. Four additional nine-scene cohorts distinguish actual regular-device option behavior from controlled backend HRTF: forced-on/off inversions in 1.19.2 and reset followed by limiter-only context in 1.20.2/.5. Eighty original-class device probes and forty production component configurations are separate evidence, not additional world scenes. See [global/default context findings](hrtf-global-overrides.md).

Strict manual-role and original-component review now adds 1.13.1/.2 and 1.14.1/.2/.3, making 52 selected-core profiles (44 mapped modern + 8 earlier). These five new entries are code-reviewed, with no inherited broadcast or world/mixer pass. Original 1.14.2 fixes stop/cleanup bookkeeping relative to 1.14.1, while 1.14.3 changes native archives; neither fact justifies merging their complete playback behavior. See [patch evidence](historical-audio-patches.md). Earlier formal releases, other native/context families, physical output and timing scopes in the historical plan remain active work.

## Earlier checkpoint, Windows 0.1.12

The strict registry has thirteen measured subsets and 1,401 exact scenes (1,284 single / 117 simultaneous). The independent 1.14.3 matrix adds 127 with its own native binaries and observed camera; 1.21.8 and 1.21.9 add 23 HRTF-off gain-boundary scenes each. Earlier 1,228 recordings were reverified with current source/fact hashes. Their settings and evidence levels are not widened by replay. The 52 selected-core source profiles remain a different count from world coverage.

Five patch delivery/camera audits now validate original same-dimension and strict entity-distance dispatch separately from camera pose; a supplementary original block-event dispatch proof does not add scenes. The 1.14 camera's eye smoothing and first-person offset show why nominal editor ear-height coordinates are not complete world camera projection. World comparisons retain actual observed positions. Generation/player-placement rules remain deferred. See [historical world source](historical-world-delivery.md).

The new 1.21.8/.9 original component probes retain 109 signed-zero bit residuals rather than claiming universal gain-bit identity. The actual-world PCM comparisons remain strict. HRTF-on, complete instrument matrices and other settings for these two versions are pending. See [volume-boundary scope](volume-boundary.md). Mac native runtime, additional sample rates/devices, custom/stereo inputs and onset scheduling remain open.
