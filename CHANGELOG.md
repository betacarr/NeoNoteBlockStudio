# 更新记录

## 0.1.56 — 2026-10-27，macOS 适配

- 增加 macOS 应用菜单、关于、设置、服务、隐藏、窗口管理和关闭窗口快捷键，保留 Command 编辑键及可自定义操作。
- 修复关闭最后一个窗口后，从 Finder、Dock 或系统菜单重新打开编辑器／工程的流程。
- 区分关闭窗口与退出应用；取消退出或取消保存均保留工程，保存并退出会完成写入后结束进程。
- 提供独立 Apple Silicon（arm64）与 Intel（x64）DMG／ZIP 构建，使用原创 ICNS 图标，保留原应用标识、工程关联与旧资料目录兼容。
- 按目标架构分别校验 Electron 和原生音频桥接组件，补齐 Electron／Chromium 许可、签名检查与 SHA-256 发布校验。
- macOS 构建采用本地临时签名（ad-hoc），未进行 Apple Developer ID 签名或公证。安装与验证范围见 [macOS 说明](docs/macos.md)。

## 0.1.55 — 2026-10-26，Windows 安装发布

- 首次提供 NeoNBS Windows x64 安装版与便携版，统一程序名称、图标和 NBSX 工程关联。
- 包含 MIDI／NBS 互通、支持范围内的 FLP 导入、编曲与钢琴卷帘编辑、实时混音和可导出的 Delay 回声。
- 更新安装步骤与图文操作指南；整理分发文件、第三方许可和下载校验值。
- 游戏声音从使用者自己的本机安装读取，安装包不包含 Minecraft 游戏文件、原版声音或贴图。

详细操作见 [图文上手](docs/quick-start.md)，本版检查范围见 [发布验证](docs/verification.md)。
