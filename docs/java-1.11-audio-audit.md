# Java 1.11、1.11.1、1.11.2 声音原类审计

三版分别完成选定核心源码与原类组件审核。注册包和名称包均直接写入、读回 float 音高；原 NoteBlock 先以 double 计算 pow，再转 float，经过实际包读写后保留原值。此次没有找到三版在所核对音高、音量或五材料规则中的变化，也没有据此继承 1.10、1.12 或任何 native/world 验收。

## 官方来源与逐版角色

| 版本 | 官方 metadata SHA-1 | 官方 client SHA-1 | 原 engine / instance | 原 registered packet |
| --- | --- | --- | --- | --- |
| 1.11 | `935062464617c9904d20045065515cfd3f1b76d2` | `780e46b3a96091a7f42c028c615af45974629072` | `ccn` / `cbz` | `ig` |
| 1.11.1 | `b244f9fc1721a2ac90b6e12220f5e40246d2c84d` | `0935745a11806d6b4cf00221938e7560c23f9291` | `ccq` / `ccc` | `ig` |
| 1.11.2 | `fa3f6d94a9fad648ff97d18fd710997261a421e8` | `db5aa600f0b0bf508aaf579509b345c4e34087be` | `ccq` / `ccc` | `ig` |

metadata、client、官方资源索引、sounds.json、五份原 Ogg 与依赖均按其官方 SHA-1 校验。上述 metadata 的类型各为 release，三版没有官方 client mappings；角色按各自原 class 的调用者、描述符、字段及 Code 确定。各版主体 43 类 / 55 个方法 Code 绑定，另有 HRTF 路径 6 类 / 8 个绑定，合并各为 45 个不同原类。同名或相同 Code 哈希不替代各版原 JAR 的身份校验。

公开来源报告分别为 [1.11](verification.md)、[1.11.1](verification.md)、[1.11.2](verification.md)。报告保留官方 URL、class/Code SHA-256、member、descriptor、独立解释和 ignored 原证据路径；整段 javap 仅在 `.research/lwjgl2111-chains/<version>/` 与 `.research/lwjgl2111-source/<version>/`。

实际核对链包括：

- 原 TileEntityNote 的头顶空气条件、dirt/stone/sand/glass/planks 分支及队列事件 → 原 NoteBlock 的五事件表、record 类别、音量 3 和 pow→float。
- 原 World 的半格中心转换 → WorldListener → ServerWorldListener 实际构造 registered packet → PlayerList 的同维度、严格玩家实体平方距离筛选；音量 3 对应 48 的发送半径，位置使用玩家脚部/实体位置。
- registered `ig.<init>(Lnm;Lno;DDDFF)V`、`b(Let;)V` / `a(Let;)V`、`g()F` → 原 client packet handler / player guard → PositionedSound → SoundManager → SoundEngine。两种包的两个声音标量均为 writeFloat/readFloat，没有低八位音高编码。坐标字段的 int(8×coordinate) 独立保留，不能据音高改变推断坐标改变。
- 原 JSON serializer 的 float volume/pitch、Gson 注册、资源输入、file/event 注册、加权选择及嵌套事件直接委派 → 原实例解析路径 → engine。五个官方事件各为单样本，event volume/pitch 都是 1。
- 实例 event float 乘法 → category float 乘法 → source clamp；MASTER 经 Options、loader/engine、原 Library.setMasterVolume 到 AL listener。实际 volume/pitch 最终方法各为 `e(instance)F` / `d(instance)F`，不是按相邻版本的方法名猜测参数。
- 原 client listener 先插值 double 玩家坐标、加原姿态眼高 getter，再转 float；名义站姿眼高为 `1.6200000047683716`。原 source 的线性距离、未 clamp 的实例/event 乘积范围、CodecJOrbis 注册和 decode/upload caller、SoundSystemConfig 请求 28 normal + 4 streaming 也分别核对。

## 真实原类组件

[汇总报告](verification.md) 通过 `node scripts/verify-lwjgl2111-audit.mjs` 消费已冻结原字节和 raw 输出，不执行产品公式生成期望值。

| 检查 | 每版 | 三版合计 |
| --- | ---: | ---: |
| 有限数学输入 | 1,249 | 3,747 |
| 原 getter / engine 四列 float 输出 | 4,996 | 14,988 |
| 真实 named / registered Netty 包案例 | 150 | 450 |
| 五个实际材料 × 25 note | 125 | 375 |
| 原 Options MASTER 返回值 | 5 | 15 |

数学期望来自已冻结、实际执行的原 Java 1.9 raw；每版本次也分别执行自己的原 getter 与私有 engine 方法，再对原结果逐位比较。相同结果只证明这个有限域，不代表整版引擎或 native 一致。输入包括 signed zero、下溢和有限边界，没有宣称 NaN 或任意资源包域。

包探针分别执行本版原构造、真实 Netty write/read，并调用本版原 engine 对照直接输入与 wire 输入。`NAPP` 每输入 32 字节：named 四列从 +0 开始，registered 从 +16 开始，列序为 constructor / wire / engineViaWire / engineDirect。这里注册包 note 1 的原 `0.5297315716743469f` 在 wire 和 engine 中保持原位；没有套用旧版 /63 或 /63.5 公式。

材料探针执行各版原 tile 和 NoteBlock 方法，World 的输入状态与 queue/sound/particle 回调由明确的隔离宿主提供，再用所捕获的原 event/category/volume/pitch 构造原 registered 包、Netty 读回和原 PositionedSound/engine。World/服务器实际发送方法本身属于源码核对，未在组件中伪装成已运行服务器。每次调用的原 descriptor 来自本版绑定；probe 依原 NoteBlock 参数顺序选择方法。原官方资源定义/采样字节另有身份校验，组件没有实际解码 Ogg。

最终 raw：

```text
.local/lwjgl2111-methods/1.11/run-1792803465253/report.json
.local/lwjgl2111-methods/1.11.1/run-1792803468863/report.json
.local/lwjgl2111-methods/1.11.2/run-1792803474876/report.json
```

各目录保留 config、输入、原二进制、编译类哈希、stdout/stderr 和 javac/java 进程 PID / exit 0；每次 classpath 只含本版唯一 client JAR。首轮开发 raw 另行保留，没有替换旧 2110 或 1.9 冻结证据。MASTER 包含 -0/0/.2/.7/1 的 Options getter 返回位，不是 AL listener 实际读回。28/4 是原静态请求配置，不能作为产品截音上限，也没有实际分配容量测量。

## 依赖、原 context 与 HRTF

三版分别从各自官方 metadata 校验 Paulscode soundsystem、librarylwjglopenal、codecjorbis 等依赖，以及 Windows native classifier。原 Windows LWJGL native JAR SHA-1 为 `b84d5102b9dbfabfeb5e43c7e2828d98a7fc80e0`，其 OpenAL64.dll SHA-256 为 `9261b66010a845ddef9f61d5e4266fe2f08a53f3605da002e9e8f8d202bdbc5e`。公开 source 报告逐版保留原压缩包与每个 DLL 的身份，不以相同依赖推断已测 native 状态。

各版 engine/loader → 原 Library.init → 无参数 LWJGL AL.create → ALCcontext 属性构造与 alcCreateContext 路径均独立核对。实际执行原属性列表构造，各得 `[4103,44100,4104,60,4105,0,0]`；完整 client 和 Options 的 HRTF 引用扫描也分别留存。因此可准备 `hrtfControl:false`、`hrtfControlMode:'device-default'`。没有打开任何原生设备或 context，没有测量 HRTF 能力、实际启用状态、loopback 等效或 PCM。

## 严格只读接口与损坏输入

```js
import { verifiedLwjgl2111Components } from './scripts/probe-lwjgl2111-methods.mjs';
import { reviewedLwjgl2111Profile, reviewedLwjgl2111Profiles } from './scripts/review-lwjgl2111-profiles.mjs';
const original = await verifiedLwjgl2111Components('1.11');
const { legacy, world } = await reviewedLwjgl2111Profile('1.11');
// reviewedLwjgl2111Profiles() returns three individually checked entries.
```

接口只读消费冻结证据，不下载、编译、运行 Java/native 或写公共 facts。它校验 source/probe/classpath/编译类、原 class/Code、metadata/资源/native 身份、raw 输出以及 public/raw 文档一致性。独立的 [reader guard 报告](verification.md) 覆盖每版 14 个、合计 42 个损坏输入，全部拒绝：版本、public/raw 不一致、client、metadata、javap、原始报告、native JAR、context 输出、numeric 状态、编译 probe 及三种原数值二进制。损坏只存在于单次读取 fixture，真实证据文件未被改动。

准备条目采用 float event、category-before-clamp、MASTER listener、五材料及 device-default HRTF。由于当前产品对存在的 `pitchTransport` 对象执行旧字节规则，adapter 省略该执行对象，用 `packetPitchEncoding:'float32'` 及 `pitchTransportDetail` / `namedPitchTransportDetail` 保留原运输身份。world 条目直接使用本版 Java float 站姿眼高，带同维度、脚部发送、原插值/姿态模型 scope 和 `gameRecording:'pending'`。

独立研究阶段没有修改共享 facts、生成器或产品，没有世界录音、新世界覆盖、native context/codec decode/mixer 测量。其后根代理的生成器已实际接入三版，整体选定核心达到 84 个 profile；三版仍是 `code-reviewed`，不因此继承 native/world 测量状态。

## 0.1.19 生产接入与既有录音重放

根代理冻结 legacy36 / world50 数据后，实际执行 `node scripts/audit-lwjgl2111-integration.mjs --write-evidence`，以 exit 0 通过。[生产接入报告](verification.md) SHA-256 为 `4f16f34f900f0fa7fded92657caacddad629693cc8fa320ff86a61875b25c909`，原始报告位于 `.local/lwjgl2111-integration/run-1792804151359/report.json`。

生产 helper、`noteAudioParameters`、`listenerForProject` 和 `AudioEngine.nativeRequest` 构造实际对照上述冻结原二进制，共 **14,799 项逐位比较、差异零**。其中原 engine 最终 gain/pitch 比较 7,494 项；375 个原材料 note 与 225 个任意有限 packet 输入均有 scalar helper 对照。每版 65 个 packet 输入可在本次有效音高 0–127 子集内表达，以经过 `validateProject` 的整数 MIDI 加 ±50 cents 内 detune 进入工程；三版合计 195 个。另有 30 个不可进入该项目子集的输入逐项列在 `excludedProjectInputs`，没有强凑成可播放工程。普通 25 音高之外的 90 个有效输入单独计数。

普通材料音符及有效 packet 输入均分别走 vanilla/studio，两种模式合计 1,140 次参数计算和 1,140 次 nativeRequest 构造。原 math 四列中的中间 getter 输出保留，但不误当作公共 helper 的最终输出。packet 期望直接取原 `NAPP` registered 第三列，即 `8 + inputIndex × 32 + 24`；studio 直接取原构造值。MASTER 则对照原 Options 返回位。没有用生产公式制造这些期望值。

这里的 nativeRequest 仅构造请求：使用明确的 32 帧内存采样 fixture 和身份校验后的原 Ogg 字节，没有执行 decoder、worker、AudioContext 或 OpenAL。音量 3 以合法 velocity 1 × track gain 3 表达，没有把归一化 velocity 偷换成 3。两种模式、任意 float 域、普通 25 音高和可表达的扩展域在报告中分别记载。

随后只重用既有已接受 PCM，实际调用标准 `scripts/reverify-world-captures.mjs --version <version>`：

| 版本 | 既有报告 | 既有场景 | 结果 |
| --- | ---: | ---: | --- |
| 1.19 | 5 | 127 | exit 0，全部 exact |
| 1.19.2 | 7 | 145 | exit 0，全部 exact |
| 1.20.2 | 6 | 136 | exit 0，全部 exact |
| 1.20.5 | 6 | 136 | exit 0，全部 exact |

24 份报告 / 544 场均为 0 LSB，未新采集或新增世界覆盖。执行 manifest 为 `.local/world-replay-audit/run-1792804138012/state.json`，SHA-256 `3c60b6763eb0c972c7e369eb5d9dd4f11dec4118e192013f6b500520d3170ba1`；同目录保存各版原 capture 身份、输入源哈希、PID、stdout/stderr 和 terminal49330 的完成记录。原 agent、provenance、case 列表、backend 配置及每份 PCM 在执行前后校验不变。此处是其它版本的既有录音重放，不能计作 Java 1.11 系列世界证据。
