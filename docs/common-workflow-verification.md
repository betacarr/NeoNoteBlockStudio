# 常用功能与完整曲目预览验收

2026-10-27 对 0.1.56 实际 macOS 分发程序补充检查。使用内置《玻璃庭院》和 Open Note Block Studio 官方仓库随附的《Turkish March》（Mozart，音符盒改编 chenxi050402）。

测试素材固定到 [OpenNBS 提交 79b22ad](https://github.com/OpenNBS/NoteBlockStudio/tree/79b22ad890631a39196d45b9c27881599f9b04ab/datafiles)，逐文件 SHA-256 见 [素材清单](../tests/fixtures/common-assets.json)。歌曲与音色仅下载到忽略的本地测试目录，不随源码或安装包重新分发。

Apple Silicon arm64 原生运行与 Intel x64 经 Rosetta 运行均通过 11 组工作流检查，各产生 7 段可校验的立体声 PCM 输出、完成 3 种格式导出，未记录渲染器异常。另一个 NBS 边界检查脚本在两个架构均通过三次有效导入和两次无效输入拒绝检查。

## 实际检查

- 内置工程显示四轨、四个片段、48 个源音符。缺少游戏资源时，播放会明确提示缺少采样；通过界面的「定位／替换乐器采样」加载本地测试音色后，预览产生真实立体声 PCM，混音器总输出显示非零实际电平。
- 播放、暂停、继续、停止归零、前后小节、鼠标标尺定位、变速与循环边界检查通过。暂停后位置保持且音频归零；循环实际越过结尾回到开头。
- 总音量调到零以及播放中静音所有轨道，均测得零输出；恢复音量或取消静音后恢复非零输出。
- 对当前钢琴片段执行全选、独立复制、撤销和重做，逐次保存并读回真实 NBSX，核对音符及恢复后的片段数据。
- 从实际导出对话框导出 WAV，检查有效 RIFF／PCM 和非零音频数据。
- 官方《Turkish March》通过实际打开流程导入：39 轨、5838 个音符，加载配套音色后可预览；保存的工程嵌入所用音色，重开后数据一致且可继续播放。
- NBS 导出由独立的 `@nbsjs/core` 读取，保留全部 5838 个音符；导出的 NBS 可再次打开并保存。
- 原曲含 534 个零力度静音音符。MIDI 按格式语义导出 5304 个有效发音音符；用独立 NBS 读取器与 MIDI 解析器逐一比较起音刻度、音高、力度，结果一致。零力度音符仍保存在 NBSX／NBS 中；这不是有效发音音符丢失。
- 另行检查了三次有效 NBS 变速导入、两次无效速度拒绝、五次工程保存读回及三次界面重开。无效导入保留原工程内容。

音频检查从应用真实 Web Audio 输出图采集 PCM，保留原有播放链路；不是替换成测试音频结果。物理扬声器／耳机、麦克风回录、主观听感、硬件 MIDI 以及游戏内录音一致性不在本次测量范围。文件选择器返回值指定到测试目录，其余操作使用实际程序控件、菜单与文件读写。

MIDI 的音符盒单音符音色覆盖、空间参数等转换边界仍以导出对话框提示为准；上述起音／音高／力度比对不代表通用 MIDI 接收器能还原音符盒音色。

## 复现

在仓库根目录使用受支持的 Node.js，先准备固定素材，再运行：

```sh
node scripts/prepare-common-test-assets.mjs
node scripts/smoke-common-workflows.mjs --packaged release/0.1.56/mac-arm64/NeoNBS.app/Contents/MacOS/NeoNBS
node scripts/smoke-nbs-desktop.mjs --packaged release/0.1.56/mac-arm64/NeoNBS.app/Contents/MacOS/NeoNBS
```

Intel 构建的目录为 `release/0.1.56/mac/`。每次检查创建独立资料目录；报告、截图、保存／导出文件及输出片段留在 `.local/common-workflows/` 和 `.local/nbs-desktop/`，不接触日常工程。音色来源与完整性清单记录在本机缓存的 `manifest.json` 中。

发行包原有平台、签名和最低系统要求检查见 [发布验证](verification.md)。
