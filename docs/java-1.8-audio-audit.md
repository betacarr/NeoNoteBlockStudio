# Java 1.8: category volume after the instance/event clamp

This independent audit establishes a real 1.8 sound behavior boundary. It adds source and original-class component evidence, **zero world measurements**, and no product/shared-fact changes. It does not extend the result to 1.8 patch releases or to 1.9.

For an ordinary note-block sound with original instance volume 3, event volume 1 and category volume .5, original **1.8 source gain is .5**. The reviewed 1.7.10 method instead produces 1. Reusing its formula for 1.8 would be incorrect even though the Windows native artifacts are identical.

## Identity and strict review

The [official 1.8 metadata](https://piston-meta.mojang.com/v1/packages/9eb165eef46294062d8698c8a78e8ac914949e7a/1.8.json) has SHA-1 `9eb165eef46294062d8698c8a78e8ac914949e7a`; its [original client](https://launcher.mojang.com/v1/objects/d722504db9de2b47f46cc592b8528446272ae648/client.jar) has SHA-1 `d722504db9de2b47f46cc592b8528446272ae648`. It supplies no official client mappings. Semantic names in this audit are manual roles, selected from original strings, fields, descriptors and callers; they are not presented as official mappings.

[The source report](verification.md) records 50 original client/dependency classes and 46 selected bindings, including complete class/method Code hashes, all declared fields, exact official artifact identities, and hashes of ignored raw class/disassembly/decompilation files. Original source and game resources remain under `.research/lwjgl218-source` and are not distributed. `reviewLwjgl218Source(filename?)`, exported by `scripts/review-lwjgl218-source.mjs`, rechecks these records against the official cached bytes. It also verifies the exact gain-method opcode sequence, the packet's field assignment versus unused local clamp, all resource/sample identities, and the archived component outputs.

```text
node scripts/review-lwjgl218-source.mjs
```

The unchanged report passes; eleven corrupted copies are rejected: client identity, semantic role, missing class, method Code hash, binding hash, volume rule, event arithmetic, packet overflow rule, native DLL identity, canonical sample identity and component count. Results are retained in `.local/lwjgl218-source-validation/results.json`.

Frozen SHA-256 identities:

| File | SHA-256 |
|---|---|
| `docs/evidence/java-1.8-audio-source.json` | `a93c191ab07443b4f877d24926a43b608f6b44960545990512b9169860257e19` |
| `docs/evidence/java-1.8-numeric-components.json` | `89de79975602b2d31ed6c52c00483b7e49a2a7c1d3918bd69e1c7dd42112f06d` |
| `scripts/review-lwjgl218-source.mjs` | `344bee1e305a4fcf47bd76c0891508f44e07c3f654313c60d3148133aee72bf3` |

## Exact gain and pitch order

Let `F` mean Java float rounding, `CD` mean a double clamp, `V` be the instance float volume, `EV` and `EP` the selected event's double volume/pitch, `R` the category float, and `M` the master float.

| Reviewed release | Source gain | Listener gain |
|---|---|---|
| 1.7.10 | `F(CD(double(V) * EV * double(R), 0, 1))` | `M` |
| **1.8** | **`F(F(CD(double(V) * EV, 0, 1)) * R)`** | **`M`** |

Original 1.8 `cza.a(Lcye;Lcyz;Lcxz;)F` first calls `cye.e()F`, widens it, multiplies by `cyz.c()D`, calls `uv.a(DDD)D` with bounds 0 and 1, converts to float, obtains the original category float, executes `fmul`, and returns. There is no second gain clamp after that category multiplication. The strict helper checks the entire instruction sequence, not the presence of an isolated clamp or matching dependency name.

Original `cza.a(Lcye;Lcyz;)F` still calculates `F(CD(double(instancePitchFloat) * EP, .5, 2))`. Event doubles must not be prematurely rounded to float. `cyb` stores JSON leaf values as float, `czh` widens them into `cyz`, and original `czg.b()Lcyz;` composes selected child and parent values in double. The component probe selects an actual original `czn` leaf through original `czg`: widened `.8f × .6f` yields volume `0.480000026226044`, and widened `.7f × 1.1f` yields pitch `0.7700000035762784` before the engine's final operation.

The requested original master option remains owned by the listener: `czb.run()` sets the original SoundSystem master at load; `cza.a(Lcxz;F)V` handles the master category through `setMasterVolume`, while other categories recompute source gain with the reviewed helper. Original `LibraryLWJGLOpenAL.setMasterVolume(F)V` writes `AL_GAIN` on the AL listener. A source-category-after-clamp label must therefore not be used to move master onto each source as in newer engines.

The separately inspected cached 1.9 `byv.e(Lbyi;)F` already multiplies its instance getter by the category before a **float** clamp. That is a concrete reason to audit the next client separately. Its complete instance/event chain is not reviewed here, and this audit makes no 1.9 production-support or cohort claim.

## Original material and packet chain

The source report binds this complete ordinary server note path:

```text
bdi.a(World, BlockPos)
  -> original air/material checks and World.c(BlockPos, Block, eventId, note)
  -> qt server block-event queue, identity check and atr.a(World, pos, state, id, note)
  -> ayn.a(World, pos, state, eventId, note)
  -> World.a(x+.5, y+.5, z+.5, "note.<instrument>", 3f, floatPow)
  -> qp server WorldListener
  -> original jv sound packet and sn player delivery
  -> cee.a(jv), cen.a(..., false)
  -> original cxy positioned sound, inherited cxt getters
  -> cza original gain/pitch helpers
```

Actual original `bdi` material checks select:

| Base block used by the component probe | Original field | Event ID | Original event | Canonical instrument |
|---|---|---:|---|---|
| Dirt/default | `aty.d` | 0 | `note.harp` | harp |
| Stone | `aty.b` | 1 | `note.bd` | basedrum |
| Sand | `aty.m` | 2 | `note.snare` | snare |
| Glass | `aty.w` | 3 | `note.hat` | hat |
| Planks | `aty.f` | 4 | `note.bassattack` | bass |

The original trigger also suppresses the event when the material above is not air. The probe invokes that method with an isolated World state getter and queue receiver, using actual original registered blocks and their default states. These are component inputs/outputs, not a loaded world.

Original `ayn` computes `Math.pow(2, (note-12)/12d)` and then converts once to float. The actual server listener constructs `jv`, whose pitch field receives the integer conversion of `F(pitch * 63f)`. Its later clamp operates on the local parameter and **does not update that field**. `jv.b(Lhd;)V` writes the stored integer with `writeByte`; `jv.a(Lhd;)V` reads it unsigned. The wire value is the low eight bits, divided by `63f` at the getter, followed by the original engine pitch clamp. A constructor/getter test alone would miss this overflow behavior.

For ordinary note values 0–24, encoded values fall in 31–126. All five original instruments × all 25 values were invoked through original `ayn`, original `jv` constructor, **actual original packet write/read over Netty**, original `cxy` construction/inherited getters, and original `cza` pitch/gain methods. At category .5, every actual original instance retained volume 3 and produced source gain .5. Note 0 transports `31/63f` and is then clamped to .5; note 1 transports `33/63f`.

Outside that ordinary domain, wrapping is observable. Input pitch 5 stores integer 315; the constructor getter returns 5, but the wire byte is 59, so the received/engine pitch is `0.9365079402923584`. Input pitch -.1 stores -6 and transports unsigned 250, which the engine clamps to 2. These are finite component probes, not claims about normal note-grid inputs. The representational wire bounds 0–255 are not a constructor clamp.

Original `sn.a(Lahd;DDDDILid;)V` uses same-dimension server-player entity coordinates and strict squared distance `< range²`; volume 3 gives range 48. The separate block-event notification radius is 64. Its client counterpart calls the original NoteBlock event again, but original client WorldListener `ckn.a(String,DDDFF)V` is empty, so it does not produce a second unpacketized note sound. The packet quantization applies to this proven ordinary server path; direct client-local sound APIs must not all be globally quantized.

The listener coordinate model also differs from reviewed 1.7.10: original 1.8 `cza.a(Lahd;F)V` interpolates the client player's position **and adds original `ahd.aR()F`**. That getter includes ordinary standing, sleeping and crouching branches. It is not the old “client Y already contains legacy eye offset, add nothing” model. No world pose or camera measurement is added here.

## Resources, codec, native identity and pool

The official 1.8 index, `minecraft/sounds.json`, all five event definitions, and all five sample bytes are individually hash-checked in the source report. Their category is original `record`; their default event volume/pitch is 1. Original `czh` resolves `sounds/<name>.ogg` and registers the selected double-valued sound definition.

Original `cza` explicitly registers `LibraryLWJGLOpenAL` and `CodecJOrbis`. The audit binds original codec `readAll`, library decode/upload, Java linear source gain and master-listener methods. This proves the selected registration/call paths, without claiming a newly measured decoder waveform.

For Windows, the metadata's rules select [LWJGL 2.9.1 native archive](https://libraries.minecraft.net/org/lwjgl/lwjgl/lwjgl-platform/2.9.1/lwjgl-platform-2.9.1-natives-windows.jar), SHA-1 `4c517eca808522457dd95ee8fc1fbcdbb602efbe`; the alternative nightly entry is OSX-only. Extracted hashes are `9261b66010a845ddef9f61d5e4266fe2f08a53f3605da002e9e8f8d202bdbc5e` for `OpenAL64.dll` and `19ddc120c3f382cebc249da69f7cec7d71f7a665054f8d6f5c6f5bde6cfd2297` for `lwjgl64.dll`. Matching the checked 1.7.10 bytes does not establish game-engine equivalence. No native context was created, normalized or measured in this audit.

Original `SoundSystemConfig` static defaults and actual getter invocation return **28 normal + 4 streaming**. Original `Library.init` can allocate fewer channels, and `getNextChannel` can reuse/steal a non-priority normal source. Actual allocated capacity and 28-voice rendering remain unmeasured.

## Integration facts and validation boundary

The strict helper exports `lwjgl218Facts`. The product-relevant behavior fields are:

```json
{
  "soundEventArithmetic": "double-event-scalars",
  "volumeRule": "category-after-clamp",
  "categoryVolumeOrder": "float-after-double-instance-event-clamp",
  "masterVolumePlacement": "listener",
  "pitchTransport": {
    "kind": "unsigned-byte",
    "scale": 63,
    "minimum": 0,
    "maximum": 255,
    "overflow": "wrap"
  }
}
```

Apply float rounding after the double instance/event clamp **and again after multiplication by the category float**. Keep the master on the listener and the attenuation range based on the original raw instance volume. For transport, Java float-to-int conversion truncates with Java saturation/NaN rules, then the wire keeps the low eight bits. `pitchTransportDetail` records the constructor versus wire distinction and ordinary note domain. These are source facts for parent integration; this agent did not modify product behavior or shared registries.

[Original component evidence](verification.md) contains 1,307 finite gain/pitch cases, 125 original note/packet/instance cases, 42 actual packet roundtrip boundaries, five actual material choices, the non-air-above guard, one original composite event and static pool defaults. There are 872 finite cases differing from the 1.7.10 category-before-clamp formula and 38 differing from premature float event composition. Explicit negative zero is retained as the string `"-0"` in the ignored input JSON; consumers must convert input entries with `Number` to preserve its sign. Inputs, binary outputs, console outputs, probe sources and official classpath artifacts are all hash-checked by the strict helper.

The Java probe required one routine reflective-access correction for package-private original `czn` construction; no original class was modified. The input suite was then expanded with nested double-event scalars before final publication so the premature-float regression had actual counterexamples. All final original calls and assertions passed. Reproduction creates new research outputs and is separate from read-only review of the frozen evidence.

Files added for this audit:

- `scripts/audit-lwjgl218-source.mjs`
- `scripts/review-lwjgl218-source.mjs`
- `scripts/probe-lwjgl218-methods.mjs`
- `scripts/java/Lwjgl218MethodProbe.java`
- `docs/evidence/java-1.8-audio-source.json`
- `docs/evidence/java-1.8-numeric-components.json`
- this document

All three new JavaScript files pass syntax checks. The original-class Java probe compiled and passed; strict cached review passed; eleven negative evidence fixtures were rejected. No product build, full product test suite, native/context probe or world capture was run for this research-only change. Nothing was committed, and no acceptance threshold or prior evidence was altered.

## Parent integration and isolated resource fixture

After the source/numeric freeze, the parent integrated the reviewed double-clamp/category order and wire wrapping. Its separate [production parameter report](verification.md) records bit-identical results for 1,307 engine inputs, the 125 original five-instrument note paths and 42 packet boundaries, including the actual project-note parameter path. The report retains zero world scenes and binds its own product sources; it does not turn the source audit into world/native acceptance.

The isolated fixture at `.local/game-fixtures/1.8` is ready for a separate packaged native-component smoke test. Its manifest is `fixture.json`; official asset index ID is **`1.8`**, SHA-1 `f6ad102bcaa53b1a58358f16e376d548d44933ec`. The fixture contains the original verified client and metadata, 29 official classpath dependencies, native dependencies extracted from their official archives, and exactly seven asset objects: indexed `sounds.json` plus six canonical samples (`harp`, `bass`, `basedrum`, `snare`, `hat`, `pling`). `pling` is a resource-only extra, not a sixth support instrument in original 1.8.

Preparation used an ignored private copy of the existing fixture preparer, `.local/audit18/prepare.mjs`, with a distinct helper bundle `.local/research-helpers/fixture18.mjs` to avoid collisions with other work. Client, metadata contents, every classpath artifact, index, all asset objects, and the `OpenAL64.dll` / `lwjgl64.dll` identities were rechecked after copying. The integrity manifest is `.local/audit18/fixture-integrity.json`. No game, world, audio device or user preference profile was opened to prepare this fixture; no packaged smoke result is claimed by this document.
