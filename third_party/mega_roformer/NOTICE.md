BS-RoFormer inference source from ZFTurbo/Music-Source-Separation-Training,
tag v1.0.21, commit ea7eb9c20ea0e3f94368a30fc1654b51cdd55789 (MIT).
Upstream credits lucidrains/BS-RoFormer for the architecture implementation.
Local changes: relative Attend import, a minimal package initializer, and opt-in
CPU inference query tiling in Attend and optional Transformer batch slicing.
Both preserve full sequence context and are disabled during training. Unused
heads can remain on meta after strict complete-checkpoint validation; selected
heads and shared modules use FP32. Checkpoint files are never modified.
Model weights/configuration are not bundled. Their official asset hashes remain pinned separately.

macOS adapter (2026-11-08): during MPS inference, complex spectrum masking,
DC suppression and inverse STFT are performed on CPU. Learned layers remain
on MPS. This avoids an MPSGraph complex-scatter process abort; checkpoint
values, time context and stem selection are unchanged.
