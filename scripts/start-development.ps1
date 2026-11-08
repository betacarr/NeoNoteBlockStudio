param([switch]$Verify)
$ErrorActionPreference = 'Stop'
$workspaceRoot = Split-Path -Parent $PSScriptRoot
$electronPath = Join-Path $workspaceRoot 'node_modules\electron\dist\electron.exe'
$profilePath = Join-Path $workspaceRoot '.local\development-profile'
foreach ($requiredPath in @($electronPath, (Join-Path $workspaceRoot 'dist\index.html'), (Join-Path $workspaceRoot 'dist-electron\main.cjs'))) {
    if (!(Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
        Add-Type -AssemblyName PresentationFramework
        [System.Windows.MessageBox]::Show('The local development build is missing. Run npm run build in the NeoNBS workspace.', 'NeoNBS development build') | Out-Null
        exit 1
    }
}
$previousRunAsNode = $env:ELECTRON_RUN_AS_NODE
$previousDevUrl = $env:NBSX_DEV_URL
$previousTestProfile = $env:NBSX_TEST_USER_DATA
try {
    $env:ELECTRON_RUN_AS_NODE = $null
    $env:NBSX_DEV_URL = $null
    $env:NBSX_TEST_USER_DATA = $profilePath
    $application = Start-Process -FilePath $electronPath -ArgumentList @(('"' + $workspaceRoot + '"'), ('"--user-data-dir=' + $profilePath + '"')) -WorkingDirectory $workspaceRoot -WindowStyle Normal -PassThru
    if ($Verify) {
        $application.WaitForInputIdle(15000) | Out-Null
        $application.Refresh()
        [pscustomobject]@{ ProcessId=$application.Id; HasExited=$application.HasExited; WindowTitle=$application.MainWindowTitle; Profile=$profilePath; Target=$electronPath; WorkingDirectory=$workspaceRoot } | ConvertTo-Json
    }
} finally {
    $env:ELECTRON_RUN_AS_NODE = $previousRunAsNode
    $env:NBSX_DEV_URL = $previousDevUrl
    $env:NBSX_TEST_USER_DATA = $previousTestProfile
}
