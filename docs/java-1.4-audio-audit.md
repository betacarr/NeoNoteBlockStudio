# Java 1.4 正式版声音核心审计

本轮独立核对官方目录实际存在的 1.4.2、1.4.4、1.4.5、1.4.6、1.4.7。目录没有 1.4、1.4.1、1.4.3；未用第三方或相邻版本补位。每版从自己的原客户端重新发现角色、核对类及方法 Code，并实际执行选定原类组件。没有启动游戏世界、OpenAL 设备或原生 mixer。

[总报告](verification.md) 包含每版源码、组件、只读 adapter 与 195 个损坏证据负例。[执行归档](verification.md) 保留阶段终态、原 Java/反汇编进程、失败、来源及报告哈希。资源部分只读消费既有 [pre17 资源证据](pre17-resource-selection.md)，没有重跑原先成功的目录遍历与资源选择探针。

| 版本 | 官方 client SHA-1 | 原类角色：Manager / Note / named packet | 原客户端播放重载 | 证据 |
| --- | --- | --- | --- | --- |
| 1.4.2 | `42d6744cfbbd2958f9e6688dd6e78d86d658d0d4` | `bcx / aju / dn` | `awz.b(DDD,String,FF)` | [source](verification.md) · [components](verification.md) |
| 1.4.4 | `b9b2a9e9adf1bc834647febc93a4222b4fd6e403` | `bek / aky / dw` | `ayh.b(DDD,String,FF)` | [source](verification.md) · [components](verification.md) |
| 1.4.5 | `7a8a963ababfec49406e1541d3a87198e50604e5` | `bek / aky / dw` | `ayh.b(DDD,String,FF)` | [source](verification.md) · [components](verification.md) |
| 1.4.6 | `116758f41b32e8d1a71a4ad6236579acd724bca7` | `bev / alf / dv` | `ayp.a(DDD,String,FFZ)` | [source](verification.md) · [components](verification.md) |
| 1.4.7 | `53ed4b9d5c358ecfff2d8b846b4427b888287028` | `bev / alf / dv` | `ayp.a(DDD,String,FFZ)` | [source](verification.md) · [components](verification.md) |

角色名称相同也未当作行为继承。每版分别绑定 41 个类、53 个选定方法；各类另有完整方法 Code 哈希表，原反汇编、客户端及依赖保留在 ignored 研究目录。五版没有官方客户端映射，绑定依据为各原 jar 的描述符、常量、实际调用者和 Code。

## 实际音符盒发声链

五版 NoteBlock 的事件方法均为 `b(World,IIIII)V`，返回 `void`。原 TileEntityNote 要求上方为空气材质；下方石、沙、玻璃、木材质依次选底鼓、军鼓、踩镲、贝斯，否则选竖琴。原事件计算 `float(pow(2,(note-12)/12))`，以音量 `3f` 和方块中心坐标调用继承的 World named-sound listener 分发方法。

服务器原 listener 构造 named-sound packet；玩家列表要求同维度，按玩家实体位置进行严格距离平方 `< range²` 比较。音量 3 对应范围 48。服务器另向 64 范围投递 block-event，客户端会再次执行方块事件；但原客户端对应的 World listener 声音回调只有 `return`。本轮既绑定服务器、客户端 listener 的实际挂接链，也执行原 World → 原客户端 listener，确认该分支不产生声音 sink 调用。

因此普通音符盒的可听声音来自 named packet，确实经历下列音高运输：

1. NoteBlock 原始 double pow 转 float。
2. 包构造器做 `floatPitch * 63f`，Java `f2i`，再限制到 0..255。
3. 原 `DataOutputStream.writeByte` 与 `DataInputStream.readUnsignedByte`。
4. 原 getter 计算 `float(code / 63f)`。
5. 原 BaseSource 将接收到的 pitch 限制到 0.5..2。

例如 note 0 的原始 0.5 会先成为 `31/63f`，再由 BaseSource 限回 0.5。不是仅凭声音包类存在就把量化套给音符盒；完整选定调用链和客户端 no-op 已分别核对。

族内实际变化是 1.4.6 起客户端播放重载多了距离延迟布尔值；本轮这条 named-sound handler 明确传 `false`。未把旧重载或后版 boolean NoteBlock 返回签名套到其它版本。

## 增益、衰减与监听者

原 Manager 在全局 sound 设置为零、资源缺失或 raw volume 非正时不提交 source。它先用未夹取 raw volume 决定 range：`float(16 * max(1,rawVolume))`；提交的增益为 `float(min(rawVolume,1) * globalSoundSettingFloat)`。

这个值仍是中间值。原 SoundSystem 私有 `CommandSetVolume` 委托原 BaseLibrary `setVolume`，后者再次限制到 0..1，再写 `Source.sourceVolume`。本轮真实执行了这两个下游方法；全局设置 1.2 与 2 下，每版有 40 个实际末端 clip 案例。选定有限域的最终规则为：

```text
sourceVolume = clampFloat(float(min(positiveRawVolumeFloat, 1) * globalSoundSettingFloat), 0, 1)
```

没有声音 category 系统。该全局 sound 设置进入 source，Manager 没有通过 listener master 实现它。实际原 SoundSystemConfig 默认 master getter 为 1；原 Library 的 listener master hook 另有 Code 绑定，但没有打开 AL 或声称读取了实际 listener gain。BaseLibrary `setVolume(String,F)V` 的 Code SHA-256 为 `61490f60963d375735184799e41b7976a0ab1f023995e66ab8fd767cac29967c`，分别从五份客户端字节验证。

原 SourceLWJGLOpenAL 的线性 gain 计算在 range 48 上实际执行了六个距离：0、1、16、47.999、48、64。其 `calculateDistance()` Code 表明先对 source/listener float 坐标相减，再转 double 做平方和、sqrt，最后转 float；该方法哈希为 `8109dd061956a847d0fa3f7f5012979bc8b18f5094306c1aa4b263942b7ecee1`。后者属于原源码检查；组件的六距离输入直接设置原 `distanceFromListener`，没有冒充完整世界坐标路径或原生混音测量。

原 Manager 对 client entity 前后 double 坐标按 partial tick 插值，再转 float；此方法内不额外加 eye height。本轮实际执行 partial 0、0.25、1，保留坐标与原 float 数学/朝向输出。原 Player 设置 `float1.62` 偏移，ServerPlayer 清零偏移；server teleport 将 server y 加 widened `float1.62` 发作 client y。adapter 的 `standingEyeHeight=1.62` 是名义编辑器耳到 server 脚部的发送距离参考；`standingEyeHeightJavaFloat` 单独保留原 float 值。它们不是实测世界姿态、完整坐标变换或现代 Camera 等价证明。

## 上下文、codec 与声源请求

五版原 Library 都通过 LWJGL `AL.create()` 建立默认路径。实际执行原 ALCcontext 属性构造器得到 `[4103,44100,4104,60,4105,0,0]`。这是请求属性，不是设备实际接受的状态。客户端全类 HRTF 控制引用扫描为空，选定调用链没有游戏 HRTF 设置；保留 `device-default`，不推断设备实际 HRTF 开关或支持性。

原配置 getter 给出 28 normal / 4 streaming，仅是请求配置，未测实际分配或可达上限。当前官方 Windows 启动 metadata 的 LWJGL 2.9.0 与 native jar/DLL 均校验哈希但从未加载；这不证明 2012 年实际部署版本。

各原客户端内嵌 Paulscode CodecJOrbis/JOrbis。资源 URL 来自既有逐版原资源成功证据，按官方哈希读入；本轮在各自原客户端 classpath 下分别实际解码 harp、bassattack、bd、snare、hat、pling 六文件，并保留 PCM 原文件及哈希。30 份结果均为 44100 Hz、mono、16-bit little-endian。pling 是可寻址资源，不是本版五材料普通音符盒的第六种选择。

没有重新执行已通过的 ResourceDownloader 遍历和 SoundPool URL 选择，也没有用前版解码结果证明后版。解码成功不等于生产 decoder、原生 mixer、硬件或完整世界已通过。

## 可执行证据与消费入口

每版 300 个有限 scalar 输入包含 raw volume 的负数/正负零/大于 1，global setting 0..2，以及直接 pitch 的边界。175 例实际提交，125 例未提交；未提交保留 NaN sink 占位，不算 final gain 为零的通过证据。有限网格中的 volume 6 等也不冒充合法编辑器工程。

另有每版 9 个非有限 scalar 与 3 个非有限 packet 诊断，单独存档，仅核对原输出在二进制与文本间一致；未扩展合法项目域，也未声称这些输入与生产实现相等。普通音符盒的 125 例单列为 5 材料 × 25 note。

二进制文件为 little-endian，8 字节头后是原始 float 位：

| 文件 | magic / 记录数 | 每记录列 |
| --- | --- | --- |
| `boundary.bin` | `NB14` / 300 | raw volume、global setting、raw pitch、Manager gain、Library final sourceVolume、Manager pitch、BaseSource final pitch、range（32 字节） |
| `packet.bin` | `NP14` / 44 | input pitch、constructor getter、wire getter、BaseSource final pitch、wire volume（20 字节） |
| `notes.bin` | `NN14` / 125 | emitted pitch、wire pitch、final pitch、emitted volume、Manager gain、Library final sourceVolume、range、wire volume（32 字节） |

`diagnostic-boundary.bin` / `diagnostic-packet.bin` 分别使用 `ND14` / `NX14`，与有限结果分开。完整原 stdout、输入 TSV、实际 classpath、编译类及命令/PID/终态都绑定哈希。World 与 SoundSystem sink 是明确的 inert fixture；原方法从该版未修改 jar 加载，harness 不替换原角色类。最终读取器还锁定完整编译/运行命令、入口类及 classpath 顺序；相关负例在最后一次纯读取 gate 中核对。

只读接口为 `scripts/review-lwjgl214-profiles.mjs` 的 `reviewedLwjgl214Profile(version)`，返回待注册 `legacy/world` 对象。底层 `verifiedLwjgl214Source` 与 `verifiedLwjgl214Components` 重读官方身份、原类/Code、编译及执行来源、原输出与原 PCM；不联网、不编译、不运行 Java，也不写共享产品或事实。

严格 gate 的 195 个损坏证据全部拒绝，包括 wrong release、错 Code/路径/规则、删除 listener 挂接、删除下游 clip、捏造 native/world、混用 resource 证据及改动二进制。还包含将二进制和 stdout 同步改成一致错误值的案例，以验证独立有限数值检查。校验前后输入哈希保持不变。

```powershell
node scripts/run-lwjgl214-stage.mjs inventory
node scripts/run-lwjgl214-stage.mjs source
node scripts/run-lwjgl214-stage.mjs components
node scripts/run-lwjgl214-stage.mjs verify
```

最终源码阶段 PID 40200、组件阶段 PID 75416、只读 gate PID 45320 均 exit 0。最终五个原 Java PID 为 77444、37324、35288、76768、76716，均已结束。gate raw 为 `.local/lwjgl214-reader-negative/run-1792810339099/report.json`。

开发失败按阶段保留：1.4 的 Player 不含后版发现线索；客户端重载差异；wood block 命名链额外调用；以及新读取器对替换二进制路径的语义检查漏接。最后一项由负例发现，已修为读取实际被引用文件，并重新执行本轮原组件和完整负例。未修改原客户端、旧资源证据、产品或比较阈值。所有本轮进程已终态，没有世界录音新增。
