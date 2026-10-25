# Java 1.12 / 1.12.1 声音链审计

本轮分别读取两份官方客户端和依赖，沿原类调用者、描述符和方法 Code 绑定声音链，再执行原类的有限组件测试。没有使用 1.12.2 映射或结论补齐这两版，也没有启动世界、打开原生音频设备或改写公共事实。角色名是本次审计的描述，不是官方 mappings。

## 两份独立身份

| 正式版 | 官方 client SHA1 | 原声音链角色 |
| --- | --- | --- |
| 1.12 | `909823f9c467f9934687f136bc95a667a0d19d7f` | `avx` Tile → `asi` NoteBlock → `ams` World → `on` server listener → `pj` PlayerList → `kp` registered packet → `brx` client handler → `brz` client world → `cgn` instance → `chm` manager → `chk` engine |
| 1.12.1 | `83385d346cf7f97d1e447b888750fb88e9928b93` | `avz` Tile → `ask` NoteBlock → `amu` World → `op` server listener → `pl` PlayerList → `kq` registered packet → `brz` client handler → `bsb` client world → `cgp` instance → `cho` manager → `chm` engine |

每版声音来源报告绑定 44 个原类、58 个选定方法 Code；独立 HRTF/属性报告另有 6 个类、8 个方法绑定。合并后每版是 46 个不同类。官方 metadata、client、资源索引、sounds.json、十个 Ogg 样本、依赖 archive、原类字节和方法 Code 均有身份校验；相同哈希只说明相应字节相同，不替代该版调用路径检查。

## 原规则与变化

两版均有以下十项表，编号从各自 NoteBlock `<clinit>`、SoundEvents 字段和实际事件返回值核实。前五项按原材质类别选择；后五项在其后按具体方块身份覆盖。上方非空气会抑制事件。

| 事件编号 | 事件 | 本次实际垫块 |
| ---: | --- | --- |
| 0 | `block.note.harp` | dirt（默认分支） |
| 1 | `block.note.basedrum` | stone |
| 2 | `block.note.snare` | sand |
| 3 | `block.note.hat` | glass |
| 4 | `block.note.bass` | planks |
| 5 | `block.note.flute` | clay |
| 6 | `block.note.bell` | gold_block |
| 7 | `block.note.guitar` | wool |
| 8 | `block.note.chime` | packed_ice |
| 9 | `block.note.xylophone` | bone_block |

原 NoteBlock 用 double `Math.pow(2, (note-12)/12)` 后转 float，音量为 `3f`，类别为 `record`。registered 和 named 两种 packet 的音高构造器直接保存 float，真实 Netty 写读使用 `writeFloat/readFloat`，没有早期 unsigned-byte 音高量化。声音实例先把自身与事件定义的音量/音高以 float 相乘；引擎音量再乘类别 float 后 clamp 到 0–1，音高 clamp 到 0.5–2。MASTER 属于 listener：该类别在 source 类别读取路径返回 1，Options 的 MASTER 值由 loader/update 路径传给 SoundSystem，再到 AL listener。

声音资源存在必须保留的区别：`chm$2` / `cho$2` 的嵌套 accessor 会新建声音定义，父子 volume 和 pitch 分别执行一次 `fmul`，stream 标志取父子 OR。它不是已审计 1.10 路径中的直接 delegation。这里没有宣称这个变化首次出现的精确版本。普通十项音符盒事件在各自原 sounds.json 中都是单一文件、volume/pitch 各 1；任意资源包嵌套事件不能据此省略组合运算。此嵌套分支本轮为 Code 审计，未单独执行资源包嵌套选择组件。

World 将音符盒位置移到半方块中心。服务器以未 clamp 的音量 3 得到广播范围 48，同维度检查使用玩家实体/脚部位置，距离平方严格小于范围平方。client 的 player guard 也在原路径内核实，避免把原始本地 note 事件误算成额外播放。

Listener 读取插值的 client Player，而不是后来的 Camera。坐标先用 double 做 `previous + (current-previous) × partialFloatAsDouble`，Y 再加入原 Player eye getter 的 float 值提升到 double，最后三个坐标各转 float。普通站立眼高为 Java `1.62f`，即 `1.6200000047683716`；原 getter 还有睡眠、蹲伏/高度和滑翔分支，本文没有把普通站立值扩成所有姿态。眼高、插值和服务器投递在本轮是原 Code 证据，未测实际世界 pose。

Codec 为原 Paulscode CodecJOrbis；注册、JOrbis readAll、原 Library 上传和 Paulscode 线性增益路径均有方法绑定。Windows 适用依赖由各版 metadata 的 OS rules 选择：LWJGL `2.9.4-nightly-20150209`；官方 Windows natives archive SHA1 为 `b84d5102b9dbfabfeb5e43c7e2828d98a7fc80e0`，其中 OpenAL64.dll SHA256 为 `9261b66010a845ddef9f61d5e4266fe2f08a53f3605da002e9e8f8d202bdbc5e`。这些身份由两版分别核实，没有替换 DLL，也没有执行解码/混音来宣称 PCM 一致。

两版无游戏 HRTF 开关。原 Library 的无参数 `AL.create()` 打开默认设备，原 attribute builder 实际返回 `[4103,44100,4104,60,4105,0,0]`，只请求 frequency 44100、refresh 60、sync 0；没有 HRTF/profile/limiter 属性。本轮只执行 builder，没有打开设备，不能据此声称实际 HRTF 关闭、能用 loopback 等价采集或实际限幅状态。原 SoundSystem 配置为 28 normal + 4 streaming；这是请求配置，不是本机实测容量，更不能用来截断合法声音。

## 实际执行与证据门禁

| 每版组件 | 数量 | 实际执行范围 |
| --- | ---: | --- |
| 原实例 getter / private engine helpers | 1,249 组 × 4 = 4,996 个 float 输出 | 与已冻结的另一原类有限输入 raw 输出逐 bit 对照；getter 中间列和引擎最终 gain/pitch 列分开保留。借用的是输入/有限数值 oracle，不继承角色、Code 或 native/world 结论。 |
| registered / named packet | 75 输入 × 2 = 150 | 原构造器及真实 Netty 序列化/反序列化；wire 后引擎与该版原引擎直接输入对照。 |
| 十种实际垫块与 NoteBlock | 250 | 原 Tile 材质判断及队列 → 原 NoteBlock 事件 → 原 registered wire → 原 instance → 原 engine；World 状态、队列、sound 和 particle 回调明确由隔离夹具提供。 |
| 原 Options MASTER getter | 5 | 含有符号零及 0.2、0.7、1 的返回位；不是 AL listener readback。 |

两版合计 9,992 个原 float 输出、300 次 wire 检查、500 次实际材料/音高事件和 10 个 Options 返回值。原类启动/编译进程、参数、PID、退出值、输入与二进制输出哈希都保留在逐版 numeric report 的 raw 引用中。没有执行真实世界、音频设备或浏览器输入。

[`verifiedLwjgl212Source()`](../scripts/review-lwjgl212-source.mjs)、[`verifiedLwjgl212Components()`](../scripts/probe-lwjgl212-methods.mjs) 及 [`reviewedLwjgl212Profiles()`](../scripts/review-lwjgl212-profiles.mjs) 是只读接口。50 个隔离损坏样本全部被拒绝：包括错版 client、错误 Code、漏掉 server/client 绑定、错误材料、byte 音高量化、clamp 顺序、MASTER 归属、把 `1.62f` 改成精确十进制 1.62、伪造 native/HRTF/声源容量和改写原数值结果。source/context negatives 同时重建匹配的假 raw JSON 与哈希，避免只测到浅层 public/raw 不一致；既有输入在运行前后逐 hash 相同。

主要证据：

- [两版完整审计与适配数据](verification.md)
- [只读门禁与 50 个拒绝样本](verification.md)
- [1.12 原声音链](verification.md)、[原属性/依赖](verification.md)、[实际组件](verification.md)
- [1.12.1 原声音链](verification.md)、[原属性/依赖](verification.md)、[实际组件](verification.md)

适配器只返回 code-reviewed/pending 世界测量的数据，省略产品会执行的 unsigned-byte `pitchTransport` 字段，另存 `packetPitchEncoding: 'float32'` 和完整 transport detail。`noteSoundTableSize` 为 10，保留嵌套事件 float 组合规则。

## 0.1.19 生产参数对照

公共 legacy/world 事实冻结后，已实际执行 [`audit-lwjgl212-integration.mjs`](../scripts/audit-lwjgl212-integration.mjs)。[生产对照报告](verification.md) 记录两版合计 **13,116 次 raw float bit 比较，差异为空**，其中原引擎最终 gain/pitch 对照为 4,996 次。原 getter 中间两列继续保留，没有当作最终输出重复计数。

每版原 250 个普通材料/音高事件全部进入实际 `noteAudioParameters` 和 `AudioEngine.nativeRequest`；另按真实 NAPP 每输入 32 bytes、registered 组起点 +16 的布局读取全部 75 个 float 输入。两版共有 130 个正数且可编码为有效 MIDI 0–127 的输入也经过项目路径，使用整数 MIDI 加合法 detune；20 个零、负数或超范围输入只对照 scalar helper，并逐项记录排除原因。加上普通音符的 vanilla/studio 两模式，共核对 1,260 路项目参数及 1,260 次 nativeRequest 构造，其中有 60 个超出普通 25 音高范围的输入案例。

项目音量 3 的夹具是合法 velocity 1 × track gain 3，不把归一化 velocity 改成 3。原 Ogg 字节逐 hash 核实并核对 request 传递；解码 buffer 明确是 32 帧内存夹具。此步骤没有打开 AudioContext、执行 decoder/native worker、渲染 PCM 或启动原版游戏，新增世界场景仍为 0。实际 bundle 闭包不含 `sound-asset-layouts`，随后对该资源表的独立注册不影响本次参数 bundle。

本轮同时以标准入口顺序重放了 1.14.3/1.14.4 原有录音，各 127 场全部 0 LSB。它们是声音回归，没有增加 1.12/1.12.1 的世界覆盖。[独立执行清单](verification.md) 保留生产对照及两次重放的命令、PID、terminal/log hash、更新前后报告 hash、来源与原录音不变证明。

复现来源与组件、只读复核的入口：

```powershell
node scripts/audit-lwjgl212-chains.mjs
node scripts/review-lwjgl212-source.mjs
node scripts/probe-lwjgl212-methods.mjs
node scripts/verify-lwjgl212-readers.mjs --write-evidence
node scripts/verify-lwjgl212-audit.mjs
node scripts/audit-lwjgl212-integration.mjs --write-evidence
```

前三项是显式研究生成入口，后两项验证现有证据并只写本族的新审计/负例报告。实际游戏/native 上下文、完整 codec PCM、真实声源池容量、跨平台和世界音乐时序均仍未验收，新增世界场景数为 0。
