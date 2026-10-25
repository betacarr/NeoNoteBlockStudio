# Java 1.12.2: static plan for observing ordinary-device mixer output

This is a prepared design, not a new recording. The observer source compiles and its actual binary ABI has been inspected, but neither that DLL nor OpenAL was loaded or executed by this work. No process memory was patched, no new sound was started and the excluded 49 recordings remain excluded.

Static evidence: [java-1.12.2-regular-mixer-plan.json](verification.md), SHA-256 `ba0200679ff22e0b6dbff9be38bb0538c4271f1a97297e9731aee6414ecd615b`. Read-only consumer: `reviewMixerObserverPlan()` in `scripts/review-lwjgl2122-mixer-plan.mjs`. The preceding [DSP state observation](java-1.12.2-dsp-state.md) and all earlier evidence remain frozen.

## Chosen observation point

Use the original MMDevAPI backend's existing `CALL rel32` at RVA **0x202c8**, in the exact shipped `OpenAL64.dll` SHA-256 `9261b66010a845ddef9f61d5e4266fe2f08a53f3605da002e9e8f8d202bdbc5e`. Its five bytes are `E8 1B 55 FF FF`, targeting the unchanged mixer at **0x157e8**; normal return is **0x202cd**. The binary caller prepares:

```text
0x202bd  RDX = [RSP+0x48]    original GetBuffer packet pointer
0x202c2  R8D = ESI           original requested/mixed frame count
0x202c5  RCX = RBX           original device
0x202c8  CALL 0x157e8
```

The proposed replacement is another five-byte `CALL rel32` to a nearby observer-owned island. That island is only `mov rax,<Observer address>; jmp rax` (12 bytes). It changes no stack pointer or nonvolatile register. The normal compiled C wrapper calls the original mixer once with the unchanged three arguments, copies the resulting packet to private preallocated memory, then returns to 0x202cd.

**No original instruction is moved into a trampoline.** The mixer prologue remains intact. The original call's target and the replacement target are calculated relative to the instruction after the five-byte call, with explicit signed-32-bit range checks. The island's absolute pointer handles an observer DLL outside that range. This avoids an unproved prologue-instruction relocator.

The original mixer immediately overwrites RAX with RSP, and the caller passes no argument in RAX. The island's RAX change therefore does not replace an original input. The function's return type is void; the caller resumes by loading its own R11D from the original stack.

## ABI and compiled preparation

[`Lwjgl2122MixerObserver.cpp`](../scripts/native/Lwjgl2122MixerObserver.cpp) defines only a normal Win64 wrapper and a one-time control-pointer binder. It is not an installer. A future controller must establish its non-null, immutable control pointer before patching any call.

The observed compiled wrapper has one call instruction, `call [rbx]`, to its configured original mixer. RCX and RDX retain the incoming device and packet pointer, while R8D is restored from the incoming 32-bit frames value. The argument-preserving dataflow and the sole call were checked in actual compiler assembly. The wrapper saves its nonvolatile registers, pushes R14 and reserves 32 bytes of shadow space, retaining 16-byte stack alignment before that call. Its actual PE contains compiler-generated `.pdata/.xdata` for the complete wrapper, including saved RBX/RBP/RSI/RDI/R14 and stack allocation. The island is a stack-neutral leaf jump; it needs no dynamic unwind table.

The DLL has a zero entry point and no imports. Its packet copy is an integer `rep movsb`; no observer XMM/YMM/MXCSR operation is emitted. Atomic counters and slot publication are compiled intrinsics. There is no managed callback, file I/O, allocation, wait, lock acquisition, device/context API or source/buffer API in this wrapper. This is consistent with the [Microsoft Win64 ABI](https://learn.microsoft.com/en-us/cpp/build/x64-calling-convention?view=msvc-170); actual runtime behavior remains a later test.

Compilation, linking and two static inspections completed with exit 0 in `.local/lwjgl2122-mixer-plan/static-1792806722876`. All commands, tool hashes, source snapshots, object/DLL/assembly hashes and outputs are retained. Those compiler tools ran; the proposed observer DLL did not.

## Packet ownership and lifetime

The original source's [MMDevAPI procedure](https://github.com/kcat/openal-soft/blob/9b6a226da55a987cb883f425eeb568776ea12c8d/Alc/backends/mmdevapi.c) has this ordering, also visible in the shipped binary: successful `GetBuffer` → device lock → mixer call → padding update → unlock → `ReleaseBuffer`. The wrapper copies after the original mixer returns and before returning to the backend, so it operates inside that packet's existing lifetime and lock interval.

Microsoft documents that [`GetBuffer`](https://learn.microsoft.com/en-us/windows/win32/api/audioclient/nf-audioclient-iaudiorenderclient-getbuffer) returns a packet sized by the requested frame count; the same thread must subsequently call [`ReleaseBuffer`](https://learn.microsoft.com/en-us/windows/win32/api/audioclient/nf-audioclient-iaudiorenderclient-releasebuffer). This observes this application's render packet before release. It is not a Windows system-loopback/capture endpoint or another application's audio.

The initial supported format is deliberately narrow: the previously observed 48 kHz, stereo, float32, **8 bytes per frame**. Every stored callback rechecks the exact binary-bound frequency/channel/type fields and records its actual frames, update size/count and packet address. Format, target-device or bounds mismatches produce an invalid record with zero copied bytes; they do not alter the original call or supply a guessed format.

## Bounded append-only recorder

The 104-byte control structure and 64-byte slot metadata are compile-time checked. The controller will allocate and validate the full slab before arming: checked capacity × stride arithmetic, aligned publication counters, sufficient per-slot PCM capacity and guard regions. The observed regular update size/count provide the initial maximum packet bound; unsupported values are explicit failures, not silently truncated data.

Each armed callback reserves one sequence number, records metadata, copies the exact `frames × 8` bytes, then atomically publishes completion. The wrapper never writes to the original packet. Full capacity increments a dropped counter and continues the original mixer path; a nonzero dropped/invalid counter makes an experiment unusable. The first pilot should use one target regular device and one backend worker. The later loopback uses a different backend, and any unexpected regular device fails the scope checks. No file serialization occurs on the playback thread.

Copying has a real cost inside the existing GetBuffer/ReleaseBuffer interval. It cannot be described as timing-neutral. Callback lengths, ordering, drop/invalid counters and later timing/underrun diagnostics must be retained. Source/listener-update timing is still a separate proof requirement.

## Installation and restoration gates for a future attempt

Installation must occur before the first original `alcCreateContext` reaches backend thread creation, after verifying the DLL, original mapped call bytes and audited MMDevAPI backend. The original call's arguments are never rewritten. Allocate the control/slab, bind the wrapper, hold a reference to the original module, and prepare an island inside the actual ±2 GiB call range. Before enabling capture, obtain the original actual native attribute list and repeat the complete stable-list and effective-format checks. The original outside-allocation pointer issue has not disappeared.

Only a quiescent first-call window may change the five bytes. Save the complete original mapped text baseline, page protection and original bytes; change only the reviewed call, restore page protection, flush instruction caches and read back both call and island. [`VirtualProtect`](https://learn.microsoft.com/en-us/windows/win32/api/memoryapi/nf-memoryapi-virtualprotect) and [`FlushInstructionCache`](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-flushinstructioncache) both need checked success. A partial installation or failed rollback is an unusable attempt; it must never be reported as a preserved original call.

The compiled wrapper remains unarmed until original AL.create has returned, its actual device/format are verified and the full recorder is ready. Initial unarmed callbacks still call the original mixer but copy no packet. Any future claim must state this capture interval explicitly.

The original stop sender is RVA 0x215e8, sending message 0x403 and waiting for its response. The actual handler sets `killNow` at 0x2105f, calls `StopThread` at 0x21066 and only afterwards releases its render client and signals completion. The shipped `StopThread` at 0x1ada0 reads the worker handle at object offset 0x10 and calls `WaitForSingleObject(INFINITE)` at 0x1adb5. **It does not inspect that wait's return value.** Original SDK cleanup returning therefore is not enough to establish quiescence.

Before cleanup, a future controller must safely observe and retain an own-process [`DuplicateHandle`](https://learn.microsoft.com/en-us/windows/win32/api/handleapi/nf-handleapi-duplicatehandle) of that actual worker handle. After the original cleanup path, it must independently observe [`WAIT_OBJECT_0`](https://learn.microsoft.com/en-us/windows/win32/api/synchapi/nf-synchapi-waitforsingleobject) and `inflight == 0`. The original module reference, wrapper DLL, island and slab stay alive until then. A module reference acquired with [`GetModuleHandleExW`](https://learn.microsoft.com/en-us/windows/win32/api/libloaderapi/nf-libloaderapi-getmodulehandleexw) also keeps the original text available after SDK teardown.

Only after those gates may the controller require the currently installed bytes still equal its patch, restore the exact original five bytes, restore protection, flush caches and verify the complete mapped text equals its pre-patch baseline. A failed wait, missing handle, active wrapper or changed bytes forbids restoration/freeing; retain all observer allocations until process terminal and mark the attempt unavailable. No thread suspension, forced worker termination or overwrite of an unrecognized patch is part of the design.

## What passed and what remains

All **22 pure-memory tests** pass: original target decoding; rel32 round trips across three representative module bases and signed boundary values; out-of-range/invalid target rejection; 12-byte absolute island encoding; five-byte-only edits; entire input image restoration; and rejection of unrecognized installed bytes/non-call opcodes. `node scripts/review-lwjgl2122-mixer-plan.mjs` passes without compilation or native execution.

No installer, original-call Java adapter, protected-memory write, runtime packet capture, thread-handle duplication, actual restoration, source playback, regular PCM or loopback comparison has run. The next turn must review an independent implementation of all runtime gates before authorizing one actual observer attempt. Only after a successful regular-output observation could a separate loopback render follow the recorded callback sizes and update ordering. No equivalence, acceptance promotion or new world count follows from this static design.
