# 原版事件音高的 float 顺序

Java 1.21.8 与 1.21.9 的原类实际调用确认：音符盒音高必须先将 `Math.pow` 结果舍入为 float，再与事件的 float pitch 相乘、舍入为 float，最后限制在 [0.5, 2]。把 double 幂与事件 pitch 相乘后才舍入，会产生有限输入下的 1 ULP 差异。

[独立组件报告](verification.md) 包含原 client/mappings 来源、每个原类与方法 Code 哈希、实际输入/返回位以及产品源码哈希。每版 200 行（25 个音符 × 8 种正事件音高），两版共 400 行；修复后的实际 `noteAudioParameters` 全部逐位一致，原先的 double 公式每版有 21 行差异。

| 有限反例：音符 1，事件 pitch 1.5 | 位值 | 数值 |
| --- | --- | --- |
| 原 NoteBlock 输出及 SimpleSoundInstance 存储 | `3f079c7d` | 0.5297315716743469 |
| 原事件 ConstantFloat | `3fc00000` | 1.5 |
| 原 AbstractSoundInstance 乘积及 Engine 最终输出 | `3f4b6abc` | 0.7945973873138428 |
| 旧 double 公式 | `3f4b6abb` | 0.794597327709198 |

实际执行的链路为：

1. 原 `NoteBlock.getPitchFromNote(int)`：double `pow` 后 `d2f` 返回。
2. 原 `SimpleSoundInstance` 构造：将传入的 float 原样存入父类 pitch 字段。
3. 原 `Sound` 与 `ConstantFloat`：提供事件的 float pitch。
4. 原 `AbstractSoundInstance.getPitch()`：两 float 执行 `fmul`。
5. 原 `SoundEngine.calculatePitch(SoundInstance)`：调用原 getPitch，再以 float 上下界 clamp。

探针调用原 registry bootstrap、真实原类构造及方法；只显式注入解析后的 Sound，SoundEngine 则分配为仅供该纯方法调用的状态。没有运行世界、播放声音、测量原生混音或声称音频资源包的全流程覆盖。默认事件 pitch 1 及这次有限反例不需要新增世界采集。原始完整 javap 保留于 ignored 的 `.research/pitch-boundary/<version>/`。

```powershell
node scripts/probe-modern-pitch-order.mjs --write-evidence
```

最终冻结源码的原始报告位于 `.local/modern-pitch-order/run-1792793572584/report.json`，400行全部通过。首次证明的原始报告 `.local/modern-pitch-order/run-1792791200307/report.json` 同样保留。此材料独立于已保留的增益 clamp 基线和严格复测，当前增益/音高结果共同绑定最终源码，见[显式清单](verification.md)。
