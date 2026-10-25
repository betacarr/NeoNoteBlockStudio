# Java 1.12.2：regular mixer runtime 的静态准备

本轮只完成新的安装器、控制器、Java agent/driver、启动器和严格只读 reader。新 controller DLL、冻结 observer DLL 和 OpenAL 均**没有被本轮加载或执行**。没有原 AL.create、声音播放、设备试验、regular PCM、loopback 比较或世界采集。旧 49 场仍排除；即使以后无声 pilot 成功，也不证明非零音符 PCM 等价。

最终静态证据：[java-1.12.2-mixer-runtime-preparation.json](verification.md)，SHA-256 `4ebf3f19bd667e3a26e0ea469aa4dc8eb3bb0e542af8c73b31af37b34e53bd97`。只读入口是 [reviewMixerRuntimePreparation()](../scripts/review-lwjgl2122-mixer-runtime.mjs)。本文件、新实现及该证据完成后冻结，等待 root 独立核对后决定一次真正 pilot。

## 输入和静态结果

准备器实际调用冻结的 `reviewMixerObserverPlan()`，并绑定已经接受的 DSP 证据 SHA-256 `09ad1c3a8f341938256492d44c2b5ce56de1cf77470b49a704690cffbdba7fe3`、其 source/raw 哈希、原成功 PID/terminal、官方客户端/依赖/原 DLL 身份及 `reviewDspBinary()`。没有修改旧 C++ observer、旧报告、公共产品或事实。

最终准备根为 `.local/lwjgl2122-mixer-runtime/prepare-1792810262848-1a0a51`；准备 Node PID 为 75364，外层工具观察其 exit 0。12 个编译/静态工具子进程的 PID、完整命令、可执行文件哈希、stdout/stderr、terminal、exit 0、signal null 分别留在根目录 `*.process.json`。包括 C++ 编译/链接、两次 dumpbin、javac、一次 `--transform-only` Java、五次 javap 和 jar 打包。Java 的这次执行只用 ASM 转换 class bytes，第一分支返回，不带 javaagent，不调用 System.load，不执行原 SDK 或 native 方法。

实际 C++ `/sourceDependencies` 记录的 118 个 include 文件全部绑定哈希；新源码、编译对象、DLL、编译汇编、生成的 JNI header、Java classes/JAR、原 SDK 输入/转换后 classes、工具和冻结 observer DLL 均可复核。失败的两次静态编译诊断仍保留在 `prepare-1792809865830-e5878e`（缺少 offsetof 声明）和 `prepare-1792809880299-8e768c`（无 CRT 链接下需提供 memset）。较早成功准备 `prepare-1792809888198-4af3cb` 也保留，当前最终证据只选择上面的最终准备根。这些失败发生于编译/链接，没有 native 尝试。

22 个新纯内存测试覆盖对齐/页/完整 8 字节范围、CAS 安装与恢复、尾 3 字节不变、拒绝不认识的完整 word、island 目标、完整 native list 的 null/终止/未知键/零值/重复键/边界、恢复必要条件和 slab 算术。它们独立于冻结 plan 的 22 个测试，均不是录音场景计数。

原 ALC10.alcCreateContext 的 42 条指令在转换后为 48 条。严格 reader 去掉 entry、beforeNative、afterNative 各一个两指令 hook 后，逐指令和分支目标重新与原 42 条相等。原 `(JJ)J` JNI 调用及其参数仍在原位置。AL10/AL11 的 source/buffer/render 包装方法只加尝试计数并拒绝该无声范围内的意外调用；ALC10 的原 make-current 次数与额外切换次数分开记录。

## 首次调用之前的安装

[控制器](../scripts/native/Lwjgl2122MixerRuntime.cpp) 通过 JNI 供 [Java agent/driver](../scripts/java/Lwjgl2122MixerRuntime.java) 使用。它没有 DLL 入口点，导入仅包括 Windows kernel32 和 bcrypt，未静态导入 OpenAL/LWJGL/CRT。JVM 实际生成的 JNI header 的 12 个函数名均存在于编译 DLL 的导出表中；普通 Win64 JNI ABI/unwind 由编译器生成。冻结 observer 仍是原来的零入口/零导入 wrapper，没有重新编写它的复制逻辑。

未来启动必须先校验 controller、observer 和 expected-text 文件哈希。controller 在首次原 JNI context 指令之前，要求当前进程的 OpenAL64.dll 已由原路径加载，检查其真实模块文件的完整 SHA-256 `9261b66010a845ddef9f61d5e4266fe2f08a53f3605da002e9e8f8d202bdbc5e`、AMD64 PE、image/section 边界和映射 text。原模块、controller、observer 在适用阶段获得固定引用，不依靠 Java GC 或 SDK 最后一次 FreeLibrary 后仍偶然存在。

text 的原 VirtualSize 为 231,284 字节；新基线另外包括 140 字节文件尾 padding，共 231,424 字节 `[module+0x1000, module+0x39800)`。这整个范围在安装前必须逐位等于原文件，安装后只能有已知 CALL 的前五字节不同，恢复后整个范围必须重新相等。原 `.text` 无需重定位归一化；控制器不会忽略任何不同字节。expected text、本次运行原映射基线、安装后映射和恢复后映射将分别保存，不能以磁盘文件代替实际映射读回。

只接受首个原 7-int buffer，position/limit/capacity 都为 7，完整绝对读取值为 `[4103,44100,4104,60,4105,0,0]`，不得消费或 flip buffer。实际原 JNI 地址必须仍为 base+28。已知它在声明分配之外；本实现没有修复、扩展或以 `[0]` 替换它。

安装还要求此时没有 current context、控制器没有先前回调、单次 first-context 状态一致、动态代码策略允许、页/section/指针范围正确。预先建立独立 control 与 append-only slab；两端有已提交的 PAGE_NOACCESS 页，每个 slot 的 PCM 区后另有 canary。容量 256，保留上限每 slot 16,384 frames，64 字节对齐，整体小于 64 MiB。实际 arming 上限随后由本次原设备的 updateSize × numUpdates 收紧，不改变原池或设备参数。

12-byte island 位于 CALL 的实际 rel32 范围，先写入、转为 RX、FlushInstructionCache 并读回；ObserverBind 在 patch 前完成，原 mixer 地址固定为 module+0x157e8。安装点仍为 module+0x202c8。

## 8-byte 原子事务的精确范围

物理写入是 **8 字节对齐的 InterlockedCompareExchange64**，逻辑改变仍为原 CALL 的 **5 字节**。原 8-byte word 全部参与 CAS 比较，后 3 字节逐位沿用原 word。实际地址必须 8 字节对齐，8 字节全部位于已验证 text、同一页及原模块分配内。没有移动任何原指令，没有 prologue detour 或未知指令重定位。

安装/恢复都检查 VirtualProtect、原保护值、CAS 返回的完整旧 word、保护恢复、FlushInstructionCache、完整 8 字节读回，以及上面的整段 text 对照。CAS 不会覆盖不认识的 word。首个 context 的创建前线程尚未进入该 mixer callsite；controller 在控制指针和 island 完备之后才安装。

任一 setup gate 失败，beforeNative 以 Java exception 阻止本次原 JNI context 指令；这是**观察器主动拒绝**，不能归因成原版 create 失败。不自动回退、不重新创建 context、不重试 native attempt。已装的 patch 和仍存活资源按不可用路径保留至进程终态。afterNative 则不抛异常：即使观察失败，也允许原 ALC10 包装器/AL.init 完成原 context 登记，使原清理流程有机会清理实际对象。

## 完整 native list、格式和 worker 归属

controller 在安装分配完成后、原 JNI 调用紧前读取两次实际 pointer 所指的完整 list；原 JNI 返回的第一项观察再读两次。每次上界 257 个 int，只有偶数索引的零 key 才终止，零 value、未知/重复 key 都保留。null、不可读、无终止、两次不稳定以及 pre/post 不同均显式记录并使 candidate 不可用；未知非零键本身不是失败原因。成功的 before hook 在最终 reads 后不再分配、写文件或调用 JNI；仍不能把两个端点快照说成 native 内部每次解引用的完整追踪。

原 context 完整返回后才允许 arming。实际 current 必须是本次原 context；从原 `alcGetContextsDevice` 取出的设备内部字段必须为 48 kHz、stereo、float32。实际 update size/count 必须在明确边界内，并生成此次 maxFrames。原 ALC effective attributes、版本/vendor/renderer、设备名和真实模块文件哈希另存。没有请求不同格式、重建 context 或额外 make-current。

线程链来自实际原 bytes：device+0x16200 → MMDevApiData+0x38 → worker object。对象头必须两次稳定，function=module+0x20198，argument=device，HANDLE 在 object+0x10。随后 DuplicateHandle、GetProcessIdOfThread、GetThreadId、GetExitCodeThread 和初始 WAIT_TIMEOUT 验证其为本进程仍存活的原 worker。该 duplicate 的独立 join 结果会在原 cleanup 后检查，不把 StopThread 原本未检查的等待结果当作证明。

冻结 wrapper 始终先以三个原 ABI 参数调用原 mixer 恰好一次；arming 前不复制。arming 后只复制本进程成功 GetBuffer 得到的 render packet，在原 mixer 返回之后、原 ReleaseBuffer 之前，目标是私有 slab。每次记录实际 frames、设备/packet 指针、格式和 update 字段；容量耗尽、invalid、slot 元数据或 canary 错误均使结果不可用。初始只记录约一秒无声区间；不建立任何 source/buffer，不调用 renderSamples，不获取其他应用或系统总音频。

## 清理、恢复与部分释放

驱动先 disarm，再调用原 AL.destroy；保存清理是否实际被调用、是否正常返回。即使保存诊断失败也尽量完成原 cleanup，失败过程有原始 stderr 和 runner terminal。只有没有先前失败且原 cleanup 返回时，才请求恢复门：独立 duplicate 必须 WAIT_OBJECT_0，inflight=0，current=null，drop/invalid=0，attempted=committed>0，canary 和已安装整段 text 正确。之后才 CAS 恢复原 8-byte word、验证尾 3 字节和整个映射 text。

恢复成功之后，Java 只读已发布的私有 slot 副本，不再读取已释放的原 WASAPI packet 或 device。逐 slot 验证 sequence、publish、bytes=frames×8、实际格式/update、容量和 slab 不重叠，保存 metadata+PCM。无声非零 float words仅记录，不自动宣称任何非零音符正确。所有记录成功落盘后才逐项释放私有分配。

释放并非全有或全无。若后一个 VirtualFree 失败，**前面已成功释放的内存不会重新变为 pinned**。release 入口此时已经完成 worker join 和 patch/text 恢复；原/observer/controller 模块仍固定至终态，剩余未释放的分配继续保留，不重试释放或恢复。错误码对应的进展如下：

| 错误码 | 已完成的释放 | 仍未成功释放的私有对象 |
| --- | --- | --- |
| 61 | 无 | duplicate handle、slab、control、island、baseline、expected text |
| 62 | duplicate handle | slab、control、island、baseline、expected text |
| 63 | handle、slab | control、island、baseline、expected text |
| 64 | handle、slab、control | island、baseline、expected text |
| 65 | handle、slab、control、island | baseline、expected text |
| 66 | handle、slab、control、island、baseline | expected text |

controller 在 control 释放之前保存最终 counters；之后 state 不解引用已释放的 control。state 中早期地址是历史身份字段，不代表该内存仍分配。只有全部释放成功才设置 allocationsReleased。终态 phase 名中的 pinned 指固定模块及剩余资源，不表示已经释放的分配仍存在。

## 尚未执行、不能提前证明的部分

所有 runtime gates 目前只有实现及静态检查，没有实际成功状态。实际 ASLR/near allocation、页保护/缓存/mitigation、JNI ABI 执行、原 pointer 在本次进程的实际 list、设备格式、worker duplicate、packet lifetime/copy、开销、join、CAS 恢复和释放都等待一次原生 pilot。静态 ABI/source 检查不能替代这些结果。

固定模块和安装器/日志/内存分配会改变进程布局与时间；原属性 pointer 已越界，稳定的 pre/post 快照也不能赋予它稳定的分配所有权契约。PIN 还延长模块及其全局 backend 生命周期至进程终态，因此不能把原 SDK cleanup 返回说成整个 OpenAL 模块已卸载或所有全局线程已退出。本次只单独验证目标 render worker 的归属和终态。

未来入口为 [run-lwjgl2122-mixer-runtime.mjs](../scripts/run-lwjgl2122-mixer-runtime.mjs)。它必须收到显式 `--authorized-silent-pilot`、精确 prepared evidence 路径和其 review SHA；默认不启动。runner 保留同一 live handle、日志、所有 packet 文件哈希和实际 terminal，无超时 kill、自动重启或替代 context。这个入口在本轮没有运行。首次无声 candidate 即使成功，也仍需 root 单独审查，才可能设计另一轮按实际 update 序列验证的非零混音比较。
