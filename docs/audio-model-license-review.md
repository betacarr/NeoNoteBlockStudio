# 六轨模型核查记录（2026-10-29）

本记录区分代码与预训练权重，不将单元测试、存储测试或原音频分析等同于六轨推理验收。

| 候选 | 已核实的许可证据 | 当前结论 |
| --- | --- | --- |
| Demucs `htdemucs_6s`，`5c90dfd2-34c22ccb.th` | 代码 MIT；作者在 [#508](https://github.com/facebookresearch/demucs/issues/508) 明确写 “Weights are provided for research purpose!”；[#384](https://github.com/facebookresearch/demucs/issues/384) 另说明个人／研究用途 | 未下载或运行。不是下载前弹窗协议，而是作者给出的用途限制；没有用户实际用途确认，也不能以用户同意下载替代商业许可 |
| MVSep Mega 53 Stems v1，`mvsep_mega_model_bs_roformer_53_stems_v1.ckpt` | [作者 ZFTurbo，2026-09-25](https://github.com/ZFTurbo/Music-Source-Separation-Training/issues/245) 明确将该权重授予 MIT，允许商业集成、转换和分发；同时保留 MIT 的无担保条款 | 权重许可方面有明确的可用候选，但算法适配与本机推理尚未验证 |
| BS-Roformer SW 六轨 | [上游 #248](https://github.com/ZFTurbo/Music-Source-Separation-Training/issues/248) 的模型来源／权重授权仍不明确 | 不使用镜像站的 MIT 标签代替训练者授权 |
| SAM-Audio | [自定义 SAM License](https://github.com/facebookresearch/sam-audio/blob/main/LICENSE) 涵盖权重；[官方模型页](https://huggingface.co/facebook/sam-audio-small) 要求同意协议、分享账户信息并申请访问 | 不是直接原生六轨；本次没有授权接受新协议或扩展凭据，不下载 |

## Mega 53 的具体证据与算法边界

官方发布：[MVSep Mega 53 Stems model v1.0.21](https://github.com/ZFTurbo/Music-Source-Separation-Training/releases/tag/v1.0.21)。
这是一个 BS-Roformer checkpoint，约 1.27 GB；不是三个子模型。权重 SHA256：
`c62820893bbf86d4e734f966bd142d9157cfc8bb8e79e9d8f9ea553f3ff3519f`。
官方 YAML 为 `mvsep_mega_model_bs_roformer_53_stems.yaml`，附件所列 SHA256：
`7e198062a251587088adb91215a4f44ab59e67bd62fcc805cf54d6e7dfc51103`。

官方发布说明明确指出输出有重叠，例如 `vocal` 含主唱和伴唱，所有输出不能简单求和还原混音。
因此不能把 53 类直接分组相加，并声称得到六条互斥声部。
选择 `vocal/drums/bass/guitar/piano` 五个宽类别预测，再定义 `other = mix - sum(five)` 只是待验证的方案：
它能让输出代数求和回到混音，却不能消除五个预测之间的重叠或泄漏；重复估计还可能在残余中形成抵消。
配置、目标头的定义、真实分离结果和参考分轨验证完成前，不将它视为与原生六轨等价。
官方发布建议至少 16 GB 显存。早期审核时 CPU 尚未实测；后续已完成真实 CPU 推理，当前配方的实曲峰值工作集约 16.42 GB，详见文末进展。

## 历史 web 配置读取失败（不是应用网络诊断）

操作：通过 web 工具点击官方 Release 的 YAML 附件，读取配置。

精确目标：
`https://github.com/ZFTurbo/Music-Source-Separation-Training/releases/download/v1.0.21/mvsep_mega_model_bs_roformer_53_stems.yaml`

工具原文：
```text
Failed to fetch https://github.com/ZFTurbo/Music-Source-Separation-Training/releases/download/v1.0.21/mvsep_mega_model_bs_roformer_53_stems.yaml: Failed to fetch restricted URL
```

状态：工具报告抓取限制，未取得配置；没有返回审批记录、明确权限政策或底层网络诊断，无法进一步确定是权限规则还是网络抓取限制。
最初停止后，用户又明确批准官方配置与约 1.27 GB 权重的本机测试及按需下载。在这条新授权下，仅对原官方 YAML URL 重试一次，仍得到相同 `Failed to fetch restricted URL` 错误。随后再次停止；未通过其他路径或工具取得同一配置、未下载受阻权重。
已核实的是官方发布页、附件名称／哈希和作者许可答复，不能把这些当成配置内容已经审核。

## 尚需完成

1. 官方配置与完整权重下载及固定哈希已通过，真实 CPU 推理已运行；继续评估真实音乐和长曲效果。
2. 决定能否提供有明确许可、满足六条目标声部语义的模型；不能仅为演示而将残余当作已验证的互斥分类。
3. 完整 12 秒合成样本的真实推理、六个完整对齐输出、试听控制、单轨导出、工程保存重开及取消已验证；仍需真实音乐声部质量和长曲资源验收。

对于公开／商业制作，不建议要求用户将用途改称研究。若单独选择 Demucs 研究试验，最低前提是用户确认实际用途符合作者限制；该确认并不授予商业分发权。


## 2026-10-29 产品链路修正与实测

在用户已授权的真实应用测试范围内，移除把 web 工具抓取失败固化成产品 `blocked` 的错误逻辑。应用实际请求仍服从执行工具审批和 HTTPS 官方域名限制，未修改工具安全策略。此次正常应用测试获执行许可，没有被审批拒绝。

真实空配置测试报告：`.local/audio-model-official-ui/run-bRYOr8/report.json`。通过正常确认按钮、preload IPC、主进程下载器请求同一作者官方 Release：

- YAML：`github.com` 302 → `release-assets.githubusercontent.com` 200；4,184 字节；SHA256 `7e198062a251587088adb91215a4f44ab59e67bd62fcc805cf54d6e7dfc51103` 通过。
- CKPT：同一官方域名链 302 → 200；本次总接收 8,866,888 字节（含 YAML），随后数据流报告 `terminated`，189.69 秒结束。没有完整 CKPT 哈希或 ready 缓存，临时文件已清理。这是传输中断证据，尚无更底层诊断，不能称作权限拒绝或官方源永久不可用。
- 两个清单哈希已独立核对 [GitHub 官方资产列表](https://github.com/ZFTurbo/Music-Source-Separation-Training/releases/expanded_assets/v1.0.21)，不是从本次下载内容反算后改写的哈希。
- 未运行真实模型推理；未验收真实模型重启缓存、硬件耗时、内存和声部互斥。CPU 运行环境为 PyTorch 2.0.1+cpu，无可用 CUDA；此信息不等于已证明 CPU 无法运行。
- 为核对实现另读取了官方仓库 v1.0.21，固定提交 `ea7eb9c20ea0e3f94368a30fc1654b51cdd55789`，置于 `.local/mega-upstream`；未将其打包或冒充完成推理适配。

产品新增明确超时与显式重试，坏缓存保留备份后重新下载；没有自动循环重试、镜像切换或断点续传。后续应继续正常产品端官方传输验收，不能要求用户手动放文件来替代。


## 2026-10-29 续传后的最终结果

先前 `terminated` 的原始任务没有记录底层 cause，不能事后断言是权限、代理或服务器策略导致。本轮增加分层错误诊断、明确超时和可恢复片段，不修改任何系统代理／网络设置、TLS 校验、域名白名单或固定哈希。

真实完整下载报告：`.local/audio-model-official-ui/run-G3nD63/report.json`。从空配置经真实确认按钮、IPC、主进程取得 YAML 4,184 字节和 CKPT 1,368,919,887 字节，合计 1,368,924,071 字节（约 1.37 GB／1.27 GiB）；两项官方 SHA256 均通过。耗时 572.261 秒，官方 CDN 实际连续返回 206、Content-Range 与稳定 ETag；该次分段传输没有再次断流。重启同一配置完成整文件缓存校验，未重新下载。

运行时为 Electron 45.0.0 的 Node 24.22.0／Undici 7.29.1。Chromium session 的代理解析结果为本机代理，HTTP_PROXY／HTTPS_PROXY／ALL_PROXY／NODE_USE_ENV_PROXY 均未设置；当前下载器使用 Node global fetch，不能将 Chromium session 代理状态当作该请求实际经过代理的证据，也不能用它推断先前断流原因。WinHTTP 子命令探查不可用，未修改系统设置。

推理适配使用固定提交的 MIT 源码，保留 Roman Solovyev 与 Phil Wang 的版权声明。仅支持安全 YAML 类型及 tuple，权重再次固定哈希校验后由 `torch.load(weights_only=True)` 载入，严格匹配全部 53 类状态字典，再使用官方 forward 的 active_stem_ids 选择五类。实际输出为五类预测加原混音残余；它不是原生六轨，也没有证实语义互斥。

真实 12 秒 CPU 测试、指标及试听文件位于 `.local/audio-mega-real-ui/` 的报告。该合成样本大部分能量在残余，不能把重构数值误差很小当作声部分离效果很好。没有用 fake checkpoint、复制缓存或只渲染六行 UI 替代真实推理。真实音乐听感及长曲验证仍未完成。

## 2026-10-29 真实音乐与配方复核

后续已使用明确 CC BY 3.0 的完整 10.88 秒真实音乐节选验收。官方五个目标头与全 53 头对应输出逐采样一致，修正旧适配的固定窗口、反射／补零和淡化差异，缓存升为 v3。真实 UI 导入、推理、播放控制、导出、工程文件重开及前向中取消均通过。仍未证明五类互斥或完成主观听感验收，吉他预测接近静音，鼓与残余相关约 0.576。详细许可署名、指标、试听文件和资源边界见 [真实音乐效果记录](audio-model-effects.md)。早期章节中的“未运行”“未实测”描述对应当时阶段，不是当前永久状态。

## 后续 v4：CPU 优化与独立参考

同一 MIT 权重缓存继续复用，没有下载新模型；在新隔离 venv 安装官方 PyTorch 2.8 CPU 包和 fsspec，保留基础运行环境与系统设置。真实音乐 UI 耗时减半、峰值约 5.32 GB。新增录音素材均逐库核对 CC0，仅选定少量文件，已知六来源的数值检查与自然音乐流程分别报告，详见 [最新验收](audio-model-performance.md)。当前六来源受控测试的直接参考分轨已经具备；主观听感、自然多轨参考及 CUDA 实测仍未完成。

## 2026-11-08 SCNet-large 整鼓候选

SCNet 原作者确认官方发布的 SCNet 与 SCNet-large 预训练权重采用 MIT，可在保留署名的条件下重新分发。这项确认适用于作者发布的权重。ZFTurbo 的 SCNet XL IHF 是另一份 checkpoint，其发布授权未确认，本轮只作本机对照。[权重授权说明](https://github.com/starrytong/SCNet/issues/35)

- 官方源码固定在 `6236f8c559778dc271e1aea9baa3993ae655e905`。官方 README 链接的 `SCNet-large.th` 实测为 168,848,417 字节，下载后 SHA256 为 `719e5abb8ed920305dad546ac3cd6fb0b1e9c3092d14ce21827bfc0423af3070`。官方配置为 1,080 字节，SHA256 为 `629a4901184bf1d3a75b0b13904f35974785aa042cad3c010fd576248cdce3f0`。这些是本机测得的摘要。下载端点实测支持 HTTP 206 和 Content-Range。[官方源码与下载入口](https://github.com/starrytong/SCNet/tree/6236f8c559778dc271e1aea9baa3993ae655e905)
- 本机测试仅以 `weights_only` 加载官方 checkpoint，严格匹配模型。四个同源测试的整鼓 SI-SDR 都高于当前 Mega。仅替换整鼓、重算残余后，保持人声、贝斯、吉他和钢琴估计，并能重组原混音。当前评估产物位于 `.local/logic-parity-benchmark/kit-research/scnet-official/` 和同级的 `scnet-hybrid-comparison.json`。
