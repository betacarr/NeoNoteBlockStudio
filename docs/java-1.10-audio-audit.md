# Java 1.10、1.10.1、1.10.2 声音原类审计

三版分别完成选定核心源码、原类数值、真实 Netty 和材料音符路径审核。**1.10 的注册声音包和名称声音包均直接保存、写入和读回 float 音高**，不再有 1.9.4 的低八位 /63 量化；1.10.1 与 1.10.2 也分别执行并确认该行为。此结论没有从相邻版本或相同依赖继承。

例如原 note 1 的起始音高均为 `0.5297315716743469f`。既有 1.9.4 原类记录运输后为 `0.523809552192688f`，三版新原类实际运输和 engine 输出均保留 `0.5297315716743469f`。这是真实方法执行的具体差别，不是产品公式的模拟结果。

## 来源和独立调用链

每版先核对其官方 metadata SHA-1，再核对原 client、Paulscode/JOrbis/LWJGL 官方依赖、资源索引、sounds.json 与五份原采样。三版没有官方 client mappings；角色依据本版原类的调用者、字段、描述符和 Code 定位。

| 版本 | 官方 metadata SHA-1 | 官方 client SHA-1 |
| --- | --- | --- |
| 1.10 | `a827abf9c022a08ed9c4c7807a8c1b7f2f05deca` | `ba038efbc6d9e4a046927a7658413d0276895739` |
| 1.10.1 | `9c23be6c5a48ab7dc7698586b5d7177fff4b441a` | `44b389fff90324c4ca18796d4428a7b8ec6c2eb0` |
| 1.10.2 | `819460dcabf1a2e41b0cf65d342b18ad8dc12281` | `dc8e75ac7274ff6af462b0dcec43c307de668e40` |

各版 `docs/evidence/java-<version>-audio-source.json` 保留官方 URL、原 class/Code SHA-256、描述符和独立解释，主体各 43 类、55 个 Code 绑定。HRTF 控制另有六类、八个绑定，合并为各版 45 个不同原类。原反编译内容只在 ignored 的 `.research/lwjgl2110-chains/<version>/` 与 `.research/lwjgl2110-source/<version>/`，公开报告不含整段 javap。

实际核对链包括：

- TileEntityNote 头顶空气检查及材料分支 → 实际 dirt/stone/sand/glass/planks 五支持块 → NoteBlock 的 `double pow → float`、音量 3 和 record 类别。
- World 半格中心转换 → 原 WorldListener → 服务器实际 registered packet 构造 → 同维度 PlayerList 的严格实体平方距离筛选。音量 3 的服务器半径为 48，距离使用玩家脚部/实体位置。
- 原包构造、writeFloat/readFloat、getter → 客户端 handler → client player guard → 原 PositionedSound → SoundManager → engine。位置字段仍单独使用 `int(8 × coordinate)`，没有把音高的 float 改动误扩展到坐标。
- 原 JSON serializer 注册与声音资源读取、file/event 选择、事件解析到实例，以及 engine 实际调用该解析路径。五个官方事件均为单样本、volume/pitch 默认 1；嵌套事件直接委派仅按本版源码核对，未计作额外组件执行。
- 本版实例 getter 的 event float 乘法 → 类别 float 乘法 → source clamp；MASTER 初始化和更新最后经原 Library 到 AL listener。原实例 volume getter 在本组为 `f()`，没有沿用旧版的 `g()` 名称。
- 客户端 listener 的 double 玩家坐标插值加原 float 姿态眼高 getter，最后转 float；站姿值为 `1.6200000047683716`。source 线性距离、未 clamp 的实例/事件乘积范围、CodecJOrbis 注册和 decode/upload caller、requested 28 normal + 4 streaming 也分别绑定。

## 原类实际执行

[汇总报告](verification.md) 由 `node scripts/verify-lwjgl2110-audit.mjs` 严格只读校验来源、探针、编译类、classpath、输入和 raw 输出后生成。

| 检查 | 每版 | 三版合计 |
| --- | ---: | ---: |
| 有限数学输入 | 1,249 | 3,747 |
| 原实例/事件 getter 与 engine float 输出 | 4,996 | 14,988 |
| 真实 named/registered Netty 包案例 | 150 | 450 |
| 五材料各 25 音符的完整组件路径 | 125 | 375 |
| 原 Options MASTER 返回位 | 5 | 15 |

数值期望不由产品公式生成。数学域复用已冻结原 Java 输入，并将每版实际执行的四个原输出逐位对照既有原 Java raw；它只证明这些有限输入的相等性，没有据此推断整引擎、源码或 native 等价。新网络包还对每个输入分别执行本版原 engine 的“直接输入”和“真实 wire 读回输入”，逐位比较；不以旧字节量化结果当新 packet 期望。note 的音高运输直接对照本次原 NoteBlock 发出的 float，gain 对照本版实际 engine 数学输出。

每个材料的每个音符都执行原 tile 排队、原 NoteBlock emission、原 registered 包构造和真实 Netty write/read，再核对 event 身份/category/volume，使用原 SoundEvent 形式的实例构造并调用原 engine。只有 World 输入状态、排队/声音/粒子输出回调由探针隔离提供。有限域包括负零、下溢和边界；没有宣称 NaN 或任意资源包事件域。Options 返回位有负零，但没有实际 AL listener 读回。

最终 raw：

```text
.local/lwjgl2110-methods/1.10/run-1792800982165/report.json
.local/lwjgl2110-methods/1.10.1/run-1792800985699/report.json
.local/lwjgl2110-methods/1.10.2/run-1792800988794/report.json
```

每次 Java 的原 client classpath 均独立绑定本版唯一 client JAR；相同输出哈希也不替代实际三次执行。此前开发 raw 保留，没有覆盖旧 1.9/patch 冻结证据。

## 原 context 与 HRTF 控制

三版分别核对 engine/loader、原 Library.init、官方 LWJGL AL.create 包装及 ALCcontext 属性列表到 alcCreateContext。每版整个 client/Options 扫描均无游戏 HRTF 控制；执行各版原属性列表构造得到 `[4103,44100,4104,60,4105,0,0]`。因此只支持来源字段 `hrtfControl:false`、`hrtfControlMode:'device-default'`。

没有打开任何 native device/context，没有验证原库 HRTF 能力、实际启用状态、loopback 等效、codec 实际解码、混音 PCM 或实际分配声部数。28 只表示原 requested 配置，不能作为导出截音上限；本轮没有游戏世界录音，新增世界场景零。

## 只读接入准备

```js
import { verifiedLwjgl2110Components } from './scripts/probe-lwjgl2110-methods.mjs';
import { reviewedLwjgl2110Profile, reviewedLwjgl2110Profiles } from './scripts/review-lwjgl2110-profiles.mjs';
const original = await verifiedLwjgl2110Components('1.10');
const { legacy, world } = await reviewedLwjgl2110Profile('1.10');
// reviewedLwjgl2110Profiles() returns all three independently gated entries.
```

接口不下载、不编译、不执行 Java/native，也不写公共 facts。接入条目采用 float event、category-before-clamp、MASTER listener、五材料和设备默认 HRTF，world 的 nominal 站姿高度直接取本版原 Java float，并保留脚部发送/同维度/原监听模型 scope 与 `gameRecording:'pending'`。

当前产品只要发现 `pitchTransport` 对象就执行旧字节量化，因此准备模块**省略该执行规则对象**，用 `packetPitchEncoding:'float32'` 和 `pitchTransportDetail`/`namedPitchTransportDetail` 保留运输来源；不能将 `{kind:'float32'}` 原样塞进旧规则读取器。

上述独立研究仅新增脚本、证据和文档。其后根生成器已实际接入三版的 legacy/world 条目，来源仍为 selected-core/code-reviewed，没有提升为 native/world 已测状态。

## 0.1.18 生产路径接入复核

`node scripts/audit-lwjgl2110-integration.mjs --write-evidence` 已在本版冻结的产品、时间模型及 facts 上执行并以 exit 0 通过。[生产接入报告](verification.md) 直接读取上述冻结原类 raw，逐位对照实际生产 `gamePitchParameters`、`gameEventPitchParameters`、`gameVolumeParameters`、`noteAudioParameters`、`listenerForProject` 与 `AudioEngine.nativeRequest` 构造结果，未用产品公式生成期望值。

| 对比范围 | 每版 | 三版合计 |
| --- | ---: | ---: |
| 原 engine 最终 gain/pitch 输出位 | 2,498 | 7,494 |
| 五材料普通 note 原类案例 | 125 | 375 |
| 全部有限 float packet 输入的 scalar helper 对照 | 75 | 225 |
| 进入有效工程路径的 packet 输入 | 65 | 195 |
| 参数计算及 nativeRequest 构造（分别计数，vanilla/studio 两模式） | 各 380 | 各 1,140 |
| 其中普通 25 音高之外的 packet 输入 | 30 | 90 |
| 原 MASTER Options 位 → helper/工程 listener | 各 5 | 各 15 |

合计 **14,799 项数值逐位比较，差异零**。原 engine 四列 raw 中，列 0/1 是中间 getter 输出，完整保留但不当作公共 helper 返回值计数；只以列 2/3 对照最终 gain/pitch。`NAPP` 每输入步长 32 字节，registered 四列从 +16 开始，最终 wire→engine 期望明确取 `8 + inputIndex × 32 + 24`，没有误用 named 或构造前的值。

项目路径使用通过 `validateProject` 的整数 MIDI 加 ±50 cents 内 detune 表达连续音高。每版另有 10 个 packet 输入仅作 scalar helper 对照：非正音高，以及反解后超出本次有效音高 0–127 子集的输入，均在 `excludedProjectInputs` 逐项列明；没有强行把任意 float 说成可播放工程音符。最初准备脚本使用小数 MIDI 被工程校验拒绝，诊断保留于 `.local/lwjgl2110-integration/run-1792802293488/report.json`；只修正审计 fixture，未改产品验证或放宽位级结果。

本次 nativeRequest 对照使用明确的 32 帧内存采样 fixture，并核对原官方 Ogg 字节身份，仅验证生产请求构造。没有执行 decoder、worker、AudioContext 或 OpenAL，没有采集三版 PCM。原材料音量 3 通过合法的 velocity 1 × track gain 3 表达，没有将编辑器归一化 velocity 偷换成 3。28 仍只是来源声部配置的提示；三版状态均为 `code-reviewed`、没有世界验收计数，HRTF 沿用设备默认的实际状态仍待测量。

最终 raw 为 `.local/lwjgl2110-integration/run-1792802410951/report.json`，公开报告 SHA-256 为 `aaaad78009346545936abb951da264f7561614b615c6fc761af20cca0df15c6f`。报告绑定 317 份输入文件的当前 SHA-256，以及独立生产 bundle 与审计脚本身份。

## 同版既有世界录音重放

另外仅重用既有已接受录音，运行四版 `scripts/reverify-world-captures.mjs --version <version>`：

| 版本 | 既有报告 | 既有场景 | 进程结果 |
| --- | ---: | ---: | --- |
| 1.19 | 5 | 127 | exit 0，全部 exact |
| 1.19.2 | 7 | 145 | exit 0，全部 exact |
| 1.20.2 | 6 | 136 | exit 0，全部 exact |
| 1.20.5 | 6 | 136 | exit 0，全部 exact |

合计 24 份报告、544 场，0 LSB 差异。执行 manifest 位于 `.local/world-replay-audit/run-1792802404096/state.json`；同目录保留四份 `*-original-capture-identity.json`、stdout/stderr、各进程 PID、terminal 68704 的完成记录及源哈希。原 agent、provenance、case 列表、backend 配置和全部 PCM 哈希在执行前后校验不变。此处不是三版 1.10 的世界证据，没有运行 1.12.2 晋升，也没有新增世界场景。
