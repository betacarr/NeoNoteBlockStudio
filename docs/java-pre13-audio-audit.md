# Java 1.0–1.2.5 原声音链审计

本档案独立检查官方目录中的 1.0、1.1、1.2.1、1.2.2、1.2.3、1.2.4、1.2.5。每版都使用各自官方 metadata/client 身份和原类字节，不借相邻版本的结果证明本版。证据覆盖选定声音调用链、可执行原类数值与内嵌解码器；**没有新增世界录音、原生 OpenAL 或硬件测量**。

汇总入口是 [pre13-audio-family-audit.json](verification.md)。它绑定每版官方 metadata URL/SHA1、客户端 SHA1/SHA256、26 个选定原类、27 个方法 Code 绑定、原反汇编/编译/执行记录、原始输出、样本/解码 PCM，以及当前只读消费工具的源码闭包。原类与反汇编保留在 ignored 研究目录，公开报告只保存身份、方法绑定、语义与路径/哈希。

## 原版行为与范围

本地调用链由原 TileEntityNote 的五种材料选择和上方空气门，进入 World block event、NoteBlock、World listeners，再经真正可闻的客户端 listener 调用普通 SoundManager 路径。另有独立的原 block-event packet 读写及原客户端 handler，仍进入同一 World block-event 路径。五种材料音色是 harp、basedrum、snare、hat、bass；资源中的 pling 不构成第六种垫块音色。

这条音符盒路径传送整数 note，客户端执行原 `double pow` 后转换成 float，再经过原 BaseSource 的 `[0.5,2]` pitch 夹取。它**不经过 named-sound 的 63 倍音高量化**。每版普通 note=1 的原输出都是 `0x3f079c7d`；`0x3f061862` 只是与后版 63 量化规则的诊断对照，不能作为这里的实际输出。本版原客户端扫描没有找到该 named-sound packet 构造器，也不据此推断未审查的独立服务端二进制。

音量没有 category 系统。普通 manager 先将正 raw volume 上限夹到 1，再乘原全局声音设置，以 float 提交；原 Library 末端还会将 source volume 夹到 `[0,1]`。因此 manager 提交值与最终 Library 值分列保留，不把大于 1 的提交值当作最终 source gain。master/global setting 落在 source 路径；原 Library listener gain 默认 unity 的源码事实不等于实际 AL listener 增益读回。

48 格是原客户端 listener 的可闻距离门：以**当前 client view entity 坐标**作严格平方距离比较。原 listener 位置则将实体前后坐标按插值计算，再转换为 float；方向只使用水平 yaw，up 固定，不增加眼高。已执行一个原 listener fixture 和十个距离边界 fixture/版；没有证明移动时 current 与 interpolated 坐标重合，也没有将此门改称 standalone server broadcast、维度过滤或 1.62 格 server-feet 规则。

衰减源码/原惰性 Source 组件确认 Paulscode linear 模型，以及 `float(16 * max(1, rawVolume))` 距离参数。没有执行 SourceLWJGLOpenAL 的 AL 调用或实际空间混音。官方当前启动依赖身份可核对，但它们本身也不证明当年所有用户实际安装了同一库。

原上下文 attribute builder 返回数据 `[4103,44100,4104,60,4105,0,0]`，`IntBuffer.position()` 为 **7**。这个观测是构造器数据与 buffer 位置，**不是**实际 `alcCreateContext` 接受的属性读回，也没有测出真实设备采样率、limiter 或 HRTF 状态。原配置的 normal=28、streaming=4 同样只是请求值，没有执行声源分配，不能声称实际容量或 28 声部上限。

## 已有可执行组件

| 项目 | 每版 | 七版合计 |
| --- | ---: | ---: |
| 选定原类 / Code 绑定 | 26 / 27 | 182 / 189 |
| finite scalar 输入 | 315 | 2205 |
| manager 实际提交 | 150 | 1050 |
| 被抑制，无最终增益可比较 | 165 | 1155 |
| 实际 Library 末端 clip | 40 | 280 |
| 五材料 × 25 原 note | 125 | 875 |
| 原 block packet → handler → note 路径 | 125 | 875 |
| 客户端距离门 | 10 | 70 |
| listener / attenuation / Options fixture | 1 / 7 / 8 | 7 / 49 / 56 |
| 原内嵌 JOrbis 解码 | 6 | 42 |

315 行 scalar 输入中，280 行使用编辑器允许的 volume `[0,4]`、master `[0,2]` 数值域，35 行负 volume 属于诊断；其中 90 行全局设置超过原游戏滑块范围，但仍在编辑器 master 域内。它们是原组件输入，不是已构造完整工程的 production integration。165 行抑制结果没有提交/最终 gain，不能计作成功的数值增益比较。

六个解码样本分别是 harp、bassattack、bd、snare、hat、pling，逐版用原客户端内嵌 CodecJOrbis 实际解码；公开报告绑定输入 OGG 与输出 PCM 的身份、格式和长度。原资源选择证据由既有 Java 1.0/pre17 reader 只读消费，本次没有重跑已成功的原资源 walker，也没有宣称完成生产 decoder/native PCM 一致性比较。

## 执行、失败与 1.2.5 恢复

归档保留 231 条既有原进程记录：182 次 `javap`、8 次 `javac`、7 次 `java` 和 34 次 Node。所有原 javap/javac/java 均有 PID、实际 terminal/exit 0 和 stdout/stderr 哈希；8 次编译包含 1.2.5 的独立 compile-only 恢复。原 Java PID 为：

| 版本 | 原 Java PID | 终态 |
| --- | ---: | --- |
| 1.0 | 78640 | exit 0 |
| 1.1 | 17540 | exit 0 |
| 1.2.1 | 73120 | exit 0 |
| 1.2.2 | 74788 | exit 0 |
| 1.2.3 | 37844 | exit 0 |
| 1.2.4 | 74968 | exit 0 |
| 1.2.5 | 78128 | exit 0 |

三次 Node 失败没有删除：1.2.5 首次 metadata 身份断言失败（PID 76052）；1.0 首次 packet-handler 角色发现没有匹配（PID 72980）；1.2.5 原 Java 成功后，父 Node 对 Java 文本 `0.0` 与 JS 文本 `0` 的比较失败（PID 21548）。前两次保留真实命令、终态与错误，但没有当时脚本快照，不能用当前脚本哈希冒充失败时的源码身份。

1.2.5 的恢复保留失败 producer report、旧 producer 源快照和 snapshot manifest。新旧 producer 差异是距离门输入的数字文本归一化，以及导出已有 `compiledRefs` 供恢复消费；没有改原 Java、输入数值/位模式或 48² 阈值。原 Java **没有重跑**。独立 javac PID 75192 在后续单独目录编译当前同一 Java，三个 helper class 哈希均与原执行字节相同。reader 要求新的目录/进程身份、原 Java 结束后的时间顺序和三个 class 一致，不能把原编译记录冒充恢复证明。

## 只读消费门与本次归档

[pre13-audio-reader-validation.json](verification.md) 记录七版正例及 **127 个被拒绝的损坏输入**。损坏用内存 overlay 同时对齐 public/raw 哈希，覆盖源码/类/Code、原 CP/进程参数、数值与原始输出、解码覆盖和恢复身份等守卫；它们只验证 reader 拒绝能力，不增加原类或声音场景数。

[pre13-reader-independent-review.json](verification.md) 是独立复核：确认七版基线，并验证“六次重复 harp 冒充六种解码”和“旧编译冒充恢复编译”两种对齐损坏均被拒绝；还独立核对真实恢复的 producer 差异、编译目录、PID、时序和 class 哈希。这些原始虚拟 fixture 及报告路径/哈希也被本归档绑定。

可重复只读归档：

```powershell
node scripts/archive-pre13-audio.mjs --write-evidence
```

脚本只调用 `reviewedPre13Source` / `reviewedPre13Components` 等只读 reader，不启动 java/javac/javap、不下载、不启动世界或 AL。它检查所有已读取输入前后哈希不变，保存自己的 Node 日志，并在 Node `exit` 事件取得实际终态后写出报告。本次原始档案为 `.local/pre13-audio-family-archive/run-1792811306287/report.json`，归档 Node PID **32732 / exit 0**。

归档源码闭包有意不包含同时开发的 `review-pre13-profiles.mjs` 候选 adapter；本档案说明原始证据与消费门，不登记 profile，也不替独立 production comparison 判定当前产品状态。没有新增 standalone server、world scene、原生 HRTF/limiter/分配池、硬件或 onset/tick 时序验收。
