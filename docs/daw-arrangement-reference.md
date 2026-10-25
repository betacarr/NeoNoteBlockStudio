# 编曲移动与多选参考

查阅日期：2026-10-25。以下为官方文档与固定源码的只读调研，未运行 Ardour/Zrythm，也不构成本编辑器的界面验收。第三方实现没有移植到产品中。

## 已核对的交互事实

| 来源 | 可借鉴的事实与边界 |
| --- | --- |
| [Ardour：Move Regions With the Mouse](https://manual.ardour.org/editing-and-arranging/move-regions/) | 片段随指针跨入目标轨。经过自动化轨、总线等不兼容位置时，片段不会进入这些轨道，提供可见反馈。文档还区分自由移动和保持时间位置的移动；这不是目标轨锁定规则的证明。 |
| [Zrythm：Edit Tools](https://manual.zrythm.org/en/editing/edit-tools.html#moving-objects) | 拖动可将片段移到兼容类型的轨道；选中对象用更亮的颜色区分。该页面标为 v2.0.0-DEV、更新于 2026-03-25，不能当作所有发布版行为的保证。 |
| [Ardour 官方论坛 106577](https://discourse.ardour.org/t/cant-move-regions-to-another-track/106577) | 2021-11-19 的 Ardour 6.9.0 案例：同轨移动可用、跨轨移动失败，维护者指出 Ripple/Ripple all 限制，用户改为 Slide 后确认恢复。说明隐蔽模式会造成“拖动失灵”的困惑；不能据此推断当前每种编辑模式。 |

实际实现另核对了 [Ardour 官方 GitHub 镜像](https://github.com/Ardour/ardour) 的 `gtk2_ardour/editor_drag.cc`，固定到查阅时 `master` 的 commit [`fd4ef0523bff40d44f9d1ac66a3a5cbff269acc8`](https://github.com/Ardour/ardour/commit/fd4ef0523bff40d44f9d1ac66a3a5cbff269acc8)。文件为 GPL-2.0-or-later，仅保存于本地调研目录；本文只记录职责和行为。

- [`RegionMotionDrag::start_grab` / `compute_x_delta`，891–993 行](https://github.com/Ardour/ardour/blob/fd4ef0523bff40d44f9d1ac66a3a5cbff269acc8/gtk2_ardour/editor_drag.cc#L891)：启动预览，Ripple 限制纵向移动；水平位置经既有吸附路径处理，并约束负时间和上界。
- [`apply_track_delta` / `y_movement_allowed`，997–1083 行](https://github.com/Ardour/ardour/blob/fd4ef0523bff40d44f9d1ac66a3a5cbff269acc8/gtk2_ardour/editor_drag.cc#L997)：轨道解析处理隐藏轨和非轨道对象，并检查目标数据类型。不能把这个兼容性检查泛称为“所有非法释放均取消整个移动”。
- [`RegionMoveDrag::finished_no_copy`，1917–2122 行](https://github.com/Ardour/ardour/blob/fd4ef0523bff40d44f9d1ac66a3a5cbff269acc8/gtk2_ardour/editor_drag.cc#L1917)：释放阶段跳过锁定的源 region，区分跨轨插入/移除和同轨位置更新，最后形成可撤销操作。这一检查是源 region 锁，不证明目标轨锁。
- [`RegionMotionDrag::aborted`，2224–2251 行](https://github.com/Ardour/ardour/blob/fd4ef0523bff40d44f9d1ac66a3a5cbff269acc8/gtk2_ardour/editor_drag.cc#L2224)：取消后恢复拖动视图的父容器、位置及高度。

固定文件 234,060 字节，SHA256 `6f8d0e4dbf457d5f57aea8a7d8607227b732553b16b362521ce82b8241e7e928`；固定 raw URL 与本地身份见 `.local/cross-track-ui/research/source.json`。GitHub API 当次限流，commit 来自镜像 HTML 的 `currentOid`，再下载固定 commit 文件并核对与同次 master 文件字节一致。

## 本项目本轮的选择

这些是本项目的交互与数据约定，不是对上述 DAW 的兼容承诺：

- 有效落点应显示目标轨道和音色；指针落点只按当前可见轨道解析。锁定、空白或被筛选掉的目标须明确拒绝，释放不应偷偷降级为源轨上的时间移动或邻近轨道移动。
- 同轨和跨轨共用原有时间吸附与拖动锚点；只做纵向移动时保持开始位置。无移动、取消和无效释放不产生历史记录；有效释放只提交一次，Undo 恢复整个操作。
- 未指定 `note.instrumentId` 的音符随目标轨默认音色；显式覆盖保留。移动不改源音符的 tick、时值、声像、微调、片段 offset/loop 或便携采样。跨轨的旧 MIDI note-off 轨道路由须清理，其他 MIDI 顺序、释放力度和附加事件保留，原始 MIDI 资产不变。
- 筛选只影响显示；明确的目标下拉选择与指针落点分别验收。不能根据已经消失的屏幕行号选择隐藏轨，也不因拖动暗中改变筛选。

## 0.1.43：整组选区的补充取舍

[Ardour 移动文档](https://manual.ardour.org/editing-and-arranging/move-regions/)描述多个已选片段一起移动时保留相对位置；[复制文档](https://manual.ardour.org/editing-and-arranging/copy-regions/)也保留选区相对位置。[Zrythm 编辑工具](https://manual.zrythm.org/en/editing/edit-tools.html)将选择、移动和复制作为一致的对象操作。这里只借鉴职责，不照搬其修饰键或链接副本规则。

[Ardour 官方论坛 copy/paste behavior](https://discourse.ardour.org/t/copy-paste-behavior/105190)记录 2020-12-17 的粘贴位置困惑：目标轨与编辑点模式影响落点。它是一条有日期的可用性线索，不是对当前社区需求的普查。本项目因此明确显示所选数量、隐藏成员、主片段和移动目标；当前提供可预见跨度的独立复制，片段 Ctrl+C / X / V 留待完整定义目标规则后实现，不能误操作主片段中的 MIDI 音符。

本项目使用统一时间／可见行差、整体拒绝非法目标、预览后一次提交、完整选择历史。副本按用户决定保持独立；没有移植第三方实现。实际操作与数据边界见[片段多选说明](arrangement-groups.md)。下节夹具及 12 次回读属于 0.1.42 历史；0.1.43 使用独立的五轨多片段夹具，18 次原始 ZIP / JSON 回读及播放中跨轨另见[本版记录](verification.md)。

## 0.1.44：片段剪贴板的落点规则

[Logic Pro for Mac 官方说明](https://support.apple.com/guide/logicpro/cut-copy-and-paste-regions-lgcpf7c0d424/mac)将普通粘贴明确为：先选目标轨道，再移动播放头，最后粘贴；原位粘贴是单独命令。该页还指出裁剪后的 MIDI 源内容可受编辑设置影响。[Logic Pro for iPad 官方说明](https://support.apple.com/en-is/guide/logicpro-ipad/lpip6381dd59/ipados)明确多个片段保留相对位置；这里只作为规则参考，不宣称两个平台的所有细节相同。

本项目用可见的目标轨道与播放头作为普通粘贴入口，不引入隐藏的鼠标／标记编辑点模式。来源轨道的原始行差与相对拍数保留；最上来源行对齐目标首轨，后续不足则补建尾轨。这是本项目的明确选择，不是声称 Logic Pro 在所有多轨情况下都自动建轨。粘贴后主片段留在首轨，避免连续粘贴逐次向下偏移。

普通片段复制始终保留完整源及裁剪外内容，与本项目已有非破坏裁剪一致。已有轨道设置保持，新增轨道才带入来源设置。音符／片段使用同一组命令、不同编辑域；最新一次复制的类型明确显示，错误编辑域不会暗中粘贴另一类对象。[具体操作与数据边界](region-clipboard.md)。

## 0.1.46：播放头拆分与消息边界

[Ardour 编辑点说明](https://manual.ardour.org/editing-and-arranging/edit-point/)将拆分作为单时间点操作，可选鼠标、播放头或标记；[片段模型](https://manual.ardour.org/working-with-regions/)把位置、源偏移和范围分离。固定到同一 commit `fd4ef0523bff40d44f9d1ac66a3a5cbff269acc8`，另读了两份 GPL-2.0-or-later 源文件：

- [`MidiPlaylist::_split_region`，186–252 行](https://github.com/Ardour/ardour/blob/fd4ef0523bff40d44f9d1ac66a3a5cbff269acc8/libs/ardour/midi_playlist.cc#L186)检查覆盖与边界，用分点前后长度及继续的源偏移构造两段。
- [`Editor::split_regions_at`，269–354 行](https://github.com/Ardour/ardour/blob/fd4ef0523bff40d44f9d1ac66a3a5cbff269acc8/gtk2_ardour/editor_ops.cc#L269)把选区内覆盖分点的片段归入一次可撤销操作；[`split_region`，6847 行起](https://github.com/Ardour/ardour/blob/fd4ef0523bff40d44f9d1ac66a3a5cbff269acc8/gtk2_ardour/editor_ops.cc#L6847)先处理其它拖动、选择与编辑点，防止操作互相破坏。

文件分别为 15,804 / 237,150 字节，SHA256 `e088754662fe583a8bee9d39294d63f344a81d2a6fcf85ff62e1031577afbb8e` / `2e38ec630501cb7e9b2cfccab07de4eb0db0b8a165a3bed928cc96e1cb85fea7`；原始 URL、身份与职责见 `.local/region-split-ui/research/source.json`。只研究逻辑职责，没有复制第三方实现。

[2020-02-18 至 20 的官方社区讨论](https://discourse.ardour.org/t/join-two-regions/89545/18)区分片段边界与跨界长音，并记录旧版本在变速附近处理片段的困惑。[2023-01-04 的界面反馈](https://discourse.ardour.org/t/newbie-rant-about-ardours-gui/108150)要求导航、选择与修改一致，减少误编辑。这些是历史个案，不能当作当前版本缺陷或全体用户统计。

本项目选择始终在播放头拆显式选区，不引入隐藏编辑点模式或空选择时处理全部轨道的回退。保留长音与完整源，右段严格推进原偏移，切点附加消息只有一个归属。拆后选中右段、一次撤销；锁定、隐藏、过期和容量错误整体拒绝。Ctrl+T / Cmd+T 是可自定义的项目默认值。操作说明见 [片段拆分](region-splitting.md)。

## 0.1.48：轨道顺序与可恢复删除

[Ardour 的轨道排序说明](https://manual.ardour.org/working-with-tracks/controlling-track-ordering/)描述编辑器与混音器保持同一顺序，并提供上下移动操作。[添加／移除轨道说明](https://manual.ardour.org/working-with-tracks/adding-tracks-and-busses/)同时说明其移除限制。固定到同一 commit `fd4ef0523bff40d44f9d1ac66a3a5cbff269acc8`：

- [`RouteListBase::reordered`，443 行起](https://github.com/Ardour/ardour/blob/fd4ef0523bff40d44f9d1ac66a3a5cbff269acc8/gtk2_ardour/route_list_base.cc#L443)将列表排序同步到共享 presentation order；[785–875 行](https://github.com/Ardour/ardour/blob/fd4ef0523bff40d44f9d1ac66a3a5cbff269acc8/gtk2_ardour/route_list_base.cc#L785)集中更改与反向同步，并防止重排通知递归。
- [`Editor::_remove_tracks`，7899 行起](https://github.com/Ardour/ardour/blob/fd4ef0523bff40d44f9d1ac66a3a5cbff269acc8/gtk2_ardour/editor_ops.cc#L7899)先收集目标，再移除路由；代码中的不可撤销警告与资源生命周期有关。本项目已有完整工程快照历史，因此实现可撤销删除，没有移植其代码或不可撤销流程。

[2017-08-28 的官方社区讨论](https://discourse.ardour.org/t/why-is-track-deletion-not-part-of-undo-history/88782)记录误删轨道后无法恢复的困扰。这里只把它作为有日期的可用性线索，不声称是当前 Ardour 缺陷或全部用户的意见。

本项目据此保持唯一轨道顺序、清晰显示删除对象、整次提交与完整撤销。筛选后的相邻可见轨交换、隐藏槽位保持、MIDI 通道固定以及共享源清理，是本项目的数据约定。读取 GPL-2.0-or-later 源码仅用于理解职责，没有复制实现；固定原始 URL、文件和 SHA256 记录于 `.local/track-management-ui/research/source.json`。[操作说明](track-management.md)。

## 0.1.49：力度的相对调整与统一设置

[Ardour 力度手册](https://manual.ardour.org/editing-and-arranging/editing-midi/editing-velocity/)将多音符按共同数值相对调整，与其它力度绘制方式区分。固定 `fd4ef0523bff40d44f9d1ac66a3a5cbff269acc8`，[`MidiView::set_velocity`，4144–4167 行](https://github.com/Ardour/ardour/blob/fd4ef0523bff40d44f9d1ac66a3a5cbff269acc8/gtk2_ardour/midi_view.cc#L4144)由锚音的新旧差生成选区共同增量；[`change_note_velocity`，3919–3932 行](https://github.com/Ardour/ardour/blob/fd4ef0523bff40d44f9d1ac66a3a5cbff269acc8/gtk2_ardour/midi_view.cc#L3919)随后逐音限幅。另一路键盘／滚轮修改可在成员越界时拒绝整组，不能把两条路径混为一谈。[`VelocityDrag::finished`，7466–7475 行](https://github.com/Ardour/ardour/blob/fd4ef0523bff40d44f9d1ac66a3a5cbff269acc8/gtk2_ardour/editor_drag.cc#L7466)在实际移动后才提交。

[Qtractor](https://github.com/rncbc/qtractor) 固定 `10152b0c8be92e062163735919789a359c8761ee` 的 [`qtractorMidiEditor.cpp`，3514–3591 行](https://github.com/rncbc/qtractor/blob/10152b0c8be92e062163735919789a359c8761ee/src/qtractorMidiEditor.cpp#L3514)也有共同增量和逐音限幅；比例缩放是另外的路径。本项目借鉴相对增量职责，选择在边界夹取整个增量，以保持音符间力度差；这是本项目交互规则，不声称与上游拖动完全相同。源码只读研究，没有复制 GPL 实现。

[2023-10-13 的官方社区讨论](https://discourse.ardour.org/t/velocity-editing/109323)明确要求各音符一起增加同一数值，保留原动态；[2022-11-26 的另一讨论](https://discourse.ardour.org/t/changing-midi-velocities/107946)则要求统一力度。两者都是有日期的个人需求线索。因此本项目保留两种清楚的入口：力度区多选相对拖动，检查器统一设置。没有加入自由绘制力度曲线。

5 份固定 Git 源码与 7 份官方手册／社区原文、17 个代码职责摘录及哈希记录于 `.local/note-velocity-ui/research/source.json`。源码、手册行为、历史反馈和自主取舍分别记录，不能用一条帖子概括全体用户。[具体操作与验证边界](note-velocity.md)。

## 0.1.50：事务边界、取消与焦点交接

固定 Ardour `fd4ef0523bff40d44f9d1ac66a3a5cbff269acc8`，[`DragManager` 析构／abort](https://github.com/Ardour/ardour/blob/fd4ef0523bff40d44f9d1ac66a3a5cbff269acc8/gtk2_ardour/editor_drag.cc#L114)与 [`Drag::abort` 捕获及滚动清理](https://github.com/Ardour/ardour/blob/fd4ef0523bff40d44f9d1ac66a3a5cbff269acc8/gtk2_ardour/editor_drag.cc#L603)处理暂时状态；[音符拉长的开始／结束路径](https://github.com/Ardour/ardour/blob/fd4ef0523bff40d44f9d1ac66a3a5cbff269acc8/gtk2_ardour/editor_drag.cc#L2437)将一次手势归入可撤销命令。固定 Qtractor `10152b0c8be92e062163735919789a359c8761ee`，[`qtractorMidiEditor.cpp` 的拖动结束](https://github.com/rncbc/qtractor/blob/10152b0c8be92e062163735919789a359c8761ee/src/qtractorMidiEditor.cpp#L4295)为当前片段收集修改，[`qtractorMidiEditCommand.cpp` 构造](https://github.com/rncbc/qtractor/blob/10152b0c8be92e062163735919789a359c8761ee/src/qtractorMidiEditCommand.cpp#L36)保留目标片段。其通用 push／redo 顺序并不等于本项目所需的合法性预检，不能据此宣称上游会在所有非法修改前拒绝。

4 份固定源文件的 16 处职责、2 份官方／维护者页面及哈希记录于 `.local/note-edit-transaction-ui/research/source.json`。源码生命周期只读研究，没有复制实现；具体 schema、容量和工程身份票据是本项目规则。

[2023-10-01 至 02 的 Ardour 官方社区案例](https://discourse.ardour.org/t/new-arranger-in-ardour-8-is-awesome/109262)给出组合撤销遗漏被替换片段状态的复现，维护者随后明确诊断和修复；[Qtractor 2024-08-29 发布说明](https://www.rncbc.org/drupal/node/2634)记录 MIDI 编辑历史移到片段实例。这些是有日期的历史经验，不能称为当前版本仍有同样缺陷；本项目因此把完整历史快照、当前目标和失败时保留重做分别验收。

本项目的画布焦点交接另对照 [React `flushSync` 官方说明](https://react.dev/reference/react-dom/flushSync)：它可使浏览器事件回调内的更新先完成，但应谨慎使用，不在渲染或 effect 中调用。这里仅在手势入口确认输入和焦点后读取新快照，预览帧不反复同步冲刷。真实旧版草稿丢首点击与修复后的文件回读分别保留。[提交与手势规则](note-edit-transactions.md)。

## 独立界面夹具

入口：`.local/cross-track-ui/baseline.nbsx`；完整基准、各预期 JSON/ZIP 及实际操作建议列于 `.local/cross-track-ui/fixtures.json`。夹具含钢琴、贝斯、长笛三条未锁轨和一条锁定钟轨，四个内嵌合成 WAV、一个新生成的原始 MIDI 资产，无外部路径或用户文件。

源 region 的 start=480、offset=240、length=2880、loop=true，源周期 960；三音中一音显式指定长笛，另两音跟随轨道。附带 controller、SysEx 和 unknown-meta 消息，含嵌套数组；MIDI note-off 原路由为 0。另三轨各有独立守卫音，工程共六个源音符、四个 region，展开后十二次起音。

预期对象由 literal 字段修改独立构造，没有调用 `moveRegion`：跨到贝斯保持 start=480、跨轨并右移一格 start=600、下拉改到长笛、同轨右移，以及跨回后不复活旧路由。锁定落点、筛选后空白落点和取消使用完整原基准。JSON 全量比较仅允许保存时根 `modifiedAt` 改变，ZIP 本身的时间戳不作为语义判据。

夹具准备阶段完成了 NBSX 全量回读、五个资产字节/哈希核对与 MIDI 结构读取。随后实际界面完成拖动、轨道下拉、锁定／筛选拒绝、边缘滚动、撤销重做、实时播放与重开；12 份保存结果与 literal 预期完整比较，见[0.1.42 验收](verification.md)。主夹具的源 pattern 独用，共享 pattern 分离由单独的核心与 App 测试覆盖。
