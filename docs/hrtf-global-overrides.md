# 游戏 HRTF 请求、全局配置与实际状态

原版游戏提交的方向音频开关不总等于设备最终状态。此次补充验收分别记录游戏请求、原版常规设备的实际结果和离线 loopback 的实际结果，并用真实世界录音确认有差异的路径。以下结果采用目标版本官方原 DLL，固定 48 kHz；没有修改用户的音频配置或替换原生库。

[80 组原库探针](verification.md)包含五个版本 × 四种隔离配置 × 游戏开关 × 两种设备路径。其中 40 组直接调用原版 Library，在常规默认设备上原样执行原 reset/context 请求，不创建或播放声源；另 40 组是明确标记的 `request-loopback` 受控适配，重放游戏请求以暴露与常规设备的差异。后者不能代表原版常规设备默认行为。

四种子进程配置分别是：`normal` 使用 `hrtf=auto, stereo-mode=speakers`；`forced-on/off` 使用 `hrtf=true/false`；`headphones-auto` 使用 `hrtf=auto, stereo-mode=headphones`。所有配置均固定频率 48000。配置全文、SHA-256、原类/方法 Code/反编译来源身份、原 DLL 官方 archive 身份和实际设备名均保留在报告。这里的“耳机”是受控后端配置，没有更换物理设备。

表中每格依次表示游戏选项关闭/开启后的实际 HRTF，0 为关闭、1 为开启。

| 原版版本 | normal | forced-on | forced-off | headphones-auto |
| --- | --- | --- | --- | --- |
| 1.19 | 0 / 1 | 1 / 1 | 0 / 0 | 1 / 1 |
| 1.19.2 | 0 / 1 | 1 / 1 | 0 / 0 | 0 / 1 |
| 1.20.2 | 0 / 0 | 1 / 1 | 0 / 0 | 1 / 1 |
| 1.20.5 | 0 / 0 | 1 / 1 | 0 / 0 | 1 / 1 |
| 1.21.5 | 0 / 1 | 0 / 1 | 0 / 1 | 0 / 1 |

1.19 关闭不发 reset，1.19.2 关闭显式请求 off，但两者仍可能被旧原库的全局配置覆盖。例如 1.19.2 的游戏关闭 + `hrtf=true` 得到常规设备状态 3（强制启用）；游戏开启 + `hrtf=false` 得到状态 2（拒绝启用）。同样的请求单独放进 loopback 则分别得到关闭、开启。

1.20.2 与 1.20.5 还有一个顺序问题：原版先 reset 请求开启与配置索引 0，随后创建仅包含 `{6554=1}` 的限幅 context。最终 HRTF 会再次按设备配置解析；在本次 normal 配置下，游戏选项开启的实际结果仍为关闭。保留 reset 结果后直接把 HRTF 开启属性放进 loopback context，会改变原版最终语义。

1.21.5 是必要的阴性对照：原版把 HRTF 请求、配置索引和限幅同时放进 context 属性。在本次原库与配置中，游戏请求胜过旧式全局 `hrtf=true/false`。因此，不能仅凭相同的 OpenAL Soft 1.23.1 库，就把 1.20.5 与 1.21.5 视为相同路径。[原版 1.21.5 边界证据](verification.md)

80 组探针中，游戏选项与实际状态不一致有 13 组：强制配置反转 8 组、normal 下 reset/context 顺序差异 2 组、耳机默认状态差异 3 组。这些是组件观测，不增加世界场景数。原库配置与应用属性的处理顺序可对照 [OpenAL Soft 1.21.1 实现](https://github.com/kcat/openal-soft/blob/1.21.1/alc/alc.cpp)和 [1.23.1 实现](https://github.com/kcat/openal-soft/blob/1.23.1/alc/alc.cpp)。请求不保证被采纳，实际配置仍需初始化后查询；配置索引也是优选，不保证名称。[OpenAL 官方 ALC_SOFT_HRTF 规范](https://openal-soft.org/openal-extensions/SOFT_HRTF.txt)

产品现在按原版本控制方式，在原 DLL 常规默认设备上无声执行原来的 reset → 原 context 顺序，包括版本要求的限幅属性。读取实际启用位、配置、详细状态、频率和设备名，再让 loopback 匹配实际状态与配置。`hrtfGameDevice` 保留原版请求和常规设备观测，顶层 `hrtfStatus` 保留 loopback 状态；例如原状态 3、2 映射为 loopback 的 1、0，不覆盖原始原因。选项与实际结果不同时允许渲染并给出说明；无法匹配状态/配置时明确报错。完整试听仍可独立控制方向音频。

[40 组产品严格对照](verification.md)逐项断言原版 Library 与产品的原始布尔值、reset/context 属性、reset 返回值、状态、配置名称、设备与频率一致。随后将产品真实空间 PCM 与按原 Library 实测状态选择的独立开启/关闭参考逐样本比较；两种参考的 PCM 必须不同。冻结后重比 40 组全部为 0 LSB。它使用合成信号验证上下文路径，不冒充世界录音。

另录四组有意义的真实世界样本，每组九场，保留原 NoteBlock 事件、实际 Options、原 AL 参数、广播边界与采样开始的听者姿态，并在每个 1024 帧块后检查姿态静止。

| 世界条件 | 游戏选项 | 原常规设备状态 | 录音实际 HRTF | 场景 | 最大 PCM 误差 |
| --- | --- | --- | --- | ---: | ---: |
| [1.19.2 forced-on](verification.md) | 关闭 | 3，开启 | 开启 | 9 | 0 LSB |
| [1.19.2 forced-off](verification.md) | 开启 | 2，关闭 | 关闭 | 9 | 0 LSB |
| [1.20.2 normal](verification.md) | 开启 | 0，关闭 | 关闭 | 9 | 0 LSB |
| [1.20.5 normal](verification.md) | 开启 | 0，关闭 | 关闭 | 9 | 0 LSB |

两种采集路径分开处理：1.20.2/.5 保留原 limiter-only context，仅补 loopback 必需格式与频率，没有添加 HRTF context 属性。1.19.2 强制反转因 loopback 不沿用全局覆盖，先在同一游戏进程调用原 Library 常规初始化并无声记录实际状态，原 cleanup 后再初始化 loopback，明确匹配刚测得的状态与配置。原布尔值、原属性、常规设备观测与适配属性分别保存，不声称 loopback 自然采用了全局配置。

这 36 场是新增世界场景；调试预检、元数据修正前的重复档案与 80/40 组件测试均不重复计数。既有 1.20.2/.5 HRTF 开启矩阵保留为受控 loopback 后端研究条件，不能据此声称原版 normal 游戏选项开启必然启用 HRTF。

从仓库根目录复现组件检查，需已有对应官方 fixture、Java/runtime 与本机默认输出设备。所有 `ALSOFT_CONF` 都只传给隔离子进程，配置文件留在 `.local`。带 `--write-evidence` 会更新公开证据。

```powershell
node scripts/probe-hrtf-overrides.mjs --devices regular,request-loopback --write-evidence
node scripts/verify-hrtf-overrides.mjs --probes docs/evidence/java-hrtf-global-overrides.json --write-evidence
```

新录音入口如下，每次创建独立的游戏目录与世界；不会操作用户实例。

```powershell
node scripts/capture-game-option-world.mjs --version 1.19.2 --forced on
node scripts/capture-game-option-world.mjs --version 1.19.2 --forced off
node scripts/capture-game-option-world.mjs --version 1.20.2
node scripts/capture-game-option-world.mjs --version 1.20.5
```

最终接受的原始档案可直接重比，无需重录。verifier 校验采集时配置 SHA，并在隔离进程按相同配置调用生产渲染器；主音量、类别音量、广播、音高与距离仍由产品 helper 独立推导后断言原值。

```powershell
node scripts/verify-game-option-world.mjs --version 1.19.2 --capture capture-1792786818130 --broadcast
node scripts/verify-game-option-world.mjs --version 1.19.2 --capture capture-1792786818121 --broadcast
node scripts/verify-game-option-world.mjs --version 1.20.2 --capture capture-1792786433950 --broadcast
node scripts/verify-game-option-world.mjs --version 1.20.5 --capture capture-1792786451265 --broadcast
```

上述验收限定于 Windows x64、所列官方原库、48 kHz 立体声离线输出、默认物理设备与静止站姿。新增世界样本验证空间/音高/投递条件，没有扩大为完整音色或合奏矩阵；不包含物理声卡与耳机的声学输出、服务器或网络时延、音乐起音调度、移动听者、所有采样率、非默认游戏设备、macOS/Linux 或整个引擎的一致性。
