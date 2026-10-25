# Java 1.12.2: original native-context equivalence is unproved

The previous 1.12.2 world acceptance has the same pointer-evidence gap found in 1.7.10. **All 49 scenes—36 single-note, 9 master-volume and 4 polyphony—are excluded from original-context measured coverage.** Their recorded PCM equality remains useful as a diagnostic under the recorder's normalized loopback context. It does not prove equivalence to the original native context. The old reports and releases are retained historical snapshots; their former acceptance status must not be treated as the current verdict.

This independent audit adds six original-class identities, twelve method bindings, an observer-only no-sound original regular-device call, and immutable snapshots/hashes for the three affected reports and their recordings. It adds no world capture. The parent owns registry/status changes; this audit does not edit the old reports, their recordings, the old agent, product code or shared facts.

The machine-readable exclusion evidence is [java-1.12.2-context-audit.json](verification.md), SHA-256 **`804dc0f0aa75b385cb3248cf742ebafd2b8f05a410485979796b8ce850dc6843`**. Its strict review helper is `reviewLwjgl2122ContextEvidence(filename?)` from `scripts/review-lwjgl2122-context.mjs`, SHA-256 `6a868499234870670288cd336a475016836d269a96b7c23f8e7f55623202e363`.

## Original chain and the three different objects

The [official 1.12.2 metadata](https://piston-meta.mojang.com/v1/packages/832d95b9f40699d4961394dcf6cf549e65f15dc5/1.12.2.json), SHA-1 `832d95b9f40699d4961394dcf6cf549e65f15dc5`, pins client SHA-1 `0f275bc1547d01fa5f56ba34bdc87d981ee12daf`. The Windows rules select original [LWJGL 2.9.4-nightly-20150209](https://libraries.minecraft.net/org/lwjgl/lwjgl/lwjgl/2.9.4-nightly-20150209/lwjgl-2.9.4-nightly-20150209.jar), SHA-1 `697517568c68e78ae0b4544145af031c81082dfe`, and its [Windows native archive](https://libraries.minecraft.net/org/lwjgl/lwjgl/lwjgl-platform/2.9.4-nightly-20150209/lwjgl-platform-2.9.4-nightly-20150209-natives-windows.jar), SHA-1 `b84d5102b9dbfabfeb5e43c7e2828d98a7fc80e0`. The alternate nightly dependency is OSX-only. Official client, Java library, Paulscode library and extracted native identities are independently checked against these original artifacts.

The original method chain is:

1. `LibraryLWJGLOpenAL.init()V` calls `AL.create()V`.
2. `AL.create()` forwards `null,44100,60,false` through both `create` overloads to `AL.init(String,int,int,boolean,boolean)`, with device/context creation enabled. The Windows x64 native-loading branch selects `OpenAL64.dll`.
3. `ALCcontext.createAttributeList(III)` allocates seven integers through original `BufferUtils`, writes all seven values, and returns the same buffer **without flip or rewind**.
4. `AL.init` immediately passes this returned buffer to `ALC10.alcCreateContext`; it does not reset the buffer position.
5. `ALC10` obtains `MemoryUtil.getAddressSafe(IntBuffer)` and directly passes that long pointer to original JNI method `nalcCreateContext(JJ)J`.
6. `getAddressSafe` delegates to `getAddress(buffer)`, which uses `buffer.position()`. Its two-argument implementation returns `getAddress0(buffer) + (position << 2)`.

These observations must be kept separate:

| Object | Actual value / meaning |
|---|---|
| Declared Java buffer contents | `[4103,44100,4104,60,4105,0,0]` |
| Java buffer bounds | position = limit = capacity = 7; remaining = 0 |
| Stored terminator | Integer index 6, before the pointer subsequently passed to JNI |
| Actual JNI argument | Base address + 28 bytes, outside the declared Java buffer |
| Unknown archived native pointed contents | Not recorded in any of the accepted world captures |

An empty **Java remaining range** is not a null native pointer and does not establish that the native pointed list starts with a zero. The declared frequency/refresh values are not the contents at the actual starting pointer. Their presence in the backing allocation cannot be called proof that they were submitted as the native attribute list.

The audit compares original method Code hashes with the previously checked 2.9.1 artifact rather than inferring behavior from a version label. `ALCcontext.createAttributeList`, `ALC10.alcCreateContext`, all three selected `MemoryUtil` methods and selected `BufferUtils` methods have identical Code bytes. Three selected `AL` method Code hashes differ, so the complete 2.9.4 forwarding/loading chain was checked independently. The report retains all hashes and semantic instruction checks; it does not declare the libraries or whole games equivalent.

## Exact timing and scope of the new probe

`scripts/java/Lwjgl2122ContextAudit.java` observes the original library in one isolated process. It creates no source, plays no sound, and substitutes no device, buffer or context parameter.

- At `ALC10.alcCreateContext` method entry, `observe(IntBuffer)` records bounds and backing contents using a duplicate. It never calls `flip`, `rewind`, or relative reads on the original buffer. The original position/limit remain unchanged.
- Immediately before the original `nalcCreateContext(JJ)J` instruction, the transformer duplicates the top long argument with `DUP2`, records the **actual pointer being passed to JNI**, and leaves the original device/pointer arguments on the stack.
- It emits the original native invocation unchanged, duplicates its returned long to record whether it was nonzero, then leaves that result available to the original instructions.
- Observations are written before the native call so native failures would not erase the entry evidence. There is no guard rejecting a nonzero outside-buffer first word and no retry on a mere observation timeout.

The one actual run is `.local/lwjgl2122-context/run-1792794617451`. PID 75588 exited 0; its process record is terminal and the probe records `closed=true`. Entry and pre-native observations agree:

```text
position = limit = capacity = 7
remaining = 0
JNI pointer offset = 28 bytes
first word at that pointer = -4 (outside the declared Java buffer)
observerMutatedOriginal = false
originalNativeResultNonzero = true
actual.contextCreated = true
backend = 1.1 ALSOFT 1.15.1
```

The original call returned successfully. Its actual `ALC_ALL_ATTRIBUTES` query returned:

```text
[4103,48000,4104,50,4105,0,4112,255,4113,1,131075,4,0]
```

**A nonzero outside-buffer first word is not proof of original native-call failure.** This probe demonstrates that point directly. It also does not establish how arbitrary future allocations, unobserved later words or archived captures behave. In particular, this one original regular-device result cannot certify replacement with a fixed loopback attribute list. Actual rate/refresh observations supplement the pointer proof; device settings alone are not used to infer which hints were submitted or honored.

The read at base+28 is explicitly outside the declared Java allocation. It observes the same starting address passed to JNI in this run, not a valid Java buffer element or a stable allocation contract. The instrumentation and process are separate from every archived world recording.

## What the accepted recorder actually did

All three accepted reports bind copied `Lwjgl2WorldCaptureAgent.java` source SHA-256 `2955e6aa446aa18d5987cd4c8430f35fee019320a2b4cf123c9feed3c9e9c645`. Their different compiled JAR identities and the actual inner transformer/normalizer method Code hashes are retained individually in the new evidence.

The old transformer runs at original `alcCreateContext` entry, calls `contextAttributes(original)`, then executes generated `ASTORE 1`, replacing the original argument before any original instruction runs. That helper:

1. Duplicates the original buffer and reads only `copy.hasRemaining()`.
2. Records `originalContextAttributes="[]"` when the original position is 7.
3. Builds a fresh direct buffer containing explicit stereo/float/48000 loopback pairs and a terminator.
4. Flips the new buffer and returns it as the replacement argument.

The helper does not consume the original buffer. The error is interpreting its empty remaining range as sufficient preservation evidence for a native argument that points beyond that range. None of the 49 saved case properties records original bounds, full backing contents, the actual original pointer, its native terminator or actual original-context attributes.

The new audit overturns the preservation claim represented by two old statements. They remain in preserved historical snapshots rather than being silently rewritten:

- `docs/evidence/java-1.12.2-world-source.json`, `interpretation[4]`, says the bridge substitutes “only” native device open and recording format/rate pairs. The actual implementation replaces the entire buffer, and preservation of all other native pointed entries was not established.
- Every old case property's `contextAttributePolicy="retain-original-pairs-except-loopback-channel-format-rate"` and `originalContextAttributes="[]"` describe the Java duplicate parser's policy/result. They cannot be used as proof of the original native terminated list.

In particular, the old world-source `interpretation[4]` statement that only device-open and format/rate pairs change, and the old properties' policy used as evidence of native-context preservation, are superseded by this correction. Their continued presence in an old source JSON, report, recording or release is an audit trail, not a currently accepted equivalence claim. The old source JSON is intentionally unchanged to avoid rewriting shared fact provenance; the parent excludes these measurements and guards publication separately.

The original game arithmetic, codec registration and native-DLL capability evidence retain their narrower source/component scope. A selected source fact with “context checked” wording must not be read as original-context world acceptance.

## Exact exclusion list and retained diagnostics

| Original report | Scenes to exclude | SHA-256 of the report snapshot audited here |
|---|---:|---|
| `java-1.12.2-single-note-world.json` | 36 | `a3f4d0605e4df4ac5d463c8879f340e9aaad6910b062334dbc42729fd82db6f4` |
| `java-1.12.2-master-07-world.json` | 9 | `f4dbf653a3b3c74accc39093d049b7015e1faba331fb9ce97fa7b98acbd857df` |
| `java-1.12.2-polyphony-world.json` | 4 | `245c2265eaa14d759ec3f54384ca2e41e24f1a3495a38aa0a434ee6488d2810a` |
| **Total** | **49** | No replacement world scenes added |

Original report snapshots are retained under `.research/lwjgl2122-context/accepted-reports`, allowing parent-owned registry/status changes without losing the historical acceptance record. Each `affectedReports[]` entry in the new public evidence pins the snapshot, original provenance, copied source/JAR, compiled entry transformer and normalizer, and every original PCM/property hash. The corresponding original capture directories are:

```text
.local/lwjgl2-world-comparison/1.12.2/run-1792781321066/capture  (36)
.local/lwjgl2-world-comparison/1.12.2/run-1792781459694/capture  (9)
.local/lwjgl2-world-comparison/1.12.2/run-1792781520962/capture  (4)
```

Their recorded `exact=true` diagnostics are retained. This audit checked the original PCM hashes against those reports; it did not rerender or relax any PCM threshold. A correct classification is **source-reviewed / normalized-loopback comparison retained / original-context measured acceptance excluded**.

## Verification and files

Read-only strict review:

```text
node scripts/review-lwjgl2122-context.mjs
```

It passes six original classes/twelve method bindings, all three report snapshots and archived agents, all 49 PCM/property pairs, probe source/JAR/raw-property/log identities, and the terminal probe process record. Ten corrupted evidence fixtures are rejected: equivalence assertion, pointer offset, method Code, scene count, PCM hash, old agent normalizer Code, fake native word, missing probe, native bridge identity and accepted classification. Results are `.local/lwjgl2122-context/validation/results.json`.

The two new JavaScript files pass syntax checks. The Java observer compiled, ran once without sound, closed its device and exited 0. No world capture, product build, product test-suite rerun, acceptance registry edit or commit was performed by this audit.

New files:

- `scripts/audit-lwjgl2122-context.mjs`
- `scripts/review-lwjgl2122-context.mjs`
- `scripts/java/Lwjgl2122ContextAudit.java`
- `docs/evidence/java-1.12.2-context-audit.json`
- this document

`audit-lwjgl2122-context.mjs --reuse-probe` rebuilds the evidence around the existing archived probe without opening a device. `--probe` explicitly performs a new no-sound original-call observation and must not be confused with review of the frozen result. Neither mode establishes normalized-context equivalence or adds measured world coverage.
