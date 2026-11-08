$ErrorActionPreference = 'Stop'
$workspaceRoot = Split-Path -Parent $PSScriptRoot
$fastRoot = Join-Path $workspaceRoot '.local\audio-runtime-fast'
$baseRoot = Join-Path $workspaceRoot '.local\audio-runtime'
$fastPython = Join-Path $fastRoot 'Scripts\python.exe'
if (!(Test-Path -LiteralPath $fastPython)) { throw 'Set up the fast CPU runtime first. CUDA is optional and never replaces CPU support.' }
$drive = Get-PSDrive -Name ([IO.Path]::GetPathRoot($workspaceRoot).TrimEnd(':\'))
if ($drive.Free -lt 12GB) { throw 'The optional CUDA installation needs 12 GiB of free workspace disk space.' }
& $fastPython -u (Join-Path $PSScriptRoot 'download-audio-cuda-runtime.py')
if ($LASTEXITCODE -ne 0) { throw 'Optional official CUDA download failed; CPU runtime is unchanged.' }
$cudaRoot = Join-Path $workspaceRoot '.local\audio-runtime-cuda'
$cudaPython = Join-Path $cudaRoot 'Scripts\python.exe'
if (!(Test-Path -LiteralPath $cudaPython)) {
    & $fastPython -m venv $cudaRoot
    if ($LASTEXITCODE -ne 0) { throw 'Could not create the optional CUDA venv.' }
}
@((Join-Path $fastRoot 'Lib\site-packages'), (Join-Path $baseRoot 'Lib\site-packages')) | Set-Content -LiteralPath (Join-Path $cudaRoot 'Lib\site-packages\neonbs-shared-analysis.pth') -Encoding ascii
$wheel = Join-Path $workspaceRoot '.local\runtime-downloads\torch-2.8.0+cu126-cp310-cp310-win_amd64.whl'
& $cudaPython -m pip install --no-deps --no-cache-dir $wheel
if ($LASTEXITCODE -ne 0) { throw 'Optional CUDA package installation failed; CPU runtime is unchanged.' }
& $cudaPython -c "import torch,librosa,soundfile,yaml,soxr,beartype,rotary_embedding_torch,fsspec; assert torch.__version__ == '2.8.0+cu126'; print('CUDA available:',torch.cuda.is_available())"
if ($LASTEXITCODE -ne 0) { throw 'Optional CUDA import check failed; CPU remains available.' }
Set-Content -LiteralPath (Join-Path $cudaRoot 'neonbs-cuda-ready.json') -Value '{"schema":1,"torch":"2.8.0+cu126","optional":true}' -Encoding ascii
Write-Output 'Optional CUDA runtime installed. CPU remains the default. No driver, system Python, or model weight was changed.'
