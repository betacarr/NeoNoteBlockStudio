# Liquid Glass

在“设置 → 外观”中可即时切换三种样式，选择只保存在当前设备：

- **经典**：默认样式。
- **Liquid Glass · 跨平台**：由浏览器合成顶部控制栏、菜单、Logic 右键菜单、顶部按钮提示和底部状态消息的玻璃。自动模式会在减少动态、减少透明度、高对比度、不支持背景滤镜或低性能设备上关闭折射；也可以手动选纯色。
- **Liquid Glass · macOS 原生**：macOS 26 或更新版本的 Electron 桌面应用才可选。顶部控制栏使用 Apple 的 `NSGlassEffectView`；菜单、时间轴和编辑器仍按应用原有样式绘制。保存的原生偏好在不支持的环境下按跨平台样式显示。

## 跨平台实现

[liquid-glass-react](https://github.com/rdev/liquid-glass-react) 的 SVG RGB 分离和鼠标高光被移植到现有玻璃层。三个色彩通道共享一张位移贴图，边缘折射量略有差异，中心保持对齐。高光跟随指针，用 CSS 更新，不触发贴图生成。上游 MIT 许可见 `THIRD_PARTY_NOTICES.md`。

位移几何继续沿用 [OpenNBS/NoteBlockStudio v3.12.0-beta.6](https://github.com/OpenNBS/NoteBlockStudio/releases/tag/v3.12.0-beta.6) 的四阶连续圆角和双折射带；[shuding/liquid-glass](https://github.com/shuding/liquid-glass) 是现有 SVG 集成的来源。保留的上游源文件与许可见 `third_party/noteblockstudio-glass/` 和 `third_party/liquid-glass/`。

SVG 背景滤镜只采样应用内像素。文字、图标与输入目标另绘；贴图只随尺寸变动而生成，每张最多 96,000 像素，缓存最多 24 张。Windows 和 macOS 桌面版使用同一套 Chromium 合成逻辑；浏览器支持范围取决于其 SVG 背景滤镜实现。

## macOS 原生实现

主进程用 Electron 的 `getNativeWindowHandle()` 定位窗口内容视图，通过已有的 Koffi 调用公开的 AppKit API，把 [`NSGlassEffectView`](https://developer.apple.com/documentation/appkit/nsglasseffectview) 放在 Chromium 视图后方。网页只为控制栏留出透明背景；可点击的按钮、输入框和无障碍语义继续由网页处理。原生类不存在时不加载玻璃，切换样式、重新导航和渲染器退出时移除原生层。这个接口不需要 Xcode 26 SDK 或新增本地二进制，也不采集屏幕图像。

`node scripts/smoke-liquid-glass.mjs` 验证浏览器光学、菜单、键盘、播放和回退；其像素检查需要 Python 和 Pillow。`node scripts/smoke-native-glass.mjs` 检查真实 AppKit 视图、交互、缩放、重载、清理及不支持平台的回退。
