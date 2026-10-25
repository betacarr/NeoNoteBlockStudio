# Java 1.12.2：独立静音 regular mixer pilot 复核

本次独立复核通过原始记录的一致性、静音 packet、worker 退出、代码恢复及释放检查，结论保持 **candidate-only**。它只证明这一次自己进程中的零声源观察器按所记录的控制流程结束；不证明原游戏非零音符、原上下文与 loopback 等价，也不提升旧 49 场 normalized 世界录音。

本次复核没有运行 Java、编译器、controller/observer DLL、OpenAL 或新的 native attempt。原运行由 root 明确发起。新的三个 Node 脚本只读取并校验既有原始文件；负例使用内存覆盖，不改写 raw、准备产物、产品、事实表或旧报告。

## 身份、终态与可复核入口

原 pilot 根为 `.local/lwjgl2122-mixer-runtime/pilot-1792811055433-97fd5e`，Java PID **61648**，`terminal=true / code=0 / signal=null`。运行从 `2026-10-24T03:04:15.435Z` 至 `03:04:17.175Z`；原 runner 的状态仍保留 `candidate-awaiting-independent-review`，没有回写成接受。全部 **75** 个原始文件及目录 inventory 被重新读取并校验。

| 证据 | SHA-256 |
| --- | --- |
| [新的独立复核报告](verification.md) | `50ff795768d1efb8f77f505ec21a22898ee4d2c94ff8ab0770efe91ef059c702` |
| 原 `pilot-1792811055433-97fd5e/report.json` | `de1b285b6ee17739f8607e5c8a38c1ce942165d7e0ad18c26b9578315e78cfd7` |
| [修正后的准备证据](verification.md) | `304bc37c61e1c42b89390575c433c44daed78c2bd7d208fa78f806e32e6cb3d9` |
| [25 个 reader 负例结果](verification.md) | `d5ddb94ffcf015868d85c84d08cd041828c1767e6ec709629449504135daecd4` |

[严格读取器](../scripts/review-lwjgl2122-silent-mixer-pilot.mjs) 导出 `inspectSilentMixerPilot()`，重新推导 raw 结果；`reviewPublishedSilentMixerPilot()` 先核对三个新脚本的 source hashes，再重新推导并逐项比较 public report。二者均不创建进程、不加载 DLL。

[只读报告生成器](../scripts/audit-lwjgl2122-silent-mixer-pilot.mjs) 的最终执行根为 `.local/lwjgl2122-mixer-runtime/independent-review-1792811816275`；Node 子进程 PID **7792**，实际 close 终态 `0 / signal=null`，process、stdout、stderr 与 report 副本均已保存。[负例脚本](../scripts/verify-lwjgl2122-silent-mixer-pilot.mjs) 的 Node PID **47768**，工具会话 `63949` 观察到实际 exit **0**；原结果保留于 `.local/lwjgl2122-mixer-runtime/review-negative-1792811833016/report.json`。public 负例文件为该原结果的逐字节副本。

原准备的 controller/agent/SDK 及工具身份由既有严格 gate 重新验证：原 ALC10 的 42 条指令在移除三组观察 hook 后保持相同，实际运行保存的 ALC10/AL10/AL11 原类和转换类与该准备逐字节一致，runtime.properties 也相同。准备证据在此次完整 raw 审查前后均再次核对相同 SHA。

## 原生 pointer 与四份实际 list

原 Java 声明的 7 个 int 为 `[4103,44100,4104,60,4105,0,0]`，position/limit/capacity 都为 7。该声明内容及 capacity 来自已绑定 `bufferEntry` 源码的成功 guard，加上 cleanup 后的 Java `original.bufferUnchanged=true`；没有额外 raw capacity/声明 7-word dump。因此报告明确标注这一证据层次，不把它伪称成独立原始序列化记录。

实际单独记录的 Java base 为 **2494644495072**，JNI attribute pointer 为 **2494644495100**，即 **base + 28 bytes**，position=limit=7。原指令仍向 JNI 传这一 pointer，没有 flip、归一化、替换或补充参数。

实际 JNI pointer 所指的四份完整 terminated list 全部是：

```text
[767765582, 6140351, 0]
```

每份 count=3、status=1（读到 zero key）、failedIndex=4294967295、Windows error=0。前两份在原 JNI 之前，后两份在原调用返回之后；各后续 checkpoint 保留相同原记录。**这不是 Java 声明的 7 words**，而是超出声明分配范围的地址，在这次进程分配状态下偶然读到的含未知 key/value 的三-word list。四份快照相同只支持这次读取得到稳定终止序列，不证明该分配外内存的所有权、两次快照之间每个 native dereference，更不能推广其他进程或未插桩游戏。观察器与日志本身会改变分配过程。

设备的 **effective attrs** 独立列为：

```text
[4103,48000,4104,50,4105,0,4112,255,4113,1,131075,4,0]
```

它们不用于替代前述实际 JNI list。原日志为 regular playback device，pre-reset `Stereo/Float/44100/1024×4`，post-reset `Stereo/Float/48000/960×4`，HRTF disabled、BS2B disabled。没有创建 loopback。日志中唯一 original device/context 的地址分别与 raw 字段一致，FreeContext/FreeDevice 发生在 before/after-original-cleanup 两个 marker 之间。

## 原 worker、代码与页保护

实际 worker function=原 OpenAL module + `0x20198`，argument=原 device；线程 ID **78772**，进程 ID **61648**。原 handle=1528，duplicate handle=1612；dup 的运行前 wait=258（WAIT_TIMEOUT）、exitCode=259（STILL_ACTIVE）。原 cleanup 返回后，成功 finish 分支要求 duplicate 的独立 wait=0（WAIT_OBJECT_0）及 inflight=0 才继续恢复。最终原记录与这些条件一致。

`workerPostWait` 初始值本身也是 0，不能将早期 checkpoint 的 0 当作线程已 join。读取器同时要求实际完成的 restoration gates、casRestored、全 text 恢复及 after-cleanup 顺序，才采纳最终 wait 结果。

CALL site=原 module + `0x202c8`，地址 **2494651826888**，8-byte 对齐且 8 bytes 在同一已验证 page。实际原 8 bytes 为 `e81b55ffff448b5c`，安装后为 `e833fdfbff448b5c`。物理 CAS 写入 8 bytes，逻辑范围为 5-byte CALL，尾 3 bytes `448b5c` 保持不变。原 CALL 解析到 module+`0x157e8`，新 CALL 解析到所记录 near island；observer 地址还独立与实际 observer DLL 的 `Observer` export RVA 比较。

原、安装后、恢复后的完整 mapped text 各 **231424 bytes**。baseline 与准备提取的原 text 相等，安装后变化只在该 CALL 的 5-byte 范围，恢复后与 baseline 逐字节相等，SHA 为 `15e1836ad1fb71f8597527b56c63f1706a2d4c4f508a4ec214a88a16f1f6bd7f`。安装后 SHA 为 `800716d039154bb575bb1af45820a1cd987cbbfa59bdc0f423a65f192c69c520`。

原 protection 与 restore 返回的 previous protection 均为 32（PAGE_EXECUTE_READ）。VirtualProtect、FlushInstructionCache、island readback、guard 查询与 canary 检查有绑定到已编译源码成功分支的 raw flags；**没有额外最终 VirtualQuery dump、实际 island 12-byte dump、guard/canary 内存 dump**。因此这些项目是 source-bound 的成功检查记录，不冒充独立 OS 重探测。packet source buffer 范围与 control/slab guards、island、原模块范围也经只读检查互不重叠。

## 私有 packet、cleanup 与 lifetime

共 **53** 次原 mixer callback，其中 3 次未 armed、50 次提交私有 packet；attempted=committed=50，dropped=invalid=0。每个 packet 的 publish/sequence/device、960 frames、48000 Hz、Stereo Float、960×4 update 与字节长度均独立核对。最大实际 frames=3840，静态 reserve=16384，capacity=256，stride=131200。

50×960=**48000 frames**，PCM 共 **384000 bytes / 96000 float32 words**，逐个 uint32 校验均为 **+0 bits**，连接 PCM 的 SHA 为 `fec9afb531a8e036eba1d81651896e1b2c1f78b0234dbadc8e7549563f09407b`。armed sleep 实际为 1004782900 ns。packet 只在原 cleanup、worker join 与代码恢复以后，从已复制的私有 slab 输出；没有在 cleanup 后读取已失效的原 WASAPI buffer。

SDK source/buffer/renderSamples 调用数均为 0，额外 make-current 为 0；原 SDK 在 create/destroy 流程中的 make-current 为 2，不能误写成所有 make-current 都为 0。原 cleanup 实际被调用并返回，所有 owned allocations 释放成功，释放前私有 counters 保存后再报告，未从已释放 control 读 counters。

原 OpenAL、observer、controller 模块有意 PIN 至进程 terminal。原 render worker 的 join 不证明所有 backend/global 线程已退出，也不证明模块提前卸载。文件身份与准备 closure/保存的类一致；controller/observer 的整个运行时 mapped image 没有独立 dump attestation。

## 负例与验收边界

25 个内存覆盖负例全部被拒绝，覆盖非终态/非零退出、错误 preparation、世界晋升、pointer/context/list 差异、非 join/inflight、不同进程 worker、错误 observer export、未恢复 text/尾 3 bytes、guard/canary/release、非零静音数据、未发布/错误长度/不同 device 的 slot、SDK source 调用以及错误 cleanup 日志顺序。覆盖后的 raw file hashes 被重新封装；final-state 字段与对应 properties 同步后再验证，避免只依靠外层摘要不一致拒绝。

这次没有观察到控制流程 raw gate 的失败，但仍严格保留 `candidateOnly=true`、`fullContextEquivalenceProven=false`、`nonzeroPcmEquivalenceProven=false`。全零数据不能区分同样输出零的错误复制或数据路径；非零输入、waveform copy、decoder/resampler 响应、调度等价、loopback 对比均未证明。成功 setup 和静音 packets 不能代替这些证据。**新增世界场景为 0，旧 49 场继续排除。** 本次没有更改旧报告、共享事实、registry、产品或 release 的音符等价声明。
