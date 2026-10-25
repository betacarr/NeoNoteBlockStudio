# HRTF 上下文规则、设备默认值与验收复现

游戏中的“方向音频”选项表示向 OpenAL 提交什么请求，实际是否启用、选中什么 HRTF 配置，需要在设备初始化后读取。本轮修复分别保留游戏请求、常规播放设备默认值和离线 loopback 的实际结果，避免把“选项关闭”统一解释为强制关闭。

[现代音频事实表](../src/data/audio-facts.json)包含 44 个发行版本的选定源码事实；这不是 44 个版本都完成世界录音的声明。[生成器](../scripts/generate-audio-facts.mjs)检查原 Library 的分支、属性、调用与源码哈希，未识别的新形态会报错。

| 已审核版本范围 | 数量 | `hrtfControlMode` | 原版行为 |
| --- | ---: | --- | --- |
| 1.14.4–1.18.2 的表内发行版 | 15 | `device-default` | 没有游戏 HRTF 控制请求，沿用音频库与常规设备默认值。更早版本的独立事实另存于 early/legacy 表。 |
| 1.19 | 1 | `enable-only-reset` | 关闭不调用 reset；开启且扩展、配置可用时，reset 请求启用与配置索引 0，随后以 null 属性创建 context。 |
| 1.19.1–1.21.4 的表内发行版 | 16 | `explicit-reset` | 关闭、开启分别 reset 请求 0、1，并指定配置索引 0。 |
| 1.21.5–26.3 的表内发行版 | 12 | `context-attributes` | 将关闭/开启请求与配置索引 0 放进 context 属性，不再使用前述 reset 路径。 |

1.19 的默认选项值是 false，但它保留设备默认状态；从 1.19.1 开始才有显式关闭请求。[1.19 原类及方法证据](verification.md)保存官方 client/mappings、原 DLL、三个类及八个方法 Code 的哈希。[1.21.5 边界证据](verification.md)对照 1.21.4 与 1.21.5，记录 reset 向 context 属性的变化，以及原版限幅属性。

配置索引 0 是原版的优选请求，不保证实际配置名称。`ALC_HRTF_ID_SOFT` 不能当作当前整数状态读取；初始化后应查询 `ALC_HRTF_SPECIFIER_SOFT` 的实际名称，并独立读取启用位与状态。OpenAL 允许请求未被采纳、不可用配置被替换，输出频率也可能限制可用配置。产品先在原版常规设备执行对应游戏请求，再匹配实际状态与配置；`first-profile` 只用于受控后端研究路径，不再替代游戏初始化流程。[OpenAL 官方 ALC_SOFT_HRTF 规范](https://openal-soft.org/openal-extensions/SOFT_HRTF.txt)

实际调查发现，不能直接把 loopback 的默认值当作原版常规设备默认值。使用 1.19 原版 OpenAL Soft 1.21.1，原 Library 在普通播放设备上开启方向音频后，reset 成功、null context 保留开启；替换为 loopback 并加入必需的输出格式和频率后，reset 虽返回成功，随后创建 context 的实际 HRTF 却关闭。给 loopback 的隔离配置写入 `hrtf=true` 也没有复现常规设备默认开启。[OpenAL Soft 1.21.1 原实现](https://github.com/kcat/openal-soft/blob/1.21.1/alc/alc.cpp#L1796-L1814)对常规设备读取该默认配置，对 loopback 使用不同路径。原始诊断保留在 `.local/game-world-119/1.19/capture-1792784191573` 与 `capture-1792784210754`，结论也记录于上述 1.19 源码证据。

随后直接调用原版 1.19 Library 做了六组无声常规设备探针。转发原始设备、reset 与 null context 参数，不创建或播放声源；所有组均使用原 DLL，实测设备相同、频率为 48 kHz。耳机自动和强制开启是子进程自己的 `ALSOFT_CONF` fixture，不代表更换了物理设备。

| 隔离后端配置 | 游戏选项 | 原 reset 次数 | 实际 HRTF | 原设备状态 | 实际配置 |
| --- | --- | ---: | --- | ---: | --- |
| 常规环境 | 关闭 | 0 | 关闭 | 0 | 无 |
| 常规环境 | 开启 | 1 | 开启 | 1 | Built-In HRTF |
| `stereo-mode=headphones, hrtf=auto` | 关闭 | 0 | 开启 | 4 | Built-In HRTF |
| 同上 | 开启 | 1 | 开启 | 4 | Built-In HRTF |
| `hrtf=true` | 关闭 | 0 | 开启 | 3 | Built-In HRTF |
| 同上 | 开启 | 1 | 开启 | 3 | Built-In HRTF |

三次开启均原样请求 `{6546: 1, 6550: 0}`。完整设备名、原属性、reset 返回值、实际状态、配置名称和原始档案哈希见[六组原 Library 探针](verification.md)。状态 3、4 也表示启用，不能只用“status 等于 1”判断所有设备；状态值分别记录启用原因。

产品在[上下文策略](../src/audio/context.ts)中把无游戏控制版本，以及 1.19 的关闭路径，设为 `device-default`。其他审核路径分别保留 `enable-only-reset`、`explicit-reset`、`context-attributes`。[原生渲染器](../electron/audio-worker.ts)使用目标版本原 DLL，临时打开常规默认设备，按原始分支执行 reset、配置索引 0 及 context 属性（包括对应版本的限幅请求），无声读取实际启用位、配置名、状态、设备名与频率，再关闭探针。之后在 loopback 显式匹配有效状态与配置，再读取离线结果。常规设备不播放任何声源。

`hrtfGameDevice` 保留常规设备观察值、原请求、reset 属性/结果及 context 属性；默认路径还提供 `hrtfDefaultDevice`。顶层 `hrtfStatus` 表示最终 loopback 状态，两者不可互相覆盖。例如常规设备自动识别耳机得到状态 4，loopback 显式匹配后可以得到状态 1。`hrtfRequestedProfile` 与 `hrtfProfile` 分别记录请求与实际名称。界面对默认路径显示“沿用设备默认”，对显式开关与实际结果不同的路径显示“设备设置覆盖为开启/关闭”。

原默认设备打不开、原始 context 创建失败、找不到同名实际配置，或导出频率导致无法保留该配置时，游戏预览明确报错，不静默改用 loopback 默认值。完整试听（studio）独立控制方向音频，不要求读取原版常规设备默认值。这里没有保证所有导出频率必须等于设备频率；检查的是该频率下能否保留要求的实际 HRTF 状态与配置。

后续 80 组原类探针确认，1.19.2 的全局强制配置可覆盖游戏开关；1.20.2 / 1.20.5 的 reset 后限幅 context 还可能重新采用默认 HRTF 状态。原库新版的行为也不能用旧配置注释概括。40 组产品原生组件与四组共 36 场新增世界录音验证了所记录的结果；旧 1.20.2 / 1.20.5 开关矩阵保留为受控 loopback 后端证据。配置身份、原类调用、适配与重比入口见[全局设置及 context 顺序实测](hrtf-global-overrides.md)，不计入本页此前两个 127 场的表内。

[八组原库组件验收](verification.md)覆盖 1.13、1.19、1.19.2、1.21.5，各自使用隔离的 speakers/headphones auto 配置与 48 kHz 输出。常规设备只做无声探针，合成空间信号仅在离线输出中渲染：比较产品请求路径与独立开启、关闭参考 PCM，确认默认值和显式关闭规则实际影响输出。它不增加世界场景数。报告的 `observedDefaultDevice.status` 是默认设备观察，`appliedHrtfStatus`/`appliedHrtfProfile` 是游戏请求路径的离线结果；`referenceOnHrtfStatus`/`referenceOnHrtfProfile` 则单独记录开启参考，结合 `appliedHrtf` 与 PCM 哈希判断。

世界录音使用各自隔离的原版进程、游戏目录与世界。1.19 开启时先记录原 Library 的 reset 调用及返回值，再以显式的 `--replay-hrtf-reset` 适配，将实际观察到的启用/索引 0 请求重放到 loopback 初始 context；关闭路径不注入 HRTF 属性。原 reset 属性与采集属性分别保存。此适配复现经常规设备探针确认的有效状态，不声称 loopback 中原始 null context 自行保留了 reset。

1.21.5 直接保留原版 context 中的 `6546`（HRTF 请求）、`6550`（配置索引）与 `6554`（限幅请求），仅加入 loopback 必需的格式和频率；通过原 Options 选择开启/关闭，并核对实际选音材料、参数与状态。

| 原版世界矩阵 | 单音关闭 | 单音开启 | 主音量 0.7 | 合奏关闭/开启 | 合计 | PCM 最大误差 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1.19 | 54 | 54 | 9 | 5 + 5 | 127 | 0 LSB |
| 1.21.5 | 54 | 54 | 9 | 5 + 5 | 127 | 0 LSB |

两者均包含 16 种音色、音高与空间位置、广播边界、最多 64 个真实同时声源。参数由产品 helper 独立推导后断言原版实际值；录音和产品输出逐样本比较，未放宽阈值。合奏按原播放顺序在一个连续 context 中比较，保留跨场景混音、尾音、滤波及限幅历史。1.19 还在采样开始读取实际听者姿态，并在每个 1024 帧块后检查静止。预检九场、六组无声探针和八组组件测试均不重复计入两个 127。

五类原始结果分别为：[1.19 单音](verification.md)、[开启](verification.md)、[主音量](verification.md)、[合奏](verification.md)、[开启合奏](verification.md)；[1.21.5 单音](verification.md)、[开启](verification.md)、[主音量](verification.md)、[合奏](verification.md)、[开启合奏](verification.md)。

复现从仓库根目录执行，需要已有经官方元数据校验的对应 fixture、Java/runtime 与本机输出设备。源码与无声组件检查入口如下；带 `--write-evidence` 的命令会更新公开报告。

```powershell
node scripts/audit-world119.mjs
node scripts/audit-hrtf1215.mjs
node scripts/verify-hrtf-context.mjs --write-evidence

$conditions = @(@(), @('--hrtf'), @('--headphones-auto'), @('--headphones-auto','--hrtf'), @('--default-hrtf-on'), @('--default-hrtf-on','--hrtf'))
foreach ($condition in $conditions) {
  node scripts/capture-world119.mjs --context-probe --regular-device --quick @condition
}
```

新的世界录音可使用以下五种条件，每次输出独立的 `capture-*` 档案。1.21.5 使用自己的采集器，保留原 context 属性，无需 1.19 的重放开关。

```powershell
node scripts/capture-world119.mjs
node scripts/capture-world119.mjs --hrtf --replay-hrtf-reset
node scripts/capture-world119.mjs --quick --master .7
node scripts/capture-world119.mjs --polyphony
node scripts/capture-world119.mjs --polyphony --hrtf --replay-hrtf-reset

node scripts/capture-hrtf1215-world.mjs
node scripts/capture-hrtf1215-world.mjs --hrtf
node scripts/capture-hrtf1215-world.mjs --quick --master .7
node scripts/capture-hrtf1215-world.mjs --polyphony
node scripts/capture-hrtf1215-world.mjs --polyphony --hrtf
```

保留原档案时可直接重比，无需重录。1.19 合奏显式使用 `--continuous`；1.21.5 验证器因原限幅请求自动连续比较。替换 capture 名可验证新录音，正式证据仍按原录音哈希与 agent 身份匹配。

```powershell
node scripts/verify-world119.mjs --capture capture-1792784765398 --broadcast
node scripts/verify-world119.mjs --capture capture-1792784765417 --broadcast
node scripts/verify-world119.mjs --capture capture-1792784937547 --broadcast
node scripts/verify-world119.mjs --capture capture-1792784972841 --broadcast --continuous
node scripts/verify-world119.mjs --capture capture-1792784972878 --broadcast --continuous
node scripts/reverify-world-captures.mjs --version 1.21.5
```

这些结果限定于已记录的 Windows x64 原库、48 kHz 立体声离线输出、静止站姿与对齐后的原音符盒事件。不包含物理声卡/耳机声学输出、服务器/网络时延、音乐起音调度、移动听者、所有导出频率、非默认游戏设备选择、macOS/Linux 或完整引擎一致性。44 个源码事实、六组无声探针、八组组件测试和世界 PCM 验收各有独立范围，不能相互替代。
