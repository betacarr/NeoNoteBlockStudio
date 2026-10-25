# Native 预览的起音帧与循环尾音（0.1.19 检查点）

0.1.18 修正了两种已经复现的问题：音乐 tick 经浮点秒数往返后，恰好落在半帧的起音可能早一帧；从工程开头播放循环时，直接进入预热后的循环区间，会听到并不存在的“上一圈”尾音。0.1.19 没有新增本节的时序功能，而是在扩充后的 84 个核心 profile 事实集上重跑原类和 Offline 组件检查。当前验证分别覆盖精确帧计算、原版音频类的受控 PCM 对照和实际 Web Audio 离线播放。它们没有测量世界 tick、服务器/红石投递延迟、声卡输出或实包的实时起音延迟。

## 已保存的反例

在 PPQ 480、BPM 96、48 kHz 下，tick 123 的精确时间为 `41/256` 秒，即 `7687.5` 帧，正数 half-up 应得到 **7688**。旧 `seconds()` 运算得到 `0.16015624999999997`，再乘采样率并四舍五入得到 7687。实际生产 native renderer 的脉冲起点也早了一帧；tick 245、505、507 有相同问题。

| tick | 精确 half-up 帧 | 旧生产 PCM 脉冲帧 | 最终生产 PCM 脉冲帧 |
| ---: | ---: | ---: | ---: |
| 123 | 7688 | 7687 | 7688 |
| 245 | 15313 | 15312 | 15313 |
| 505 | 31563 | 31562 | 31563 |
| 507 | 31688 | 31687 | 31688 |

另一个反例不依赖单段运算顺序：PPQ 960、BPM 176，在 tick 0 到 54 每 tick 写入相同 BPM，查询 tick 55，精确结果为 `937.5 → 938`。旧秒数前缀累加得到 937；把表达式换成 `delta * 60 / (ppq * bpm)`，甚至先用浮点累加各段帧数，仍会在这个前缀上得到 937。

独立 BigInt 有理数 oracle 的离线扫描保留了这些反例：935,424 个单段查询中，旧表达式错 330 个，换运算顺序后仍错 186 个；六个针对重复 tempo 前缀的案例中，浮点帧前缀仍错四个。有限扫描用于寻找反例，不构成新算法普遍正确的证明。旧诊断脚本及 raw 保持原样；其中关于暖首圈的结论属于修复前快照，不用来判断当前产品。

## 帧量化约定与实现

生产接口是 [`TempoMap.frame()`](../src/core/time.ts)：

```ts
timing.frame(tick, sampleRate)
timing.frame(tick, sampleRate, { cycle, endTick })
```

PPQ、BPM、tempo 边界和查询 tick，均按已保存 JavaScript 数字的最短可往返十进制表示解释成精确有理数。查询 tick 和循环 `endTick` 可以是有限非负小数；这保留了参考音频结束位置换算为非整数 tick 的路径。采样率是正安全整数，圈数是非负安全整数，超出安全整数的结果帧明确报错。相同 tick 的 tempo 仍由最后一条生效，公共 `events`、`seconds()`、`tick()` 和 NBSX 格式不变。

将完整音乐时间记为 `T(tick)`。普通事件只对 `sampleRate × T(tick)` 做一次正数 half-up；循环事件先精确合成 `T(tick) + cycle × T(endTick)`，再做这一次舍入。不会先舍入每段、每圈或周期长度，也不添加 epsilon。生产请求同时携带整数 `frame`、音乐 `tick` 和兼容的 `time`；worker 优先使用整数帧，旧调用者仍可使用 `time`。

为避免每个音符都建立巨大公共分母，首次 `frame()` 查询才建立内部索引，普通秒数/UI 查询不支付这项 BigInt 成本。索引使用 `Q = 10^30`：每段秒数乘 Q 后向下取整，保存下界 L；每个非零余数给累计误差界 C 加一。因为每个被截去的余数严格小于一个 Q 单位：

- `C = 0` 时，精确秒数就是闭合单点 `L/Q`。
- `C > 0` 时，精确秒数位于半开区间 `[L, L+C)/Q`。
- 查询局部段、圈数乘法与加法保持同一上下界。若区间两端乘采样率后的 half-up 相同，单调性保证精确答案就是该整数；上端按闭合点保守计算，不会漏掉半帧边界。
- 只有两端结果不同时，才计算并缓存真正的有理数前缀，以 gcd 约分，精确加入局部时间和循环周期，最后 half-up 一次。

相邻相同 BPM 只在内部精确索引合并，公共事件不删改。快速路径的保证来自上述界限，与测试数量无关；它不限制精确 fallback 的最坏成本。极端长、互不相关的小数 BPM 前缀可能产生很大的有理数分母，BigInt/gcd 计算会变贵；缓存只保存实际请求的 fallback 边界。

本机 2,000 个 tempo、100,000 个实际音符对象的查询记录：整数 BPM 约 **70.5 ms**，六位小数 BPM 约 **92.1 ms**，首次索引约 2.2/4.2 ms。这是一次 CPU 观察，没有脆弱的耗时通过线，也不代表界面 FPS 或极端 fallback 上限。独立回归测试在 [`tests/time-frame.test.ts`](../tests/time-frame.test.ts) 覆盖两个上述反例、多 tempo/同 tick、小数与指数形式、四种采样率、非零位置和循环周期。

## 冷启动、seek 与循环尾音

App 已经生成冷前缀、预热周期和稳态循环段。0.1.18 的修复保留这些数据，只将 [`playRendered()`](../src/audio/engine.ts) 的首次 `source.start()` 偏移从 `loopStart + from` 改为 `from`。音频先播放真实冷前缀和预热过程，达到 `loopEnd` 后回到稳态 `loopStart`。这样既没有虚构上一圈，又保留后续跨圈尾音。

实际 OfflineAudioContext 使用未修改的最终生产 `playRendered()`。夹具周期 0.5 秒，首音在 0.45 秒，音源持续 0.3 秒：首次首音前峰值为 **0**，前四处跨圈尾音均存在，2.5 秒输出与独立按 `0.45 + n×0.5` 安排事件的连续原生混音逐样本相同。这个检查使用已核实官方哈希的 1.14.4 OpenAL DLL 和合成 PCM，关闭 HRTF；没有经过原版 Vorbis 解码，也没有合成界面输入。

从 tick 240（0.125 秒）开始播放时，非循环和循环两条路径都保留同圈先前 onset 的余音，前 1,000 个输出帧与原 PCM 对应片段完全一致。输送位置还按独立夹具公式核对相位；这不把 UI 的浮点秒数转换升级为精确原生事件帧保证。

非整帧周期另有单独观察：BPM 137 连续 300 圈，约 131.39 秒，实际 OfflineAudioContext 脉冲峰值相对独立有理数预期的最大误差为 **1 帧**，首圈和末圈误差均为 0，未观察到累计漂移。这是该浏览器离线循环/重采样的观测残差；不是放宽原版 PCM 比较阈值，也不保证任意曲长、参考音频、硬件或实时调度都具有相同界限。

## 0.1.19 当前来源与历史证据

当前核心事实集由 44 个现代、4 个早期和 36 个 legacy profile 组成，去重后共 84；world delivery 事实另有 50 条。数量表示产品事实范围，不是 84 个 profile 的音乐时序均已测量。以下时序检查仍是原有 16 条 timeline / 268 个事件和四个 Offline 夹具的重放，没有增加场景或扩大结论。

| 证据 | 最终结果 | 范围 |
| --- | --- | --- |
| [0.1.19 原类连续时序](verification.md) | 16 条 timeline、268 个事件，全部 **0 LSB**；`frameDifferences: []` | 官方身份核实的 1.20.5 原 JOrbis/音频 Buffer/Channel/Listener 与实际生产 nativeRequest/renderer；HRTF off/on、限幅开启、块边界、半帧、重复 tempo、速度变化、声源复用、64 音和重复乐句。是受控帧时钟组件对照，没有新世界场景。 |
| [0.1.19 Offline 播放](verification.md) | 冷前缀无声、跨圈尾音保留、两条 seek 正控、四个 BPM96 PCM 起点正确；300 圈峰值残差最大 1 帧；renderer errors 为空 | 实际生产函数、隐藏 Electron OfflineAudioContext、1.14.4 原 DLL + 合成 PCM；不是实包或声卡测量。 |
| [0.1.19 两版旧世界重放](verification.md) | 1.14.3、1.14.4 各 **127**，合计 254，全部 0 LSB；原录音身份不变 | 旧世界 PCM 的音频回归检查。每版 54 off + 54 受控 backend on + 9 master + 5/5 合奏；不新增覆盖，也不验证连续音乐的世界 tick 时序。 |
| [0.1.18 历史重放](verification.md) | 同一批 254 个旧场景，历史检查点全部 0 LSB | 保留当时的来源和执行记录；当前来源以 0.1.19 清单为准，不叠加计数。 |

0.1.19 原类 raw 为 `.local/original-timeline/1.20.5/run-1792804288705/report.json`，其 SHA256 与当前 canonical public 一致：`28d2c2e2415b05b68ca7fb4577fb3252d7b5533bb0c9a0818724758ac5be274b`。当前 Offline raw 为 `.local/native-preview-temporal/run-1792804289077/report.json`，SHA256 `e2dbdf4ead62872493e5fe7a42cf9d3b8336460982dc515663736a933d442f35`；canonical public SHA256 为 `9ddff505854e8e8f40f3918d7bb4876bcd119e414351294fa1e97e3c0b95bf5b`。

两份 canonical 报告的完整来源闭包分别有 27 / 28 个文件，已逐文件与当前源码核对。它们共同绑定以下冻结来源；`time.ts` 与 0.1.18 相同，变化的是本轮扩充的事实集合。

| 来源 | SHA256 |
| --- | --- |
| `src/core/time.ts` | `5dbd197fd434cf292fd9ae2bcc3839dde96a3b82813df2293407ad1c3d9f8770` |
| `src/data/legacy-audio-facts.json`（36 条） | `fc58cbd1393d978584e85b8a9679c0c1f07d5ac808af877715081a8104e815e3` |
| `src/data/world-audio-facts.json`（50 条） | `90d1ab95286ede6afc815caa9cf541a1a7cb07db7b0bd6b45e229f2dfb8c0730` |

本地当前重放与历史诊断保留路径、SHA256：

| raw | SHA256 |
| --- | --- |
| `.local/native-onset-timing/run-1792800835308/report.json`（修复前） | `ac927a5c2d29528784aa322925093ccefb33cb400ed3e32a024966fae95b297e` |
| `.local/tempo-frame-rounding/run-1792801140339/report.json`（独立扫描） | `d60d10c8e02098d2b3ded32711ee53a5ed66f9d8c0e933aacdc0a4aab9a5dc41` |
| `.local/exact-frame-quantization/run-1792801700813/report.json`（100k 查询） | `1a46122bd4da23b1c34df18ba8ba8f76d4b6e178dc7d74701a8bea97afd6d76b` |
| `.local/original-timeline/1.20.5/run-1792802393368/report.json`（0.1.18 历史原类时序） | `3ef9050ec891a2cb8d8e446c4e45adc98964a02f6a22d644f7d74f2f25d1a328` |
| `.local/native-preview-temporal/run-1792801888290/report.json`（0.1.18 历史 Offline；当时 public SHA256 为 `ac2e37f4e2b3dad65e8c97bbe97318f174703095563362bdbf9a8b74ee87d338`） | `4c0a99fb6bb11a0314cd7573b46e9cc08593d40351e621f398023f27a74840cc` |
| `.local/world-refresh-143-144-1792802479300/refresh-summary.json`（0.1.18 重放执行清单） | `aa683ab13089a261e67e164f4d8e7ac9dfe4a6b30474f6349b0cf0e8573bab89` |
| `.local/world-refresh-143-144-1792804095108/refresh-summary.json`（0.1.19 重放执行清单） | `e409a5b44baa155096bc3cc3ec98b392f75411dcca31685754d0fdddbd0e0d67` |

可重复执行的入口：

```powershell
npx vitest run tests/time.test.ts tests/time-frame.test.ts tests/reference-transport.test.ts
node scripts/verify-original-timeline.mjs --write-evidence
node scripts/verify-native-preview-temporal.mjs --write-evidence
node scripts/reverify-world-captures.mjs --version 1.14.3
node scripts/reverify-world-captures.mjs --version 1.14.4
```

这些入口需要已有本地原版客户端、官方资源/原生库和隔离研究运行时。世界重放只消费旧采集；它会刷新当前 canonical 比较报告和派生 renderer/WAV，不应覆盖带日期的诊断快照。当前未完成的范围仍包括实际世界多音符起音与游戏 tick 的联合采集、网络/服务器负载、硬件音频延迟、macOS、实时 UI 卡顿与实包时序。这里的通过结果不对这些范围作推断。
