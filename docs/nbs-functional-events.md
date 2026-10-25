# NBS Tempo Changer 的功能事件边界

本轮发现并修复两项导入问题，不改变工程时间模型、共同音频实现或其他功能音色的执行方式。

第一项是零值事件被静默跳过。以 10 tick/s 文件为例，tick 4 的 Tempo Changer fine pitch 为 0，tick 8 有普通音符：原 OpenNBS 的速度计算结果为 0，正常播放游标停在该列，后续音符不会自动触达；旧转换忽略零值，tick 8 仍在 0.8 秒发声，同时提示事件已转换。现在导入明确拒绝最终生效的零值事件，错误给出 tick、0 BPM 及当前模型限制，避免编造后续起音。

第二项是原应用允许的高速度无法作为有效 NBSX 保存。原 Tempo Changer 对话框接受整数 1～32767 BPM；12000 是实际可输入的值。旧导入生成 12000 BPM 工程，而现有 NBSX 校验上限为 10000，保存时就会被校验拒绝，也不能作为有效工程重新打开。现在对最终生效且超过 10000 BPM 的事件拒绝转换，并显示位置、实际值和上限。没有截断速度或改写起音。

## 已确认的顺序

来源固定为 OpenNBS 开发提交 `7dd79ecb313d981c12bc4b69ad13201c4995a3ae`。

- [播放循环](https://github.com/OpenNBS/NoteBlockStudio/blob/7dd79ecb313d981c12bc4b69ad13201c4995a3ae/scripts/control_step/control_step.gml) 按列、按层从上到下执行。Tempo Changer 分支在普通音符的可听条件之前，所以静音层、非独奏层、层音量零或事件力度零都不阻止速度事件；负 fine pitch 使用绝对值。现转换保留这些行为。
- [速度表构建](https://github.com/OpenNBS/NoteBlockStudio/blob/7dd79ecb313d981c12bc4b69ad13201c4995a3ae/scripts/update_tempo_changes/update_tempo_changes.gml) 同样让同列最后一层事件生效。导入先归并最终事件再校验：零值或高值被同列后续的合法事件覆盖时继续接受；最后是零值时明确拒绝。tick 0 的事件可以替换文件头速度。
- [开始播放](https://github.com/OpenNBS/NoteBlockStudio/blob/7dd79ecb313d981c12bc4b69ad13201c4995a3ae/scripts/toggle_playing/toggle_playing.gml) 及 [游标推进](https://github.com/OpenNBS/NoteBlockStudio/blob/7dd79ecb313d981c12bc4b69ad13201c4995a3ae/scripts/control_draw/control_draw.gml) 支持零速度停住的解释。外部跳转、重新设速可以恢复；本轮没有将这些交互转成自动曲线。
- [旧格式读取](https://github.com/OpenNBS/NoteBlockStudio/blob/7dd79ecb313d981c12bc4b69ad13201c4995a3ae/scripts/open_song_nbs/open_song_nbs.gml) 在 v0～v3 没有 fine pitch 字段时使用零。不能把测试构造器传入但未写入文件的非零值当作可恢复数据。对应文件若被解析为 Tempo Changer，会给出明确错误。固定原应用的 v0 loader 另有旧十项内置表的自定义索引未重映射问题，因此 v0 案例只证明字段缺失和本转换器的边界，不声称原应用将该旧自定义索引识别为 Tempo Changer。
- [原事件对话框校验](https://github.com/OpenNBS/NoteBlockStudio/blob/7dd79ecb313d981c12bc4b69ad13201c4995a3ae/scripts/draw_window_edit_tempo_changer/draw_window_edit_tempo_changer.gml) 区分可达控制域：12000 属于接受域，零/负值属于二进制文件可表达或通用 fine pitch 编辑输入，不能称作该对话框接受的参数。

## 验证与重现

[独立报告](verification.md) 保存修复前提交 `f26fcc6c14661c04f6706f2ac64364654988693c` 的 NBS 模块及当前模块，分别读取同一组 37 份独立编码 fixture。26 项可转换行为的速度表、可听起音和固定 20 tick/s 导出结果一致；11 项明确边界拒绝，覆盖零值、同 tick 最后零值、旧格式字段缺失，以及 10001/12000/32767/-32768。独立 `@nbsjs/core` 仅核对生成的 v6 普通固定网格文件，不用于解释它未实现的 Tempo Changer。

23 项新增针对性测试通过；加上现有 NBS/core/MIDI 测试，共 109 项通过，类型检查通过。测试同时断言合法转换工程能通过现有 `validateProject`，不会生成已知无法重开的速度事件。fine pitch 为 1、-1、10000、-10000 的可表达边界保留，速度取绝对值，未经钳制。

```powershell
npx vitest run tests/nbs-functional-events.test.ts tests/nbs-interop.test.ts tests/core.test.ts tests/midi.test.ts
npx tsc --noEmit
node scripts/audit-nbs-functional-events.mjs --write-evidence
```

源码缓存沿用 [NBS 互通审计](nbs-interop-audit.md) 的官方固定提交。每次审计生成新的 `.local/nbs-functional-events/run-*/report.json`，保留 fixture、修复前后 bundle、导出文件和原 GML 快照；公开报告仅记录来源身份、哈希、路径与独立解释。

这里的起音期望是按已核对的原代码顺序和公式独立编写的模型，并未执行原 GameMaker 应用。没有新增原版应用手势、世界录音、PCM 或帧调度一致性声明；整曲循环、外部跳转、动态改速及 Sound Stopper 等其他功能音色不在本次修复范围。
