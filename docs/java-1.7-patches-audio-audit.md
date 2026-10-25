# Java 1.7.3–1.7.9 selected audio core audit

All seven official releases independently retain the category-before-clamp double-event rule, stored pitch-field clamp before byte transport, five material-selected instruments, listener-owned master gain, and legacy client-player Y offset. The source/finite component evidence supports individually identified code-reviewed resource and parameter profiles. It does **not** establish whole-engine equivalence, original native-context equivalence, allocated channel capacity or world PCM acceptance. World scenes added: **0**. Native contexts invoked or normalized: **0**. Java 1.7.2 remains outside this audit.

The frozen [aggregate index](verification.md), SHA-256 `739d02383f6764b028a8314c2774c6a59c6cd3802bb2dc6fcc7f1fa38567006b`, contains all fourteen per-version source/numeric paths and hashes, exact official identities, changed fields, native dependencies, finite component counts and the twelve rejected mutation types.

## Independently checked originals

These clients supply no official client mappings. Semantic names in the reports are manual roles discovered from each original client's strings, descriptors, fields, inheritance and actual callers. Each report binds **53 original client/dependency classes and 74 method-role bindings (72 distinct methods)**, complete method Code hashes, all declared fields, raw class/disassembly hashes, and exact artifact ownership. Content-addressed disassembly caching only avoids repeating work for identical whole class bytes; it does not replace that client's role, caller or field verification.

| Version / official metadata | Original client SHA-1 | SoundEngine / NoteBlock / note tile | Original Options map |
|---|---|---|---|
| [1.7.3](https://piston-meta.mojang.com/v1/packages/cd133f90b7e339c50b3cdce64188a51469c6a128/1.7.3.json) | `feaf10fa9da94c388f2c53a2cf31a14406d0c532` | `btw` / `ala` / `aoc` | `bac.aX` |
| [1.7.4](https://piston-meta.mojang.com/v1/packages/5db9d89cb6b89573384f324aa585b4c99525b37a/1.7.4.json) | `900950d8e3217b3a42405d1ecf767dcc31239d69` | `btw` / `ala` / `aoc` | `bac.aX` |
| [1.7.5](https://piston-meta.mojang.com/v1/packages/4afb628501a6a206b80a47ab4f29ea6b98caac90/1.7.5.json) | `77aa70ac5054cbf1140b6449b579e950d5050c4a` | `buc` / `alg` / `aoi` | `baf.aX` |
| [1.7.6](https://piston-meta.mojang.com/v1/packages/b6dd3e6496ad415f0c57867dea1f97710d5f184c/1.7.6.json) | `6b2c5827994e17f904f0852f962dd6fccfbb8bdc` | `bvt` / `ami` / `apk` | `bbh.aW` |
| [1.7.7](https://piston-meta.mojang.com/v1/packages/47e228263557da73d0e2be803e5d83e5b246ae75/1.7.7.json) | `e520f254a2b496d61839b816d712e238b1243f30` | `bvt` / `ami` / `apk` | `bbh.aW` |
| [1.7.8](https://piston-meta.mojang.com/v1/packages/03d8e2e1c192d48ffc406cb7a483861cf26dfe25/1.7.8.json) | `83ae44189888a873f46f7509a87ebdb6dc785741` | `bvv` / `ami` / `apk` | `bbi.aW` |
| [1.7.9](https://piston-meta.mojang.com/v1/packages/5579bc9e25a9bb5e3187a2570693a0c6658edce4/1.7.9.json) | `fbbaae784b1de315a8d08a82c6c345a583fb676b` | `bvv` / `ami` / `apk` | `bbi.aW` |

This is four class-name layouts and a real Options field boundary, not one configuration applied to all clients. Matching names or dependency hashes were never taken as proof that their callers or fields were unchanged.

## Complete ordinary note route

For example, the [1.7.3 report](verification.md) independently binds:

```text
aoc.a(afs,int,int,int): air guard, original base material and queue request
mm.c(int,int,int,ahz,int,int), mm.a(afj): server queue, block identity and dispatch
ala.a(afs,int,int,int,int,int): float note power, event name, position and volume3
afs.a(double,double,double,String,float,float): original WorldListener dispatch
mi.a(String,double,double,double,float,float): original gt constructor
lg.a(xq,double,double,double,double,int,fk): player entity/dimension delivery
bjw.a(gt), bka.a(double,double,double,String,float,float,boolean)
btb original positioned instance -> buc.a(btg) -> btw.c(btg)
btw gain/pitch helpers, original instance getters and selected event doubles
```

Every other report binds its own complete owner/member/descriptor and Code identity for this route. The client's separate block-event receiver invokes the NoteBlock again, but its corresponding WorldListener sound method is empty, preventing a second unpacketized note. That gate is checked separately from sound-packet delivery. Direct client-local sound APIs are not all packet-quantized by this conclusion.

Each original note tile selects dirt/default → event0 `note.harp`, stone → event1 `note.bd`, sand → event2 `note.snare`, glass → event3 `note.hat`, and planks/wood → event4 `note.bassattack`. The original NoteBlock uses branches inside its event method rather than a 1.8-style static instrument array. Each original tile trigger was invoked with actual registered blocks after that client's original block-registration method, an isolated World block lookup and queue receiver; five material choices and the non-air-above guard passed. These callbacks are component inputs, not a game world.

Each original event evaluates `Math.pow(2,(note-12)/12d)` and narrows once to Java float. All five instruments × all 25 notes were invoked through the original event, captured sound callback, original packet constructor, actual original Netty write/read, original positioned instance/getters and original engine helpers. The actual server connection is proven by source bindings; the component test does not run a server or network connection.

## Double event arithmetic and packet field clamp

With `F` denoting Java float rounding, `CD` double clamp, `V` the instance float, `EV`/`EP` the selected event doubles and `R` the category float, all seven original helpers compute:

```text
gain  = F(CD(double(V) * EV * double(R), 0, 1))
pitch = F(CD(double(transportedPitchFloat) * EP, .5, 2))
```

The strict binding checks the entire gain opcode order. The category is multiplied before the double clamp, unlike the separately reviewed 1.8 rule. For a note with raw volume3, event volume1 and category `.5f`, each original engine returns source gain1. The 1.8 order returns `.5f`. Each client's 1,307 finite inputs include 872 differences from the category-after-clamp alternative and 258 differences from prematurely narrowing event/intermediate products to float. Those counts describe this finite input fixture, not additional game scenes.

Original JSON leaf scalars are floats widened to double; selected event composition remains double. Each original leaf/composite call yields volume `0.480000026226044` from widened `.8f × .6f` and pitch `0.7700000035762784` from widened `.7f × 1.1f`. Parent and selected-child methods, the nested resource accessor, JSON deserializer registration, resource definition builder and actual engine getters are all bound to the target client's originals.

The packet constructor converts `F(pitch * 63f)` to Java int, then updates the **stored integer field** to stay within 0–255. Three field stores cover initial conversion, negative clamp and upper clamp. Its writer sends a byte, the reader receives it unsigned, and the getter divides by `63f`. Unlike 1.8, it does not leave the integer field unclamped and wrap out-of-range input.

Each client's 42 packet boundaries execute the actual Netty roundtrip. Pitch5 becomes constructor field255 and wire255, rather than wire59; its transported pitch is `4.047618865966797`, then engine clamp2. Negative pitch becomes field0/wire0 and engine clamp `.5f`. Ordinary notes0–24 encode31–126. Note0 transports `31/63f` and is clamped back to `.5f`; note1 transports `33/63f`.

The proposed production fact deliberately has no wrap field:

```json
{
  "soundEventArithmetic": "double-event-scalars",
  "volumeRule": "category-before-clamp",
  "masterVolumePlacement": "listener",
  "pitchTransport": {
    "kind": "unsigned-byte",
    "scale": 63,
    "minimum": 0,
    "maximum": 255
  }
}
```

`pitchTransportDetail` separately records the constructor-field clamp and byte transport. The master-category/load paths call original `setMasterVolume`, and the original library writes listener `AL_GAIN`. Master is not folded into each source. Original raw instance volume determines range before source gain clamping; ordinary volume3 with distance16 gives48. Original codec registration, `CodecJOrbis.readAll`, buffer upload, Java source distance/gain/upload and channel play are bound, but no new codec waveform or native mix is measured.

## Server feet, legacy client Y and game HRTF control

Each server delivery method uses same-dimension server-player entity coordinates and strict squared distance `< range²`. The separate block-event notification radius64 is not the sound-delivery radius48. Original dimension and coordinate fields are discovered independently for each version.

Each ordinary client player initializes legacy field `L` with `1.62f`; each server player explicitly sets it to0. The server teleport method adds widened `float32(1.62)` to server feet Y. The client receiver passes transported coordinates to the direct position setter; the alternate feet setter adds the offset, while bounding-box construction subtracts it. Minecraft supplies its actual client player to the SoundManager listener call. The listener interpolates player XYZ and does **not** add another eye-height getter or offset.

The profile adapter retains the nominal editor standing reference1.62 and exact Java float `1.6200000047683716`, separately from server feet and ordinary client Y. It explicitly excludes non-standing poses, world float rounding, complete editor-to-world placement and native/world equivalence. Using the 1.8 player-position-plus-eye-getter model here would add the eye offset twice.

Every original game client was scanned and bound independently: 1,822 classes each for 1.7.3/.4, 1,833 for 1.7.5, 1,867 each for 1.7.6/.7, and 1,869 each for 1.7.8/.9. There are no HRTF/reset/extension references in those clients. The reviewed game constructor registers Paulscode, the loader starts it, Library calls no-argument LWJGL `AL.create`, and the declared wrapper chain reaches the original attribute builder and context call without a game HRTF request. Together with the original Options class, this supports **no game HRTF control**, `device-default`. It does not measure backend HRTF capability or effective native context attributes.

## Resource and native boundaries

All seven use the already proven default-domain root index layout: logical `minecraft:sounds.json` / `minecraft:sounds/note/...` resolve through raw keys `sounds.json` / `sounds/note/...`. Each current report rechecks its official index, actual definition object, original reload/default-pack path, five material-selected event definitions/category and sample byte hashes. The [earlier resource-only audit](legacy-sound-assets.md) remains unchanged; its extra `pling` resource is not promoted to a sixth material instrument.

There is a real dependency boundary inside this family:

| Releases | Official Windows dependency | Native archive SHA-1 | JNI `lwjgl64.dll` SHA-256 |
|---|---|---|---|
| 1.7.3–1.7.4 | [2.9.1-nightly-20131120](https://libraries.minecraft.net/org/lwjgl/lwjgl/lwjgl-platform/2.9.1-nightly-20131120/lwjgl-platform-2.9.1-nightly-20131120-natives-windows.jar) | `d2330e003d621521b11dc729a8f8d5aa21875ca7` | `1c712fd013495b7008c9561ab4aa157dc41b2d494aecf40fed628411c61ed2b3` |
| 1.7.5–1.7.9 | [2.9.1](https://libraries.minecraft.net/org/lwjgl/lwjgl/lwjgl-platform/2.9.1/lwjgl-platform-2.9.1-natives-windows.jar) | `4c517eca808522457dd95ee8fc1fbcdbb602efbe` | `19ddc120c3f382cebc249da69f7cec7d71f7a665054f8d6f5c6f5bde6cfd2297` |

The individually extracted OpenAL64 bytes have SHA-256 `9261b66010a845ddef9f61d5e4266fe2f08a53f3605da002e9e8f8d202bdbc5e`. This identity is not used to inherit backend support, valid original JNI attributes, measured capacity, or world acceptance. The source reports explicitly say native context evidence is not reviewed or normalized. A declared Java attribute buffer must not be substituted for its effective JNI pointer or treated as proof that an adapter preserves an original context.

Original static pool getters return28 normal plus4 streaming in each separate process. The actual library allocation loops and non-priority source reuse are bound. Configured28 is not proof of allocated28, simultaneous-note capacity or renderer truncation behavior.

## Strict consumers, counts and freeze

`scripts/review-lwjgl217-patches.mjs` exports `reviewLwjgl217Patch(version, filename?)`, `lwjgl217PatchVersions` and `lwjgl217PatchFacts`. It re-discovers each original role, checks the exact owner set, artifacts/classes/all method Code/all fields, rebinds changed callers, verifies resources and Windows native identities, and rechecks every final raw input/output, compiled probe class, classpath, configuration and terminal successful process. Negative zero stays `"-0"` in the input JSON; consumers convert entries using `Number` before evaluation. All nine helper/source dependency identities are bound in each source report.

`scripts/review-lwjgl217-patch-profiles.mjs` exports `reviewLwjgl217PatchProfile(version)` and `reviewLwjgl217PatchProfiles()`. The latter returns seven `legacyProfiles`, seven `worldProfiles`, their `sourceEvidence` identities, and `newWorldScenes:0`. Each entry is obtained only after the strict original review; all have pending world recording status and no inherited native-context acceptance.

```text
node scripts/review-lwjgl217-patches.mjs
node scripts/review-lwjgl217-patch-profiles.mjs
node scripts/verify-lwjgl217-patches-audit.mjs
```

Final components total **9,149 engine cases, 875 original five-instrument note paths, 294 packet boundaries and 35 material choices**, plus each client's guard, actual selected composite and static pool getters. Shared input tuples were reused only as inputs; target-version outputs were freshly invoked. Repeated preparation runs are retained ignored and are not added to these counts.

Seven strict source reviews and all fourteen proposed profile entries pass. Twelve corrupted copies per version are rejected: client identity, Options field, method Code, gain order, packet-wrap claim, listener model, pool64, native bridge, missing caller owner hidden by a duplicate class, component count, canonical sample and dimension requirement. All **84** rejection records remain under `.local/lwjgl217-patch-validation/`. Six new JavaScript files pass syntax checks; the independent Java probe compiled and every final child exited0. Frozen 1.7.10 and 1.8 strict reviews still pass unchanged.

Frozen helper SHA-256: `154157e6b17cdfb86201fbfbf2d00609f772bb77f89b0ab8671474ff9637d128`. Profile adapter SHA-256: `e22329ce15a3327eed3c4364172c8824e7902ad3c2bbb753508a4d2d0988ee02`.

The audit adds six JavaScript files (`audit-lwjgl217-patches`, `lwjgl217-patch-bindings`, `probe-lwjgl217-patches`, `review-lwjgl217-patches`, `verify-lwjgl217-patches-audit`, `review-lwjgl217-patch-profiles`), `scripts/java/Lwjgl217PatchMethodProbe.java`, fourteen per-version `java-V-audio-source.json` / `java-V-numeric-components.json` files, the aggregate index and this document: **23 files**. Original class/disassembly/resource files remain ignored under `.research/lwjgl217-patches`; component processes and binaries remain under `.local/lwjgl217-patch-methods`. No prior frozen report, shared fact, generator or product file was changed, and nothing was committed.

Production integration is a separate follow-up. Preparing or running a new production comparison must preserve these source/numeric identities and must not add world coverage.

## Subsequent production integration

The root generators have now integrated all seven independently reviewed releases through the strict profile adapter. The application has **75 selected core source-reviewed profiles** in total. Each of these seven profiles reports **`code-reviewed`**, a configured voice warning of28, no measured-world summary and no world-validation registry entry. Their world-fact entries describe the source-derived feet/listener reference model; they are not world measurements.

The independent [production integration report](verification.md), SHA-256 `d7fac2873686b20783da0d5e4b0606a4a0537908c409eb4c7dd71e8279382235`, records **29,092 actual bit comparisons**, all exact:

| Compared production path | Per release | Seven-release total |
|---|---:|---:|
| Gain and event-pitch helpers against1,307 archived original Java engine tuples | 2,614 outputs | 18,298 outputs |
| Original125 note paths: packet/event pitch, category-half gain, actual vanilla pitch, studio emitted pitch and studio raw instance volume | 750 outputs | 5,250 outputs |
| Registered packet constructor-field clamp boundaries | 42 outputs | 294 outputs |
| Explicit event metadata through actual vanilla `noteAudioParameters`: unity, original float leaf and original double composite,375 input cases | 750 gain/pitch outputs | 5,250 outputs |
| **Total** | **4,156** | **29,092** |

The first three groups read the frozen original Java binary words. The explicit non-unity event group reuses the hash-verified frozen probe classes and each original client/dependency classpath in seven independent Java processes, all terminal exit0. Those originals produce new independent engine output buffers for category1 and the previously observed packet wire pitch/scalars; production formulas do not generate the expected values. The wrapper's repeated125-note and42-packet outputs only confirm unchanged original component identity and are not counted as new note cases or world scenes. Studio comparisons retain the original emitted pitch and raw instance volume; the non-unity event variants are checked in vanilla mode only.

The comparison binds generated legacy facts SHA-256 `c867bd2bb1533553768930e57bc437e0fb63a69f4b114cc73a07eda0b5f63f01` and world facts `017afb21108aba06e7bcc303b7b7c708389d1f983f0da914ee6a32aef189ebca`. Its script is `scripts/audit-lwjgl217-patch-integration.mjs`; full original Java inputs, outputs, process terminal records, source hashes and comparisons remain in `.local/lwjgl217-patch-integration/run-1792799784897/`. The frozen source/numeric reports and audit helpers remain unchanged.

This establishes the current production scalar and note-parameter integration. **Native-context equivalence, backend capability for these seven clients, successful allocated voice capacity, codec/native mixer waveform, scheduling and original game-world output remain unverified by this integration.** The listener/master and standing-reference assertions are source-derived parameter checks, not native listener or world readbacks. No game or native context was started; no world scene, world acceptance or measurement status was added.

The final integration also binds the current validation registry SHA-256 `ce78da2f4dd7adac9be80a26d5cb39917855ed4b4cb604a07f7d47c6024f8e3d` (13 measured profiles / 1,479 existing world scenes). All seven new profiles remain absent from that measured registry. The final rerun retains the same29,092 comparison cases and adds no coverage; prior run outputs are preserved as historical local artifacts.
