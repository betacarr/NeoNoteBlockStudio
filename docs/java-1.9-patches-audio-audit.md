# Java 1.9.1～1.9.4 原类声音审计

四版现已分别完成源码调用链和原类组件执行。注册音符包的比例在 **1.9.3 从 63.5 改为 63**；四版均未移除低八位网络音高量化。声音事件标量均为 float，类别音量在 source clamp 前相乘，MASTER 仍由 listener 承担。本轮没有启动游戏世界或原生音频设备，世界/PCM 场景新增零。

## 独立来源

每版均从其官方 metadata 校验 client 和依赖 SHA-1；没有官方 client mappings，角色由该版原类、实际调用者、字段、描述符与 Code 独立定位。没有以邻版相同方法名或相同库版本替代该版调用链核对。

| 版本 | 官方 metadata SHA-1 | 官方 client SHA-1 | 注册包比例 |
| --- | --- | --- | ---: |
| 1.9.1 | `fdca0cf4bdab9959fce30413202a00a1bce35be5` | `9bc7f02323d90b9385c1a5dbd47fb144a3fb8835` | 63.5 |
| 1.9.2 | `9623ca73a57c6d183a28513c894c2337cfe65995` | `19106fd5e222dca0f2dde9f66db8384c9a7db957` | 63.5 |
| 1.9.3 | `4d37195227760207d397224c509ded4b0c68ea37` | `b6985b0d3a0520dfb6f17eeb1e8ba58ce9577061` | 63 |
| 1.9.4 | `b1a314ce2b67b3639bd6407ddcd549ce236de6f6` | `4a61c873be90bb1196d68dac7b29870408c56969` | 63 |

官方 URL、原 class SHA-256、原方法描述符/Code SHA-256、资源索引/声音定义及五份原采样身份均在各版 `docs/evidence/java-<version>-audio-source.json`。每版主体为 43 个原类、51 个 Code 绑定；HRTF 补证另有六类、八个绑定，两份报告合并为 45 个不同原类。原 javap 留在 ignored 的 `.research/lwjgl219-patch-chains/<version>/` 与 `.research/lwjgl219-patches-complete/<version>/`，公开报告没有整段反编译内容。

1.9.1～1.9.3 的旧暂停 raw 经原 client/class/Code/反编译哈希重验后复用；只为缺失角色与 1.9.4 补提取。原 1.9 的冻结 helper、Java 和报告均未修改，完成后其严格只读接口仍通过。

## 已闭合的路径

- 原 TileEntityNote 的头顶空气检查、四种特殊材料和默认分支，实际五个支持块 `dirt/stone/sand/glass/planks`，对应 harp/basedrum/snare/hat/bass。
- 原 NoteBlock 的 `double pow → float`、音量 3 与 `record` 类别，经 World 的半格中心转换、WorldListener、服务器实际注册声音包构造，至原 PlayerList 的同维度与严格实体平方距离筛选。音量 3 的服务器半径为 48；它不是 listener 耳位距离。
- 注册包和名称包的原构造、实际 write/read 与 pitch getter；原客户端 handler、无 raw note 重复播放的 player guard、PositionedSound 构造及 AbstractSound 事件乘法到 engine。
- 原 sounds.json 读取、Gson serializer 注册、file/event 选择、事件解析到实例；五个官方音符事件均为单样本，volume/pitch 默认 1。嵌套事件直接委派，没有外层标量乘法；该嵌套路径仅为源码核对，不计组件执行。
- MASTER 的 Options getter、初始化及更新调用，最终 `LibraryLWJGLOpenAL.setMasterVolume → alListenerf`。位置由客户端玩家 double 插值加原 float 眼高 getter，再转 float；站姿 getter 为 `1.62f`，不是对所有姿态固定 1.62。
- 原 CodecJOrbis 注册、Library 的 readAll/buffer 上传调用、Source 的 Java float 线性衰减，以及 requested 28 normal + 4 streaming 配置。配置不是实测分配上限，不据此截音。

源范围使用实例/声音事件的未 clamp 音量，服务器发送范围使用服务器事件音量；官方事件默认标量下两者均为 48。本轮没有宣称任意替换资源包、codec 实际解码或完整运行引擎已与 PCM 等价。

## 实际原类组件

[汇总报告](verification.md) 由 `node scripts/verify-lwjgl219-patches-audit.mjs` 只读重验各版源码、探针、编译类、原依赖、输入与输出哈希后生成。

| 每版检查 | 每版数量 | 四版合计 |
| --- | ---: | ---: |
| 有限 instance/event/category 数学输入 | 1,249 | 4,996 |
| 原 getter + engine float 输出逐位比较 | 4,996 | 19,984 |
| 网络音高输入 / named + registered 真实 Netty 案例 | 75 / 150 | 300 / 600 |
| 原材料选择 → NoteBlock → registered wire → 实例 → engine | 5 × 25 | 500 |
| 原 Options MASTER 返回位 | 5 | 20 |

数学、包、音符各列均逐位比较，不容许误差。有限数学域含 `-0`、下溢和 clamp 邻界，合成标量输入与游戏音符事件分开记录；没有扩展宣称 NaN 域。材料路径在每个音符都执行原 tile 分支，包读回后核对原 event 身份、category、volume，再使用原 SoundEvent 形式的实例构造。只有隔离 World 的输入状态及排队/声音/粒子输出回调由探针提供。

音符 12 的具体差别：1.9.1/1.9.2 的原 `1f` 经注册包后为 `0.9921259880065918f`；1.9.3/1.9.4 为 `1f`。四版原 `instance 3 × event 1 × category .5` 均得到 source gain 1，不能沿用 1.8 的先 clamp 后乘 category 公式。MASTER 的五个原 Options 返回位包含负零；没有冒称 AL listener 实际读回。

最终 raw 报告：

```text
.local/lwjgl219-patch-methods/1.9.1/run-1792798617824/report.json
.local/lwjgl219-patch-methods/1.9.2/run-1792798621500/report.json
.local/lwjgl219-patch-methods/1.9.3/run-1792798624828/report.json
.local/lwjgl219-patch-methods/1.9.4/run-1792798627745/report.json
```

适配过程的失败 raw 保留，包括 1.9.3 首次因 NoteBlock 的 BlockState 参数顺序改变而无法反射调用的记录。最终探针按每版实际描述符选择顺序；没有更换原类、正常化输出或放宽比较。

## HRTF 控制与未测范围

四版分别闭合 engine → loader → 原 Paulscode Library → 官方 LWJGL AL.create → ALCcontext 属性列表 → alcCreateContext。分别扫描该版整个 client 和 Options，没有游戏 HRTF 控制；实际执行各版官方 LWJGL 的原属性构造方法均得到：

```text
[4103, 44100, 4104, 60, 4105, 0, 0]
```

因此只可接入 `hrtfControl: false`、`hrtfControlMode: 'device-default'`。此执行没有打开 native device/context，未测 HRTF 实际开关状态、原 DLL 能力或 loopback 等效，也没有新增 HRTF on/off 世界验收。

## 只读消费接口

```js
import { verifiedLwjgl219PatchComponents } from './scripts/probe-lwjgl219-patches.mjs';
const evidence = await verifiedLwjgl219PatchComponents('1.9.1'); // 1.9.1～1.9.4
```

接口只读校验该版官方 metadata/client/依赖、原 class/Code、raw 反编译、资源、HRTF 控制和组件输入/输出/探针/编译类哈希；不下载、不重编译、不执行 Java 或 native。返回 `facts`、`instruments`、`sourceEvidence`、`contextEvidence`、`numericEvidence`、`bindings`、`contextBindings`、`componentCounts` 和零世界计数。

暂停阶段的 `verifiedLwjgl219PatchEvidence` 仅用于读取旧的 source-only 聚合，那个聚合未发布，也不存在于本次提交；它会拒绝缺失证据。当前完整配置使用上面的新接口，不调用旧入口。旧提取脚本的逐版/raw-only 选项保留为新证据所绑定的提取出处，不通过补造旧聚合来替代完整审核。

最小接入为各版独立 profile 加 `float-event-scalars`、`category-before-clamp`、`masterVolumePlacement: 'listener'`、unsigned-byte/低八位 wrap 的注册 scale（.1/.2 为 63.5，.3/.4 为 63）、设备默认 HRTF、五个实际材料/事件和 requested pool 字段。来源审核状态可提高到已核对源码与组件；不能继承 1.12.2 或其他版本的世界测量、native 能力或实际声部容量。

生成器准备模块为 `scripts/review-lwjgl219-patch-profiles.mjs`，导出 `lwjgl219PatchVersions`、`reviewedLwjgl219PatchProfile(version)`（返回 `{legacy, world}`）与 `reviewedLwjgl219PatchProfiles()`（返回四项数组）。模块只读消费上述冻结证据；额外断言比例来自原 registered 构造绑定，不从 named 复制。world 的 `standingEyeHeight` 直接采用原 Java float 眼高 `1.6200000047683716`，并保留脚部实体发送、同维度筛选、姿态/监听范围和 `gameRecording: 'pending'`。

独立来源与原类采集阶段没有修改产品、公共 facts、生成器或原 1.9 冻结证据，也没有开展 1.10～1.12 的进一步链路审核。下述生产接入是随后完成的单独阶段，原来源/组件审计及中途 raw 历史均保留。

## 生产接入状态（2026-10-24）

根任务的公共生成器现已实际接入这四版，选定核心源码 profile 合计为 75 个。四版生产状态为 `code-reviewed`，requested 28 声部仅作提示，`gameRecording` 仍为 `pending`；没有继承其他版本的世界测量或原生能力。

[本轮生产集成报告](verification.md) 使用独立 esbuild bundle 调用当前真实 `gameVolumeParameters`、`gameEventPitchParameters`、`gamePitchParameters`、`noteAudioParameters` 与 `listenerForProject`。所有数值期望直接读冻结原 Java 二进制，而非由生产公式生成；四版合计通过：

- 4,996 组原数学输入，对应 9,992 个最终 engine gain/pitch 输出逐位比较。
- 500 个原材料音符，对 helper、已运输 event、原 gain 和真实 vanilla/studio 音符参数路径作 2,500 次比较。
- 300 个实际注册包边界输入，读取原 registered 列，独立于 named 比例。
- 20 个原 Options MASTER 返回位，各对照 helper listenerGain 和 `listenerForProject`，共 40 个输出。

原数学前两列是未 clamp 的 instance/event getter 中间值：9,992 个原中间输出被保留，但没有对应公共生产返回，因此不计作上述最终输出比较。原 gain 3 的组件检查也没有替代编辑器归一化力度规则。全部比较无逐位差异，388 个输入/脚本/bundle 哈希复核一致；raw 为 `.local/lwjgl219-patch-integration/run-1792799511632/report.json`。此阶段没有重开 Java、native context 或游戏世界，也未增加四版的世界/PCM 验收计数。
