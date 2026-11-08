param([string]$Python = 'python', [string]$RuntimeDir = '')
$ErrorActionPreference = 'Stop'
$workspaceRoot = Split-Path -Parent $PSScriptRoot
$runtimeRoot = if ($RuntimeDir) { [System.IO.Path]::GetFullPath($RuntimeDir) } else { Join-Path $workspaceRoot '.local\audio-runtime' }
if (!(Test-Path -LiteralPath (Join-Path $runtimeRoot 'Scripts\python.exe'))) {
    & $Python -m venv $runtimeRoot
    if ($LASTEXITCODE -ne 0) { throw 'Could not create the isolated audio runtime.' }
}
$runtimePython = Join-Path $runtimeRoot 'Scripts\python.exe'
& $runtimePython -m pip install --index-url https://download.pytorch.org/whl/cpu torch==2.0.1 torchaudio==2.0.2
if ($LASTEXITCODE -ne 0) { throw 'Could not install official PyTorch CPU packages.' }
& $runtimePython -m pip install --index-url https://pypi.org/simple -r (Join-Path $PSScriptRoot 'audio-assist-requirements.txt')
if ($LASTEXITCODE -ne 0) { throw 'Could not install audio analysis dependencies.' }
& $runtimePython (Join-Path $PSScriptRoot 'setup-smart-tempo.py')
if ($LASTEXITCODE -ne 0) { throw 'Could not install the Beat This! Smart Tempo model.' }
Write-Output 'Local runtime and Smart Tempo are ready. No separation model was downloaded.'
