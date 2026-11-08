# Windows 0.1.60 RC1 构建与验收

在 Windows x64 真机或虚拟机上，用普通用户打开 PowerShell。需要 Git、x64 Node.js 24（推荐）或 26+、JDK 17（或其他支持 `javac --release 8` 的 JDK），以及能访问 npm、GitHub 和 Mojang 资源服务的网络。基础安装与试听不需要 Python、FFmpeg 或 Minecraft。建议用测试账户或虚拟机快照，方便验证旧版升级和卸载。

## 从候选提交构建

把 `NeoNBS-0.1.60-rc1.bundle` 复制到 Windows 的测试目录，在该目录运行：

```powershell
git clone --branch codex/release-0.1.60-rc1 .\NeoNBS-0.1.60-rc1.bundle .\NeoNBS-0.1.60-rc1
if ($LASTEXITCODE -ne 0) { throw 'Clone failed' }
Set-Location .\NeoNBS-0.1.60-rc1
node -p "process.version + ' ' + process.arch"
javac -version
git rev-parse HEAD
node .\scripts\windows-release.mjs build
if ($LASTEXITCODE -ne 0) { throw 'Candidate build failed' }
```

构建命令会检查干净的 Git 提交和发布内容，依次运行 `npm ci`、`npm test`、`npm run package:win`，并核对打包内容。输出在 `release\0.1.60`：`NeoNBS-0.1.60-x64-setup.exe`、`NeoNBS-0.1.60-x64-portable.exe`、`SHA256SUMS.txt` 和记录源码提交的 `windows-candidate-build.json`。

## 安装版

在干净测试账户运行安装程序。下面的验收命令假设在安装向导里选择了 `%LOCALAPPDATA%\Programs\NeoNBS-RC1`；如选了其他位置，改为实际安装的 `NeoNBS.exe`。要测试升级，先在测试账户装 0.1.59 并保存一份小工程，然后用同一安装目录覆盖升级。

```powershell
$setup = (Resolve-Path .\release\0.1.60\NeoNBS-0.1.60-x64-setup.exe).Path
Start-Process -FilePath $setup -Wait
```

安装后从开始菜单启动一次，确认「关于」显示 0.1.60，然后关闭应用并运行：

```powershell
$app = Join-Path $env:LOCALAPPDATA 'Programs\NeoNBS-RC1\NeoNBS.exe'
node .\scripts\windows-release.mjs verify "$app"
if ($LASTEXITCODE -ne 0) { throw 'Installed app verification failed' }
```

自动验收先核对实际安装的程序和资源与候选构建一致，再用隔离资料目录测试 20 种内置音色、诊断导出、保存和恢复、MIDI 与 NBS。报告写到 `.local\windows-release-verification\run-*\report.json`，不会把手动步骤计为通过。

在普通权限的 Explorer 双击保存好的 `.nbsx`，确认关联到正确程序并打开工程。检查 Windows 显示设置在 100% 和 125% 时的顶部控制、Delay 旋钮／滑块、右键菜单及跨平台玻璃。升级后确认旧工程和设置仍在。卸载前关掉程序，确认快捷方式和程序被移除、测试工程仍在；如要做后续音频验收，先保留安装。

## 便携版

关闭安装版，在同一个 PowerShell 里运行实际的便携启动器，用单独的资料目录：

```powershell
$portable = (Resolve-Path .\release\0.1.60\NeoNBS-0.1.60-x64-portable.exe).Path
$portableProfile = Join-Path (Resolve-Path .\.local).Path 'portable-rc1-profile'
Start-Process -FilePath $portable -ArgumentList ('--user-data-dir="{0}"' -f $portableProfile)
```

确认能首次启动、内置音色能出声、创建工程并另存为到启动器外的目录。关闭后用同一条命令再开并打开刚才的工程。可从「帮助 → 打开日志文件夹」核对资料落在 `portable-rc1-profile`。这一步要运行实际的 `-portable.exe`，安装副本的自动报告不能代替它。

## 音频与玻璃效果

如要验收智能速度、和弦分析、分轨和自动玻璃像素检查，安装 x64 Python 3.11。下面用安装包自带的脚本，把音频组件装到一个隔离的资料目录。若没有 `py` 命令，可把 `$python` 设为实际的 x64 Python 3.11 可执行文件。使用上一节设置的 `$app`：

```powershell
$python = & py -3.11 -c 'import sys; assert sys.maxsize > 2**32; print(sys.executable)'
if ($LASTEXITCODE -ne 0) { throw 'x64 Python 3.11 is required' }
$profile = Join-Path (Resolve-Path .\.local).Path 'audio-rc1-profile'
$runtime = Join-Path $profile 'audio-runtime'
$tools = Join-Path (Split-Path $app) 'resources\audio-runtime-tools'
powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $tools 'setup-audio-assist.ps1') -Python "$python" -RuntimeDir "$runtime"
if ($LASTEXITCODE -ne 0) { throw 'Audio runtime setup failed' }
$qaPython = Join-Path $runtime 'Scripts\python.exe'
& $qaPython -m pip install Pillow
if ($LASTEXITCODE -ne 0) { throw 'Pillow setup failed' }
node .\scripts\windows-release.mjs verify "$app" --audio-runtime "$runtime" --glass-python "$qaPython"
if ($LASTEXITCODE -ne 0) { throw 'Audio or glass verification failed' }
Start-Process -FilePath $app -ArgumentList ('--user-data-dir="{0}"' -f $profile)
```

从 Explorer 把本地 WAV 拖进新建工程的时间线，检查片段位置、智能速度和首拍对齐。右键分别运行和弦分析和大分轨。第一次分轨须先在界面下载模型；先用短 WAV、CPU 和单个声部验证，随后用一首完整曲目试听和导出。保存并重开工程，确认同名的 `.nbsx.assets` 目录和音频都可用。若测试 AAC／M4A，把已有的 `ffmpeg.exe` 所在目录加入 PATH 后重启测试应用。最后在便携版重复一次真实拖放和保存重开，可用同一隔离音频资料目录启动便携版（须先关闭安装版）。

记录安装版、便携版和完整曲目各自的结果，保留构建摘要、SHA-256 与自动验收报告；发生问题时注明使用的是哪一个 EXE，以及失败的步骤。
