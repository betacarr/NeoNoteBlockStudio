# Neo Note Block Studio · NeoNBS

面向 Minecraft Java 版的独立桌面音符盒编辑器。以 MIDI 为主要起点，支持 NBS 互通，使用独立的 **.nbsx** 工程格式保存片段、混音、Delay 和来源信息。

仓库名：**NeoNoteBlockStudio**；软件简称：**NeoNBS**；中文描述：**音符盒音乐工作站**。

> 当前版本 **0.1.53**，首次公开发布源码，不附带旧名称的安装包。

**NOT AN OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT.**

## 编辑功能

- 编曲区与钢琴卷帘分栏，可调整面板和两轴缩放；片段副本独立，循环单独设置。
- MIDI 导入／导出，NBS 导入／导出；FLP 导入保留可解码的音符与片段。FL Studio 插件和自动化不会还原，见 [FLP 范围](docs/flp-import.md)。
- 默认 FL 操作预设、框选、移动、时值调整、力度／声像、撤销重做和片段剪贴板；空格优先控制播放。
- 混音器支持轨道筛选与对应高亮，默认实时试听可边改边听，并显示分轨与总输出电平。
- 轨道 Delay 生成派生音符，不主动改写源 MIDI；支持时值关联包络、独立尾音、相对声像左右交替，随 NBS 导出。
- NBS 导出自动检查，默认 TPS = BPM ÷ 7.5（每拍 8 tick），可选 BPM ÷ 5（每拍 12 tick）。音乐位置按格点映射，无法准确表示的细分会提示。
- 偏好设置可启用 Liquid Glass 外观；内置方块图标为原创绘制。

当前优先完善编辑流程。原生声音对照仍有版本与设备边界，游戏内结构生成待定。Windows 为主要验证平台；有 macOS 构建入口，尚无同等运行验收。

## 开发运行

需要 Node.js 24+ 与 JDK 9+（建议 JDK 17，用于编译自行编写的 Java 解码适配器），以及 Git。

```powershell
npm ci
npm run dev
```

安装会下载并校验当前平台官方 Electron。仅查看 Web 界面可使用 npm run dev:web；读取本机资源与原生渲染依赖桌面运行方式。游戏采样需用户从自己的本机安装中读取，仓库不提供采样下载。

```powershell
npm run audit:publication
npm test
npm run build
npm run package:win
```

首次公开提交前的开发候选需先暂存文件，再运行发布检查；普通 Git 检出可直接检查。可选 npm run install:hooks 安装本仓库的推送检查。它检查即将推送的提交与身份信息，不能代替人工素材审阅。线上自动检查尚未启用；可参考 docs/ci-template.yml 配置。

## 许可与素材

本项目采用 **源码可见的自定义许可**：允许免费使用、修改和免费分发编辑器；禁止未经书面许可收费分发编辑器或收费提供其功能；允许用户靠自己的原创作品、接单、教学及独立服务盈利。它不是 MIT 或 GPL，也不是 OSI 认可的开源许可。完整条款见 [LICENSE](LICENSE) 和 [中文范围说明](docs/licensing.md)。

第三方组件保留各自许可，见 [第三方说明](THIRD_PARTY_NOTICES.md)。项目不捆绑 Minecraft 游戏代码、声音、贴图、专有插件或私人曲目。嵌入采样的 NBSX 在分享前仍需确认素材权利，详见 [素材边界](docs/assets-and-rights.md)。

## 项目资料

[操作说明](docs/editor-interactions.md) · [混音器](docs/mixer.md) · [Delay](docs/delay-effects.md) · [变更日志](CHANGELOG.md) · [当前状态](docs/status.md) · [验证范围](docs/verification.md) · [版本规则](VERSIONING.md) · [隐私与报告](SECURITY.md)
