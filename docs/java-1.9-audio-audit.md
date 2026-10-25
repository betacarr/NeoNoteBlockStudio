# Java 1.9 声音源码与组件审计

Java 1.9 的注册音符路径仍有网络音高量化，比例为 **63.5**，不能直接套用 1.8 的 63 或 1.10 之后的原 float。音量与声音事件的标量运算则已经改为 float，类别音量在 source clamp 之前相乘，MASTER 留在 listener。以下为冻结的独立源码、原类组件和 HRTF 控制证据；没有游戏世界录音或 PCM 测量。

## 来源身份与原调用链

[源码报告](verification.md) 绑定 [官方版本元数据](https://piston-meta.mojang.com/v1/packages/9178828493e41a24452841039710f05728c466d6/1.9.json)（SHA-1 `9178828493e41a24452841039710f05728c466d6`）及 [官方 client](https://piston-data.mojang.com/v1/objects/2f67dfe8953299440d1902f9124f0f2c3a2c940f/client.jar)（SHA-1 `2f67dfe8953299440d1902f9124f0f2c3a2c940f`），并校验元数据所列的 Paulscode、LWJGL、资产索引、声音定义与五份采样。该版本没有官方 client mappings；类名角色由实际原类、调用者、字段和描述符独立定位。

其中 1.9 共 45 个原类、45 个方法 Code 绑定。完整原类和 javap 保留在 ignored 的 `.research/lwjgl219-source/1.9/`，公开报告只保存身份、哈希、描述符及独立解释。

| 角色 | 原类与已确认行为 |
| --- | --- |
| 材质与音符事件 | `aql` 检查头顶空气，按默认/石/沙/玻璃/木选择五个事件 ID 并入队；`and` 生成 float 音高和音量 3，类别为 `record` |
| 服务器声音发送 | `aht` 加半格中心，经实际 `lq` listener 构造注册声音包 `hz`；`mm` 用同维度玩家实体位置和严格平方距离筛选，音量 3 对应 48 格 |
| 网络运输 | `hz` 构造保存 `int(float(pitch × 63.5))`，写低八位、读 unsigned byte、float 除回 63.5；构造后的 clamp 只改局部参数，不改已保存字段 |
| 客户端实例 | `bks` 将 `hz` 返回值交给 `bku`，再构造原 `bye`；客户端原始 block-event 的 null player 不会额外重复播放未量化音高 |
| 事件与 source 参数 | `bxz` 将实例与 `byf` 的 volume/pitch 分别以 float 相乘；`byv` 再乘类别音量并 clamp，或 clamp 音高到 [0.5, 2] |
| MASTER 与 listener | 原 Options 值经 engine/loader 的 `setMasterVolume` 到 Paulscode/OpenAL listener；listener 坐标为玩家 double 插值加原 float 眼高 getter，最后转换 float |
| 解码与距离 | 原构造注册 `CodecJOrbis`，原 `readAll` 经库上传 buffer；`SourceLWJGLOpenAL` 负责 Java float 差值/线性距离衰减 |

名称声音包 `gi` 仍使用 63，而音符盒实际服务器路径使用 `hz` 的 63.5。原声音实例/事件乘积也用于未 clamp 的 source 距离范围；发送给玩家的半径则由服务器原声音音量决定，两者不能混为一个范围。

原 `byx$2` 的嵌套声音事件直接委派给被引用的 `byz`，没有沿用 1.8 的外层引用标量乘法。此项仅有源码证明，未把它算作本轮新增的实际组件执行。

## 原类组件结果

[组件报告](verification.md) 的冻结 raw 位于 `.local/lwjgl219-methods/run-1792796541665/report.json`，此前运行目录也保留。Java 探针执行原类和真实 Netty 序列化；只有明确的实例/Options 状态及隔离 World 输入、排队、声音和粒子输出回调由探针提供。

| 检查 | 数量与范围 |
| --- | --- |
| instance/event → engine | 1,249 组有限输入，每组四个原 float 输出，全部逐位核对 |
| 原 packet 构造与实际 Netty write/read | 75 个输入 × named/registered 两条路径，共 150 例 |
| 原 NoteBlock → registered packet → instance → engine | 五音色 × 25 音符，共 125 例 |
| 原材料触发 | 五个实际支持方块与非空气头顶抑制 |
| MASTER | 原 Options getter 的五个返回位；没有测量 AL listener 的实际读回 |

实际反例：原音符 12 的 `pow` 返回 `1f`，注册包运输后为 `0.9921259880065918f`，原 engine 保留该值。名称声音包对相同输入返回 `1f`。原音符 0 的运输值为 `0.4881889820098877f`，最终才被 engine clamp 为 `0.5f`，所以不能提前 clamp 或省略运输。

音量反例：原 instance 3、event volume 1、category 0.5 得到 source gain 1；1.8 的先 clamp 再乘 category 公式得到 0.5。本次 1,249 组中，错误沿用旧顺序有 749 组差异；将两个 float 乘法合并后才舍入有 194 组差异。例如 instance `0.5647908449172974`、event volume `1.20900297164917`、category `0.6192591786384583`，原结果为 `0.4228510856628418f`，延迟舍入为 `0.4228511154651642f`。

这些是原类组件证据，合成有限输入不冒充游戏滑块或实际音符盒能产生的全部事件。没有执行完整声音引擎、原 codec 的实际解码或原生混音。Paulscode 请求的 28 normal + 4 streaming 是静态配置，实际分配容量、溢出/抢占行为未测；28 只能作为提示，不能据此截断导出的声部。

## HRTF 控制补证

[独立控制报告](verification.md) 没有修改前述冻结 helper，另绑定原 `byv` → `byv$1.run` → `Library.init` → 官方 LWJGL `AL.create()` → `ALCcontext.createAttributeList` → `alcCreateContext` 八个方法 Code。原 `AL.create()` 选择默认设备，传入频率 44100、refresh 60、sync false；整个原 client 的 HRTF 引用扫描及原 Options 均没有游戏 HRTF 控制。

实际执行原属性列表构造方法得到：

```text
[4103, 44100, 4104, 60, 4105, 0, 0]
```

没有 HRTF 属性 6550、设备 reset 或游戏开关，可接入 `hrtfControl: false`、`hrtfControlMode: 'device-default'`。这只说明游戏把 HRTF 留给设备/库默认，不说明默认实际上开启还是关闭，也不说明原 DLL 支持或不支持 HRTF。本探针没有打开 native device/context，没有证明 loopback 配置等效或任何 backend capability。

## 其他十三版的证据等级

同一源码报告包含另外十三个发行版的窄扫描，每版七类。加上 1.9 总计 136 类、253 个 Code 绑定，不代表十四版都有完整引擎或世界验收。

| 发行版 | 已核对的网络音高 | 音符事件表项数 |
| --- | --- | ---: |
| 1.9.1～1.9.2 | registered /63.5，named /63，均低八位 | 5 |
| 1.9.3～1.9.4 | registered/named 均 /63，低八位 | 5 |
| 1.10～1.11.2 | 两条 packet 均读写原 float | 5 |
| 1.12～1.12.2 | 两条 packet 均读写原 float | 10 |

窄扫描还核对 instance/event float 乘法、engine category/clamp 顺序、NoteBlock 的 double pow → float 及 tile trigger Code。它不能独立证明各版的 master/listener、实际服务器注册包调用链、codec caller、pool 或具体方块身份；事件表项数也不是逐材料验收。中途暂停的 patch-chain raw 不作为本报告已完成的公开集成证据，不应提升这些版本状态。

## 只读集成入口与最小接入

```js
import { verifiedLwjgl219Evidence } from './scripts/verified-lwjgl219-evidence.mjs';
import { verifiedLwjgl219ContextControl } from './scripts/review-lwjgl219-context-control.mjs';
const original = await verifiedLwjgl219Evidence('1.9');
const control = await verifiedLwjgl219ContextControl('1.9');
```

两个入口只读校验官方 artifact、原 class/Code、raw 文件和 helper 哈希。前者返回 1.9 完整来源/组件字段；传其他十三版仅返回窄字段并明确 `fullCallChainReviewed: false`。后者返回独立 HRTF 控制字段及所有未测 native 范围。

对生产 `gamePitchParameters` 的 1.9 注册音符路径，现有算法无需换公式：只需相应 profile 获得下面的运输规则，并保持 event 标量走 float 分支。

```json
{
  "id": "java-1.9",
  "soundEventArithmetic": "float-event-scalars",
  "volumeRule": "category-before-clamp",
  "masterVolumePlacement": "listener",
  "pitchTransport": {
    "kind": "unsigned-byte",
    "scale": 63.5,
    "minimum": 0,
    "maximum": 255,
    "overflow": "wrap"
  },
  "hrtfControl": false,
  "hrtfControlMode": "device-default"
}
```

最小映射还应绑定原 client/source 证据，添加 JOrbis/Paulscode、距离 16、音符盒音量 3、五音色与 requested pool 配置；发送/监听字段按独立来源接入，世界场景数保持零。没有注册 scale63.5 规则时，默认 float 路径会使中心音符错误地保持 1。不能将 1.9 标为 `double-event-scalars`，也不能带入 1.8 的 `float-after-double-instance-event-clamp`。

`gameVolumeParameters` 的现有普通 float/listener 分支已经满足 1.9：先 `f32(instance × eventVolume)`，再 `f32(×category)`，最后单位区间 clamp；MASTER 只给 listener。`gameEventPitchParameters` 表达已运输实例与事件 pitch 的乘积；`gamePitchParameters` 才包含服务器运输。官方五个声音事件的 volume/pitch 均为 1。编辑器当前归一化音符力度仍按现有规则传入，原类 helper 的 raw volume 3 测试不能被误当成 UI 力度重映射要求。

当前生产还把“存在 pitchTransport 对象”视为需要量化，没有检查其 kind。因此为较新版表达原 float 时，应省略该对象；不能把窄证据的 `{kind:'float'}` 原样塞进当前旧规则读取器，否则未定义 scale 会产生 NaN。这是接入边界提示，不是本轮产品改动。

建议生产回归至少保留：

- 1.9 注册音符 0/1/12/24，尤其中心 `0.9921259880065918`；named 的 63 不得误用于注册音符。
- 使用已记录原 wire 边界输入，检查 int 截断、低八位 wrap、除回 float 和最终 clamp；`gameEventPitchParameters` 对已经运输的输入不得再次量化。
- 原 gain `3 × 1 × 0.5 → 1`、category 0.2/master 0.7 的 source `0.6000000238418579` 与 listener `0.699999988079071`，以及上面的有限乘法舍入反例。
- `noteAudioParameters` 在 vanilla 模式实际使用 scale63.5；studio 模式保持原有不运输音高，不能因加入 profile 改写该模式。
- profile 为源码审核状态、voice warning 为 28 且仅提示；不新增 world/PCM 计数，不继承 1.12.2 的测量状态，HRTF 使用设备默认的实际状态。

## 当前生产集成的独立复核

共享事实冻结后，已运行 `node scripts/audit-legacy-profile-integration.mjs --write-evidence`。[独立报告](verification.md) 的 raw 为 `.local/legacy-profile-integration/run-1792797318807/report.json`。脚本只读校验官方 artifact、原 class/Code、冻结探针与输入输出哈希，再以独立 esbuild bundle 调用当前真实生产 helper 和 `noteAudioParameters` 路径；期望位直接取自既有原 Java 二进制输出，不由生产公式生成。

| 比较 | 实际通过数量 |
| --- | ---: |
| 1.8.1～1.8.9 与 1.9 profile | 10 |
| 原 engine 输入 / gain、pitch 逐位比较 | 13,012 / 26,024 |
| 原 NoteBlock 输入 / helper、vanilla、studio 路径比较 | 1,250 / 6,250 |
| 实际注册 packet wire 边界输入 | 453 |
| 1.9 原 Options MASTER 返回位 → listener 参数 | 5 |

所有比较无差异。生产 1.9 使用 registered scale63.5，九个 1.8 patch 使用 scale63；已运输输入走 event helper 时不会再次量化。还确认十个 profile 均为 `code-reviewed`、28 声部仅为 warning、HRTF 控制为 device-default，且没有世界测量条目或新增世界场景。1.8 的 listener MASTER 归属按已核对源码检查；没有将其描述为新增 AL 实测。

本轮没有重跑原 Java、打开游戏或 native context，也没有新增 codec 解码、混音或世界 PCM 测量；只新增此文档、独立集成审计脚本与其新报告，不修改产品、公共事实、生成器或冻结证据。
