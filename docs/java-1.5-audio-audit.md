# Java 1.5.1 / 1.5.2 原版声音链审计

本轮独立核对两个正式客户端，执行其原始类的选定方法，并验证原资源遍历、选择与解码。官方当前版本目录没有 `1.5` 客户端；未用相邻版本或第三方文件补位。两个版本仍属于源码及组件证据，未启动游戏世界、OpenAL 设备或原生混音器，也没有增加世界录音场景。

总报告：[java-1.5-family-audit.json](verification.md)。每版各有原源码身份、组件与资源证据：

| 版本 | 官方 client SHA-1 | 原源码 / Code | 原类组件 | 资源与解码 |
| --- | --- | --- | --- | --- |
| 1.5.1 | `047136381a552f34b1963c43304a1ad4dc0d2d8e` | [source](verification.md) | [components](verification.md) | [resource-selection](verification.md) |
| 1.5.2 | `465378c9dc2f779ae1d6e8046ebc46fb53a57968` | [source](verification.md) | [components](verification.md) | [resource-selection](verification.md) |

每版重新从自己的原始客户端查找角色，绑定 40 个类、45 个选定方法的 Code 哈希；没有使用后版映射。原类、反汇编与资源仅保存在 ignored 研究目录，公开报告记录身份、语义、方法描述符及哈希。

## 音符盒真正发声的路径

两版 `anm.b(Laab;IIIII)Z` 都由 note 值计算 `float(pow(2, (note - 12) / 12))`，发出音量 `3f`、方块中心坐标及五种事件之一。下方材质为石、沙、玻璃、木时分别选底鼓、军鼓、踩镲、贝斯，否则为竖琴；上方不是空气材质则不排入事件。

这条方法调用的是继承的 `aab.a(DDD,String,FF)`，其工作是转发 World listener：

- 服务端 listener `iv.a(String,DDD,FF)` 创建 `dy` named-sound 包，并交给玩家列表按同维度、严格距离平方小于范围平方过滤；音量 3 对应范围 48，距离参考玩家实体位置。
- 客户端原 listener `bfz`（1.5.1）/ `bfy`（1.5.2）的对应方法只有 `return`。原始 World → 原 listener 的独立执行也确认没有送达声音 sink。
- 原服务端还向 64 范围发送 block-event。客户端再次执行 NoteBlock 方法，但其上述 raw-sound callback 为空，因此不能把这个分支算成额外的未量化发声。
- 真正可听的路径由客户端 named-packet handler 读 `dy.j()`，调用 ClientWorld 带布尔参数的播放重载，再进入 SoundManager。

因此，**普通音符盒确实经历 63 倍字节量化**。这个结论来自完整选定调用链及客户端 no-op 正控，不是因为客户端里存在一个声音包类。关键 Code 哈希包括 NoteBlock `ba0560d1…`、服务端 named dispatch `2b8c304e…`、客户端 no-op `149488d8…`、包 pitch getter `77af528e…`；完整值及各版 owner/descriptor 位于 source 报告。此结论不自动推广到其它版本。

## 音量、音高、监听者及上下文

SoundManager 先拒绝 sound setting 为零、资源不存在或 raw volume 非正的请求。正音量的 source range 为 `float(16 * max(1, rawVolume))`。提交给 SoundSystem 的 gain 是 `float(min(rawVolume, 1) * globalSoundSettingFloat)`，即先限制 raw volume，再乘全局 sound 设置；没有声音分类系统。设置落在 source，原管理器不借 listener master gain 实现该滑块。

named 包的 pitch 编码顺序为：输入 float 与 `63f` 相乘 → Java `f2i` → 构造器限制为 0..255 → `writeByte` / `readUnsignedByte` → `float(code / 63f)`。原 BaseSource 再将 pitch 限制为 0.5..2。SoundManager 的本地直接播放方法本身不做包量化。普通 note 0 的原始 0.5 在包中成为 `31/63f`，之后由原 BaseSource 限回 0.5。

原 SourceLWJGLOpenAL 的线性衰减私有计算已实际执行，选定 range 48 上包含 0、1、16、47.999、48、64 六个距离。其结果不是原生 OpenAL 的 PCM 或实际 AL gain 读回。

原监听者方法对实体前后坐标作 double 插值，再转 float，没有在这个方法内额外加 eye height。原 Player 构造器设置 `N = 1.62f`，ServerPlayer 清零 `N`；服务端传送方法将 server y 加上 widened `float1.62` 送作 client y。公开 adapter 保留这些原始语义，并提供名义编辑器发送距离参考 `standingEyeHeight=1.62` 与原 float 字段的独立值；该参考不是实际客户端坐标变换、现代 Camera 或实测 standing pose。

原 Library 调用 LWJGL `AL.create()`。实际执行原 ALCcontext 属性列表构造器得到 `[4103,44100,4104,60,4105,0,0]`，对应频率、刷新率与同步字段。两版完整客户端 HRTF 相关引用扫描为空，没有游戏 HRTF 开关证据；实际设备默认状态未测。原 SoundSystemConfig 静态 getter 返回 28 normal / 4 streaming 请求数，**不代表实测声源容量，也不授权截断声部**。

源码报告还核对当前官方 Windows metadata 的 LWJGL 2.9.0 和 native jar，记录各 DLL 的字节数及 SHA-1/SHA-256，但不加载 DLL。这证明当前官方启动依赖身份，不证明历史部署环境。

## 原资源选择与实际内嵌解码

两版官方 metadata 都指向 `pre-1.6` 资产索引，SHA-1 为 `3d8e55480977e32acd9844e545177e69a52f594b`。隔离目录放入该索引中 `sound3/note/` 与 `newsound/note/` 的全部 14 份官方文件，然后实际调用各原 ResourceDownloader 的目录遍历、Minecraft dispatcher、SoundPool 注册/查询及返回 URL 的读取。

原 dispatcher 接收 `sound3`（大小写不敏感），不接收 `sound` 或 `newsound`。14 份输入中原普通声音池仅增加 sound3 的 7 项。另有 streaming、music/newmusic、未知前缀共 8 组 dispatch 正负控。SoundPool 使用原始扩展名/数字后缀处理及随机查询代码；这些 note key 各只有一个候选。

原池实际读回 `harp`、`bassattack`、`bd`、`snare`、`hat`、`pling` 六个 key 的 URL 与字节，随后由**该版原客户端内嵌的 CodecJOrbis/JOrbis**实际解码；每个解码输出保留 PCM 原文件及哈希，均为 44100 Hz、单声道、16-bit little-endian。`bass.ogg` 是额外可注册资源，未混作普通音符盒的 bassattack；pling 也不在本版五材料普通音符盒选择中。

资源身份与解码成功不等于生产解码器、原生 mixer、硬件回放或完整 profile 已验收。

## 执行与严格消费

每版实际覆盖 200 组原 Manager 边界（105 播放、95 拒绝）、44 个原包构造及真实 DataOutputStream/DataInputStream 写读、5 材料 × 25 note、8 个 Options parser 值、1 个 listener 插值、6 个线性衰减距离、8 个资源 dispatch 控制、6 个 URL 读回及 6 份原解码。float 比较使用原始位模式；独立有限输入 oracle 不调用产品音频 helper。

World 的材质/队列/声音/粒子输入与 SoundSystem sink 是明确的 inert fixture；Note → 包 → Source 的组件组合按已审核链手工串接，不宣称已经运行完整服务器、网络或游戏世界。

只读消费入口：

- `scripts/review-lwjgl215-source.mjs`：`verifiedLwjgl215Source(version)`。
- `scripts/probe-lwjgl215-methods.mjs`：`verifiedLwjgl215Components(version)`，返回原 float-bit stdout、进程、classpath、解码与原资源证据。
- `scripts/review-lwjgl215-profiles.mjs`：`reviewedLwjgl215Profile(version)` 返回待注册的 `legacy/world` 对象；`reviewedLwjgl215Resources(version)` 校验资源专报。它们不写共享 facts 或产品。

严格 gate 重读官方 metadata/client、类/Code、原始反汇编、音频依赖、组件原输出和 PCM，重新计算绑定及 adapter。70 个隔离损坏证据都被拒绝，包括匹配伪 raw 哈希后的错误规则、删绑定、错 pitch、错 source master、错资源前缀、错 native 身份、捏造解码/世界状态，以及重新哈希后的原包输出损坏。另有两个缺失 1.5 API 拒绝检查。校验前后所有受保护输入 hash 不变。

可重现命令依次为：

```powershell
node scripts/run-lwjgl215-stage.mjs inventory
node scripts/run-lwjgl215-stage.mjs source
node scripts/run-lwjgl215-stage.mjs components
node scripts/run-lwjgl215-stage.mjs verify
```

所有正式 stage 的 live PID、terminal exit、stdout/stderr 与运行时源码快照在 `.local/lwjgl215-executions/`；[独立执行身份记录](verification.md) 汇总 13 次正式运行、5 次保留失败及当前报告/源码哈希。原 Java 编译/运行也各有独立 PID、命令和 terminal JSON。最终 source 为 `run-1792806324742-source`（PID 45352 / exit 0）；最终组件为 `run-1792806373128-components`（PID 63748 / exit 0；两版 Java PID 70776 / 77412）；仅在补充名义编辑参考 adapter 字段后重跑的最终只读 gate 为 `run-1792806918654-verify`（PID 76332 / exit 0），原 Java 输出未重跑。原始 gate 结果位于 `.local/lwjgl215-reader-negative/run-1792806918736/report.json`。

开发失败保留在同一执行目录：Options load/save 方法选择、反汇编方法名格式、玩家列表委托层的四次 source 断言失败，以及首次组件的 slash/dot 类名适配错误。随后修正的是研究 harness/绑定选择，未改原客户端、规则或比较阈值。所有正式运行均已结束，没有遗留本轮采集或音频进程。

0.1.20 已接入两个候选。实际产品参数/nativeRequest 对原输出的 4,124 次位级比较一致，644 次合法项目参数与请求构造通过；资源加载器的 12 个字节/事件匹配通过。1.5 解码器内嵌在原客户端，桌面加载器只对 id/hash 与已核对容器相符的客户端加入实际 jar；继承实例解析、二次 SHA-1 及 classpath 白名单另经只读审阅。首个缺失容器的开发检查失败及修复前包保留，最终实包两版正常解码/混音；总音量大于1的末端夹取另有五版证明。原世界/常规设备 PCM、完整相机映射及实际分配池容量仍未测。[参数](verification.md)、[资源](verification.md)、[执行/闭包/审阅](verification.md)、[末端音量](java-1.5-1.6-source-volume.md)、[交付](verification.md)。
