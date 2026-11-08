$ErrorActionPreference = 'Stop'
$workspaceRoot = Split-Path -Parent $PSScriptRoot
$baseRoot = Join-Path $workspaceRoot '.local\audio-runtime'
$basePython = Join-Path $baseRoot 'Scripts\python.exe'
if (!(Test-Path -LiteralPath $basePython)) { throw 'Run setup-audio-assist.ps1 first; this optional CPU runtime reuses its analysis dependencies read-only.' }
$fastRoot = Join-Path $workspaceRoot '.local\audio-runtime-fast'
$fastPython = Join-Path $fastRoot 'Scripts\python.exe'
if (!(Test-Path -LiteralPath $fastPython)) {
    & $basePython -m venv $fastRoot
    if ($LASTEXITCODE -ne 0) { throw 'Could not create the isolated fast CPU runtime.' }
}
# New environment packages precede these shared dependencies. Do not uninstall or
# upgrade anything in the base runtime, system Python, CUDA toolkit or drivers.
Set-Content -LiteralPath (Join-Path $fastRoot 'Lib\site-packages\neonbs-base-runtime.pth') -Value (Join-Path $baseRoot 'Lib\site-packages') -Encoding ascii
$pipCache = Join-Path $workspaceRoot '.local\pip-cache'
& $fastPython -m pip install --no-deps --cache-dir $pipCache --index-url https://download.pytorch.org/whl/cpu torch==2.8.0+cpu
if ($LASTEXITCODE -ne 0) { throw 'Could not install the official 619 MB CPU wheel; base runtime is preserved.' }
& $fastPython -m pip install --no-deps --cache-dir $pipCache --index-url https://pypi.org/simple fsspec==2025.9.0
if ($LASTEXITCODE -ne 0) { throw 'Could not install the isolated CPU dependency.' }
& $fastPython -c "import torch,librosa,soundfile,yaml,soxr,beartype,rotary_embedding_torch,fsspec; assert torch.__version__ == '2.8.0+cpu'; assert torch.version.cuda is None"
if ($LASTEXITCODE -ne 0) { throw 'Fast runtime import check failed; it has not been enabled.' }
Set-Content -LiteralPath (Join-Path $fastRoot 'neonbs-mega-ready.json') -Value '{"schema":1,"torch":"2.8.0+cpu","scope":"mega-cpu-only","baseDependencies":"read-only"}' -Encoding ascii
Write-Output 'Fast CPU runtime ready for Mega. Restart NeoNBS. Base analysis and Demucs research continue using the original runtime. No model was downloaded.'
