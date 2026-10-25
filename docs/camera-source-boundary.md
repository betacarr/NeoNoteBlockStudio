# First-person camera boundary: Java 1.14.3–1.16.5

The ordinary first-person `-0.05f` forward-axis translation is present in **1.14.3** and removed in **1.14.4**. It remains absent in 1.15, 1.15.1, 1.15.2, 1.16 and 1.16.5. This follows the original `Camera.setup` instructions and its branch destinations, rather than a class-hash comparison. Third-person collision distance and the sleeping branch are separate paths.

| Original client | First-person translation | Orientation calculation | Evidence |
|---|---:|---|---|
| 1.14.3 | `double(-0.05f)` = -0.05000000074505806 | Float trigonometry and products, widened into Vec3 doubles | [Source and numeric methods](verification.md) |
| 1.14.4 | 0 | Float trigonometry and products, widened into Vec3 doubles | [Source and numeric methods](verification.md) |
| 1.15 | 0 | Float Quaternion / Vector3f | [Source and numeric methods](verification.md) |
| 1.15.1 | 0 | Float Quaternion / Vector3f | [Source and numeric methods](verification.md) |
| 1.15.2 | 0 | Float Quaternion / Vector3f | [Source and numeric methods](verification.md) |
| 1.16 | 0 | Float Quaternion / Vector3f | [Source and numeric methods](verification.md) |
| 1.16.5 | 0 | Float Quaternion / Vector3f | [Source and numeric methods](verification.md) |

Every version retains float eye-height smoothing: save the previous camera eye height, then add `(entityCachedEyeHeight - cameraEyeHeight) * 0.5f`, with float subtraction, multiplication and addition. Setup interpolates the entity's double coordinates using the float partial tick widened to double. It interpolates old/current camera eye heights in float, widens that completed result to double, and adds it to the interpolated double Y. Camera translation, where present, follows this addition. `SoundEngine.updateSource` obtains the completed camera position and orientation; its queued callback passes them to the original Listener. Listener converts completed double XYZ components separately to float for OpenAL.

The numeric fixture starts camera eye height at zero and gives the original Entity getter a cached `1.62f`. After 128 original tick calls it has stalled at **1.619999885559082** (bits 1070554152), one float ULP below the target `1.62f` (bits 1070554153). This is a result for that explicit initial state, not a claim about every possible camera history. Replacing the smoothed value with a decimal eye-height constant before double addition changes the calculation.

At yaw 180°, pitch 0°, entity Z 2.5, the original 1.14.3 camera produces Z **2.550000000745058**, narrowed by Listener to `2.55f`; 1.14.4 produces Z **2.5**. The 1.15 Quaternion path also changes small orientation components: this fixture's forward X is `8.742278E-8f`, whereas the earlier path gives zero. An idealized direction vector cannot substitute for the original numeric path.

The seven reports verify official release metadata and client SHA-1. Versions with official client mappings bind their exact mapping artifact; 1.14.3 uses separately reviewed original class roles and explicitly has no official mappings. Each report retains original class identities, selected method Code hashes, and hashes of ignored raw disassembly. The call chain includes Camera setup/tick/move, Entity eye/view methods, the renderer and Minecraft callers, SoundManager, SoundEngine's listener callback, Listener, and the relevant numeric helpers.

Reproduce the independent audit and numeric component checks:

```powershell
node scripts/audit-camera-boundary.mjs
node scripts/probe-camera-boundary.mjs
node scripts/review-camera-boundary.mjs --write
```

The numeric probes execute unchanged original Camera, Entity getters, math/vector and Listener classes, checking loaded target class hashes. Their entity coordinates and cached eye height are synthetic. The only replacement classes are a no-op graphics rotation sink and an OpenAL sink that records the original Listener's float arguments. All 84 numeric cases pass: yaw 0°/37°/180° crossed with partial ticks 0/0.25/0.5/1, at pitch 0°. This does not cover every possible angle or camera history. They do not create a world, place a player, open a graphics/audio device, or establish waveform, timing, UI or complete editor-to-world equivalence. Actual world recordings remain a separate acceptance step.
