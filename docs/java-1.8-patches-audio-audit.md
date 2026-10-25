# Java 1.8.1–1.8.9 selected audio core audit

All nine official 1.8 patch releases independently retain the reviewed 1.8 gain order, double event scalars, byte-quantized ordinary server note pitch, five material instruments, listener-owned master gain, player-eye listener model, and configured 28 normal plus 4 streaming channels. This is a selected source/component cohort, not a whole-engine or native-context equivalence claim. It adds **zero world measurements** and **zero native-context measurements**.

The frozen [aggregate evidence index](verification.md) lists every source/numeric report and SHA-256, exact official metadata/client identities, original roles, changed fields, Windows native identities, component counts, and the strict review helper. Its SHA-256 is `074bcf4c3760505d9c535033bfa6a5aab16e16de6af18464a406928025be527d`.

## Original identities and changing callers

The cached official release catalog contains 1.8.1 through 1.8.9. Each metadata file and client is checked against its own official identity; these clients provide no official client mappings. The role names below are manual semantic labels established from original strings, descriptors, fields and callers, not official mappings.

| Version / official metadata | Original client SHA-1 | Engine / NoteBlock / note tile | Options map | Default state | Player eye getter |
|---|---|---|---|---|---|
| [1.8.1](https://piston-meta.mojang.com/v1/packages/62f9f77f67fd7d6c92cfae57cecd445be14ccd4e/1.8.1.json) | `6edd2a3e3d76a7602c52f319f87cf11f7720b43b` | `cza` / `ayk` / `bdg` | `btm.aY` | `P` | `aS` |
| [1.8.2](https://piston-meta.mojang.com/v1/packages/1e35829856a71261f5a7b2b3a83012c7434b2203/1.8.2.json) | `a8e71f6c81acfa834d249579a242f5b0852075c1` | `bpy` / `aij` / `aln` | `avi.aZ` | `Q` | `aS` |
| [1.8.3](https://piston-meta.mojang.com/v1/packages/413ad8fdcf8f29f4f1c2b4425aa0dade00f75dd4/1.8.3.json) | `69d14463ddc22e581bc66c66ef5eb72a8b452c46` | `bpy` / `aij` / `aln` | `avi.aZ` | `Q` | `aS` |
| [1.8.4](https://piston-meta.mojang.com/v1/packages/043b84efde9fc25d849e979329c03101ac9b7795/1.8.4.json) | `459204fabee3fd9976a6c942b24cbd8382d02d6e` | `bpx` / `aii` / `alm` | `avh.aZ` | `Q` | `aS` |
| [1.8.5](https://piston-meta.mojang.com/v1/packages/16da5f5be7478f3602c25182a90f2057ba2f60d8/1.8.5.json) | `5d39957c61d19042f8bd669a6faa99989cf37083` | `bpx` / `aii` / `alm` | `avh.aZ` | `Q` | `aS` |
| [1.8.6](https://piston-meta.mojang.com/v1/packages/acccbb056a3e8f3086c4614974fb3a894317853a/1.8.6.json) | `faa55e34ded35089d34fe921ea83d317fc152e93` | `bpx` / `aii` / `alm` | `avh.aZ` | `Q` | `aS` |
| [1.8.7](https://piston-meta.mojang.com/v1/packages/7152f102903cd3ce7514d84c8ac98efecac30839/1.8.7.json) | `d546a6a092060c85f1eb1d9213ff823c558b1255` | `bpx` / `aii` / `alm` | `avh.aZ` | `Q` | `aS` |
| [1.8.8](https://piston-meta.mojang.com/v1/packages/690172f1227e1c1d2fa8fceadd0f578f7851a69e/1.8.8.json) | `0983f08be6a4e624f5d85689d1aca869ed99c738` | `bpx` / `aii` / `alm` | `avh.ba` | `Q` | `aS` |
| [1.8.9](https://piston-meta.mojang.com/v1/packages/d546f1707a3f2b7d034eece5ea2e311eda875787/1.8.9.json) | `3870888a6c3d349d3771a3e9d16c9bf5e076b908` | `bpx` / `aii` / `alm` | `avh.bb` | `Q` | `aS` |

Every source report contains **49 original client/dependency classes and 55 selected method bindings**, full class byte hashes, all method Code hashes, declared fields, exact artifact identities, ignored raw class/disassembly hashes, and the per-client component configuration. Whole class bytes are cached by their own SHA-1 to avoid repeatedly disassembling identical bytes; a cache hit does not bypass the caller, owner, descriptor or field checks in that client's report.

The four final caller bindings explicitly connect the actual SoundManager constructor to that client's engine, manager play to engine play, ClientWorld to manager play, and manager listener updates to the engine listener method. Starting in 1.8.2, loader/nested-accessor roles include anonymous inner classes, unlike the earlier class layout. The original listener's eye getter changes from the anchor 1.8 `aR` to patch `aS`. Even among patches with the same core class names, the Options map changes in 1.8.8 and 1.8.9. No role configuration was copied solely because class names or dependencies matched.

For example, the [1.8.9 source report](verification.md) binds the complete route through original owners:

```text
alm.a(adm,cj): original note tile material/air checks and block-event enqueue
le.c(cj,afh,int,int), le.a(ade): server queue, block identity and event dispatch
aii.a(adm,cj,alz,int,int): note power, original event name, volume3 and position
adm.a(double,double,double,String,float,float): WorldListener dispatch
lb.a(String,double,double,double,float,float): construct original gs sound packet
lx.a(wn,double,double,double,double,int,ff): same-dimension strict player range
bcy.a(gs), bdb.a(double,double,double,String,float,float,boolean): receive sound
bpf original positioned sound -> bpz.a(bpj) -> bpx.c(bpj): actual play route
bpx original gain/pitch helpers with inherited bpa instance getters
```

The other eight reports bind their own actual owners and complete descriptors, rather than treating this example's names as a universal mapping.

## Gain, event arithmetic and master ownership

Let `F` mean Java float rounding, `CD` mean double clamp, `V` the original instance float volume, `EV`/`EP` the selected event double scalars, and `R` the original category float. All nine original gain helpers execute this exact instruction sequence:

```text
instance volume float -> widen double -> multiply event double
-> clamp double [0,1] -> narrow float -> multiply category float -> return float
```

Thus gain is `F(F(CD(double(V) * EV, 0, 1)) * R)`, and pitch is `F(CD(double(transportedPitchFloat) * EP, .5, 2))`. There is no final gain clamp after the float category multiplication. The reviewer checks the whole gain opcode sequence, not just whether a clamp or multiply exists. A normal note with `V=3`, `EV=1`, `R=.5` yields gain `.5`; the older 1.7.10 category-before-clamp order yields 1.

Each client was invoked with 1,307 finite engine input tuples, including float and clamp boundaries. Each has **872 inputs** that distinguish this order from 1.7.10, and **38 inputs** that distinguish it from prematurely rounding the event product to float. The actual original leaf/composite selection produces volume `0.480000026226044` from widened `.8f × .6f` and pitch `0.7700000035762784` from widened `.7f × 1.1f`. The reused fixture supplies input tuples only; outputs were freshly produced by a separate original-class process for each client.

The original engine registers `LibraryLWJGLOpenAL` and `CodecJOrbis`. It uses raw instance volume to form attenuation distance before the reviewed source gain helper; ordinary volume3 has linear range48. Loader and master-category updates use original `setMasterVolume`, and the original library writes listener `AL_GAIN`. Master must stay on the listener rather than being folded into every source. Registration, codec `readAll`, decode/upload, Java linear gain and source reuse are bound to the original dependency bytes. This audit does not add a measured decoder waveform or execute OpenAL.

## Materials, pitch packet and delivery

Each original tile trigger was invoked against an isolated World callback using its own original bootstrap, registered blocks and default states. The five actual choices are dirt/default → event0 `note.harp`, stone → event1 `note.bd`, sand → event2 `note.snare`, glass → event3 `note.hat`, and planks/wood → event4 `note.bassattack`. Each original trigger also suppresses an event when the material above is not air. The fixture is a component callback, not a game world.

Every original NoteBlock computes `Math.pow(2,(note-12)/12d)` and narrows once to float, with raw volume3. For all five instruments × all 25 note values, the component probe invokes that original event, captures its sound callback, invokes that client's original packet constructor and **actual original Netty packet write/read**, then constructs its original positioned instance and invokes the original getters and engine math. The source-bound actual server listener establishes why that packet path applies to ordinary server notes; the component test itself does not run a server/network connection. Every original instance retains volume3, with gain `.5` at category `.5`.

The packet constructor stores Java's integer conversion of `F(pitch * 63f)`. A subsequent clamp changes an unused local parameter, not the stored integer. The wire writes its low eight bits and reads an unsigned byte, and the pitch getter divides by `63f`. These are separate constructor and wire semantics:

| Finite input | Constructor field | Received unsigned byte | Received/engine result |
|---|---:|---:|---|
| Ordinary notes 0–24 | 31–126 | 31–126 | Quantized by 63, then engine clamp |
| Pitch5 | 315 | 59 | `0.9365079402923584` |
| Pitch−.1 | −6 | 250 | Received value above2; engine clamps2 |

Each client has 42 original packet roundtrip boundaries. The `minimum:0, maximum:255` fact describes received unsigned-byte representation, not a constructor clamp. For any product implementation, preserve Java float-to-int conversion before the low-eight-bit wire wrap.

The actual server dispatch method checks the server player's entity coordinates, same dimension and strict `distanceSquared < rangeSquared`. An ordinary volume3 sound uses48. A separate block-event notification has radius64. The client block-event receiver invokes the original block event, but its sound WorldListener method is empty; this source-bound gate prevents an additional local unpacketized note. These facts apply to the ordinary server note route, not every direct client sound API. Delivery semantics are source-audited here, not newly measured with a server player.

The audio listener interpolates the client player's XYZ and adds that client's original player eye-height getter. The original getter includes standing `1.62f`, sleeping `.2f`, and the crouching subtraction `.08f`. Its stable standing eye value is the Java float `1.6200000047683716`. It is not a camera-position API, a hardcoded camera displacement, or the legacy 1.7.10 client-Y model. The source/caller/field bindings establish this model; no camera pose or listener/world recording is claimed.

## Resources, native family and pool limits

Each metadata's asset index, indexed `minecraft/sounds.json`, five event definitions and five exact `minecraft/sounds/note/*.ogg` bytes are independently checked. Their original category is `record`, with default event volume/pitch1. The manager's original definition builder uses `sounds/<name>.ogg` and double-valued selected event scalars. Per-version report identities support resource/decoder selection without borrowing a neighboring client's hash.

Windows rules select different official LWJGL JNI families within these patches:

| Patches | Official Windows LWJGL archive | JNI bridge `lwjgl64.dll` SHA-256 |
|---|---|---|
| 1.8.1 | [2.9.1 natives](https://libraries.minecraft.net/org/lwjgl/lwjgl/lwjgl-platform/2.9.1/lwjgl-platform-2.9.1-natives-windows.jar), SHA-1 `4c517eca808522457dd95ee8fc1fbcdbb602efbe` | `19ddc120c3f382cebc249da69f7cec7d71f7a665054f8d6f5c6f5bde6cfd2297` |
| 1.8.2–1.8.9 | [2.9.4-nightly-20150209 natives](https://libraries.minecraft.net/org/lwjgl/lwjgl/lwjgl-platform/2.9.4-nightly-20150209/lwjgl-platform-2.9.4-nightly-20150209-natives-windows.jar), SHA-1 `b84d5102b9dbfabfeb5e43c7e2828d98a7fc80e0` | `ebdcedbc3e24b911aacd7bb666ab426397ca7d7883a8d4e3cf28946041c95425` |

Their extracted OpenAL64 identity is `9261b66010a845ddef9f61d5e4266fe2f08a53f3605da002e9e8f8d202bdbc5e`. Equal DLL hashes do not prove equivalent Java request handling or native context attributes. No native context was created, replaced, normalized or accepted in this audit; existing LWJGL2 pointer/context concerns remain outside this selected-core conclusion.

Original static SoundSystemConfig getters return **28 normal and 4 streaming** for each process. The bound original library initializes pools using those getters and may allocate fewer channels; its non-priority normal-source reuse is also bound. This is a configured-pool fact, not proof of actual allocated28, 28 simultaneous notes, overflow behavior, or hardware capacity.

## Frozen review and integration facts

`scripts/review-lwjgl218-patches.mjs` exports `reviewLwjgl218Patch(version, filename?)`, `lwjgl218PatchVersions`, and `lwjgl218PatchFacts`. It re-discovers original roles, verifies the exact original owner set and every class/method/field, re-binds real callers and changed fields, verifies official resources/native identities, and rechecks archived process exit, classpath/configuration, finite raw outputs, input origins, compiled probe classes and source hashes.

The product-relevant proposed facts for **each separately identified patch client** are:

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

Additional selected facts include the original CodecJOrbis registration, linear distance16 × raw note volume3, pitch clamp .5–2, five material instruments, unsupported game HRTF control, player-eye listener model, server entity delivery and configured pool28+4. The helper carries the full shape. It is reasonable to integrate these clients as individually hash-gated **code-reviewed resource/render-math profiles**; it is not reasonable to inherit another release's world measurement, native-context validity or capacity acceptance.

```text
node scripts/review-lwjgl218-patches.mjs
node scripts/verify-lwjgl218-patches-audit.mjs
```

All nine strict reviews pass. Ten independently corrupted report copies per version are rejected: client identity, Options field, original method Code, gain order, packet overflow, listener model, configured pool64, JNI bridge identity, missing caller owner disguised by a duplicate class, and component count. The 90 rejection records and frozen manifest remain in ignored `.local/lwjgl218-patch-validation/`. The review helper SHA-256 is `f6eccba2e1e44d324fb5263534654abac1595c055860c3f37f14ecceaebd026e`; the independent negative runner SHA-256 is `2d277a8b4a904339d35823073200a1037f5816d210fbaaafa3538990f8b168ac`.

Across nine separately invoked clients, final component evidence contains **11,763 engine cases, 1,125 original note/packet/instance cases, 378 packet boundaries and 45 original material choices**, plus each client's blocked-above guard, selected composite event and static pool getters. Repeated preparation/probe runs are retained under ignored research/local paths and are not added to these counts. Final numeric reports bind the terminal successful process and compiled classes. Inputs preserve explicit negative zero as `"-0"`; consumers must use `Number` before evaluating them.

Five new JavaScript files pass syntax checks, the original-class Java probe compiled and all final invocations passed, nine strict reviews passed, and all 90 corrupt fixtures were rejected. The frozen original 1.8 source/numeric/helper hashes were rechecked unchanged. No game, world, native-context probe, product build or shared registry/fact edit was performed for this audit.

New files for this audit are:

- `scripts/audit-lwjgl218-patches.mjs`
- `scripts/lwjgl218-patch-bindings.mjs`
- `scripts/probe-lwjgl218-patches.mjs`
- `scripts/review-lwjgl218-patches.mjs`
- `scripts/verify-lwjgl218-patches-audit.mjs`
- `scripts/java/Lwjgl218PatchMethodProbe.java`
- `docs/evidence/java-1.8.1-audio-source.json` through `java-1.8.9-audio-source.json` (nine files)
- `docs/evidence/java-1.8.1-numeric-components.json` through `java-1.8.9-numeric-components.json` (nine files)
- `docs/evidence/java-1.8-patches-audit.json`
- this document

Original client files, dependency archives, raw classes/disassemblies, original resources, private callback classes, processes and outputs remain ignored under `.research/lwjgl218-patches` / `.local/lwjgl218-patch-methods`. No original binary or texture was added to the public deliverables, no previous evidence was rewritten, and nothing was committed.
