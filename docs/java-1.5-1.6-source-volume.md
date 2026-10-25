# Java 1.5/1.6 的最终 sourceVolume 边界

本审计独立补齐 1.5.1、1.5.2、1.6.1、1.6.2、1.6.4 在 SoundManager 之后的原 `paulscode.sound.Library.setVolume(String,float)`。五版均把非 MIDI 源的有限输入再次裁到 `[0,1]`，写入真实原 `Source.sourceVolume`，再调用原 `Source.positionChanged()`。五版的 BaseSource 该方法 Code 均只有 `return`。没有以 OpenAL 子类代替原基类，也没有修改旧的 215/216 source/numeric 证据。

项目 masterGain 可达到 2，所以仅核对 manager 的命令接收值不够。实际原类给出反例：上游 `unit(1) * float(2)` 的 float32 参数为 `0x40000000`（2），原 Library、原私有命令处理、原队列分发三条路径的最终 sourceVolume 都为 `0x3f800000`（1）。因此，在已证明的 manager 前置裁剪之外，还必须保留最终 Library 裁剪。对本次有限域可写作 `unit(float32(unit(instanceFloat) * masterFloat))`。该表示式不是本次用来生成原类输出的 oracle；原类输出由各版原 class 执行得到。

原比较使用 `< 0`、`> 1` 分支，`-0.0f` 不满足任一分支，最终保留 `0x80000000`。最小正/负 subnormal、最小正/负 normal、0.999、1 的相邻 float、1.5、2 的相邻 float、负数及最大有限 float 均在输入内。这里不对 NaN/Infinity 给出生产支持结论。

## 原版身份和方法绑定

每版从当前官方 release catalog 指向的、以 URL SHA-1 校验的 metadata 取原客户端；再按该版 metadata 选出纯 Java 音频依赖。所有原 class、字段、完整 Code 哈希、反汇编进程、编译器/Java 可执行文件哈希及参数均在[新证据](verification.md)中。SoundManager 是既有独立审计里的 manual role，新审计重新读取对应原 bytes；这些版本没有被冒称使用官方 mappings。

| 版本 | 官方 client SHA-1 | 原 Library 来源 |
| --- | --- | --- |
| 1.5.1 | `047136381a552f34b1963c43304a1ad4dc0d2d8e` | 该原 client 内嵌类 |
| 1.5.2 | `465378c9dc2f779ae1d6e8046ebc46fb53a57968` | 该原 client 内嵌类 |
| 1.6.1 | `17e2c28fb54666df5640b2c822ea8042250ef592` | 本版 metadata 的 soundsystem 20120107 |
| 1.6.2 | `b6cb68afde1d9cf4a20cbf27fa90d0828bf440a4` | 本版 metadata 的 soundsystem 20120107 |
| 1.6.4 | `1703704407101cf72bd88e68579e3696ce733ecd` | 本版 metadata 的 soundsystem 20120107 |

1.6 三版的[官方 SoundSystem artifact](https://libraries.minecraft.net/com/paulscode/soundsystem/20120107/soundsystem-20120107.jar) SHA-1 为 `419c05fe9be71f792b2d76cfc9b67f1ed0fec7f6`。逐版各自校验、反汇编并独立运行，没有因依赖相同而省略成员验证。

1.5 两版 `Library.setVolume(Ljava/lang/String;F)V` Code SHA-256 为 `61490f60963d375735184799e41b7976a0ab1f023995e66ab8fd767cac29967c`；1.6 三版为 `029966bb3ce0fd136a8946dfa2868712130ea69d9e3b2ab571a25826fcf784ad`。二者原 class/常量池字节不同，本次没有把这类字节差异写成声音行为差异；实际有限输入结果逐版相同。

## 真实执行路径

专用[Java probe](../scripts/java/Lwjgl21516SourceVolumeProbe.java)用 Unsafe 分配准确的原 `Library`、原 `Source`、原 `SoundSystem`，不调用它们的构造器。Library.sourceMap 放入该真实 BaseSource，midiChannel 保持 null。先核对 BaseSource.positionChanged 的原 Code，随后对每个参数真实执行：

1. `Library.setVolume("probe", input)`；
2. 原私有 `SoundSystem.CommandSetVolume("probe", input)`，其原调用转发到同一 Library；
3. 原 `CommandObject(14,"probe",input)` 构造器、原 `CommandQueue(object)` 入队、原 `CommandQueue(null)` 排空。核对原命令的整数编号、字符串参数、float 原始 bits，队列入队/排空和最终源字段。

公开 `SoundSystem.setVolume` 的原 Code 创建命令 14、调用 CommandQueue，然后中断 CommandThread；该公开方法在本 probe 中**只做 Code 绑定，没有执行**。本次没有创建 CommandThread，也没有通过捕获人工空线程异常来冒充完整异步执行。上述原入队/排空调用提供实际同步组件证据，不声称验证了运行中的线程调度。

每版 22 个直接输入，加 22 × 11 = 242 个组合输入，共 264 行 × 3 条原路径 = 792 次最终 float bits 比较。组合输入仅构造下游组件参数 `float32(unit(rawFloat) * masterFloat)`，master 取 0、最小 subnormal、0.1、0.5、0.7、1 的相邻值、1.5、2 的相邻值至 2。这不把非正 raw 上的组件调用说成原 manager 真正播放了源；上游 manager 的播放门、乘法次序由本次原 Code 绑定及既有独立组件审计分别覆盖。

五版总计 **1,320 行、3,960 次位级比较**。另逐版实际检查缺失及 null 源名不修改已有源、SoundSystemConfig 原默认 masterGain bits 为 `0x3f800000`。后者是纯 Java 默认值证据，不是实际 AL listener gain 测量。

## 运行、严格消费和边界

成功 runner 的 PID 为 70604，终态 exit 0；raw 根为 `.local/lwjgl21516-source-volume/run-1792807275555`。每版的 6 次原 javap、一次 javac、一次 Java 均有 PID、完整 argv、工具文件哈希、stdout/stderr 和 terminal/exit/signal。所有 40 个子进程终态 exit 0。编译闭包只允许 `studio/nbsx/research/Lwjgl21516SourceVolumeProbe.class`，不生成或遮蔽任何原类。1.6 执行 classpath 只有该 helper、原 client 和原纯 Java SoundSystem artifact，不含 LWJGL 库。1.5 的原 client 虽包含原 OpenAL 类，probe 不加载或调用这些子类。

初次静态 preflight 在 Java probe 前拒绝了本新审计对 `getMasterGain` 私有实现的错误预期；原版本实际是直接 getstatic。失败诊断保留于 `.local/lwjgl21516-source-volume/run-1792807254758`，没有 Java probe 或设备启动。之后的只读 reader 修正了 Windows 路径表示比较，并在没有重跑成功原组件的情况下刷新本新报告的 reader source hash；原始成功 Java 输出未改。

执行入口为 [audit-lwjgl21516-source-volume.mjs](../scripts/audit-lwjgl21516-source-volume.mjs)。严格只读入口为 [review-lwjgl21516-source-volume.mjs](../scripts/review-lwjgl21516-source-volume.mjs) 的 `reviewLwjgl21516SourceVolume()`：重新校验官方 metadata/client/artifact、原 class/Code/字段、全部绑定、source/compiled 闭包、完整进程参数及终态，最后重新读取真实 Java 输出逐位验证。它不联网、不编译、不启动进程。

[verify-lwjgl21516-source-volume.mjs](../scripts/verify-lwjgl21516-source-volume.mjs) 的只读 overlays 负例 20/20 拒绝，覆盖官方身份、class/Code、positionChanged、命令 14、classpath/遮蔽类、helper/source 哈希、terminal/exit/Java main、输入 bits、原输出 bits 和总数。负例保留在 `.local/lwjgl21516-source-volume/validation-1792807352351/report.json`，SHA-256 `67ac5ca9feb260d880b2a5f3e27f2325e200d52f876d726ec8079b003512a4fd`；负例不改写公共证据和原 raw。

最终 source-volume 公共证据 SHA-256：`440a50f8364f54b84fe315bb93e73ac13b1a1a3a3136ab0df7466d5d7e778eb3`。

这些结果仅是原 Java 组件验证：零设备、零音频 worker、零游戏世界、零新增 native/world 测量。没有更改或提升旧世界报告、旧 native context 证据或任何公共 profile/facts。本文件及新报告在本次完成后冻结；regular mixer 静态计划另见 [java-1.12.2-regular-mixer-plan.md](java-1.12.2-regular-mixer-plan.md)，本次没有执行该计划。

0.1.20 实际产品函数在验证过的有限工程域另完成五版共960行/2,880次最终bits比较，负零保持；375个负值、非有限或超工程域诊断不提升为支持承诺。它复用冻结原Java输出，没有再次运行原类或native。[产品比较](verification.md)。
