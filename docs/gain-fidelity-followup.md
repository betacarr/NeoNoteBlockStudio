# 0.1.12 后的增益位一致性复核

Java 1.21.8 与 1.21.9 原类各 1,312 行，共 2,624 行严格组件复测全部逐位一致。比较包含原 SoundEngine 返回值、原监听增益，以及有效输入下原 Channel/Listener 的实际 AL 读回。NaN 与正负零均没有比较豁免。本轮组件结果不增加世界场景计数。

[最终增益复测](verification.md) 绑定当前冻结的 `parameters.ts`、`volume.ts` 与事实表；[首次严格复测](verification.md) 和 [clamp 来源审核](verification.md) 另作带日期的证据保存。旧版 [组件报告](verification.md) 和 [正负零报告](verification.md) 保持为 0.1.12 的历史基线。旧组件脚本将“二者均为 NaN”视为位一致，所以旧正负零差异列表没有包含 NaN 的符号与 payload 差异；新复核明确移除了该豁免。

## 原函数行为与修复

两版 `Mth.clamp(FFF)F` 的方法 Code 哈希相同：`bcb2fca6a64bcce5b877df6c579faf75018f548a5800f32030e49a16a999d5f6`。原指令先比较 `value < lower`，成立时返回下界，否则调用 Java `Math.min(value, upper)`。完整原始反汇编仍位于 ignored 的 `.research/volume-boundary/<version>/`；公开审核只记录类、方法描述符、哈希和独立解释。

当下界固定为正零、上界固定为 1 时，原函数保留输入负零。原 JVM 的直接调用还保留了本次六种正负 quiet/signaling NaN 的符号及 payload；随后 SoundEngine 的 float 乘法会将 signaling NaN quiet，保留本次观测到的符号与 payload。V8 的 `Math.min` 会将这些输入规范为另一种 NaN，因此产品的固定单位区间使用条件比较：

```ts
value < 0 ? 0 : value > 1 ? 1 : value
```

这不是对所有可变上下界的通用替代。报告限定为两版原音量路径、固定 [0, 1] 及本次 Java/V8 环境。

只修下界比较的中间诊断保留于 `.local/strict-volume-boundary/run-1792790780457/report.json`，脚本如实退出 1：有效有限域已通过，但 NaN 符号/payload 仍有差异。完整条件分支首次通过结果为 `.local/strict-volume-boundary/run-1792790840727/report.json`。最终源码的通过结果为 `.local/final-gain-fidelity/run-1792793561131/report.json`，原探针输出保留于 `.local/strict-volume-boundary/run-1792793561208/report.json`，均退出 0。各目录保留原探针、Java class、输入、原始位 TSV、原选项验证结果、产品 bundle 和哈希；首次诊断和通过结果没有被覆盖。

## 严格比较范围

| 每版输入域 | 行数 | 位差异 |
| --- | ---: | ---: |
| 音符盒 raw volume 3，原 validator 接受的选项 | 62 | 0 |
| 任意有限实例，原 validator 接受的选项 | 1,039 | 0 |
| 非有限实例，原 validator 接受的选项 | 171 | 0 |
| 显式注入原 validator 拒绝的选项状态 | 40 | 0 |

62 行音符盒组件输入包括 category/master 的负零、正零及正数下溢；原滑块校验实际接受负零和合法区间内的正数。其余域是明确构造的合成测试，不冒充音符盒能产生的事件或菜单接受的设置。测试还覆盖最小 float 次正规数、最小正规数、最大有限数、乘法下溢、边界邻值、负值、无穷、NaN 及六种 NaN 位模式。原始 SoundEngine/Options/Mth 方法均直接执行；实例状态由研究探针显式构造，未宣称运行完整引擎。

NaN payload 行只证明当前运行环境和这些输入的实际位结果，不保证跨 JVM 的所有 NaN 运算可移植。NaN、无穷等无效 AL 增益不送入 OpenAL；这些行比较原函数返回位，`nativeApplied` 标记真正执行 source/listener 设置并读回的行。硬件输出、实时调度、开启 HRTF 和动态镜头不在本轮新增范围内。最终源码冻结后已复用两版46个世界场景，全部0 LSB，见[显式采集及复核清单](verification.md)。

## 重现

```powershell
node scripts/probe-strict-volume-boundary.mjs
node scripts/recheck-final-gain-fidelity.mjs --write-evidence
```

第一条创建新的原始结果而不覆盖历史公开材料。第二条复用不可变的探针，将当前结果写入独立的 `final-gain-components` 文件，并额外绑定 `parameters.ts`。脚本校验旧基线未改变、原始文件与 helper 哈希、当前产品源码哈希和官方依赖。若出现任何位差异，探针保存报告后退出 1。

首次严格通过材料原由 `archive-gain-fidelity.mjs` 归档；该归档器要求源码哈希仍与当时报告相符。后续音高 helper 等源码变化不能反向改写这份带日期的结果，应使用独立 final recheck。
