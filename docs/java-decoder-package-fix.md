# 原版客户端内嵌 JOrbis：Java helper 默认包签名冲突修复

0.1.21 首个实包在 Java 1.0、1.1、1.2.1–1.2.5 的资源加载之后，调用原客户端内嵌 `CodecJOrbis` 解码时失败。原始 `.local/world-profile-desktop/run-1.0-RaufuD/report.json` 的 utility worker 完整 traffic 显示：`CodecJOrbis.initialize` 进入原默认包类 `me` 时，`ClassLoader.checkCerts` 抛出 `signer information does not match signer information of other classes in the same package`。这是 decoder 初始化失败；桌面等待播放状态随后超时是后果，不能据此判断 OpenAL 不支持。

产品助手 `NbsxVorbisDecoder` 原来位于 default package，且无原客户端的签名；这些旧客户端的相关原类也在默认包。研究 probe 采用了具名包，因此其既有原类数值结果没有覆盖到这一产品助手冲突。此次使用原客户端、相同依赖和旧助手实际重现了七版失败，再以具名包助手对照成功。

## 最小产品修改

| 文件 | 修改 |
| --- | --- |
| [NbsxVorbisDecoder.java](../electron/java/NbsxVorbisDecoder.java) | 仅加入 `package studio.nbsx.audio;`，源文件路径不变；测试逐字节比较剥去该声明后的 Java 源码与修复前备份相同。 |
| [java-decoder.ts](../electron/java-decoder.ts) | Java 启动类改为 `studio.nbsx.audio.NbsxVorbisDecoder`，保留原 classpath 根、codec kind、临时文件、PCM 协议和错误处理。 |
| [build-electron.mjs](../scripts/build-electron.mjs) | 继续使用 `javac --release 8 -d dist-electron/java`；只删除旧 `NbsxVorbisDecoder.class` 及其 `$inner.class` 残留，编译后检查新具名包产物存在。 |

新 class 产物为 `dist-electron/java/studio/nbsx/audio/NbsxVorbisDecoder.class`，而 classpath 根仍是 `dist-electron/java`。现有 ASAR unpack 的递归 glob 已覆盖新目录，因此不需要改变 main/preload 授权接口、应用包配置或依赖。原客户端、签名和 codec artifact 均未修改，未设置绕过签名校验的 JVM 参数。

新 class 的 SHA-256 为 `8dd05d286a72e021e84f6c3374a4e323e56751d660a05f019c13b722318111b6`；major version 为 52（Java 8）。三个产品源文件最终 SHA 为：

```text
Java:  0b3a3bad9cc35861a250fce208c736d6b5e82db1b8bde08bef39cc35ffcada80
TS:    e1f5c4c40feb220b3c8697e5aea32c4a2c3d48ebc1ddb8b49547092cc77b00b6
build: 05bdac1b37f3f7d3d33c2d8b0b34174e382e014416f12f30c0ab1b1fd9dcf8be
```

## 定向真实回归

[test-java-decoder-package.mjs](../scripts/test-java-decoder-package.mjs) 打包并调用实际产品 `decodeJavaVorbis()`、实际资源加载与 codec 选择函数；客户端身份与依赖通过现有官方 catalog 的 SHA-1 复核。测试捕获每个真实 Java 子进程的 PID、参数、完整 stdout/stderr、终态及 `NBSJ` 产物；不启动游戏或 OpenAL，不执行旧研究 Java probe。

最终执行目录为 `.local/java-decoder-package-fix/run-1792812435200`，Node PID **67416**，实际 terminal **exit 0 / signal null**；20 个 Java 子进程全部到达终态，其中 13 个成功、7 个为预期的旧助手签名冲突失败。159 项输入闭包在测试前后逐项复核相同 hash。

| 原版版本与实际产品选择 | 新助手解码 | 旧助手对照 |
| --- | --- | --- |
| 1.0、1.1、1.2.1、1.2.2、1.2.3、1.2.4、1.2.5，内嵌 `legacy-jorbis` | 每版 6 个，合计 **42** 个采样成功 | 相同原客户端、资源与依赖逐版重现签名冲突，7 次预期非零退出 |
| 1.13、1.13.2，外部 `legacy-jorbis` | 每版 11 个，合计 **22** 个采样成功 | 22 个 PCM16 数组与旧助手逐位相同 |
| 1.21.5，外部 `jorbis` | **16** 个采样成功 | 16 个 PCM16 数组与旧助手逐位相同 |

合计 **10 个版本 / 80 个当前采样**，覆盖两种实际 codec 路径；**38 个外部 codec 采样**的 PCM 未变。每个当前采样都具有有效的采样率、通道、非空且含非零值的 PCM16，并记录 PCM hash。七版修复前没有可比较的成功 PCM，不能把它们写成 42 个前后 PCM 相等结果。

[公开诊断结果](verification.md) SHA-256：**`50def81b0295d90b31781536eb41203df92b3ab37d42ca15e614a0832021bdda`**。其中记录每个子进程和输入身份，原 raw `report.json` SHA 为 `449f683bee07eee0faeb7c9935c198cd2f0b7cc8cbb569ba3df1cc7959c9038e`。

此前一次成功运行 `.local/java-decoder-package-fix/run-1792812344721` 保留 9 版 / 64 当前采样和 22 个外部 legacy PCM 控制；之后补了实际 `jorbis` 的 1.21.5 控制。该旧 raw、公报副本和当时测试脚本原字节都保留，不能把 1.13.2 标为现代 JOrbis；生产选择实际是 `legacy-jorbis`。

[两项单元回归](../tests/java-decoder.test.ts) 检查两种 codec kind 都使用具名包入口、检查既有 classpath 保留、PCM 协议和临时清理。定向 Vitest **2/2**、`build:electron` 和 TypeScript 检查均 exit 0。

## 历史保留与发布影响

root 已保留首包完整目录 `release/0.1.21-before-decoder-package-fix`；旧助手源码/TS/build/main class 的原字节及 SHA 在 `.local/decoder-before-package-fix/manifest.json`。旧 main class SHA 为 `453b159208dd7ad8c4d79fd5a5b282ace11a5ede0a04089bbbbfcca7594ef759`。新回归只读该旧产物作为失败/未变 PCM 对照，未改首包或既有冻结原类报告。

此次需要重新构建发行包，并刷新包含 Java helper 源码、compiled class 与 worker bundle 的生产来源闭包。所有读取旧 `dist-electron/java/NbsxVorbisDecoder.class` 的当前 verifier/smoke 应使用新产物路径；历史证据仍绑定旧产物，读取时应显式使用保留的历史位置。产品修复完成后的实包 IPC 和既有世界 PCM 重放由 root 统一进行，本组件诊断不替代这些验收。

本诊断新增 native context/world 场景均为 **0**；没有碰旧 native pilot、1.12.2 的旧 49 场排除证据或共享事实。
