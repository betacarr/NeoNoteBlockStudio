# NBS 互通审计

本轮修复实际音色身份和可听轨道的互通错误，范围限于 NBS 导入、按当前混音生成 NBS 的导出及转换提示，不改变公共音频实现。

该轮互通报告保留当时的源码哈希；后续 Tempo Changer 零值与 NBSX 可保存范围修复另见 [功能事件边界](nbs-functional-events.md)，其独立报告绑定后续实现，没有重跑或覆盖这里的 21 例历史产物。

## 已修复的问题

- 来源文件的自定义音色索引属于来源内置表。原实现将来源索引 10 或 16 当作新目标的内置音色，跨版本导出后丢掉自定义定义。现在按真实内置 ID 分配目标索引，自定义音色独立编号，来源索引仍在工程中保留。v6 的四种铜管内置音色仍保持内置；导出 v4/v5 时按已有策略转为自定义。
- v4+ 层状态 2 是独奏。此前把它当作布尔编辑锁，导致其他轨道继续发声。现在状态 2 映射为独奏，状态 1 按 OpenNBS 实际播放代码同时映射为锁定和静音。编辑器自己设置的轨道锁仍只限制编辑，不自动静音。导入会说明这项来源差别；未知状态 3/255 明确拒绝。
- 原导出允许小于 0.01 tick/s 的正数，0.004 舍入后写出零速度，产生无法重新导入的文件。现在写入前验证可表示范围。
- 导出继续按当前试听混音生成音符。转换报告明确提示静音/非独奏轨道未写入、NBSX 仍保留完整内容；原 NBS 整曲循环不写入时也明确提示，避免静默省略。
- 已使用的目标内置音色若关联工程采样，导出仍保留内置身份，并明确提示接收端使用 NBS 内置采样、替换采样留在 NBSX；需要传递替换声音时应使用自定义乐器并提供声音文件。不区分关联资产是否与原采样相同，提示仅说明格式实际传递的内容。未使用、静音轨道中的关联不会触发这项提示；v6 铜管导出旧目标时已经转为自定义，因此不误报为丢失的内置关联。

## 独立核对与结果

[互通报告](verification.md) 将修复前的完整提交 `894a00207e35e169a91d9bc393ffb71d63f78d61` 与当前实现分别打包，读取同一组独立二进制文件。v0～v6 共七种来源分别导出 v4/v5/v6，共 21 例；修复前 12 例丢失自定义身份，修复后全部保留。独立读回核对目标音符索引、自定义定义、采样根音和工程重新导入结果。独立写出的独奏/锁定文件也验证了修复前多发音符与修复后可听集合，所有原音符仍保留在工程中。

来源依据为 [OpenNBS 官方格式](https://noteblock.studio/nbs)、[OpenNBS nbs.js](https://github.com/OpenNBS/nbs.js) 的本机 `@nbsjs/core` 6.1.0，以及原应用开发分支固定提交 `7dd79ecb313d981c12bc4b69ad13201c4995a3ae`：

- [读取代码](https://github.com/OpenNBS/NoteBlockStudio/blob/7dd79ecb313d981c12bc4b69ad13201c4995a3ae/scripts/open_song_nbs/open_song_nbs.gml) 和 [保存代码](https://github.com/OpenNBS/NoteBlockStudio/blob/7dd79ecb313d981c12bc4b69ad13201c4995a3ae/scripts/save_song/save_song.gml) 证明来源/目标自定义边界及层状态字节。
- [层独奏状态](https://github.com/OpenNBS/NoteBlockStudio/blob/7dd79ecb313d981c12bc4b69ad13201c4995a3ae/scripts/add_layer/add_layer.gml) 与 [实际播放筛选](https://github.com/OpenNBS/NoteBlockStudio/blob/7dd79ecb313d981c12bc4b69ad13201c4995a3ae/scripts/control_step/control_step.gml) 证明状态 2 的独奏集合和状态 1 的静音行为。后者也给出 Tempo Changer 的绝对 fine pitch / 15 规则。
- [原自定义音高计算](https://github.com/OpenNBS/NoteBlockStudio/blob/7dd79ecb313d981c12bc4b69ad13201c4995a3ae/scripts/play_sound/play_sound.gml) 与转换后的 MIDI 根音核对。

报告包含原来源提交、Git blob、SHA-256 与 ignored 原始快照路径，不将整段原源码放入公开证据。`@nbsjs/core` 6.1.0 的 writer 总是写 20 项内置表，reader 也忽略来源内置数；因此旧版本文件按官方格式独立编码，独立 reader 只用于核对原始音符索引和自定义定义列表，不用其错误的旧版自定义索引查找结果证明互通。

针对性测试还覆盖自定义 key 0/24/45/57/87、fine pitch、同轨单音符音色覆盖、v6 铜管身份、层与音符音量/声像，以及 Tempo Changer 转为固定速度导出时的真实起音秒数和目标 tick。追加的内置采样关联测试覆盖三个目标版本的原始索引/定义、工程不变性、单音符覆盖、未使用/静音过滤和铜管旧目标转换；独立报告也保存三个实际导出文件及提示。NBS/core/MIDI 共 86 项通过，类型检查通过。转换诊断由现有导出预览直接显示，无需另改界面。

## 重现与限制

首次准备官方源码缓存：

```powershell
git clone --filter=blob:none --no-checkout --depth 1 --single-branch --branch development https://github.com/OpenNBS/NoteBlockStudio.git .research/nbs-interop/upstream
```

审计脚本要求缓存中含上述固定提交；若上游分支前移，可在同一官方仓库获取该提交。然后运行：

```powershell
npx vitest run tests/nbs-interop.test.ts tests/core.test.ts tests/midi.test.ts
npx tsc --noEmit
node scripts/audit-nbs-interop.mjs --write-evidence
```

原始报告与所有二进制 fixture 每次写入新的 `.local/nbs-interop/run-*/` 目录。公开报告的 `output` 指向本次实际路径，保留修复前/后产物。

本轮没有认证所有 Unicode/旧文本编码、所有元数据、其他功能音色事件或整曲循环自动转换。NBS 导出仍是按当前可听混音和选定固定速度生成的转换文件，完整可编辑内容应保存为 NBSX。没有新增 Minecraft 世界录音或 PCM 声音一致性声明。
