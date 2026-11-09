# 本地音频辅助扒谱（开发版）

在桌面版中打开「文件 → 和弦与速度分析」，选择一段参考音频。
导入本地音频后，结果先留在预览窗口。可以试听、定位、循环、静音／独奏、调节音量，导出单轨或当前混音的完整时间轴 WAV。
这是一套独立的辅助音频工作区；主编曲的 MIDI、NBS 和音符播放继续处理音符。它不会自动转音符或生成 MIDI。

和弦标记可以修改名称、相邻分界及合并。候选的不确定程度会显示在表中。
BPM 支持人工输入、半速／倍速、首拍对齐与单独拍点校正。本轮只支持固定速度；手动拍点是参考标记，不生成复杂速度图，也不对音频做时间伸缩。
只有明确勾选「应用时将工程改为此固定 BPM」才替换工程速度图，默认保留原速度。
「应用到工程」保存标记、混音设置及音频引用；取消不改工程。窗口有独立撤销／重做，应用也可在主工程撤销。

## 完整曲目与工程旁资源

新分析的原音频和分轨保存在工程旁的 `曲名.nbsx.assets/audio/<SHA256>.wav`，NBSX 只保存相对引用、校验值及采样信息。
移动或备份时请把 `.nbsx` 与同名 `.nbsx.assets` 文件夹一起带走。另存为会复制所需资源，再写入新工程；不覆盖或清理原工程资源。
旧工程内嵌音频继续可用，不强制转换。新资源不依赖分析缓存或模型文件，搬移后可在新的用户配置中打开。
素材缺失时仍可打开音符工程；辅助窗口明确报错，并提供「定位缺失音频…」。重新定位要求原文件校验值匹配，避免悄悄替换分析来源。
恢复草稿也保存自己的音频资源目录。主工程与恢复文件均在资源复制完成后才写入清单。

## 后台与运行环境

开发环境使用项目的 `.local/audio-runtime`。安装包则从应用用户数据目录下的 `audio-runtime` 加载可选组件，基础编曲、MIDI／NBS 和内置音色试听无需它。组件不修改全局 Python，处理时不上传音频。

安装包的 `audio-runtime-tools` 目录中有安装脚本。先安装对应架构的 Python 3.11。先启动一次应用，通过「帮助 → 打开日志文件夹」找到 `logs`，其父目录才是本次启动的实际用户资料目录。关闭应用后，按下面命令安装并重开。示例路径只适用于没有旧资料目录的新安装；若沿用 `EX NoteBlock Studio` 或自定义资料目录，必须替换为刚核实的路径：

```sh
# macOS，假设 NeoNBS 已复制到「应用程序」
bash "/Applications/NeoNBS.app/Contents/Resources/audio-runtime-tools/setup-audio-assist-macos.sh" \
  "$HOME/Library/Application Support/NeoNBS/audio-runtime"
```

```powershell
# Windows，在 NeoNBS 安装目录（或便携版实际展开目录）运行
$python = & py -3.11 -c 'import sys; assert sys.maxsize > 2**32; print(sys.executable)'
if ($LASTEXITCODE -ne 0) { throw 'x64 Python 3.11 is required' }
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\resources\audio-runtime-tools\setup-audio-assist.ps1 -Python "$python" -RuntimeDir "$env:APPDATA\NeoNBS\audio-runtime"
if ($LASTEXITCODE -ne 0) { throw 'Audio runtime setup failed' }
```

如果应用沿用旧的 `EX NoteBlock Studio` 数据目录，将命令里的数据目录改为旧名称。可从应用的「帮助 → 打开日志文件夹」定位实际数据目录，`audio-runtime` 与 `logs` 同级。macOS 脚本可用 `NEONBS_PYTHON` 指定 Python；Windows 脚本接受 `-Python`。大分轨的模型仍在应用里按需单独下载。

`scripts/setup-audio-assist.ps1` 从官方 PyPI 和 PyTorch CPU 仓库安装已列出的依赖，并配置 MIT 许可的 Beat This! 测拍模型。不下载分轨模型。
Python 后台与界面分开执行，提供进度、取消、失败后重试及本地结果缓存；只有完整且通过校验的结果进入缓存。
WAV、FLAC、OGG 等由 libsndfile 解码；需要时用本机既有 FFmpeg 解码 AAC/M4A。macOS 可使用默认 Homebrew 安装位置，Windows 可将 `ffmpeg.exe` 所在目录加入 PATH 后重开应用。未找到解码器时可先转换为 WAV、FLAC 或 OGG。
桌面导入使用文件句柄和流式快照，不将整首源文件传入 IPC；返回结果也只有资源描述，不含 Base64 或整轨 PCM。
后台支持时长不超过两小时的输入，检查磁盘余量，分块重采样、分析并写入完整时间轴；不会截短歌曲来满足工程限制。允许导入的时长不是已实测的完整长曲性能。
桌面文件选择上限为 16 GiB，旧的字节接口仍有 64 MiB 上限。NBSX 原有 ZIP 安全上限只约束清单及内嵌资源，不约束工程旁音频。
音频以对齐的 44.1 kHz 立体声浮点 WAV 保存和导出，不对各轨分别归一化或静默裁剪。
当前试听仍整轨解码到 Web Audio，按实际分轨数计算 2 GiB 缓冲预算；超限会明确报错并保留完整原文件，不等于后台或存储截断。导出也有独立的内存预算检查。
浏览器版不能单独保存含工程旁资源的工程，请使用桌面版。

## 当前分轨选择

大分轨与和弦分析使用独立入口。支持声部勾选、单个鼓件和子混音；鼓件包括底鼓、小军鼓、踏钹、嗵嗵鼓及鼓其他（含铙钹残余）。独立铙钹提取暂不可用，不能把鼓其他残余写成独立铙钹。模型首次使用在应用内确认下载，默认 CPU。

下面的 v2～v5、`.local` 和 `setup-audio-assist-fast.ps1` 描述的是历史源码试验，不是安装版用户的组件安装步骤；日常安装使用上方随包脚本与实际用户资料目录。

## 六轨模型状态与许可

模型结果采用可变数量分轨数组，不依赖四轨或六轨常量。`htdemucs_6s` 接入代码支持人声、鼓、贝斯、吉他、钢琴及其他。
BPM／拍点／和弦分析与原音频试听继续可用。Mega 资源完整校验后提供“五类预测＋其他残余”试用；Demucs 不作为默认路径启用。
Demucs 的代码为 MIT；作者在 [官方问题 #384](https://github.com/facebookresearch/demucs/issues/384) 中另行说明预训练权重仅供个人／研究用途。
当前 [作者的六轨权重页](https://huggingface.co/adefossez/HTDemucs-6s) 未另列可随产品分发的许可。因此不能将代码的 MIT 当成权重的分发授权。
未确认用户实际属于该用途，不能以用户「同意下载」扩大上游许可，也不把单条原音频结果称作六轨分离完成。

另已核实 [MVSep Mega 53 Stems v1 作者对权重的 MIT 授权](https://github.com/ZFTurbo/Music-Source-Separation-Training/issues/245)。它不是已验证的六轨替代品：官方说明 53 个类别存在父子重叠；五个宽类别预测加原混音残余只能保证代数求和，不能据此证明声部互斥。
此前 web 工具抓取 YAML 返回 `restricted URL`，不能据此判断应用的网络权限。已移除将该工具错误写成产品永久禁用的逻辑。
首次使用提供模型资源提示，显示约 1.37 GB（1.27 GiB）、MIT 授权依据和官方来源；点击确认后才通过主进程下载。清单哈希已对照作者官方 GitHub 发布资产列表核实。
模型缓存位于用户数据目录的 `audio-models`；保留 HTTPS 官方重定向白名单和 SHA256 校验。连接等候上限 30 秒、连续无数据上限 60 秒、单次总上限 6 小时。以 4 MiB HTTP Range 分段接收，保存 ETag／Last-Modified 并用 If-Range 续传；校验 206 范围和长度，200 降级保留原片段后从头接收，不拼接不同版本。临时网络故障最多连续退避重试五次；权限、证书或完整性错误立即停止。取消、关闭或失败后保留应用自己的片段，下次明确确认后继续；最终整文件固定 SHA256 通过才进入 ready 缓存。已损坏的旧缓存保留为带唯一后缀的备份，再重新下载。
早先完整响应传输曾在约 8.9 MB 以 `terminated` 中断。改为分段续传后，2026-10-29 的真实独立 UI → IPC → 主进程测试完整取得官方配置与权重：GitHub 302 → 官方 CDN 206，合计 1,368,924,071 字节，两项固定 SHA256 通过，耗时 572.261 秒。重启同一测试配置校验并复用缓存，未重新请求网络。没有用手动拷贝文件替代自动下载验收。详见 [模型核查记录](audio-model-license-review.md)。

上游参考：[Demucs](https://github.com/facebookresearch/demucs)、[librosa](https://github.com/librosa/librosa)（ISC）、[SoundFile](https://github.com/bastibe/python-soundfile)（BSD）。
未捆绑 Essentia、madmom 或第三方未知许可的预训练权重。


Mega 使用固定提交的 MIT BS-RoFormer 实现和 `torch.load(weights_only=True)` 加载已核验权重，YAML 仅允许安全类型及配置中的 tuple 标签；工作进程自身不联网。按官方目标索引选择 vocal/drums/bass/guitar/piano 五个模型头，独立保留其输出，并以原混音减五类预测得到“其他（残余）”。界面和保存工程持续标明此试用方案不是原生六轨，代数重构不证明声部互斥。

此前 v2 的真实 CPU 测试使用完整 12 秒合成音频，得到六个 44.1 kHz 立体声浮点 WAV。播放、静音／独奏、单轨导出、保存工程旁资源及文件重开均已验证；取消新模型任务保留此前预览并清理该任务。该样本主要能量仍落在残余轨，不能据此声称已达到有用的六类声部分离。真实音乐、人耳听感及完整长曲的语义效果尚需进一步验收；详细耗时、峰值内存及重构误差记在真实 QA 报告中。


已完成下载与真实推理的独立试用入口为 `scripts/start-audio-trial.cmd`，复用已验证的 QA 模型缓存并打开附带的测试工程，不向日常用户配置复制模型或改动原工程。试用中可自行导入代表性真实音乐继续判断效果。最终报告：`.local/audio-model-final-report.json`；入口现已更新为真实音乐测试工程。早期 v2 的 12 秒合成测试模型流程约 49.04 秒、峰值约 8.25 GB，只作历史记录；当前 v3 资源边界见下文。

## 真实音乐试用进展

已在明确 CC BY 3.0 的 Slow Motion Dream 节选上通过完整桌面链路。修正分块为官方固定 20 秒窗口、10 秒步长、2 秒淡化及首尾／尾段补齐，模型结果缓存升为 v3。五个目标与完整 53 头的对应输出实测完全一致。10.88 秒实曲的桌面分析约 197.84 秒，峰值工作集 16.42 GB；此前 12 秒合成样本的旧 v2 耗时和内存不能代表当前配方。

预测信号确有差异，但吉他接近静音，鼓与残余仍明显相关，不能当作已验证的干净六轨。真实音乐测试工程、本地同电平试听对比、许可、信号证据及压力测试见 [效果验收记录](audio-model-effects.md)。主观听感、独立参考分轨、完整长曲和 GPU 仍未验收。

## v4 CPU 试用（历史）

已在独立 `.local/audio-runtime-fast` 接入官方 PyTorch 2.8 原生 CPU 注意力；历史源码环境中曾执行 `scripts/setup-audio-assist-fast.ps1` 并重启（不适用于安装版用户指引）。仅 Mega 分离选择此环境，基础分析／研究模型继续使用原环境，没有改系统 Python 或驱动。真实音乐桌面分析由 197.84 秒降至 101.52 秒，峰值工作集从 16.42 GB 降至 5.32 GB，完整导出、工程重开及取消仍通过。

另以 CC0 人声、鼓、贝斯、吉他、钢琴和 Saxello 录音构成八秒受控混合，六个输出与独立参考的 SI-SDR 为 17.33、17.47、20.77、17.42、15.41、14.44 dB；残余也与已知其他参考直接比较。它验证该受控输入的六声部用途，不冒充自然多轨音乐或人耳验收。最新入口、源文件许可、试听、性能比较见 [v4 实测](audio-model-performance.md)。

## 当前 v5 CPU 优先试用

CPU 保持默认，新增线程／低内存选项、可取消的加载／推理进度；同一 10.88 秒音乐桌面分析约 70.15 秒、峰值工作进程 4.29 GB。低内存样本实测峰值 2.51 GB，代价是耗时增加；没有承诺所有低配电脑的性能。已批准的 CUDA 包安装在项目独立环境，仅手动勾选实验加速才使用，不要求普通用户下载。GPU 实际运行、导出和取消通过，但自然音乐 CPU/GPU 数值一致性尚未通过预设阈值，因此明确保留实验标记，CPU 试用入口不变。性能、许可、六来源重叠范围及失败证据见 [当前实测](audio-model-performance.md)。

## 编曲区音频流程

现在可以将受支持的本地音频拖入编曲区，创建音频轨道／片段，并从片段右键“处理 → 大分轨拆分器”将结果作为原轨下方分轨组加入主时间轴。分轨和片段和弦有独立入口。操作见 [音频片段操作说明](arrangement-audio.md)。

## macOS 开发环境（2026-11-08）

在已安装 Python 3.11 的 Mac 上执行 `bash scripts/setup-audio-assist-macos.sh`。它只创建项目 `.local/audio-runtime`，从官方 PyPI 安装对应架构的固定版本 PyTorch 和 torchaudio（Apple Silicon 2.8.0，Intel 2.2.2）与分析依赖，并配置 Beat This! 测拍模型；不改系统 Python，不下载分轨模型。Apple Silicon 的原生 PyTorch 包自带 MPS，不需要 CUDA。

CPU 仍是默认。运行环境确认 Apple GPU 可用后，计算设置显示「尝试 Apple MPS 加速（实验，可选）」。MPS 任务使用独立缓存身份；失败时销毁该次工作进程，并明确报告后改走 CPU，不会把 CPU 结果标成 MPS。取消不触发回退。MPS 为共享内存分配设置保守上限，不能据此保证所有长曲或其他同时运行的程序都有足够内存。

模型继续使用现有官方下载器和固定 SHA256，保存于用户配置的 `audio-models`，不用从 Windows 搬 Python/模型凭据。Mega 的「五类预测＋残余」语义限制不变，MPS 功能验收不代表自然音乐分轨质量或与 CPU 全部数值一致性已获保证。

本机验证：1 秒迁移回归音频按完整官方 20 秒窗口计算，CPU 与 MPS 均完成六个对齐输出，最大逐采样差约 1.0e-6；CPU 模型流程约 17.83 秒，MPS 约 17.68 秒，不能据此承诺明显加速。这里只验证短回归素材与算子兼容，不是自然音乐分轨质量验收。MPS 的神经网络层在 Apple GPU，复数频谱重建在 CPU，修复了原上游 DC 抑制触发 MPSGraph 进程中止的问题。CPU 继续默认，MPS 仅手动实验选项。
