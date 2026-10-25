# 平台验证状态

Windows x64 是当前分发与运行验收平台。经典和 Liquid Glass 共用 React / Electron 实现；macOS 的实际显示、输入、原生声音和文件生命周期仍待实机验证。

2026-10-24 在 Windows 主机准备了官方 Electron 45.0.0 Darwin arm64 压缩包，并按已安装 Electron 的校验清单核对 SHA-256：`896c3a50b148e89a158dca08a6996a022ddf39b23aac871e107f5b4087f8caa9`。Koffi 3.3.3 Darwin arm64 可选依赖按 package-lock 的 SHA-512 integrity 校验；这两项只证明输入身份。

实际尝试 electron-builder 26.15.3 的 macOS arm64 目录构建，工具在打包前拒绝：`Build for macOS is supported only on macOS`。失败记录保留于 `.local/macos-prototype/run-1792788808059/outcome.json`，没有形成可分发 Mac 应用。未绕过主机检查，也未将静态二进制检查算作运行验收。后续使用 [macOS 构建配置](https://www.electron.build/v26/docs/mac/) 在 Mac 主机验证。

下一阶段应在 Mac 主机安装本平台依赖并运行现有构建，分别检查 arm64 / x64 的 Electron、Koffi 与目标 Minecraft 原生库。早期客户端可能只提供 x64 Mac 库；应用资源加载会提示架构不匹配。缺少匹配原生库时，试听会要求加载资源或明确选择 Web Audio。

后续静态核对修复了 LWJGL 2 Intel Mac 资源查找：遵守官方 `natives-osx` 映射并识别 `openal.dylib`，同时保留 1.12.2 的 Mac 专用依赖覆盖。103 个正式版、51 个不同原生压缩包的身份和实际 CPU 架构均通过检查；旧版 Intel 包不会用于 ARM64 应用。详见[原生库清单](native-archive-census.md)。这项修复与静态文件检查没有改变上面的 Mac 构建/实机验收状态。

Mac 签名、公证、安装和真实设备声音均未验收；当前 `package:mac` 命令不是支持已完成的标记。
