# Java 1.21.8 / 1.21.9 音量边界验收

两版共六次独立原版整合世界采集、46 个场景，已复用原录音与最终冻结的产品广播和原生渲染路径逐样本比较，最大误差 0 LSB。公开 [矩阵清单](verification.md) 记录每次采集目录、原始 PCM、配置、代理快照及报告哈希。当前[严格增益复测](gain-fidelity-followup.md) 2,624行与[音高顺序复测](pitch-order-followup.md) 400行均逐位一致；0.1.12组件残差另作历史基线保留。

## 原类与音量顺序

[1.21.8 来源](verification.md) 与 [1.21.9 来源](verification.md) 分别绑定 25 个官方原类、176 / 175 个方法 Code 哈希。官方版本元数据、client、mappings 均校验来源与哈希。完整原类、反汇编和调用链原始产物保留于 ignored 的 `.research/volume-boundary/<version>/`，公开文件仅包含类、描述符、哈希与独立解释。

| 版本 | source gain | listener gain |
| --- | --- | --- |
| 1.21.8 | `clamp(f32(instance × category), 0, 1)` | 原版 `Options.MASTER` 经 `Listener.setGain` 设置 |
| 1.21.9 | `clamp(instance, 0, 1) × clamp(f32(category × master), 0, 1)` | 保留 OpenAL 默认值 1；原 Listener 已无 `setGain` |

音符盒原事件的 instance volume 为 3，RECORDS 与 MASTER 原选项默认值均为 1，合法滑块范围为 [0, 1]。原版 OptionInstance 的验证接受负零，拒绝负数、大于 1、NaN 和无穷。1.21.9 对 MASTER 自身的 final getter 返回原 MASTER；其他类别先以 Java float 相乘类别与 MASTER。组件执行记录包含原滑块工厂、选项 getter、SoundEngine 计算与原 Channel/Listener 方法调用，明确限定为显式构造状态的原类探针，不冒充完整引擎运行。

| 世界设置 | 1.21.8 原 source / listener | 1.21.9 原 source / listener |
| --- | --- | --- |
| category 0.5，master 1 | 1 / 1 | 0.5 / 1 |
| category 0.2，master 0.7 | 0.6000000238418579 / 0.699999988079071 | 0.14000000059604645 / 1 |

每份正式报告由场景与原 Options 独立计算产品参数，再断言其与原版 AL source/listener gain 相符；没有将捕获的 AL_GAIN 直接喂给产品。广播同时调用实际 `broadcastForProject`，使用音符盒原音量 3 对应的 48 格发送半径及玩家实体位置的严格平方距离条件。类别或 MASTER 音量不会改变该发送范围。

## 46 个世界场景

| 版本 | category 0.5 / master 1 | category 0.2 / master 0.7 | category 0.2 / master 0.7 合奏 | 合计 |
| --- | --- | --- | --- | --- |
| 1.21.8 | 9 | 9 | 5 | 23 |
| 1.21.9 | 9 | 9 | 5 | 23 |

九场单音包含中央、左右、上下、高度 40 / 48 格及音高 0 / 24。五场合奏为 3、6、16、32、64 声部，使用原版材料选择的 16 种实际音色。两版均保留原版 block events、SoundEngine、JOrbis、官方依赖包所带 OpenAL DLL 与原 Options 设置。每场为 48 kHz 双声道 PCM16、3 秒。比较时按原始场景顺序在同一个产品上下文连续渲染，保留限幅器状态；严格阈值为 0 LSB。

原 context 的 `6546=0`、`6550=0`、`6554=1` 均被保留，仅添加 loopback 所需格式和采样率。报告记录实际 context 属性、限幅器与 HRTF 状态。实际限幅器为开启，原版和产品的 HRTF 均关闭。关闭状态的 `ALC_ALL_ATTRIBUTES` 不返回 6550，因此这里只证明请求值被保留及实际关闭状态，没有声明开启 HRTF 或配置应用等价。

原 Camera 与 AL listener 在每场开始、每 1024 帧块及结束采样，共 143 次，均保持稳定。实际 Camera 为 `(0.5, 81.61999988555908, 2.5)`，AL listener 为 `(0.5, 81.62000274658203, 2.5)`，朝向 `(0,0,-1)`、上方向 `(0,1,0)`。来源绑定包含 Camera → ListenerTransform → SoundEngine.updateSource → Listener.setTransform 的原调用链；渲染采用实际观测到的绝对坐标。站姿名义眼高 1.62 不等同于将所有浮点中间步骤简化为理想常量。

先前无广播过滤的单次诊断有 8/9 场一致，48 格场景出现 8 LSB 差异，因为原服务端未投递事件而直接混音路径仍有微弱输出。该诊断原样保留，未计入通过数。正式六份报告全部启用 `--broadcast`，46 场全部一致。

## 0.1.12 组件基线及后续严格复测

[组件报告](verification.md) 每版 949 行，共 1,898 行，不计作世界场景。每版分为音符盒原 raw volume 3 的 27 行、合成非有限实例 75 行、合成负实例 25 行、其他合成有限实例 822 行。数值一致包括明确标记的 NaN 对 NaN 鲁棒性结果；这些输入不是滑块接受的值，也不代表音符盒可产生它们。

[正负零单列报告](verification.md) 保留历史上的 109 行位差异：1.21.8 为 56 行，1.21.9 为 53 行。来源包括 instance 的显式负零与负数下溢、负实例乘正零、category 负零和 master 负零。原 Java clamp 可保留 `0x80000000`，当时的产品 clamp 将其规范为 `0x00000000`。每行记录输入及原函数、原 source/listener 与产品对应位，当时 `strictGainBitExact` 为 false。旧组件 helper 还曾将二者均为 NaN 视为位一致；这些历史材料保持原样，新复测没有该豁免。

当前固定单位区间使用条件比较保留负零和输入 NaN 位，并单独验证现代音高的 float 运算顺序。最终 [增益组件](verification.md) 2,624行和[音高组件](verification.md) 400行全部逐位一致；合成域和合法音符盒输入域分开计数，不增加世界场景数。

本轮未测开启 HRTF、移动监听者、全部数值设置、其他声音事件、物理扬声器输出或实时调度延迟。原版采集进程均正常退出，无活动采集句柄。最终复核没有新增采集；原 PCM 和代理身份保持不变，只复用录音刷新产品比较与显式清单。

## 重现

已有录音可直接重新比较，无需重启游戏：

```powershell
node scripts/verify-volume-boundary-matrix.mjs --manifest .local/world-volume-boundary/boundary-matrix.json
node scripts/archive-final-volume-world.mjs --result .local/world-volume-boundary/matrix-verification-1792793606983.json
```

第二条参数应替换为本次实际完成的汇总文件；归档脚本会校验六份报告、原始 PCM、代理、独立组件结果与冻结源码哈希。当前汇总包含最终增益、音高、原生配置与事实的共同源码哈希，也绑定 Vorbis/Java decoder、原 Java decoder 源码及工程/时间模型依赖。正式报告也已分别通过 `reverify-world-captures.mjs --version 1.21.8` 与 `--version 1.21.9` 的原录音身份复核路径。完整来源审核可用 `audit-volume-boundary-source.mjs`；旧组件脚本保留用于复现历史来源，当前复测使用独立 helper：

```powershell
node scripts/audit-volume-boundary-source.mjs
node scripts/recheck-final-gain-fidelity.mjs --write-evidence
node scripts/probe-modern-pitch-order.mjs --write-evidence
```

只有需要新增独立录音时才运行采集。下面展示已使用的三类设置，版本参数分别为 `1.21.8` 和 `1.21.9`；每次均自动创建新目录，不复用用户世界：

```powershell
node scripts/capture-volume-boundary-world.mjs --version 1.21.8 --records .5 --master 1 --quick
node scripts/capture-volume-boundary-world.mjs --version 1.21.8 --records .2 --master .7 --quick
node scripts/capture-volume-boundary-world.mjs --version 1.21.8 --records .2 --master .7 --polyphony
```
