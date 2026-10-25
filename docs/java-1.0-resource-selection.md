# Java 1.0 原始资源选择

**0.1.21 开发检查注记：** 原资源证明仍是 resource-only，`fullAudioProfilePromoted=false` 不变。随后独立完成的[pre13 声音链/原组件审计](java-pre13-audio-audit.md) 现已登记 Java1.0 的源码配置，当前状态为 `code-reviewed`，解码器分类为 `legacy-jorbis`；内嵌 codec 受精确 release ID/client SHA1 白名单控制。[当前纯生产 loader](verification.md) 再次核对原有六份文件，并绑定独立 core source/numeric 证据，没有重跑原资源探针或增加原样本、audio worker、native/world 测量。326 项单元测试和类型检查通过；更新后的桌面检查仍等最终 0.1.21 实包，不宣称新版包已通过。

Java 1.0 的官方 `pre-1.6` 索引同时包含 `newsound/note/…` 与 `sound3/note/…`，但相同文件名不能证明游戏会加载两组。实际执行原始资源目录遍历、Minecraft 资源分发、SoundManager 注册与 SoundPool 查找后，六个音符事件选中 `newsound`，`sound3` 不进入音效池。贝斯使用 `bassattack.ogg`。

[原始类报告](verification.md) 保存官方 metadata/client/index 身份、六个原类与八个 Code 绑定、八种目录分发情况、进程 PID/退出状态和六份实际文件 URL 读回。十四份官方 note 资源只用于隔离 fixture；七份 `newsound` 文件注册到音效池，六个事件的最终文件逐字节吻合官方对象。资源下载线程没有启动，Minecraft 的构造器被绕过，没有创建 SoundSystem 或音频设备。

原先资源加载器仅为这个已核对的客户端启用 `legacy-newsound` 路径。[实际加载器对照](verification.md) 将六份结果与原始类选出的文件直接比较，并保存完整生产 bundle 输入的哈希；当前报告按顶部注记刷新。缺少已核对文件、重复音效候选或未经核对的路径会明确报错，不改用 `sound3`。1.1 等后来支持的客户端各有独立资源证明，不继承 Java1.0 的索引路径结论。七项单元检查覆盖这些边界。

此项原工作只完成资源选择。事件的默认 volume/pitch 字段是加载器的归一化元数据，不证明早期 SoundManager、解码器或混音器等价。当时完整声音配置为未核对，解码器分类为 `unknown`；其 [sound 设置运算边界](java-1.0-audio-boundary.md) 与资源证据分别保留。后来的调用链、listener 数值与 codec 源码/组件结果来自独立 pre13 证据，不能追溯算作这次资源读取的验收。原始原生上下文、运行中的镜头/世界姿态和游戏录音仍未因此通过，没有新增世界验收场景。

0.1.17 Windows 实包通过实际 preload/main-process 目录授权与资源读取：未选择的根目录被拒绝，选择后返回六份原始 payload，名称、字节数、SHA-1 与原始类选出的文件一致。原生库只按官方压缩包身份提取到隔离缓存，没有执行 native ABI；解码器仍 unknown，警告与未验证状态保留。[实包记录](verification.md)。
