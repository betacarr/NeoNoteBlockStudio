# 游戏素材与第三方权利

NOT AN OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT.

NeoNBS 是独立编曲编辑器。Minecraft、相关品牌及游戏素材的权利归其相应权利人所有；项目不由 Mojang、Microsoft 或 OpenNBS 开发、认可或支持。

公开源码不提交游戏客户端、服务器、反编译游戏源码、原版纹理、原版音频文件、资源包、私人曲目、MIDI／FLP／NBSX 母版或录音。方块图标为自行绘制的 SVG。版本号、资源路径、格式与校验和等事实元数据不授予游戏素材许可。

0.1.58 起，默认音色改为 Mojang 官方资源服务提供的 Minecraft Java 26.3 原始 Ogg，替换 0.1.56–0.1.57 的 OpenNBS 采样。20 种文件按官方声音事件映射获取，构建时校验版本元数据、资源索引、声音定义与原文件 SHA-1／SHA-256；保留原始振幅，不做归一化、音量补偿、裁剪或重编码。[清单](../third_party/minecraft-samples/manifest.json)和[来源与权利说明](../third_party/minecraft-samples/NOTICE.md)随包提供。原版音频仍保留相应权利人的权利，不适用 NeoNBS 代码许可或 OpenNBS 的 MIT 许可；获取自官方服务不等于官方对本项目的授权。

原生版本校对从用户选择的本机安装只读加载所需内容，不用默认采样冒充对应版本的游戏输出。Java 解码适配器为本项目实现；第三方解码器和原生库按用户安装及相应许可加载，不作为游戏程序附送。

若用户选择将采样嵌入 NBSX，分享该文件前仍需确认每份采样与曲目的分发权。软件许可不会把原版或第三方素材变成可以随意传播的内容。

未来若增加真实纹理显示，应采用本机读取／用户资源包，并保留原创备用图标；不得将提取的素材自动加入源码、安装包或公开下载。

官方资料：[Minecraft EULA](https://www.minecraft.net/en-us/eula)、[Minecraft Usage Guidelines](https://www.minecraft.net/en-us/usage-guidelines)。项目的实现取舍不是官方对本项目合规性的认证。
