# Java 1.3.1 / 1.3.2：独立声音核心与原类组件审核

本次逐版检查官方正式客户端，没有从 1.2、1.4、1.5 或 1.6 继承覆盖。两版均完成 48 个原类、55 个选定方法 Code 绑定，以及原类音量、音高、包、材料音符、监听、衰减、Options 和内嵌 JOrbis 解码组件。当前产物是严格只读的接入候选；没有修改公共 facts、产品、生成器或版本，也没有新增原生、HRTF 或世界实测。

## 官方身份与原始产物

| release | 官方元数据 SHA-1 | 官方客户端 SHA-1 |
| --- | --- | --- |
| 1.3.1 | `637aa8466c4dac462b88682caaf753290f37798f` | `33167e71e85ab8e6ddbe168bc67f6ec19d708d62` |
| 1.3.2 | `598eedd6f67db4aefbae6ed119029e3d7373ecf5` | `c2efd57c7001ddf505ca534e54abf3d006e48309` |

来源为 Mojang 的 [1.3.1 元数据](https://piston-meta.mojang.com/v1/packages/637aa8466c4dac462b88682caaf753290f37798f/1.3.1.json) 和 [1.3.2 元数据](https://piston-meta.mojang.com/v1/packages/598eedd6f67db4aefbae6ed119029e3d7373ecf5/1.3.2.json)，客户端分别来自其声明的 [1.3.1 client.jar](https://launcher.mojang.com/v1/objects/33167e71e85ab8e6ddbe168bc67f6ec19d708d62/client.jar) 与 [1.3.2 client.jar](https://launcher.mojang.com/v1/objects/c2efd57c7001ddf505ca534e54abf3d006e48309/client.jar)。这两版没有官方命名映射；角色从原始字段、描述符、常量、调用者和被调用者独立定位。

公开证据仅存类/字段/方法身份、类哈希、完整方法 Code 哈希和独立解释。原始 class、完整 javap、清单和命令输出留在 ignored 的 `.research/lwjgl213-source/<release>/`、`.local/lwjgl213-source/` 和 `.local/lwjgl213-executions/`。官方元数据选定的依赖均按其 SHA-1 校验；这是该元数据的启动依赖身份，不另行宣称等于每种 2012 年历史安装环境。

## 原音符盒真正可听的路径

| 角色 | 1.3.1 | 1.3.2 | 原方法 |
| --- | --- | --- | --- |
| NoteBlock | `agv` | `agw` | `b(World,IIIII)V`，返回 **void** |
| TileEntityNote | `aje` | `ajf` | `a(World,III)V` |
| ServerWorld / 服务端监听器 | `gq` / `gm` | `gr` / `gn` | 执行块事件；字符串声音监听器构造命名声音包 |
| 命名声音包 | `cr` | `cr` | `<init>(String,DDDFF)V`、`a(DataOutputStream)V`、`a(DataInputStream)V` |
| 客户端包处理器 | `asu` | `asv` | `a(cr)V` |
| ClientWorld | `atc` | `atd` | `b(DDD,String,FF)V` |
| SoundManager | `ayp` | `ayq` | **`b(String,FFFFF)V`** 空间声音入口 |
| 客户端 WorldListener | `ava` | `avb` | `a(String,DDDFF)V` 的 Code 仅 `0:return` |

服务端 TileEntityNote 选材料并排入整数块事件；ServerWorld 执行原 Block/NoteBlock 的 void 回调。NoteBlock 的字符串声音调用进入继承的 World 分发，再由服务端监听器构造 `cr`。PacketBase 原注册表把 `cr` 注册为 **62**，标志 `true,false`。该声音包是可听路径。

服务端同时广播块事件，但客户端原字符串声音监听器是空实现。因此客户端执行块回调产生的原始 `pow` 音高不会另发一遍音符；不能因为它存在便跳过声音包量化，也不能把两条路径都混音。组件单独执行了原 World→空监听器路径，确认未调用记录器的 play。

SoundManager 的 `a(String,FFFFF)V` 是另一条 streaming 且含 `0.5f` 乘数的入口。此审核明确跟随原命名包调用到 **b**，没有误测同描述符的 a 方法。

包构造器先 `float pitch * 63f`、Java `f2i`，再夹到整数 0..255；写出字节，真实 `DataInputStream.readUnsignedByte` 读回，getter 以 float 除 63。原 NoteBlock 自身先做 double `Math.pow` 再舍入 float。两版材料和音高路径均独立执行：例如 note=1 的原始音高是 `0.5297315716743469`，经真实包后为 `0.523809552192688`。网络后的 Source 最终再夹到 0.5..2。

## 音量、材料和监听

空间入口先检查 ready、全局声音设置是否等于零、采样是否存在，以及原实例音量是否大于零。有限正音量的空间范围为 16；raw volume>1 时为 `float(16f*raw)`，线性模型为 2，原音符盒 raw volume=3，范围为 48。实例音量先只做上界 1 的夹取，再与全局 sound setting 做 float 乘法，提交 SoundSystem。末端原 `Library.setVolume` 再夹源音量到 0..1。全局设置属于源增益；原库默认 listener master=1，完整客户端引用扫描没有游戏侧 setMasterVolume 调用，也没有分类音量或 JSON 声音事件倍率。

组件同时保存 command sink 和 final Library 的位模式。例如 raw=3、sound setting=1.5 时，命令提交 1.5，末端源音量为 1；不能用中间 sink 冒充最终库增益。Options 的真实字符串解析可接受 1.5/2，且保留 `-0`。1.5/2 超出原游戏滑块 0..1，但属于当前编辑器 master 0..2 的数值范围。本审核没有执行工程或产品 helper；其余任意 float 输入也不冒称全部可由合法 MIDI 工程表达。NaN、Infinity、负数为单独标记的合成诊断，suppressed 行保留“未播放”标志，绝不强行当作 0 增益通过。

五种原材料分别为默认/土、石、沙、玻璃、木，对应 `note.harp`、`note.bd`、`note.snare`、`note.hat`、`note.bassattack`。低音使用 **bassattack**，不是独立 `note.bass`。pling 可读、可解码，但不是第六种音符盒垫块。

原 listener 使用实体前后 double 坐标插值，再转 float，没有额外 eye getter。原朝向只插值 yaw，lookY 恒为 0，up 为 (0,1,0)，忽略 entity pitch；10 组执行覆盖 pitch=-60/+60 与五个 partial，成对位置和朝向位模式相同。Player 的 M=Java float1.62、ServerPlayer 清 M=0、Entity bounds/placement 和服务端 teleport 的 widened-float eye Y 均有各自原 Code 绑定。这些不等于运行中相机或完整脚部到耳部坐标测量。adapter 的 `standingEyeHeight:1.62` 明确标记 `editor-nominal-reference`，原 float 独立放在 `ordinaryClientPlayerYOffsetJavaFloat`。

服务端命名声音按同维度玩家实体坐标执行严格平方距离 `< range²`；原音符盒范围 48。块事件另用范围 64。没有新增世界捕获来声称这些来源事实已实测。

## 资源、解码、context 与 voice pool

既有 [1.3.1 资源证明](verification.md) 和 [1.3.2 资源证明](verification.md) 由冻结的 `reviewPre17Resources` 只读消费，未重跑或改写原资源 probe。原选中前缀为 **newsound/**，不是 sound/ 或 sounds/；launcher 的 pre-1.6 index 是文件树物化来源，不能替代成游戏内 ResourceIndex 角色。

此轮新增的是对冻结选择出的六份同字节文件执行各自客户端内嵌 CodecJOrbis.initialize/readAll/cleanup。SoundSystem、Paulscode Library、CodecJOrbis、JCraft JOrbis/Jogg 均通过原 JVM CodeSource 确认来自该版 client.jar；没有用后续版本外置音频 jar 替换。六个输出均为 mono/44100Hz/16-bit/little-endian，PCM 字节/哈希及完整格式保存在原报告中。ASM 只用于隔离 World 回调，实际来源为该版官方元数据选定的 asm-all 4.1；不替换原声音类。

原 Library 调 AL.create() 默认入口；官方元数据选定的 LWJGL 2.9.0 源码默认参数是 44100、60、false。纯 Java 原 `createAttributeList(44100,60,0)` 实际输出底层 `[4103,44100,4104,60,4105,0,0]`，且 **position=limit=capacity=7**。原 AL.init 直接传此 buffer，ALC10 使用 getAddressSafe。本审核保留该位置，不 rewind、不将底层数组冒称真实有效的 ALC 已采用属性；没有创建 context 或读取 native 状态。完整类扫描与调用链仅证明无游戏内 HRTF 控制、沿用默认创建路径；实际 HRTF 能力、启用状态和默认行为未测。

原 SoundSystemConfig 请求 28 个 normal、4 个 streaming 通道，默认 master gain=1。没有实际分配或测量容量，28 仅能用于来源说明或 voice warning，不能据此截音或宣称合奏通过。

## 数量、严格消费与接入

| 每版独立执行 | 数量 |
| --- | ---: |
| 原 manager scalar 状态 | 1,413（826 played / 587 suppressed） |
| 真实命名包输入 | 78（75 finite + 3 nonfinite） |
| 原 Tile→Note→真实包→原 client handler/world→manager 路径 | 125（25×5 材料） |
| listener 插值 | 10 |
| 原 Source 距离/线性衰减 | 9 |
| Options 原字符串解析 | 12 |
| 原纯 context 属性构建 | 1 |
| 内嵌 JOrbis 解码采样 | 6 |
| 损坏拒绝 fixture | 30 |

公开入口：

```js
import { reviewedLwjgl213Profile, reviewedLwjgl213Profiles,
         reviewedLwjgl213Resources } from './scripts/review-lwjgl213-profiles.mjs';
import { verifiedLwjgl213Components } from './scripts/review-lwjgl213-components.mjs';
```

这些入口只读校验本地原始证据，不下载、不编译、不启动 Java/native/game。它们检查官方客户端与依赖 SHA、原类/Code/字段、完整 javap 和实际提取命令、编译 helper 闭包、真实 classpath 与 CodeSource、输入 TSV、原输出二进制、PCM、PID/终态及公开/原始报告一致性。负例以只读内存 overlay 注入错误，覆盖错版本、改类/Code、63→63.5、捏造分类/HRTF/world、非终态 JVM、改 classpath、真实 wire 不一致、原音量/采样/解码损坏等，两版合计 60 项全部拒绝。

首轮编译不适配官方 ASM 4.1 API、样本配置键错误以及 reader 路径归一化失败均有终态日志留存；不是游戏或 PCM 失败。最后的组件运行修正了“原滑块范围”与“编辑器 master 合法范围”的输入标签，旧 raw runs 未删除。最终 [族归档](verification.md) 包含每版原报告、实际进程、来源闭包、已终态运行与失败记录；[reader 验证](verification.md) 可独立重放。

仍未验证：生产 helper/合法工程/nativeRequest 的接入比较、原 AL 与 PCM、实际 HRTF、voice pool 分配、连续合奏、运行相机、整合世界与 server/client 真实网络播放。候选保留 `gameRecording:'pending'`，本轮 world/native 新增计数均为 **0**。
