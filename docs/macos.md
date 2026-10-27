# macOS 安装、构建与支持范围

0.1.59 将 macOS 适配与官方采样、运行日志合并，提供两个独立架构的构建，要求 macOS 13 或更高版本：

- Apple Silicon（M 系列）：`NeoNBS-0.1.59-mac-arm64.dmg`，或同名 `.zip`。
- Intel：`NeoNBS-0.1.59-mac-x64.dmg`，或同名 `.zip`。
- `SHA256SUMS.txt` 用于核对分发文件，`release-audit.json` 记录架构、许可与内容检查结果。

构建产物位于本机仓库的 `release/0.1.59/`。制作本地分发包不会自动上传 GitHub、创建远程标签或覆盖已发布版本。实际发布状态以下载页为准，历史适配验收与合并版本验收分别记录。

## 安装

打开对应架构的 DMG，把 NeoNBS 拖到「应用程序」，推出磁盘映像后启动应用。ZIP 解压后也可把 NeoNBS.app 拖到「应用程序」。不要从磁盘映像中长期运行。

本版使用 ad-hoc 本地临时签名，尚未使用 Apple Developer ID 签名和公证。联网下载的文件可能被 Gatekeeper 阻止；确认来源与 SHA-256 后，按 macOS 的「系统设置 → 隐私与安全性 → 仍要打开」流程处理。不要关闭系统整体安全检查。

应用包含 Electron、Chromium 和原生桥接组件；普通启动无需 Node.js 或 JDK。部分历史游戏版本的 JOrbis 解码需要可用 Java 运行环境。设置和恢复数据继续兼容原应用标识与旧 `EX NoteBlock Studio` 资料目录。

## macOS 操作

- Command 是编辑主命令键；菜单按平台显示 `Cmd`。
- `Cmd+N/O/S` 新建、打开、保存，`Cmd+Shift+S` 另存为，`Cmd+,` 打开设置。
- `Cmd+W` 关闭窗口，应用继续保留在 Dock；点击 Dock 或打开 NBSX 文件可重新显示编辑器。
- `Cmd+Q` 退出整个应用。有未保存修改时，可保存、取消或放弃；取消保存文件选择器也会保留工程。
- 应用菜单提供关于、服务、隐藏；窗口菜单提供最小化与缩放。系统按键不可重新分配给编辑器操作。
- FL／NBS 默认量化为 `Option+Q`，避开系统 `Cmd+Q`；其余预设沿用现有设置。详见 [快捷键](shortcuts.md)。

默认试听内置 20 种 Minecraft Java 26.3 官方原始采样，保留原始振幅，无需安装游戏或 Java。需要校对特定版本时，默认发现 `~/Library/Application Support/minecraft`；其他启动器实例可在「设置 → 声音与资源」手动选择。匹配版本的资源从使用者自己的安装读取，分发包不包含游戏代码或原生声音库。旧游戏版本可能没有 ARM64 原生 OpenAL／STB；这种情况下会明确提示，可使用匹配架构环境，或选择 Web Audio 实时试听。

## 从源码构建

需要 Git、Node.js 24 或 26+、JDK 9+，在 macOS 上运行：

```sh
npm ci
npm test
npm run package:mac
node scripts/verify-mac-release.mjs
```

`npm run package:mac:arm64` 与 `npm run package:mac:x64` 分别只生成一个架构。打包脚本按目标架构下载官方 Electron，并用官方 SHA-256 校验；原生音频桥接包按锁文件的 SHA-512 完整性校验，避免把主机架构的二进制误标成另一个版本。构建不会切换开发环境使用的 Electron。

`verify-mac-release.mjs` 依次检查两个实际打包程序的 Mac 窗口与 Command 操作、20 种默认音色、日志导出、工程生命周期、MIDI 与 NBS 工作流，最后重新审查分发内容。检查使用隔离资料目录。详细报告留在忽略的 `.local/` 内；`release/0.1.59/macos-verification.json` 仅含版本、源码提交、固定检查名称和分发文件校验值，便于反馈构建结果。该命令要求两个架构都能在本机运行；Apple Silicon 上的 Intel 检查需要已安装 Rosetta。

发布检查确认 NBSX 关联、版本、最低系统要求、图标、许可证、Java 适配器、主程序／原生组件架构和代码签名，并扫描开发路径与非公开素材。DMG、ZIP 均保留文件权限与符号链接。当前配置明确采用 ad-hoc 签名；正式 Developer ID 公证发布需要另行配置证书和公证凭据。

可用 `npm run test:mac -- --packaged <NeoNBS.app/Contents/MacOS/NeoNBS>` 对实际打包程序运行 macOS 工作流检查。`npm run test:lifecycle -- --packaged <程序路径>` 检查工程恢复与单实例转交；`node scripts/smoke-midi-desktop.mjs --packaged <程序路径>` 检查 MIDI 工程的保存、编辑、历史记录和进程重启。每次检查使用独立资料目录，不接触日常工程。

实际验收结果与边界记录在 [发布验证](verification.md)。Intel 包在 Apple Silicon 上通过 Rosetta 的结果不能代替物理 Intel Mac 的硬件音频／MIDI 验收，最低系统版本声明也不代表所有 macOS 版本均已实机测试。
