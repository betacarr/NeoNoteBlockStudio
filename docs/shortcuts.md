# 快捷键配置

在“设置 → 操作与快捷键”中选择 FL、Logic 或 NBS 基础预设。新安装默认 FL。可修改播放、撤销、重做、独立复制、在播放头拆分片段、绘制、选择、擦除、混音器、量化、上移当前轨道、下移当前轨道和删除当前轨道这十三项操作。拆分默认 Ctrl+T（macOS 为 Cmd+T）；三个轨道整理命令默认没有快捷键，可自行配置，不复用删除音符／片段的 Delete。

修改只进入草稿；“应用快捷键”在全部按键校验通过后一次生效。留空可停用某项操作的额外绑定；全局 Space / Shift+Space 始终用于播放。“恢复预设”清除当前草稿的自定义项，仍需点击应用。“撤销更改”返回已应用的配置。关闭设置会放弃未应用草稿。

## 导入和导出

“导出已应用配置”保存独立 JSON，不再导出外观、吸附、显示面板等偏好。在桌面程序中会选择保存位置；网页版使用浏览器下载。即使有未应用草稿，导出的仍是已生效配置。

```json
{
  "format": "nbsx-shortcuts",
  "version": 1,
  "preset": "fl",
  "shortcuts": {
    "duplicate": "Ctrl+Shift+B",
    "erase": ""
  }
}
```

`shortcuts` 保存自定义覆盖项，缺少的命令使用预设。预设名只允许 `fl`、`logic`、`nbs`。可自定义的命令名为 `play`、`undo`、`redo`、`duplicate`、`split-region`、`draw`、`select`、`erase`、`mixer`、`quantize`、`track-up`、`track-down`、`delete-track`。

导入限制为 64 KiB。文件会先完整检查格式版本、预设、命令、按键文本和合并预设后的冲突，全部通过后一次应用。任何错误都会保留当前配置和草稿，不会先应用一部分。新格式中的未知字段也会拒绝。

兼容以前误导出的完整 Preferences JSON：仅取其中的 `preset` 和 `shortcuts`，其余字段忽略。旧文件同样必须通过所有快捷键校验；不会改变当前外观、吸附、时值或面板显示。

## 按键与平台

- 修饰键顺序与大小写不敏感，例如 `shift+command+z` 规范为 `Ctrl+Shift+Z`。
- 配置中的 `Ctrl`、`Control`、`Cmd`、`Command`、`Meta`、`Mod`、`CmdOrCtrl` 都指跨平台的主命令键：Windows/Linux 为 Control，macOS 为 Command。菜单在 macOS 显示 `Cmd`。macOS 物理 Control 不代替 Command，也不能另行映射为编辑器修饰键。
- `Alt` 与 `Option` 等价。支持字母、数字、F1–F24、Space、方向键、Home/End、PageUp/PageDown、Insert/Delete/Backspace、Enter、Tab 和常见标点。
- 数字和标点按主键盘基础键位匹配：`Shift+1` 对应数字 1 键加 Shift（通常输入 `!`），`Ctrl+Shift+/` 对应问号组合；不写变化后的字符。`Plus` 是 `Shift+=` 的别名，也接受数字小键盘的加号；裸 `=` 与加号组合不同。除 `Plus` 这个别名外，Shift 必须显式列出。非美式布局也按这些基础键位匹配数字和标点。
- macOS 的 FL/NBS 默认量化使用 `Alt+Q`，避开系统退出程序的 `Cmd+Q`；Windows/Linux 保留 `Ctrl+Q`。

钢琴卷帘的鼠标框选独立于上述键盘配置：Ctrl / Cmd＋左键拖动替换选择，Shift＋左键或 Ctrl / Cmd＋Shift＋左键追加选择；从音符主体、右边缘和空白处都可开始。这里 macOS 物理 Control 也可用于框选。Ctrl / Cmd 滚轮仍用于缩放。

固定文件操作 `Ctrl+N/O/S/Shift+S` 与桌面原生菜单一致。复制、剪切、粘贴、全选、Delete/Backspace 删除、左右方向键按网格移动／Shift+左右按四分拍移动、上下方向键半音／Shift+上下八度移调，以及对话框、焦点导航和原生系统菜单保留键不能分配给其他命令。设置页会列出当前平台的固定映射，冲突项显示具体命令并禁止应用或导入。以前已保存的歧义绑定也不会按“第一个匹配”执行；相关自定义命令停用，进入设置后可修复。

复制／剪切／粘贴和全选按当前编曲区或钢琴区处理片段或音符；输入框保留正常文本操作。仅钢琴区有效已选音符响应方向键编辑，锁定时拒绝修改；编曲区 Delete 删除片段选区，“删除当前轨道”是独立命令。具体范围见[片段多选](arrangement-groups.md)、[片段剪贴板](region-clipboard.md)与[轨道整理](track-management.md)。

Space / Shift+Space 固定优先切换播放 / 暂停，在文字与数字输入、下拉框、按钮、复选框、滑块、菜单和设置等弹窗中同样生效。按下与松开均拦截控件默认行为，不再代替点击或输入空格；按住时的系统重复不会反复切换播放。可另设播放快捷键，但不能把这两个空格组合分配给其他命令，清空额外播放绑定也不会停用它们。

其他文字、数字、下拉框和可编辑内容中的按键保留给控件，不操作音符；输入法组合输入、AltGr 与 Ctrl/Command/Alt 参与的系统组合不被全局空格接管。设置等对话框打开时，编辑命令也不会通过桌面菜单作用于背后的工程。原生菜单的复制/粘贴等文本命令会交给当前文本控件。焦点按钮的 Enter 和滚动条导航键保留其正常作用。

电脑键盘演奏或录入开启时，`Z S X D C V G B H N J M`（含 Shift）优先作为音符键，相关单字母工具键暂不执行。用户另设的系统全局快捷键、浏览器自身拦截的快捷键不在应用内冲突检测范围。

## 验证

`npx vitest run tests/shortcuts.test.ts` 检查三预设、平台映射、重复与固定键冲突、独立格式、旧导出兼容、无效文件和 UTF-8 大小限制。

真实 Edge 浏览器通过 CUA 验证了：重复/固定键错误禁止应用、有效别名规范化、新格式导入、无效导入保持原配置、旧 Preferences 导入不改变外观、菜单提示随映射更新、关闭设置丢弃未应用草稿，以及搜索输入不触发工具/混音器/音符删除。`Ctrl+Shift+M`、`Shift+1`、`Ctrl+Shift+/`、`Plus`（`Shift+=`）均实测触发混音器。macOS 的映射通过单元测试验证，尚未在 macOS 桌面实机验收。

`node scripts/smoke-shortcuts.mjs` 使用独立桌面配置目录检查原生菜单的对话框保护、正常复制/撤销，以及独立 JSON 的原生保存桥接。另并发调用四次真实 `discoverMinecraft`，断言每次返回的根目录唯一，并确认没有 React 重复 key 警告。脚本不合成键盘或鼠标输入。最近通过的归档为 `.local/shortcut-desktop/run-1792785100341/report.json`。
