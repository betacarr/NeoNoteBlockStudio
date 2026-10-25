# Java 1.12.2：首个 silent pilot 的摘要检查拒绝与修正

Root 依最终静态 SHA 复核后执行了一个原生 pilot：PID **70228**，terminal **exit 1 / signal null**。原始完整资料保留在 `.local/lwjgl2122-mixer-runtime/pilot-1792810569329-b0ad82`，本次修正没有再次执行 native，也没有改写该目录。

[失败诊断证据](verification.md) SHA-256：`8ec42a1906b36a7fea4485a87bba2beddbf630e7c4242b297e5ac039cee06d08`。它独立重新核对原 preparation 的历史源码副本、对象/DLL/header/classes，以及 pilot 的每个 raw 文件哈希、实际 state 和终态。

## 实际发生的边界

原 `AL.create()` 已开始：原 OpenAL 成功打开自己的 regular device，日志记录了 `alcOpenDevice: Created device`。之后新的 beforeNative hook 在进入原 `nalcCreateContext` 指令之前，以 **failureCode 11** 主动拒绝。原源码 wrapper、context 的 JNI 创建没有继续执行；这不是原版 context 初始化失败。

证据中 originalFileHashVerified=0、casInstalled=0、recorder.calls=0、nativeBeforeComplete=0、nativeAfterObserved=0、originalNativeContext=0。observer DLL 未加载，没有 CALL patch、context、mixer 回调、packet 或 PCM。controller DLL 则已加载并执行过身份检查，不能笼统称此次 root pilot 没有 native 执行。

原 cleanup 实际被调用并正常返回，日志有对应 FreeDevice；原 buffer 的 position/limit/capacity 未变。SDK source、buffer、renderSamples 尝试数均为 0。这是一个已终止的观察器 setup rejection，没有新的声音/世界验收或成功静音采样。

## 原因和最小修正

旧 C++ `originalHash[32]` 手写数组展开为：

```text
错误：9261b66010a845ddef9f61d5e4266fe2f08a53f3605da002e9e8f8d202bbdc5e
正确：9261b66010a845ddef9f61d5e4266fe2f08a53f3605da002e9e8f8d202bdbc5e
```

数组第 29/30 索引的两字节为 `bb,dc`，应为 `bd,bc`。错误值还真实存在于旧编译 controller DLL 内，正确值不在其中；pilot 独立报告的原 OpenAL 文件 SHA 却是正确值。之前静态 gate 绑定了源码/产物身份，却漏掉了**常量内容与被校验 DLL 身份之间**的程序化相等检查。这是本实现的静态漏检。

控制器的运行时修改仅是这两个摘要字节；Java agent/driver、运行器、冻结旧 observer、旧 plan/DSP 均未修改。CAS、native 参数、context、worker 和释放逻辑没有变化。

新增 [lwjgl2122-mixer-identity.mjs](../scripts/lwjgl2122-mixer-identity.mjs) 直接解析 C++ 的唯一 `static const u8 originalHash[32]` 声明，要求恰好 32 个字面 byte，并确认它用于实际模块文件的 hashFile gate。它将展开值同时与 `reviewedRuntimeInputs().binary.sha256`、实际原 DLL 文件的 SHA-256 比较；编译之后还要求真实 controller 产物包含相同的 32-byte 数据。

prepare 在任何编译器或 Java 进程启动前运行该检查，失败保留 failure.json；严格只读 reader 重新做相同检查，不依赖报告自述。七个负例分别覆盖这次的精确旧拼写、单 byte 错误、31/33-byte 长度、不同 reviewed identity、实际原 DLL 被改写，以及“源码正确、编译数据仍旧错误”。负例只操作内存，不改写真实 DLL/source，也不加载 DLL。

## 历史保留与新冻结

旧 canonical public 逐字节另存为 [preparation-before-hash-correction.json](verification.md)，仍为 SHA-256 `4ebf3f19bd667e3a26e0ea469aa4dc8eb3bb0e542af8c73b31af37b34e53bd97`。旧完整准备根 `.local/lwjgl2122-mixer-runtime/prepare-1792810262848-1a0a51`、其全部源码快照、编译产物、工具记录及原 pilot 全部保留，未用新源码冒充旧运行。旧静态报告和旧说明是历史快照；当前 live gate 应使用新的 canonical public。

修正后的 [preparation.json](verification.md) SHA-256 为 **`304bc37c61e1c42b89390575c433c44daed78c2bd7d208fa78f806e32e6cb3d9`**。准备根 `.local/lwjgl2122-mixer-runtime/prepare-1792810862227-b7c451`，Node PID **70464**，外层工具观察 exit 0。12 个静态工具进程全部有独立 PID/terminal/exit 0；22 个原内存测试和新增 7 个身份负例通过，118 个 include 哈希保留。原 ALC10 42 条指令去除新增 hook 后仍逐项相同。新 controller DLL SHA-256 为 `0bea3aa6e72b7b511fc20f23905dd534dd0b511d5d8051deee4ff292831a51ab`；正确摘要字节在该产物文件 offset 13072。

本次仅重新编译、反汇编和运行不加载 native 的 `--transform-only` Java 分支。没有加载修正后的 controller/observer/AL，没有再次打开设备或运行上下文试验。Root 重新读取新 gate 后才决定是否执行一次修正后的 pilot。本报告不把身份校验修正当作 runtime gates 已通过：设备格式、原越界 pointer 的实际完整稳定 list、packet 复制、worker join、恢复和释放仍待真正运行验证。旧 **49 场继续排除**，即使以后 silent PCM 成功，也不证明非零音符混音等价。
