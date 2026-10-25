# Java 1.7.2 声音原类与资源审核

Java 1.7.2 已独立完成选定声音链源码、原类组件、原资源读取和生产参数接入核对，状态为 **code-reviewed**。本页不把相邻版本、相同依赖或资源字节相同当作 native/world 一致的证明。

## 原版身份与源码范围

官方 metadata SHA-1 为 `c2e8ecbf355760a74c93d7210767fa043d53f27c`，client SHA-1 为 `0c8689f904922af71c7144dcfb81bce976cadd49`。原 metadata、client、Paulscode/JOrbis/LWJGL 依赖、资源索引和对象均按官方身份校验；原类没有官方 mappings，角色依各自调用者、字段、descriptor 和 Code 确定。

[源码报告](verification.md) 绑定 **53 个原类、76 个方法 Code**，包括材料事件 → server 普通声音包 → client instance → manager/engine，以及资源注册、类别/MASTER、原 listener、服务器发送、codec 与声部配置。公开报告保留身份、方法和哈希，整段 javap 与原 class 仅在 ignored `.research/lwjgl2172-source/`。

关键规则及有区分力的反例：

- 普通服务器 note 路径先做 double pow→float，再由原包将 float×63 截为整数，并在构造时钳制到 0–255；write 只发送该字段的低八位。实际原输入 pitch 5 得 stored/encoded 255，读回 `4.047618865966797f`，engine 最终为 2。不能套用后续版本的构造字段 wrap 行为。
- 原 event/composite 标量使用 double：instance float 扩为 double，与 event 和 category 相乘，clamp 后才转 float。原输入 volume 3、event 1、category .5 的 gain 为 1；提前 clamp instance 再乘 category 会错误得到 .5。另有原 gain `0.9797043800354004`、提前 float 化错误结果 `0.9797043204307556` 的实测反例。
- MASTER 属于原 listener，source gain 不重复乘 master。五种材料仍是 default/dirt、stone、sand、glass、wood；事件分别为 harp、bd、snare、hat、bassattack，音量为 3。
- server 以同维度玩家脚部/实体位置计算严格平方距离，volume 3 对应半径 48。普通声音发送与半径 64 的独立 block-event 通知是不同路径，原 client listener 的 block-event 回调不额外重复播放声音。
- 原普通 client player 的 Y 已带扩为 double 的 `float32(1.62)` offset，server player offset 为 0。listener 插值 client player 的位置，不再添加一次眼高。editor 的名义站姿参考 1.62 与原 float 值 `1.6200000047683716` 在字段中分开保留；非站姿、完整工程到世界坐标转换和 native 等效仍未证明。
- 源码核对原 CodecJOrbis 注册、readAll/upload caller、线性衰减和 requested 28 normal + 4 streaming。28 是来源配置/提示，不是实际分配容量或导出截音上限。游戏无 HRTF 选项、沿用 device-default，不等于已测原库能力或实际开关状态。

## 实际原类与生产接入

[原类汇总](verification.md) 和 [数值报告](verification.md) 覆盖：

| 原类检查 | 数量 |
| --- | ---: |
| 有限 math 输入，原 gain/pitch 输出各一 | 1,307 |
| 实际五材料 × 25 note | 125 |
| 原包构造、真实 Netty write/read 与 engine 边界 | 42 |
| 原材料选择 | 5 |

原类执行还包含头顶非空气不触发、原事件复合及静态声部配置读取。所有角色和反射参数取自本版 descriptor。World 输入和输出回调由明确的隔离宿主提供，不假装已运行完整服务器或世界。有限输入包含 signed zero、下溢和边界，不据此推广到任意数值/资源包域。

原组件 raw 位于 `.local/lwjgl2172-methods/1.7.2/run-1792803551550/`，保留输入、原二进制、配置、编译类哈希、classpath 和终端记录。严格源码审核另有 12 个损坏数据拒绝案例。

[生产接入报告](verification.md) 在冻结的公共 facts 和实际 production helper / project 参数路径上完成 **4,156 项逐位比较，差异零**：

| 对比 | 位级比较数 |
| --- | ---: |
| 1,307 原 math 的最终 gain/pitch | 2,614 |
| 125 note 的六个 helper / vanilla / studio 输出 | 750 |
| 原 packet 字段钳制边界 | 42 |
| 375 个显式 event route 的 gain/pitch | 750 |

375 个 event route 使用原 unity、原选中 double composite、原 JSON float leaf 三种输入，并复用冻结原 probe/classpath 实际调用原 Java 得到新期望位；没有用产品公式制造期望。重复输出的 125 note 和 42 packet 只做原身份复核，不计作新增材料或包场景。这里的 studio unity 保留未过包的原 emitted pitch/raw instance volume，非 unity event metadata 仅对照 vanilla 路径。

生产接入 raw 位于 `.local/lwjgl2172-integration/run-1792804268421/`。它证明 scalar helper 和真实工程参数路径，不证明 native render、实际 AL listener、decoder 波形或世界 PCM。

## File-root 虚拟资源树

**1.7.2 没有后续版本的 ResourceIndex 路径。** 原 `DefaultResourcePack(File)` 接收 launcher materialized legacy 根目录，递归遍历文件，以原 ResourcePathHelper 生成相对路径并放入 map；原 ResourceLocation 与实际 InputStream 方法随后读取资源。原 pack 会先尝试 client 内嵌资源，再访问文件 map；本次只证明下列选中资源的实际字节。

官方 legacy index SHA-1 为 `770572e819335b6c0a053f8378ad88eda189fc14`，且 `virtual:true`。[原资源读取报告](verification.md) 使用从该索引按官方 SHA 下载的最小 `.local/lwjgl2172-resources/run-1792803728881/virtual/legacy/` 树，实际执行原 File-root pack，得到 **7 次读取：1 份 sounds.json + 6 份采样**。

| 路径 | 事件/角色 | 原材料乐器 |
| --- | --- | --- |
| `sounds.json` | 原声音配置 | — |
| `sounds/note/harp.ogg` | `note.harp` | 是 |
| `sounds/note/bassattack.ogg` | `note.bassattack` | 是 |
| `sounds/note/bd.ogg` | `note.bd` | 是 |
| `sounds/note/snare.ogg` | `note.snare` | 是 |
| `sounds/note/hat.ogg` | `note.hat` | 是 |
| `sounds/note/pling.ogg` | `note.pling`，存在的资源 | 否 |

因此这里是 **6 samples、5 material instruments**。Pling 的资源和事件存在，不能据此称为第六种原材料乐器。

[只读消费 gate](../scripts/review-lwjgl2172-resources.mjs) 导出 `reviewLwjgl2172ResourceSelection(filename?)`，验证全部 53 类/76 bindings、三个原资源角色、官方 metadata/index、七份对象字节、原 materialized root、精确 args/classpath、唯一编译 helper 闭包和两个 exit 0 终端日志。它不调用下载、javap、编译、Java 或 native。原读取 PID 为 compile 61880 / Java 56268；raw 报告与 public 报告身份一致。

[gate 验证报告](verification.md) 的 34 个损坏输入全部拒绝，包含原 class/Code、metadata/index、虚拟树字节、编译 helper、进程状态/参数、classpath、namespace 和伪造 pling 材料身份。损坏只存在于单次读取 fixture，未修改真实证据，也未重跑成功的原 Java。

## 生产资源接入与限制

生产 `sound-asset-layouts.json` 将该 client 单独登记于 `virtualLegacyRoot`，与后续 `defaultDomainRoot` 的 ResourceIndex 来源分开；两者在本编辑器对象索引中都将规范路径映射为 root key。登记绑定上述原资源证据，不根据共享 index 或恰巧存在的文件猜测来源。

[实际 production loader 比对](verification.md) 使用原七份文件，验证 `sounds.json` 与六份采样的选择、路径、大小和哈希；bass 明确取 `bassattack.ogg`。当前 `sound-assets.ts`、`sound-events.ts` 及布局 JSON 的哈希与报告一致。只读复核未发现本次 `virtualLegacyRoot` 接入的实质问题；对应测试覆盖按原 client 身份选择、与 namespace 干扰项并存、已核对路径缺失时拒绝替代、未知历史 client 拒绝猜测及非法路径。单元 fixture 不充当原 Java 或 PCM 证据。

本页没有完整可玩安装、任意 namespace/resource-pack 优先级、实际 codec decode、原生 context 等效、声部分配容量、硬件输出或游戏世界录音验收。1.7.2 没有 world registry 测量条目，新增 native/world 场景为零；来源审核和资源/参数组件通过不会改变这个限制。

0.1.19 Windows 实包另外通过未选择目录拒绝、实际目录选择和六份采样/事件字节比对，音频工作进程启动数为零，应用与检查进程均正常退出；记录见 [本版资源加载](verification.md)。这项检查验证桌面授权和资源读取路径，不扩大上述声音验收范围。
