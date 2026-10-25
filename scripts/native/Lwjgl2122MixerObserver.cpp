// STATIC PREPARATION ONLY. This file is not an installer and opens no device.
// A future controller must prove the exact DLL/callsite, quiescent install,
// verified own-process device, all allocation bounds, and thread-joined removal.
using u32 = unsigned int;
using u64 = unsigned __int64;
using i64 = __int64;
static_assert(sizeof(void*) == 8 && sizeof(int) == 4 && sizeof(long) == 4, "Win64 ABI only");
extern "C" i64 _InterlockedIncrement64(volatile i64*);
extern "C" i64 _InterlockedDecrement64(volatile i64*);
extern "C" i64 _InterlockedExchange64(volatile i64*, i64);
extern "C" void __movsb(unsigned char*, const unsigned char*, u64);
#pragma intrinsic(_InterlockedIncrement64, _InterlockedDecrement64, _InterlockedExchange64, __movsb)

using Mixer = void(__cdecl*)(void*, void*, int);
struct Control {
    Mixer original;
    void* device;
    unsigned char* slots;
    u64 capacity;
    u64 stride;
    u64 maxFrames;
    volatile i64 armed;
    volatile i64 inflight;
    volatile i64 calls;
    volatile i64 attempted;
    volatile i64 committed;
    volatile i64 dropped;
    volatile i64 invalid;
};
struct Slot {
    volatile i64 publish;
    u64 sequence;
    u64 device;
    u64 buffer;
    u32 frames;
    u32 frequency;
    u32 formatChannels;
    u32 formatType;
    u32 updateSize;
    u32 numUpdates;
    u64 bytes;
};
static_assert(sizeof(Control) == 104 && sizeof(Slot) == 64, "Recorded layout must not drift");
static Control* control = nullptr;

// The controller binds once before the callsite is patched. Control and its
// bounded append-only slots remain alive until the original worker is joined.
extern "C" __declspec(dllexport) u64 ObserverBind(Control* value) {
    control = value;
    return (static_cast<u64>(sizeof(Control)) << 32) | sizeof(Slot);
}

extern "C" __declspec(dllexport) void Observer(void* device, void* buffer, int frames) {
    Control* c = control; // Non-null and immutable are installation preconditions.
    _InterlockedIncrement64(&c->inflight);
    _InterlockedIncrement64(&c->calls);
    c->original(device, buffer, frames); // Exactly once, unchanged three ABI arguments.
    if (c->armed) {
        const i64 index = _InterlockedIncrement64(&c->attempted) - 1;
        if (index < 0 || static_cast<u64>(index) >= c->capacity) {
            _InterlockedIncrement64(&c->dropped);
        } else {
            Slot* slot = reinterpret_cast<Slot*>(c->slots + static_cast<u64>(index) * c->stride);
            slot->sequence = static_cast<u64>(index);
            slot->device = reinterpret_cast<u64>(device);
            slot->buffer = reinterpret_cast<u64>(buffer);
            slot->frames = static_cast<u32>(frames);
            slot->bytes = 0;
            if (device != c->device || !buffer || frames <= 0 || static_cast<u64>(frames) > c->maxFrames) {
                _InterlockedIncrement64(&c->invalid);
            } else {
                // Offsets below are proved for the exact shipped binary, not C struct packing.
                const volatile u32* fields = reinterpret_cast<const volatile u32*>(device);
                slot->frequency = fields[0x38 / 4];
                slot->formatChannels = fields[0x44 / 4];
                slot->formatType = fields[0x48 / 4];
                slot->updateSize = fields[0x3c / 4];
                slot->numUpdates = fields[0x40 / 4];
                const u64 bytes = static_cast<u64>(frames) * 8;
                if (slot->frequency != 48000 || slot->formatChannels != 5377 || slot->formatType != 5126 ||
                    !slot->updateSize || static_cast<u32>(frames) % slot->updateSize || c->stride < 64 || bytes > c->stride - 64) {
                    _InterlockedIncrement64(&c->invalid);
                } else {
                    // This is the application's GetBuffer packet before its own ReleaseBuffer.
                    // Writes target observer-owned memory only; the original buffer stays read-only.
                    __movsb(reinterpret_cast<unsigned char*>(slot) + 64,
                            reinterpret_cast<const unsigned char*>(buffer), bytes);
                    slot->bytes = bytes;
                }
            }
            _InterlockedExchange64(&slot->publish, index + 1);
            _InterlockedIncrement64(&c->committed);
        }
    }
    _InterlockedDecrement64(&c->inflight);
}
