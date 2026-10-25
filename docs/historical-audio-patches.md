# Historical audio patch audit: 1.13.1–1.14.3

The five patch releases 1.13.1, 1.13.2, 1.14.1, 1.14.2 and 1.14.3 have individually reviewed original audio-core classes and successful original-component comparisons. They can supply source-reviewed production parameters. This audit adds **zero integrated-world recording scenes** and does not transfer an anchor version's measured coverage.

The significant behavior boundary is **1.14.2**: the original sound engine changes stop bookkeeping and fixes category cleanup. **1.14.3** also changes the actual OpenAL and STB native binaries. Neither boundary can be dismissed because the selected gain/pitch formulas remain the same.

## Evidence and reproducibility

The public records are [1.13.1](verification.md), [1.13.2](verification.md), [1.14.1](verification.md), [1.14.2](verification.md) and [1.14.3](verification.md). They contain 26, 26, 28, 28 and 28 original class entries respectively, including the original Paulscode dependency classes for the legacy pair, and 16, 16, 20, 20 and 20 selected method bindings: **136 class entries and 92 bindings** in total. All methods with `Code` bodies in each selected class are hashed, in addition to the selected bindings.

The files include original-client SHA-1, official metadata identity, original class SHA-1/SHA-256, original method instruction SHA-256, raw disassembly/source hashes, official native archive identity and extracted DLL SHA-256. The original jars, extracted classes, disassemblies and decompilations remain in ignored research directories. No original game source, native binary or game texture is redistributed by these public JSON records.

These releases do **not** publish official client mappings in their version metadata. Names such as `SoundEngine` are manual semantic labels for the original obfuscated classes; the audit does not describe adjacent-version or community mappings as official.

The independent integration entry point is [review-historical-audio-patches.mjs](../scripts/review-historical-audio-patches.mjs):

```js
import { reviewHistoricalAudioPatch } from './review-historical-audio-patches.mjs';
const audit = await reviewHistoricalAudioPatch('1.14.2');
// audit.facts contains selected-core source facts only.
```

`node scripts/review-historical-audio-patches.mjs` rechecks all five against the cached, checksum-verified official metadata/client/dependencies; class and method hashes; raw sources/disassemblies; original component output; official audio assets; and archive/DLL provenance. It rejects changed probe/production decoder/source files recorded in the component evidence. Regeneration requires an intentional probe rerun if those dependencies change.

The discovery script is [audit-historical-audio-patches.mjs](../scripts/audit-historical-audio-patches.mjs). Its seven-version inventory includes the 1.13/1.14 anchors and 175 original client class entries. This inventory alone is not a behavioral acceptance claim. Instruction hashes also do not establish semantic equivalence across different constant pools; complete original class identities and reviewed call targets remain necessary.

## Original-client sources

The metadata below supplies the client and dependency checksums used by this audit. Each matching client was read locally and verified before extraction.

| Version | Official metadata | Client SHA-1 |
| --- | --- | --- |
| 1.13.1 | [Mojang metadata](https://piston-meta.mojang.com/v1/packages/f37fe6f0912ddb7ac3e7d5201a73d56ce170a57f/1.13.1.json) | `8de235e5ec3a7fce168056ea395d21cbdec18d7c` |
| 1.13.2 | [Mojang metadata](https://piston-meta.mojang.com/v1/packages/fa3ddc22146c46bfeb0e9d322c6f83b937e25005/1.13.2.json) | `30bfe37a8db404db11c7edf02cb5165817afb4d9` |
| 1.14.1 | [Mojang metadata](https://piston-meta.mojang.com/v1/packages/183e49ba0fabb5ef8a304f8f5907fa887f40c466/1.14.1.json) | `55ba86ddcbc3579397f41910463ffd4056e1e523` |
| 1.14.2 | [Mojang metadata](https://piston-meta.mojang.com/v1/packages/83299b3bf3139ebd9ae5547b3144dcf68d4cb1fd/1.14.2.json) | `ca6c5a139045967229975c0c0b7f93e78b4314c2` |
| 1.14.3 | [Mojang metadata](https://piston-meta.mojang.com/v1/packages/e21618620e02be5a14543d1d17ffdba941d09aa8/1.14.3.json) | `af100b34ec7ef2b8b9cf7775b544d21d690dddec` |

| Version | Library | Channel | Engine | Manager | NoteBlock | Instrument | Options | Decoder/source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1.13.1 | `dgo` | `dgn` | `dgq` | `dgs` | `bge` | `bmj` | `cfv` | Source `dgt`; dependency `CodecJOrbis` |
| 1.13.2 | `dgp` | `dgo` | `dgr` | `dgt` | `bgf` | `bmk` | `cfw` | Source `dgu`; dependency `CodecJOrbis` |
| 1.14.1 | `ctf` | `cte` | `dxu` | `dxx` | `bqc` | `bwl` | `cvo` | `cth` |
| 1.14.2 | `ctf` | `cte` | `dxu` | `dxx` | `bqc` | `bwl` | `cvo` | `cth` |
| 1.14.3 | `ctj` | `cti` | `dxy` | `dyb` | `bqg` | `bwp` | `cvs` | `ctl` |

## Selected production facts

Every patch independently retains category multiplication **before** the source-gain clamp: Java float `clamp(instanceVolume * categoryVolume, 0, 1)`. Master/null category handling returns 1 for that helper; the master slider is applied to listener gain. The original pitch helper clamps instance pitch to `.5..2`. The note event uses `pow(2, (note - 12) / 12)`, record category and volume 3.

All reviewed Libraries call `alcCreateContext(device, null)` and contain no game HRTF reset/selection or output-limiter request. The corresponding Options and engine paths expose no HRTF switch. The correct policy is `hrtfControl: false`, `hrtfControlMode: 'device-default'`, `outputLimiter: 'device-default'`. This describes the original request: it does not assert that the actual device's HRTF/limiter state is off.

For 1.13.1/.2 the decoder is the actual configured `paulscode.sound.codecs.CodecJOrbis`, and attenuation is the original Java source's linear calculation. The source computes distance and gain before applying gain × sourceVolume × abs(fadeOutGain) × fadeInGain. A claim of OpenAL-computed linear attenuation for this pair would lose original Java arithmetic behavior. Their selected facts use `decoder: 'legacy-jorbis'` and `attenuationModel: 'paulscode-linear'`.

For 1.14.1/.2/.3 the actual original client STB pushdata decoder supplies PCM16, converting with `float * 32767.5f - .5f`, Java truncation and signed-short clamp. Channels set linear clamped per-source attenuation, reference distance 0, rolloff 1 and the calculated maximum distance. Their selected facts use `decoder: 'stb'`, `attenuationModel: 'openal-linear'`, `distanceModel: 'linear'`, `referenceDistance: 0`, `rolloff: 1`.

All five have default sample attenuation distance 16, note volume 3 and pitch limits `.5..2`. The play method scales attenuation distance by raw instance volume above 1, yielding maximum distance 48 for an unmodified note sound. This source maximum distance does not establish the server's broadcast rule for these patch releases; broadcast/eye-height facts were deliberately omitted.

### Additional default-definition review

Before the source evidence was frozen, the independent [audit-historical-sound-definitions.mjs](../scripts/audit-historical-sound-definitions.mjs) extracted the original serializer, event registration and sound definition classes for all seven versions. The ignored inventory is `.research/historical-audio-patches/sound-definitions.json`; its individual original sources/disassemblies are under each version's `sound-definitions/` directory. These additional classes were reviewed after generating the five selected-core records; they are supplementary provenance and are **not** silently included in those records' strict class counts or hash chain.

| Version | Serializer | Registration | Definition | Serializer original class SHA-1 |
| --- | --- | --- | --- | --- |
| 1.13.1 | `dfu` | `dft` | `dfs` | `1fe11859e6eb8cb53de863740af17fb6b655056e` |
| 1.13.2 | `dfv` | `dfu` | `dft` | `74f8fd4520dac0b72117811f52bc2dde1186b95f` |
| 1.14.1 | `dww` | `dwv` | `dwu` | `2187f8e15ddc190fbdde76bab0fd1ddd2d3b025e` |
| 1.14.2 | `dww` | `dwv` | `dwu` | `2187f8e15ddc190fbdde76bab0fd1ddd2d3b025e` |
| 1.14.3 | `dxa` | `dwz` | `dwy` | `0c96af461b0fdf0c3276dde38135956732f79b5e` |

In every original serializer, a simple string sound entry constructs a definition with volume 1, pitch 1, weight 1, file type, stream/preload false and attenuation distance **16**. Object entries independently default `attenuation_distance` to 16; explicit values are retained. The definition stores the constructor distance and `j()I` returns it. Event references in the original managers multiply source/reference volume and pitch while retaining the resolved target's attenuation distance. The 1.13 family performs this in the manager's registration routine; the 1.14 family performs it in the manager's registration helper. This confirms the default from actual code rather than importing it from the anchor.

The relevant original instruction hashes are the same across these five class-specific, constant-pool-bound records: serializer `a(JsonObject)List` = `8757e683df7715eba1e026d3f01dfb1fdb2a505e121f2b667b36592a26d98f73`; serializer object-entry `b(JsonObject)SoundDefinition` = `a57faca79932582488ae2b1e95881e110dfdbdf04019e82395a94b65b08966bc`; definition `j()I` = `af19463efa3d2fc2df00c427099b4c4fcd4128fce10dbf35968a60ca5ba2bc38`. The full original class and parsed call targets, not the bare equal instruction hashes, support that reading. These extra serializers have not been invoked as a new runtime probe.

## Actual original-component results

[historical-audio-patch-components.json](verification.md) records the real original-class/dependency invocations run by [probe-historical-audio-patches.mjs](../scripts/probe-historical-audio-patches.mjs) and [HistoricalAudioMethodProbe.java](../scripts/java/HistoricalAudioMethodProbe.java).

| Version | Original engine math cases | Original source cases | Original codec samples | Lifecycle observations |
| --- | ---: | ---: | ---: | --- |
| 1.13.1 | 1,005 exact | 2,005 exact | 11 PCM-exact | — |
| 1.13.2 | 1,005 exact | 2,005 exact | 11 PCM-exact | — |
| 1.14.1 | 1,005 exact | — | 16 PCM-exact | Original pre-fix behavior reproduced |
| 1.14.2 | 1,005 exact | — | 16 PCM-exact | Original fixed behavior reproduced |
| 1.14.3 | 1,005 exact | — | 16 PCM-exact | Original fixed behavior reproduced |

Totals: **5,025 gain/pitch input cases**, **4,010 legacy-source input cases**, **70 original codec sample decodes** and **six lifecycle observations**. Each math case checks both gain and pitch; each source case checks attenuation and gain. These paired assertions are not reported as additional scenes. The 1.13 family has ten material-selected instruments; the eleventh decoded resource is pling, which exists in the sound resources but is not selected by a supporting block in these versions. The 1.14 family has sixteen material-selected instruments.

The math probe calls the actual original private helpers with isolated engine/options state and a proxy implementing the original sound interface. The legacy source probe constructs the actual original source class and compares its distance/gain outputs with the production legacy functions. Codec checks use every resolved canonical fixture sample, invoke the actual original decoder, and compare the full original PCM bytes with production decoding. All sample SHA-1, sample rates, channel counts, lengths and PCM hashes are retained.

The lifecycle probe calls the original stop and tick-cleanup methods on isolated state. Its executor records queued callbacks and intentionally does not execute native channel callbacks. It does not simulate a running world or measure playback timing.

## Behavior boundaries and cohorts

**1.13, 1.13.1 and 1.13.2:** complete CFR outputs for the original Library, Source and Channel match after explicit substitution of discovered original role names and class-derived local names, removal of comments and whitespace normalization. The normalized SHA-256 values are respectively `f5b3fb2bb2f4fbc269dc7d6c1f8617ac99f76a6743eab6923d43ab18a7e73b8d`, `d3de7e5b4f5fd7321f8686be7b213271f2a1dbf509e9de6f174723cfdf451af1`, `f091bde4e4213a0860a8fa0f89c470c31eb9af37e54a43c854ce7d80b91ef3cc`. This normalized-source comparison is auxiliary: CFR warns about reconstructed exception handling in some methods, and raw original instructions remain authoritative. The patch pair also passes its independent original component checks. This supports a selected decoder/source cohort. The entire engine/registry pipeline is not declared equivalent: for example, 1.13.1 changes the registry iteration accessed by engine reload. Whole-world evidence still needs its own source review and recordings.

**1.14.1 → 1.14.2:** 27 of the 28 selected original client classes are byte-for-byte identical. The changed class is `dxu`, the sound engine. Its stop method changes the active map operation from `remove(sound)` to `get(sound)` and stops deleting the expiry entry immediately. Tick cleanup changes category removal from `(category, channelHandle)` to `(category, soundInstance)`. The original-component observations are:

| Phase | 1.14.1 active / expiry / category members | 1.14.2 and .3 active / expiry / category members |
| --- | --- | --- |
| Immediately after stop | 0 / 0 / 1 | 1 / 1 / 1 |
| Finished-channel tick cleanup | 0 / 0 / 1 | 0 / 0 / 0 |

Each stop queues one original channel callback. The cleanup probe queues none. Therefore equal gain/pitch/decoder results do not justify claiming the entire engine is identical across .1/.2. The .2 lifecycle fix is retained in .3.

**1.14.2 → 1.14.3:** official Windows natives move from LWJGL 3.2.1 to 3.2.2, and both actual DLL contents differ. Exact decoding of the sixteen relevant samples is independently established for .3; native mixer/filter/HRTF equivalence has not been measured.

| Versions | OpenAL.dll SHA-256 | lwjgl_stb.dll SHA-256 |
| --- | --- | --- |
| 1.13.1/.2 | `e16e84f069e083e3ac14ccbdb47d17aaa91c8142284af423302a3df999e35caf` | `38b9397ef3df2ff56c28d45e253390fe9ee8c9f8f58688efe4485d6dae6a24fb` |
| 1.14.1/.2 | `be6011a99314ed93a536669fcb475a52793a3c6af43d49061e4f09f4d8f1e5ec` | `c09450580f0e9f7f05666ab80eed09fbec78513502bbe5c61c02e3c9ae64f3a2` |
| 1.14.3 | `1e128050e6ecd9da7a030f76b24d93a1dcb7de55b02d80cd2e2683818e895b5a` | `64b424ce5142ce23b43e2e2bc5cc8543add7c0037a151b279e4e17aa7f7600a0` |

The associated official native artifact URLs, archive SHA-1 and sizes are in each public source/component record. Shared dependency versions are treated as provenance, not a substitute for the original caller and behavior review.

## Remaining measurements and next batches

1. Preserve the five patch profiles at source-reviewed status. Wrong original-client hashes must remain ineligible. No existing 1.13 or 1.14 recording is relabeled as a patch-version measurement.
2. For the 1.13 patch pair, audit the original world/server delivery and listener/camera adapters before an integrated-world run. Reuse the established decoder/source cohort to focus recording on sound registry resolution, startup/context, delivery, and listener coordinates; retain each actual version/client identity.
3. Record a 1.14.1/.2 lifecycle differential using original stop, expiry and category membership under rapid stop/replay and natural completion. Include PCM and original channel/source traffic if it becomes a playback acceptance test. Replaying identical static notes alone would miss the confirmed update.
4. Give 1.14.3 its own native-mixer anchor because the OpenAL binary changes. Cover relevant instruments, pitch endpoints, distance boundaries, master/category combinations and polyphony; record actual device HRTF/profile/limiter state and continuous render history. The game itself exposes no HRTF toggle in these releases.
5. For any final production-vs-world comparison, bind the current worker/decoder/source hashes and retain raw recordings. If those sources change after comparison, rerun the comparison; do not increase counts for rerunning the same recording.

Other than the independent evidence, scripts and this audit note, this work does not modify product audio code, shared fact generators, shared data tables or the overall recording/status totals. Production fact integration is performed by the coordinating agent.
