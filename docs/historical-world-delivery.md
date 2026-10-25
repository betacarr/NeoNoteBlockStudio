# Historical patch world delivery and standing listener audit

This independent audit covers Java 1.13.1, 1.13.2, 1.14.1, 1.14.2 and 1.14.3. It supplements the frozen historical audio-core/component records without changing them. All five original released clients prove a sound-delivery radius of 48 for note volume 3, using **player entity position**, same-dimension identity and a strict squared-distance comparison. The sound listener uses a separate position calculation. The 1.14 patches introduce camera smoothing and an ordinary first-person forward-axis offset that a fixed eye-height subtraction does not reproduce.

These are source-reviewed world rules. This work adds **zero integrated-world recordings** and transfers no anchor version's measured scenes to a patch version.

## Public records and offline review

| Version | Source record | Original classes | Selected method bindings |
| --- | --- | ---: | ---: |
| 1.13.1 | [java-1.13.1-world-source.json](verification.md) | 41 | 29 |
| 1.13.2 | [java-1.13.2-world-source.json](verification.md) | 41 | 29 |
| 1.14.1 | [java-1.14.1-world-source.json](verification.md) | 53 | 39 |
| 1.14.2 | [java-1.14.2-world-source.json](verification.md) | 53 | 39 |
| 1.14.3 | [java-1.14.3-world-source.json](verification.md) | 53 | 54 |

Totals are 241 original class entries and 190 selected bindings. Every selected class additionally retains hashes for every method with an original `Code` body, the full class SHA-1/SHA-256, field descriptors and hashes of local raw source/disassembly. Original class files, decompilation and disassembly remain ignored under `.research/historical-world-patches/`; public JSON does not redistribute the original source or binary.

These versions provide no official client-mappings artifact. Role names below are explicitly manual labels derived independently from each original client's class structure, constant pool, descriptors and actual callers. The official client and metadata identities are the ones individually verified in the [historical audio-core audit](historical-audio-patches.md#original-client-sources); no adjacent-version mappings are used as authoritative evidence.

[audit-historical-world-source.mjs](../scripts/audit-historical-world-source.mjs) discovers roles from the original classes and extracts the local evidence. [historical-classfile.mjs](../scripts/historical-classfile.mjs) reads original class metadata and resolved constant-pool references. [review-historical-world-source.mjs](../scripts/review-historical-world-source.mjs) exports:

```js
const audit = await reviewHistoricalWorldSource('1.14.3');
// audit.facts: source-reviewed delivery and listener-position rules.
// audit.adapterConfig / audit.adapterFields: checked 1.14.3 world adapter.
// audit.bindings: original owner/member/descriptor/Code SHA-256.
```

The offline reviewer checks official metadata bytes and client identity, absence of official mappings, the independently rediscovered role map, all original class bytes/fields/method hashes, raw sources/disassemblies, the selected instruction checks, facts and adapter fields. Method instruction hashes alone are not semantic-equivalence proofs across different constant pools; original class identity and resolved call targets remain part of every check.

Validation passed for all five public records. Eight deliberate corruptions were rejected: wrong client identity, radius, camera offset, class identity, method hash, selected binding, adapter players getter and false official-mappings status. The isolated results are `.local/historical-world-source-validation/results.json`. These checks are not world scenes.

## Actual material and event chain

The original NoteBlock placement method reads the supporting block state and passes it to the original `Instrument.byState` method. The downward-neighbor update method refreshes the same instrument property when support changes. `Instrument.byState` checks special supporting blocks, material identities and, for guitar, the actual wool block tag. Serialized instrument names come from the original enum, rather than an inferred neighboring-version name list.

The original wool tag must be bound by the world's data-pack/tag loading before a reflective adapter selects supporting blocks. Calling `Instrument.byState` too early can fail to find guitar even though the original method and all blocks are present. The independent 1.14.3 adapter therefore selects materials after world readiness and records the actual original supporting-block field for each instrument.

The original NoteBlock interaction/redstone helper checks the space above the block and queues a world block event. ServerWorld stores an original block-event record. When processing it, ServerWorld verifies the current block identity and calls the block state's event method, which reaches the original NoteBlock event. The note value determines `pow(2, (note - 12) / 12)`; its instrument property supplies the original sound event; category is record and raw volume is 3.

The World block-position sound overload adds 0.5 to all three block coordinates. In 1.13.1/.2 World dispatches to registered world listeners; the original MinecraftServer world-creation routine installs the server-world listener. That listener computes the sound radius and packet. In the three 1.14 patches ServerWorld directly overrides the coordinate sound overload and computes the radius/packet there.

| Version | NoteBlock / Instrument | World / ServerWorld | Sound-range caller | PlayerList | Client packet handler / world |
| --- | --- | --- | --- | --- | --- |
| 1.13.1 | `bge` / `bmj` | `axx` / `td` | server-world listener `te` | `vp` | `crc` / `crf` |
| 1.13.2 | `bgf` / `bmk` | `axy` / `td` | server-world listener `te` | `vp` | `crd` / `crg` |
| 1.14.1 | `bqc` / `bwl` | `bhi` / `vg` | `vg` | `xq` | `dhk` / `dhn` |
| 1.14.2 | `bqc` / `bwl` | `bhi` / `vg` | `vg` | `xq` | `dhk` / `dhn` |
| 1.14.3 | `bqg` / `bwp` | `bhm` / `vi` | `vi` | `xt` | `dho` / `dhr` |

## Radius, entity origin and the separate block-event notification

Each original sound-range caller uses float arithmetic `volume > 1 ? 16.0f * volume : 16`, widened to double for delivery. Volume 3 therefore gives 48 exactly. PlayerList excludes the supplied player, compares the server player's dimension-type object identity, then sends only if:

```text
(soundX - entityX)^2 + (soundY - entityY)^2 + (soundZ - entityZ)^2 < radius^2
```

The original double instructions include three coordinate differences, four multiplications, two additions, `dcmpg` and rejection on `ifge`. The three entity-coordinate fields and dimension field are recorded individually in each JSON. No camera or eye-height getter participates in this method.

The 1.13 patch signatures must not be copied blindly from the measured 1.13 anchor. For example, 1.13.1 uses `vp.a(Laof;DDDDLboc;Liv;)V`, with a dimension-type object; the older 1.13 anchor used an integer dimension argument. The 1.14.3 method is `xt.a(Lawb;DDDDLbyi;Lkb;)V`. Both reviewed patch families still use direct server entity coordinates and strict same-dimension distance.

ServerWorld separately notifies clients about a successful block event at radius 64. This is a different packet and radius. The client handler replays that block event, but its NoteBlock event calls the client world's sound overload with a null player. The original client-world implementation only plays that overload if the passed player is the actual client player. Null therefore fails this identity gate. Actual audio instead arrives through the sound packet, whose handler supplies the client player to the world overload and creates the real local sound instance. A block-event notification at 64 does not imply audio delivery outside 48.

Sound packets quantize coordinates using Java integer truncation of double coordinate × 8. The getters convert the stored integer to float, divide by 8.0f and then widen to double. Note-block centers are exact eighths at ordinary world coordinates, but the packet path is retained explicitly rather than assumed to transport arbitrary doubles unchanged.

## Standing eye height and listener position

All five ordinary standing eye-height functions return `1.62f`, whose actual Java-float value is `1.6200000047683716`. That value is distinct from the server player origin used for delivery.

For **1.13.1/.2**, the sound manager passes the player and partial tick directly to the sound engine. The engine interpolates previous/current entity X/Y/Z, adds the current player eye-height function to interpolated Y, casts the resulting coordinates to float and calls the original listener setter. There is no separate camera first-person forward shift in this audio path. Bindings include `dgq.a(Laof;F)V` and `dgr.a(Laog;F)V` and both original `Player.bF()F` methods.

For **1.14.1/.2/.3**, GameRenderer updates the original Camera using the selected camera entity, perspective flags and partial tick. Player standing height is dispatched through LivingEntity, stored in Entity's cached eye-height field and exposed by its getter. A camera tick saves the previous smoothed height and evaluates this update entirely in float arithmetic:

```text
height = float32(height + float32(float32(targetEyeHeight - height) * 0.5))
```

Camera setup interpolates entity coordinates in double arithmetic, adds the interpolated smoothed eye height to Y, then applies perspective-specific movement. The ordinary non-sleeping first-person branch translates **−0.05000000074505806** along the camera forward axis. The literal is the exact double value of `-0.05f`; it is present in original bytecode. The forward vector is produced by the original yaw/pitch and trigonometric helpers. Third person and sleeping have separate branches.

Minecraft passes the Camera to SoundManager, then SoundEngine. SoundEngine reads the Camera position and queues an original callback on its sound executor. The callback passes that position to the original Listener, which casts each coordinate to float for `alListener3f`. Camera orientation vectors are passed separately. Treating this path as a direct entity-plus-eye-height setter omits real original behavior.

| 1.14.3 stage | Original method | Code SHA-256 |
| --- | --- | --- |
| Standing height | `awb.b(Laje;Laim;)F` | `73a2932dd553bbc8454746c56a1c2b3b60d807d66167f96497639e1e6582e7f2` |
| Cached eye getter | `ail.bN()F` | `cfc3cb232c7d74457f119289cdd8c3413cc3628ce36524ea6d8ff90d42b608a7` |
| Cached eye refresh | `ail.x_()V` | `8e61a342b2f68bfde847f30290357c8f3f50fc09196ab1834880e6a06d7c70fd` |
| Camera setup | `cvd.a(Lbgw;Lail;ZZF)V` | `95af882a2229979bac555bbe278de8b20577620773825340cc988d2bb0ccc015` |
| Camera eye tick | `cvd.a()V` | `4e47e8a6984645605e1ac66452fa71a763d69b9f733bfc7f816c77359ee92a43` |
| Camera axis translation | `cvd.a(DDD)V` | `fc3bbcd150a35dd5b70a9ca0fb0dc7481cb94ab708138a2307101e3fe4523583` |
| Camera to sound engine | `dxy.a(Lcvd;)V` | `564dd3fe08376737c81f57f29c92a558f929488439bb84754d61d4c6e682de79` |
| Sound executor callback | `dxy.a(Lcsb;Lcsb;Lcsb;)V` | `e770629821edb5f123433815d8a1fbf8e931ced8440483fa56fcf8bfd18b7c0e` |
| Native listener float conversion | `ctk.a(Lcsb;)V` | `9481fdea47dc5324f39dada342bf9572282dd6314b50328bdb4ee1c4c1e57590` |

Before final world-coordinate float rounding, the stationary ordinary first-person relationship is:

```text
playerPosition - listenerPosition
  = +float32(0.05) * cameraForward - [0, smoothedEyeHeight, 0]
```

At yaw 0/pitch 0 this is approximately `[0, -eye, +0.05]`; at yaw 180 it is approximately `[0, -eye, -0.05]`. The exact vector also depends on the original orientation arithmetic, position interpolation and final listener-coordinate rounding. The structured `facts` contain `listenerPositionModel`, `firstPersonForwardOffsetJavaFloat`, `eyeHeightSmoothing` and orientation-specific approximate examples, so the distinction is available to future world-fact consumers as data.

An explicit numerical derivation, assuming a newly constructed Camera whose two height fields begin at zero and a stationary standing target: the float update reaches `1.619999885559082`, one float ULP below the target `1.6200000047683716`, after 23 effective updates and then stops changing. The camera's world-reset method does not reset those height fields, so zero initialization is a fresh-object condition, not a rule for every world switch.

For stationary feet `[0.5, 80, 2.5]`, yaw 180 and pitch 0, this arithmetic gives an ordinary listener near `[0.5, 81.62000274658203, 2.549999952316284]` after final OpenAL float conversion. The corresponding player-relative vector is approximately `[0, -1.6200027465820312, -0.04999995231628418]`. These are source-derived numerical examples, not a new world recording. The world adapter must continue to record actual entity and listener values and the verifier must derive delivery independently.

## Integration and remaining evidence

`reviewHistoricalWorldSource(version).facts` supplies source-reviewed world-fact candidates with exact client identity. The existing broadcast subset is `broadcastRange: 48`, `broadcastOrigin: 'player-entity-position'`, `comparison: 'strict-distance-squared-less-than-range-squared'`, and `standingEyeHeight: 1.62`. The last value is the original standing function's nominal height, not an exact listener-to-entity offset. The additional structured camera facts must be considered before using a preview listener as an entity origin.

The 1.14.3 record also provides `adapterConfig` and `adapterFields`, independently checked against original descriptors and field identities. Its frame hook is private `cvo.e(Z)V`, overlay is field `p`, client player is field `j`, server getter is `A()Ldxo;`, commands setter is `bhq.b()Lbhq;`, and server players getter is **`vi.A()Ljava/util/List;`**. The World field `f` is not this getter. The original server executor is inherited through `MinecraftServer → agr → agn.execute(Runnable)`.

No existing source/component report, product file, shared fact/generator, original recording or overall status table was modified. Source review does not measure native mixer behavior, packet timing or actual waveform delivery. Those remain the independent recording adapter's responsibility. Other player poses, third person and moving-listener histories also remain outside the standing rule provided here.

## Supplemental state-to-block dispatch proof

[historical-world-block-dispatch.json](verification.md) and [review-historical-block-dispatch.mjs](../scripts/review-historical-block-dispatch.mjs) explicitly bind the four event-dispatch stages for each patch: ServerWorld checks current block identity against the queued event; the state event method forwards to a virtual Block event call; the base Block method has the original descriptor; and NoteBlock overrides that exact descriptor to emit its sound. This supplies twenty selected bindings over twenty already-recorded class entries. These are references to the existing evidence, not additional unique audited classes or world scenes.

For 1.13.1/.2 the state types `blb`/`blc` are interfaces whose event methods have an actual original `Code` body. The forwarding is an **interface default method**, not an assumed abstract method or an inferred behavior of an unreviewed implementation. For the 1.14 patches the corresponding state method is concrete. The supplemental reviewer verifies the class interface flag, presence of original `Code`, `invokevirtual` to the original Block event descriptor, the server's identity branch, and the actual NoteBlock override. All referenced original class/method bodies were already in the frozen five-version inventory.

The supplement hashes each frozen world-source file and does not mutate it. It uses existing cached class files and disassembly only; no new game launch, native probe, source collection or audio measurement was needed. `reviewHistoricalBlockDispatch(version)` exposes its strict offline check independently of the frozen report/helper hashes.
