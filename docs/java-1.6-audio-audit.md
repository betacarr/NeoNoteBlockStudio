# Java 1.6.1 / 1.6.2 / 1.6.4 声音链审计

本次逐版核对官方客户端与库，并实际调用原类。三版各有 **49 类、55 个选定 Code binding、1,101 个 SoundManager 状态、78 个真实 java.io 包输入、125 个材料音符路径、5 个监听插值、9 个原 Source 衰减状态和 7 个原资源 URL 读取**。三版总计 3,303 个管理器状态、234 个包输入、375 个音符路径、21 次资源读取；只读守卫的 78 个损坏副本全部拒绝。

这是源码、原组件和原资源选择证据。没有打开游戏、音频设备或 OpenAL 上下文，没有原版 PCM、实际声道容量、HRTF 状态或世界录音验收；不会因依赖与后续版本相同而继承这些状态。没有修改产品、公共 facts 或生成器。

## 官方身份与原类

| 版本 | 官方 client SHA-1 | 原组件 Java PID | 最终原始输出 |
| --- | --- | --- | --- |
| 1.6.1 | `17e2c28fb54666df5640b2c822ea8042250ef592` | 31772 | `.local/lwjgl216-methods/1.6.1/run-1792806636253/report.json` |
| 1.6.2 | `b6cb68afde1d9cf4a20cbf27fa90d0828bf440a4` | 78052 | `.local/lwjgl216-methods/1.6.2/run-1792806640666/report.json` |
| 1.6.4 | `1703704407101cf72bd88e68579e3696ce733ecd` | 45192 | `.local/lwjgl216-methods/1.6.4/run-1792806644501/report.json` |

各版本的 [1.6.1 元数据](https://piston-meta.mojang.com/v1/packages/7fd8e0c76f62813eb0465e31bb74b160c01472d6/1.6.1.json)、[1.6.2 元数据](https://piston-meta.mojang.com/v1/packages/c0729761bf65dc58138ce508645dba1442fa78b8/1.6.2.json)、[1.6.4 元数据](https://piston-meta.mojang.com/v1/packages/b71bae449192fbbe1582ff32fb3765edf0b9b0a8/1.6.4.json) 均按官方 SHA-1 验证；客户端和被选库逐个验证官方哈希。该批元数据没有官方 mappings，角色由每版独立发现和原字节码约束确定，没有套用 1.7 的命名或运行语义。

| 角色 | 1.6.1 | 1.6.2 | 1.6.4 |
| --- | --- | --- | --- |
| SoundManager / SoundPool | `blc` / `blf` | `blk` / `bln` | `bln` / `blq` |
| NoteBlock / TileEntityNote | `api` / `ase` | `apm` / `asi` | `app` / `asl` |
| World / ServerWorld | `abr` / `jp` | `abv` / `jr` | `abw` / `js` |
| 服务器 WorldListener / 客户端 WorldListener | `jl` / `bfa` | `jn` / `bfi` | `jo` / `bfl` |
| 声音包 / 方块事件包 | `en` / `gd` | `en` / `ge` | `eo` / `gf` |
| 客户端包处理器 | `bcn` | `bct` | `bcw` |

公开的 [1.6.1 源码证据](verification.md)、[1.6.2 源码证据](verification.md)、[1.6.4 源码证据](verification.md) 保留类、字段、方法身份和 Code SHA-256。完整原 class / javap 保留在忽略的 `.research/lwjgl216-source/<version>/`；每个 javap 子进程有 PID、精确参数、stdout/stderr 和 terminal 记录。反编译输出不进入公共文档正文。

## 已确认的声音语义

1.6 使用直接字符串声音名和 SoundPool，没有后续版本的 `sounds.json` 事件标量和类别音量系统。原 Options 的全局 `sound` 设置作用于源，`music` 是另一路。整份客户端扫描也没有声音类别选项、游戏的 SoundSystem MASTER setter 或 HRTF 控制调用；该否定范围绑定每个原客户端身份。

原空间播放入口是 `SoundManager.a(String, float x, float y, float z, float volume, float pitch)`。加载/全局声音为零会抑制播放，原池查找后才检查正音量。对有限的合法设置域，处理顺序为：

- 用未裁剪的 raw volume 计算范围：初始 16，大于 1 时执行 float 乘法 `16 * volume`；音符盒的 3 对应 48。
- volume 上限先裁到 1，再以 **float 乘全局 sound 设置**，提交 `SoundSystem.setVolume`；不是类别先乘后裁剪。
- 原 SoundSystem 只把音量、音高送到命令队列；原 `Library.setVolume(String,float)` 另裁到 0–1，原 `Library.setPitch` / `Source.setPitch` 另裁到 0.5–2。
- 原库的 MASTER 默认值为 1，游戏 `sound` 设置没有走 listener MASTER。配置请求 28 个 normal、4 个 streaming；这不等于已测得实际分配容量。

每版 125 条原音符路径中，note volume=3、global sound=.5 时，游戏命令值与原 Library.sourceVolume 都是 `.5`。这与类别先乘后裁剪会得到的 1 有明确区分力。

1,101 个管理器输入包含 1,092 个网格状态和 9 个标记为非有限/滑块域外的诊断；网格也明确标记负 instance 输入。592 个状态实际提交播放。未播放行的输出 NaN 是探针哨兵，不是游戏原函数返回值。原 `fcmpg` / `fcmpl` 对 NaN 的分支不能当作现代 Java clamp 的通用等价规则，原始 bits 保留在 `math.bin`，没有把无效输入算作普通 UI 控制域通过。

## 音符盒实际通过哪条包路径

不能仅凭声音包存在就给音符盒套用量化规则。三版均独立闭合了：

`TileEntityNote.a(World,III)` 读取上方空气和下方实际 Material，排入整数 block-id 事件；ServerWorld 队列执行原 Block 事件回调；原 NoteBlock 产生 float 化的 `pow(2,(note-12)/12)` 和 `note.harp/bd/snare/hat/bassattack`、volume=3；继承的 World 字符串声音入口通知服务器 WorldListener，由它构造原声音包。

服务器还发送方块事件包；但是三版客户端 WorldListener 的 `a(String,DDDFF)V` 原 Code **只有 `return`**，因此客户端方块事件的 raw-pow 声音回调不会另行发音。这一空回调也在原类探针中实际调用。

原声音包构造器 `(String;DDDFF)V` 执行 float pitch×63、Java float-to-int、0–255 构造器裁剪；原 `DataOutput.writeByte` / `DataInput.readUnsignedByte` 往返后 getter 用 float 除以 63。它不是 Netty、不是低八位 wrap，也不是后来的 float32 wire。

原组件的 125 条路径实际执行了 **TileEntityNote → NoteBlock → 原声音包写读 → 原 ClientPacketHandler → 原 ClientWorld 距离入口 → 原 SoundManager**，最后接上原 Library/Source 的数值方法。World 的材料输入/排队/声音/粒子回调是明确隔离的 fixture，未启动世界。声音系统使用真实原 SoundSystem 的子类记录命令边界，构造器和线程未启动；没有把记录器冒称成原混音器。

三版、五种材料均得到同一可区分数值：

| 音符 | 原 NoteBlock pitch | 原包写读后 pitch | 原 Source pitch |
| --- | --- | --- | --- |
| 0 | 0.5 | 0.4920634925365448 | 0.5 |
| 1 | 0.5297315716743469 | 0.523809552192688 | 0.523809552192688 |
| 12 | 1 | 1 | 1 |
| 24 | 2 | 2 | 2 |

78 个包输入包含 75 个有限值与 3 个非有限诊断，跨 63 / 63.5 邻近边界、负值和构造器饱和边界。期望数据是原 Java 二进制输出，未用生产公式生成。

## 单数 `sound/` 的原资源读取

原 SoundManager 递归扫描 File 根目录，以第一个目录名与 `sound` / `records` / `music` 做忽略大小写的相等比较，再交给对应原池。SoundPool 去除扩展名、按开关移除末尾数字，将 `/` 转为 `.` 后分组；探针实际确认 `note/harp.ogg` 与官方 harp 字节的 `note/harp1.ogg` 会成为两个同组变体。

三版官方元数据都声明 [legacy 索引](https://launchermeta.mojang.com/v1/packages/770572e819335b6c0a053f8378ad88eda189fc14/legacy.json)，SHA-1 `770572e819335b6c0a053f8378ad88eda189fc14`，`virtual:true`。这是 launcher 的文件物化来源；游戏端实际使用原 `DefaultResourcePack(File)`、ResourcePathHelper、reloadable/fallback ResourceManager 和原资源 InputStream，**没有借用后续 ResourceIndex 的角色**。

原 URL 协议在 patch 间发生了真实变化：

- 1.6.1：`minecraft:sound/note/harp.ogg`。
- 1.6.2 / 1.6.4：`mcsounddomain:minecraft:sound/note/harp.ogg`。

七个文件均通过原 URLStreamHandler → 原 URLConnection → 原 ResourceManager → 原 Resource InputStream 读取；三份原 client ZIP 均无内嵌 note 资源，原 DefaultResourcePack 的文件映射回退实际可用。长度和 SHA-1 与官方索引对象逐个一致：

| 实际索引键 | 长度 | SHA-1 |
| --- | ---: | --- |
| `sound/note/harp.ogg` | 6137 | `46244605b8663a29cdce7bccc5b2d038241e32ee` |
| `sound/note/bd.ogg` | 3850 | `1afefaa39a53606d2737bab9cb3409350cb2dc9f` |
| `sound/note/snare.ogg` | 3969 | `6967f0af60f480e81d32f1f8e5f88ccafec3a40c` |
| `sound/note/hat.ogg` | 3880 | `fd2b6f745b05a2cf44a4e010f72631de2e5099f6` |
| `sound/note/bassattack.ogg` | 5574 | `037b9fb7f74381f354739d015193dc4a6897f620` |
| `sound/note/pling.ogg` | 6274 | `20d06589bd5ab81a73989bdac8ca59ecd4d66932` |
| `sound/note/bass.ogg` | 5479 | `e28d844995368de1d45c724a5d371c9952ae5ed4` |

这仍然只有五种材料音色；`pling` 和 `bass.ogg` 是额外资源读取控制，没有升为当版材料乐器。音符盒木材路径用的是 `bassattack.ogg`。共享 legacy 索引也含复数 `sounds/` 等同名资源，哈希相同不能替代游戏实际选择的路径。

建议独立注册 `legacy-sound` 布局，按已核对 client SHA 选择，把编辑器规范路径映射到上述单数 `sound/` 键，直接建立五事件表；不要走 `sounds.json`，不要套用 `legacy-newsound`、`legacy-sound3` 或 1.7.2 的复数 `sounds/` 根布局。本次只给适配候选，没有改运行时。

资源证据：[1.6.1](verification.md)、[1.6.2](verification.md)、[1.6.4](verification.md)。实际探针构造原池；SoundManager 整树扫描和前缀分流属于 Code 审核，没有把它们误记为一次完整扫描执行。

## delivery、listener 与原库边界

原服务器声音发送半径为 `volume>1 ? float(16*volume) : 16`，同维度、服务器玩家实体坐标的严格 squared-distance 小于半径平方判断；音符盒的空间声音半径 48，另一个方块事件包半径 64，二者没有混淆。

原 SoundManager 按 partial tick 插值客户端实体 double 坐标再转 float，不额外加 eye getter；角度使用原 MathHelper 正余弦表。五组实际插值输出保留原 bits。原 Player 写 `N=Java-float1.62`、ServerPlayer 清零 N，Entity bounds 对 Y 减 N、加 X 的关系已 Code 绑定。**本轮没有闭合客户端/服务器 teleport 包的姿态传播，也没有站立相机采样**，因此适配候选不把这一普通 offset 当成实测耳高或后续 Camera 模型。

原 SourceLWJGLOpenAL 的距离使用 float 相对坐标减法后转 double 求平方和及平方根，再转 float；线性 gain 在原私有方法上实际执行了 9 个状态。最终 AL gain 还会乘 sourceVolume 和 fade 值，本轮没有执行 AL 调用或录音。

原构造器注册官方 Paulscode LibraryLWJGLOpenAL、CodecJOrbis；库的原 readAll / alBufferData 链已 Code 绑定，Ogg 原字节成功读取，**没有宣称 JOrbis 解码已执行**。原 Library 调用 LWJGL `AL.create()` 默认路径；游戏无 HRTF 控制，原库实际 HRTF 能力/状态未知。官方 Windows LWJGL 2.9.0 native jar SHA-1 `3f11873dc8e84c854ec7c5a8fd2e869f8aaef764` 中原 DLL 已验证归档身份：

- OpenAL32.dll SHA-256 `baf27fc91dc852d78889e052cfc9ed2b6fc0927258bb507a895c6fcd50f10fef`。
- OpenAL64.dll SHA-256 `9261b66010a845ddef9f61d5e4266fe2f08a53f3605da002e9e8f8d202bdbc5e`。

DLL 没有加载；默认参数与创建链的源码核对不等于 loopback 等价、设备 context 属性读回或 HRTF on/off 验收。

## 严格消费入口与归档

`scripts/review-lwjgl216-profiles.mjs` 导出三个只读入口：

```js
await reviewedLwjgl216Profile('1.6.1');   // { legacy, world, resources } 候选
await reviewedLwjgl216Profiles();        // 三版各自严格验证
await reviewedLwjgl216Resources('1.6.4');
```

原二进制列和输入由 `scripts/review-lwjgl216-components.mjs` 的 `verifiedLwjgl216Components(version)` 返回。入口不下载、不编译、不启动 Java/原生设备或游戏；校验官方身份、原 class/字段/Code、原 javap 参数与终端、完整 helper/classpath 闭包、原始报告和所有二进制/输入/资源哈希。1,101 行 math 的未播放哨兵、包与音符列的 stride 均显式记录，后续生产比对应直接读取原 bits。

`scripts/verify-lwjgl216-audit.mjs` 已对三版各 26 个内存损坏 fixture 验证拒绝，包括错版本、63.5 替换、假 HRTF/世界状态、字段与 Code 变更、错误原 JVM classpath、未退出进程、包二进制差异、复数路径替换和 Ogg/库字节损坏。结果见 [只读守卫](verification.md)。

汇总见 [三版冻结归档](verification.md)。最终 Java/Javac 六进程全部 terminal / exit 0，批协调 Node 76344 亦已终止。先前的角色发现、原资源 helper 需要 Minecraft singleton、材料名称匹配及探针类名格式等失败均保留在独立 `.local/lwjgl216-*` 目录，未覆盖最终原类输出，也未因观测超时重启活进程。当前没有活动句柄。

本轮到此冻结研究脚本、原类二进制和公开证据。候选可以支持后续源码级接入与针对性生产比对；未执行的 decoder/native/world/相机/实际池容量路径保持未测。

0.1.20 已独立接入三版：实际产品参数/请求 12,648 次严格位级比较无差异；1,140 次合法参数与 nativeRequest 构造、18 个采样字节/事件匹配通过。1,527 个原管理器未播放输入不冒称为零匹配，非有限/超工程域诊断单列；15 个原绝对监听 fixture 不冒称编辑器相机相等。最终实包各自使用官方独立 codec/soundsystem 路径完成原生解码/离线混音；这是产品 smoke，冻结原组件审计没有执行 codec/native，不增加世界或原常规设备等价验收。[产品比较](verification.md)、[末端音量](java-1.5-1.6-source-volume.md)、[交付](verification.md)。
