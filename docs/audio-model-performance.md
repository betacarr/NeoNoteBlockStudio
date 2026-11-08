# 六声部试用与 CPU 优化实测（2026-10-29）

六声部本地开发试用现在有两类证据：自然音乐的完整桌面流程，以及具有独立参考音轨的受控录音混合。新增 CPU 环境已接入应用，原模型缓存、原运行环境和用户工程保留。

## 当前 v5：CPU 默认，CUDA 仅实验选项

用户要求 CPU 优先。CPU 完整分离功能保留；GPU 从不自动安装，勾选实验选项才尝试。缺包、显存不足或单次 GPU 执行失败时明确转回 CPU；取消不触发另一次推理。缓存区分 CPU、CUDA 与算法版本，不将 CPU 后备结果伪装为 GPU。线程可选自动／1／2／4／8／16，自动上限 8；新增低内存模式和持续进度／用时提示。

同一台电脑、同一个完整 **10.880544 秒**自然音乐输入，20 秒窗口、10 秒步长、FP32 和五个目标不变：

| 路径 | 桌面导入至预览 | 模型前向 | 模型工作进程峰值 RAM |
| --- | ---: | ---: | ---: |
| v4 CPU | 101.519 秒 | 79.221 秒 | 5.318 GB |
| **v5 CPU（默认）** | **70.151 秒** | 56.967 秒 | **4.286 GB** |
| v5 CUDA FP32 math（实验） | 24.524 秒 | 11.547 秒 | 1.298 GB |

v5 采用 meta 构造、mmap 权重、严格核验全部 53 头后仅实例化所需五头与共享层，保持 FP32。低内存模式只拆独立批次维度，保留完整注意力序列。相同 8 秒六来源样本：8 线程均衡模型总时长 33.903 秒、峰值 4.034 GB；4 线程低内存 45.324 秒、峰值 **2.512 GB**，最大逐采样差异约 `1.79e-7`。这是工作进程内存，另需应用、系统及文件缓冲空间；没有在低配电脑上实测，不能据此承诺 4 GB 机器可用。启动前检查可用 RAM，低余量自动采用低内存模式，过低时给出可恢复提示。

CPU 完整 UI 导出／预览／静音独奏／工程文件重开均通过，推理中取消 0.055 秒。默认试用入口继续打开 CPU v5 工程 `.local/audio-mega-real-ui/run-L3kE3n/real-mega-six-output.nbsx`；没有改动原用户工程。

### 可选 CUDA 的实际结果与未通过项

已按用户授权从 PyTorch 官方源完整下载 `torch==2.8.0+cu126` Windows CPython 3.10 wheel，**2,915,462,477 字节**，SHA256 `3b43acaa40ac87495d858bb1dbe574aaaff4e60e9da6221825ece694fd1d2b80`，安装到 `.local/audio-runtime-cuda`。安装入口 `scripts/setup-audio-assist-cuda.ps1`。保留既有 CPU 环境与模型，没有改驱动、系统 Python、CUDA Toolkit 或网络设置；初始串行下载较慢，保留已收到的 570,425,344 字节后以最多四路 Range 续传，最终整文件 SHA256 通过。没有第二次下载模型权重。

本机 RTX 4060 Laptop 8 GB、驱动 576.80 实际运行成功。CUDA 运行前同时查看 CUDA API 和物理显存预算并取保守值，限制分配器；没有关闭用户其他 GPU 程序。上述自然音乐实测峰值显存已分配 **1.192 GB**、预留 **1.753 GB**。保持 FP32，禁用 TF32；当前采用 math SDPA 与独立批次切片，完整窗口不变。

实际 UI → IPC → 工作进程 CUDA、导出、工程重开、取消（0.049 秒）已通过，CPU 默认选项也验证通过。但**精度一致性没有全部通过**：8 秒受控六来源的 CPU/GPU 比较通过预设阈值（最大逐采样差异 `4.32e-5`、最大相对 RMS 0.0329%，参考 SI-SDR 差异 <0.001 dB）；同一 10.88 秒自然音乐鼓轨相对 RMS 差异 **0.427%**、残余 **0.189%**，超过预先采用的 0.1% 阈值，最大逐采样差异约 0.002394。切为保守 FP32 math 后仍存在，原因尚未定位，未放宽阈值冒充通过。因此 UI 明确标为实验选项，CPU 继续默认，GPU 不能称为已完成精度验收的正式加速方案。这里的差异不是已证明的人耳劣化，也没有自然独立参考轨可判定哪一端更接近真值。

证据：`.local/audio-mega-real-ui/run-kRCzIU/report.json`、`.local/effect-eval/compute-v5-cuda-math-comparison.json`、`.local/effect-eval/compute-v5-cuda-math-natural-comparison.json`。初次 fused SDPA 测试及其失败证据保留，未用后续短参考测试覆盖自然音乐失败。

### 六来源混合的重叠边界

源许可与独立参考均再次核验，直接从原录音重建各参考和总混合最大误差为 0。六来源不是依次独奏，但也不能称为整段六声部同时强奏：10 ms 活跃窗口按各参考自身峰值 RMS 的 −30 dB 判断，至少四类同时活跃 6.68 秒，六类同时活跃仅 **0.77 秒**；−20 dB 时六类同时活跃为 0 秒。只取这 0.77 秒，CPU SI-SDR 为人声 16.53、鼓 16.52、贝斯 18.83、吉他 **7.03**、钢琴 14.37、其他 **10.27 dB**。下文 8 秒全段均值不能当作密集六声部效果。

完整自然长曲、其他硬件和主观听感仍未验收；已有同电平输出与试听页面。仍为五个预测加残余，不是原生六类互斥模型。本轮全套回归 2185 通过、1 跳过（另排除既有 publication-audit 环境检查），最终增量检查与构建见交付报告。没有推送或发布。

## v3/v4 实际提速与内存（历史）

同一个完整 10.880544 秒 CC BY 音乐节选、相同官方权重、相同 20 秒窗口和五个目标头：

| 指标 | v3 / PyTorch 2.0.1 CPU | v4 / PyTorch 2.8 CPU |
| --- | ---: | ---: |
| 桌面导入至预览 | 197.843 秒 | 101.519 秒 |
| 模型前向（两窗） | 175.419 秒 | 79.221 秒 |
| 模型流程（含加载） | 186.376 秒 | 90.079 秒 |
| 峰值工作集 | 16.420 GB | 5.318 GB |
| 推理中取消 | 约 0.05 秒 | 0.047 秒 |

桌面总流程提速 **1.95 倍**，前向提速 **2.21 倍**，峰值工作集减少 **67.6%**。新旧六个输出的最大逐采样差值不超过 `2.98e-6`，没有缩短输入、改变目标、减少重叠或对输出分别归一化来换速度。报告 `.local/effect-eval/legacy-vs-fast.json`；完整新 UI 验收 `.local/audio-mega-real-ui/run-obuAcz/report.json`。播放控制、静音／独奏、导出、保存及文件重开均通过；结束后未发现遗留模型工作进程。

本机 RTX 4060 Laptop GPU：8,188 MiB、驱动 576.80、计算能力 8.9，读取时约 2,498 MiB 空闲；已有 CUDA Toolkit 11.8 和 12.8。原 PyTorch 为 `2.0.1+cpu`，没有 CUDA 后端；已有 Toolkit 不会把 CPU wheel 变成 CUDA wheel。没有关闭占显存的程序，也没有安装驱动或修改系统 CUDA／代理。

v4 阶段选择实际验证的 CPU 原生 SDPA 加速；此阶段未安装 GPU 包。官方 PyTorch `2.8.0+cpu` CPython 3.10 Windows x64 wheel 来自 [官方索引](https://download.pytorch.org/whl/cpu/torch/)，619,389,681 字节；索引固定 SHA256 为 `7cc4af6ba954f36c2163eab98cf113c137fc25aa8bbf1b06ef155968627beed2`。另从官方 PyPI 安装 `fsspec==2025.9.0`，约 199 kB。所有新包在 `.local/audio-runtime-fast`，使用既有 Python 3.10 创建新 venv，并共享原环境中的其他分析依赖；安装器确认未卸载原环境的 torch。兼容性通过依赖导入、真实模型严格加载、真实 UI 和取消测试验证，不仅是检查版本号。

复现安装：先有基础运行环境，再执行 `scripts/setup-audio-assist-fast.ps1`，重启 NeoNBS。标记就绪后，仅 Mega 分离使用 fast 环境；普通 BPM／和弦分析和 Demucs 研究路径继续使用原 `.local/audio-runtime`。新环境没有重复下载权重。此脚本是开发环境安装入口，不代表当前发布包已捆绑 Python。

对于旧 CPU 环境，增加查询分段的精确注意力后备路径：每段仍读取全部 K/V，上下文没有裁短。基准显示其主要价值是降低中间矩阵内存，未宣称它能提速；8 线程比 4／2 线程快，因此当前保留 8 线程。PyTorch 2.8 使用自身原生 CPU 注意力，不叠加这层分段。基准与版本分别保存在 `.local/effect-eval/cpu-attention-benchmark-torch20.json`、`cpu-attention-benchmark-torch28.json`。

另跳过官方首尾反射裁剪后完全不影响任何保留采样的窗口。缩小尺寸的参考算法数值测试验证短文件、精确边界和多窗结果一致；缓存版本和运行时命名空间已分开。没有为此次优化再次运行长曲：旧 v3 的 21 秒完整压力报告保留，v4 实测为上述自然音乐两窗和下面的受控混合，不冒充新版完整长曲性能。

## 已知六来源的数值验收

采用 CC0 原始乐器／人声录音构成 8 秒混合，参考独立保留：

- 人声：Karoryfer Hadzi-Fia 的唱元音录音，来自 [legato_vocal_tutorial](https://github.com/sfzinstruments/legato_vocal_tutorial)，提交 `fac6461ee4c7f498b23246eced644616fa58d2ec`。
- 鼓：Karoryfer [Big Rusty Drums](https://github.com/sfzinstruments/karoryfer.big-rusty-drums)，提交 `f07ce00df34a46b6b08375be56fe116cf15782bc`，底鼓、军鼓、闭镲实际录音。
- 贝斯：Karoryfer [Big Little Bass](https://github.com/sfzinstruments/karoryfer.big-little-bass)，提交 `4e92bdf54dcd2d6cfad968cc90542d5461c9b9fc`。
- 吉他／钢琴：[Meta Open Sound](https://github.com/facebookincubator/Meta-open-sound)，提交 `251c0be57d5d1b3242b91f53e0cde62ab1cb42d9`，钢弦吉他与立式钢琴；另单独测试了尼龙吉他。
- 其他：Versilian Studios [VCSL](https://github.com/sgossner/VCSL) Saxello 录音，提交 `c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e`，属于五个模型目标之外的真实管乐。

逐库读取 CC0 许可，只取得少量选定文件，未下载完整数 GB 音色库。Meta 文件与作者 SHA256SUMS 一致；全部选定源文件、提交、大小和 SHA256 随 `source-manifest.json` 保存。录音经过重采样、短音符拼接／淡出和混音前电平平衡；输出不单轨归一化。它是受控录音组合，不是现场演奏或自然多轨音乐基准，也不是振荡器合成。

| 输出与对应独立参考 | SI-SDR | 同电平 SDR | 投影增益 |
| --- | ---: | ---: | ---: |
| 人声 | 17.33 dB | 16.30 dB | 0.910 |
| 鼓 | 17.47 dB | 16.94 dB | 0.932 |
| 贝斯 | 20.77 dB | 20.81 dB | 0.993 |
| 吉他 | 17.42 dB | 17.46 dB | 0.994 |
| 钢琴 | 15.41 dB | 15.50 dB | 0.986 |
| 其他残余 vs 已知 Saxello | 14.44 dB | 14.54 dB | 0.985 |

残余与已知其他参考做了直接比较，没有把代数重构当成分类正确。六来源联合线性投影还测得残余中人声、鼓的幅度系数约 0.077／0.056；这些系数不是“串轨百分比”，表明它仍有可测的目标残留。六输出求和误差 `1.49e-8` 是另一个时间对齐检查。

此测试模型流程 **50.35 秒**，其中前向 **39.54 秒**，峰值 **5.33 GB**。单独尼龙／钢弦吉他分别恢复至约 42 dB SI-SDR；吉他＋钢琴两来源混合为 20.87／15.53 dB。`guitar` 与 `acoustic-guitar`、`piano` 与 `keys` 的确输出高度重叠，支持不将父子头直接相加。自然音乐示例的吉他近静音不能再据此解释成 `guitar` 头失效或索引错误。

六来源报告 `.local/effect-eval/six-known-recordings-fast/report.json`，对比页 `.local/effect-eval/six-known-recordings-fast/listen.html`，有原混合、每个独立参考和每个预测的同电平 WAV。脚本 `scripts/evaluate-audio-mega-six-references.py` 可复现；吉他／钢琴更细的目标比较见 `scripts/evaluate-audio-mega-semantics.py` 和 `.local/effect-eval/known-sources-fast/report.json`。

## v4 阶段结论（历史）

六个期望声部在这个受控录音混合上已有直接数值证据；自然音乐完整 UI 流程也已通过，CPU 速度和内存已实际改善。试用入口 `scripts/start-audio-trial.cmd` 已改为打开 v4 真实音乐工程，并复用完整下载缓存。

模型仍是五个预测头加残余。自然音乐没有独立参考轨，本轮也没有本地音频感知工具完成主观听感验收；对比文件已备好供实际本地试听。v4 当时未测试完整自然长曲和 CUDA 推理；CUDA 后续进展见本文开头。这些未测项不阻止当前开发版试用，也不将一个受控八秒测试推广为所有歌曲的效果保证。

验证：3 项 Python 数值测试（含十种长度边界、全 K/V 查询分段和拒绝错误输入）、64 项音频 Vitest、类型检查、Electron 构建及新完整 UI 验收通过；未推送、未发布，未改用户原工程或系统 Python。
