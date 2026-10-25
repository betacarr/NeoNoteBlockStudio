# Checked historical sound-index paths

The resource loader now supports the **default-domain root index layout of Java 1.7.3 through 1.7.9**. It selects that layout only for seven checked original client hashes. Later namespaced indexes keep their existing paths. The shared sound-event resolver still chooses the actual event sample: historical bass uses `note.bassattack` / `sounds/note/bassattack.ogg`, rather than the separate, similarly named bass file.

This fixes a resource-loading defect. It does not certify the codec, gain, native mixer, full game world or instrument availability of these versions. In particular, the historical index exposes a `note.pling` resource as well as the five material-selected note-block sounds; loading that event does not claim that every modern supporting-block instrument exists in 1.7.3.

## Official artifacts and original code

The checked [1.7.3 metadata](https://piston-meta.mojang.com/v1/packages/cd133f90b7e339c50b3cdce64188a51469c6a128/1.7.3.json) identifies [client SHA-1 `feaf10fa9da94c388f2c53a2cf31a14406d0c532`](https://launcher.mojang.com/v1/objects/feaf10fa9da94c388f2c53a2cf31a14406d0c532/client.jar) and the [1.7.3 asset index](https://launchermeta.mojang.com/v1/packages/f6cf726f4747128d13887010c2cbc44ba83504d9/1.7.3.json), SHA-1 `f6cf726f4747128d13887010c2cbc44ba83504d9`.

The checked [1.7.4 metadata](https://piston-meta.mojang.com/v1/packages/5db9d89cb6b89573384f324aa585b4c99525b37a/1.7.4.json) identifies [client SHA-1 `900950d8e3217b3a42405d1ecf767dcc31239d69`](https://launcher.mojang.com/v1/objects/900950d8e3217b3a42405d1ecf767dcc31239d69/client.jar) and the [1.7.4 asset index](https://launchermeta.mojang.com/v1/packages/545510a60f526b9aa8a38f9c0bc7a74235d21675/1.7.4.json), SHA-1 `545510a60f526b9aa8a38f9c0bc7a74235d21675`. Original 1.7.5–1.7.9 clients select this same index; their relevant code was checked individually, rather than inferred from that index identity.

Both indexes contain root keys `sounds.json` and `sounds/note/...`. Their shared [sounds definition object](https://resources.download.minecraft.net/fc/fce0bb3e14ade7b292a7c1d5fa785533d8106d82) has SHA-1 `fce0bb3e14ade7b292a7c1d5fa785533d8106d82` and size 34,020 bytes.

The original 1.7.3 and 1.7.4 clients contain identical bytes for these three roles:

| Original role | Class | Class SHA-1 | Relevant behavior |
| --- | --- | --- | --- |
| ResourceIndex | `brh` | `bccd8ba0065f893ed5062fddcca23d0c606a8094` | Prefixes every raw asset-index key with `minecraft:` and maps it to the SHA-1 object file |
| DefaultResourcePack | `bri` | `0326c44d766bc4f6eb9ad440934be0e020b59f7a` | Resolves the logical resource name through that map after checking the client archive |
| SoundHandler | `buc` | `701d3dc1c7b552901523bfd604a520244022950a` | Requests a domain's `sounds.json`; file events become `sounds/` + event sample name + `.ogg` |

For example, the logical `minecraft:sounds/note/harp.ogg` therefore maps to raw index key `sounds/note/harp.ogg`, not `minecraft/sounds/note/harp.ogg`. The original 1.7.3 note-block class `ala` also selects `harp`, `bd`, `snare`, `hat` and `bassattack`, then plays the corresponding `note.` event.

The remaining checked class names are `brn` / `bro` / `bui` in 1.7.5, `bsy` / `bsz` / `bvz` in 1.7.6–1.7.7 and `bta` / `btb` / `bwb` in 1.7.8–1.7.9. Full client, class, index, dependency and resource hashes are retained in [the resource-path evidence report](verification.md). Decompiled research stays in ignored `.research/legacy-resource-layout/`; original game classes and sound bytes are not distributed with the application or committed fixtures.

## Implementation and limits

- `src/data/sound-asset-layouts.json` records the seven checked client identities and two official root-layout index hashes.
- `src/core/sound-assets.ts` separates a logical Minecraft resource path from its physical asset-index key and loads the exact referenced objects. `electron/main.ts` uses it while retaining the existing original-client, object-checksum, allowed-root and index-identity checks.
- A checked root-layout client does not switch to another layout just because a conflicting file is present. Missing checked definitions or samples produce an explicit error.
- `scripts/research-sounds.mjs` uses the same recorded index identities. Its refreshed 34-index local report now recognizes seven sound events and seven sample objects for each of the 1.7.3 / 1.7.4 indexes. The application's existing canonical event list resolves six of those events; the unused `note.bass` file is not substituted for bass attack.
- The `legacy` and `pre-1.6` layouts remain unreviewed. No fallback guesses between `newsound/`, `sound3/`, `sound/` or `sounds/`, and no inference from a root `sounds.json` alone, were introduced.

## Verification

The committed fixture contains only the relevant official index entries, hashes and event definitions. Unit tests use placeholder sample payloads to test path selection; they do not pretend to decode real audio. The independent integration probe downloads/checks the actual official object bytes and invokes the **unmodified original ResourceIndex and DefaultResourcePack classes** in isolated Java processes. It then compares their resource bytes with the application loader's bytes.

```powershell
npx vitest run tests/sound-assets.test.ts
npx tsc --noEmit
node scripts/verify-legacy-sound-assets.mjs --write-evidence
node scripts/research-sounds.mjs
```

Results for this change:

- **12 targeted tests pass**, including all seven checked client identities, modern namespaced behavior, conflicting keys, unchecked historical layouts, missing resources and invalid resource paths.
- **Seven original clients × seven resources = 49 original-class resource reads**, all identical to the application loader. Each set includes the real `sounds.json` plus six resolved sample files; the report records their actual SHA-1 and size.
- TypeScript checking passes. The Electron main entry also bundles successfully in memory, without replacing another agent's active build output.
- The 34 official-index research pass completes with zero failures. Its two previously empty root-layout records now contain their real event/sample metadata; `pre-1.6` and `legacy` remain explicitly unreviewed.

Because the application loader is bundled into Electron's main process, distributing this fix requires a fresh application build and package. A previously built executable does not acquire it from source-file edits. Desktop integration and the next packaged build are coordinated by the main agent; this report does not claim that packaging step has already passed.

## Subsequent packaged verification: 0.1.9

On 2026-10-24 (Asia/Shanghai), the Windows x64 unpacked **0.1.9** application passed the real desktop resource-loading integration check:

```powershell
node scripts/smoke-legacy-resources.mjs --packaged "release/0.1.9/win-unpacked/EX NoteBlock Studio.exe"
```

The test invoked the actual preload desktop API and packaged main-process handlers. It mocked only the OS directory chooser, then let the normal authorization, original-client identification, filesystem reads and checksum checks run. It used a new isolated `NBSX_TEST_USER_DATA` / `--user-data-dir` profile under `.local/legacy-resource-desktop/run-f9rv3H/profile`, and closed only its own application instance.

- **Six IPC scenarios passed:** each of three unselected fixture roots was rejected; after directory selection, 1.7.3 and 1.7.4 loaded successfully, while the genuine 1.7.2 client with its official `legacy` index was explicitly rejected as an unreviewed layout.
- **Twelve actual returned sample payloads passed SHA-1 and size checks:** both supported versions loaded exactly `harp`, `bass`, `basedrum`, `snare`, `hat` and `pling`. Harp resolved to `sounds/note/harp.ogg` / `46244605b8663a29cdce7bccc5b2d038241e32ee`; bass resolved to `sounds/note/bassattack.ogg` / `037b9fb7f74381f354739d015193dc4a6897f620`, rather than the separate bass file. All remaining samples also matched their official object hashes.
- Original client/index identities matched the 1.7.3 and 1.7.4 hashes recorded above. The Java decoder used the official checked Paulscode dependencies and the helper class inside the actual packaged `app.asar.unpacked` directory. Main-process extraction placed the checked original `OpenAL64.dll` only in the isolated profile; its SHA-256 was `9261b66010a845ddef9f61d5e4266fe2f08a53f3605da002e9e8f8d202bdbc5e`.
- The running application reported `isPackaged: true` and version `0.1.9`; renderer errors were **zero**. Expected rejected-request messages are retained in the main-process stderr record.

The complete local report is [`.local/legacy-resource-desktop/run-f9rv3H/report.json`](verification.md). It is an ignored local artifact, not a shipped game-resource bundle. This packaged pass establishes resource loading and decoder/native-library selection; it does not add codec, audio-rendering or integrated-world acceptance for these historical clients.
