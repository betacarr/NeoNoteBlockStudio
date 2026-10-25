# Java 1.1–1.4.7 原版资源目录分界

原版目录分发在这批客户端中有明确变化。共享同一份 `pre-1.6` 资源索引不能证明应读取同一组采样。

**0.1.21 开发检查注记：** 以下原资源执行及旧桌面记录保留原日期和 resource-only 范围，`fullAudioProfilePromoted=false` 不变。随后完成的[pre13](java-pre13-audio-audit.md)、[1.3](java-1.3-audio-audit.md) 与 [1.4](java-1.4-audio-audit.md) 独立声音链/原组件证据已登记当前源码配置；这十三版现在为 `code-reviewed`，解码器分类为 `legacy-jorbis`，内嵌 codec 只允许精确 release ID/client SHA1 匹配。当前[纯生产 loader 报告](verification.md) 重新核对原有 78 份采样和 Java1.0 六份回归，并绑定独立 core source/numeric 证据；没有重跑原资源探针，没有增加原样本数、audio worker、native 或世界验收。326 项单元测试与类型检查通过。更新后的 0.1.21 桌面断言仍等待最终实包，不把旧 unknown/warning 的历史结果当作当前状态或新版实包结果。

| 原版客户端 | 实际接收的音效目录 | 独立客户端数量 |
| --- | --- | ---: |
| 1.1、1.2.1、1.2.2、1.2.3、1.2.4、1.2.5、1.3.1、1.3.2 | `sound/`、`newsound/`；官方 note 文件选自 `newsound/` | 8 |
| 1.4.2、1.4.4、1.4.5、1.4.6、1.4.7 | `sound3/`；忽略 `sound/` 和 `newsound/` | 5 |

每版都独立校验官方 metadata/client/asset-index 身份，识别其原始 Minecraft、实际 concrete subclass、ResourceDownloader、SoundManager、SoundPool 和 entry 类，并绑定八个原始方法 Code。探针通过原目录遍历、Minecraft 分发、SoundManager 注册及 SoundPool 查找，再实际打开最终选中的文件 URL。Minecraft 使用其原始 concrete class，通过 Unsafe 分配而不运行构造器；下载线程不启动，声音系统不构造，没有游戏、解码器或原生音频调用。

每版的最小 fixture 同时包含官方 `newsound/note/` 和 `sound3/note/` 两组共 14 份文件。原声音池只注册所接受目录中的七份；实际读回 harp、bassattack、bd、snare、hat、pling 六个资源。每版另有九个前缀分发正负例，包含大小写、streaming、music、newmusic 和未知目录。总计 **78 份实际采样读取、117 项分发观察**；各版本的公开 `java-<version>-resource-selection.json` 保留各自记录，没有借用相邻版执行。

[`audit-pre17-resources.mjs`](../scripts/audit-pre17-resources.mjs) 保存原类和方法身份、disassembly 哈希、官方依赖、配置、原始 stdout/stderr、编译和 Java 的 PID/终端状态、编译 helper 及源文件快照。源快照保留运行时的精确字节，不要求未来的研究脚本永远不再修改。开始阶段的 metadata 格式与角色发现失败记录保留在 `.local/pre17-resource-executions/`；1.4.7 的早期成功原读取也保留在旧 run 中，最终报告使用加入完整源快照后的执行。

[`review-pre17-resources.mjs`](../scripts/review-pre17-resources.mjs) 为纯只读消费器：不下载、不编译、不运行 Java 或 native，逐项核对官方原件、六个角色、八个 Code、源快照、实际 classpath/args、终端、14 份 fixture、六个 URL 结果和九个前缀结果。13 个正例通过；对 1.1 和 1.4.7 的两种布局共 58 份损坏报告均拒绝。负例只修改隔离报告与侧文件，没有改写原始证据或重跑原版。见[消费器验证](verification.md)。

生产加载器按每个已核对 client 身份登记 `legacy-newsound` 或 `legacy-sound3`，不会按恰巧存在的文件或共享 index 猜测。两个布局同时存在时，各版仍取原版目录；缺少已核对文件会拒绝，不从另一组替代。活动目录中的多变体仍明确拒绝；忽略目录的变体不会干扰选择。Java 1.0 的生成工具会保留其他已独立登记客户端。

最初资源开发检查中，实际生产加载器与 13 份原读取结果逐字节比较，**78 份采样全部一致**；1.0 原有六份采样回归也一致。该历史阶段同时检查 namespace 干扰项、事件映射与当时的 `unverified` 状态，并通过 280 项单元检查及 TypeScript/生产构建。当前 canonical [生产加载器记录](verification.md) 已按顶部注记刷新；原读取证明与旧开发 checkpoint 保留原样。

原资源开发版 Electron 另经真实 preload/main 路径完成 13 次未选择目录拒绝、目录选择和 13 版/78 份采样及事件字节比对。该历史阶段显示未核对警告和 unknown decoder；音频工作进程启动数为零，应用与检查进程正常退出，实际编译 main/preload/worker 与当时源码一致。见[桌面开发验收](verification.md)。这不是 0.1.19 或 0.1.21 发行包验收；已交付的便携版、安装版及其历史报告保持原样。

原资源工作只补齐资源选择。事件里的单位 volume/pitch 与 16 距离是加载器元数据，不证明早期 SoundManager、服务器传输、listener、解码、混音、原生上下文或世界录音等价。后续配置登记来自独立声音链证据，不能归因于本资源探针；没有因此增加 native/world 验收场景或结构生成。1.5、1.6 各自的资源路径与声音链另有独立证据，不继承本表结论。

0.1.20 最终 Windows 实包重新完成全部13版授权目录选择及78份字节/事件读取，仍不启动音频worker，也不提升这些版本的完整声音状态。[本版桌面记录](verification.md)。
