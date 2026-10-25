param([Parameter(Mandatory=$true)][string]$ArtifactUrl, [Parameter(Mandatory=$true)][string]$Destination)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
if (([Uri]$ArtifactUrl).Host -ne 'github.com') { throw 'Unexpected Electron artifact host.' }
Invoke-WebRequest -UseBasicParsing -Uri $ArtifactUrl -OutFile $Destination -TimeoutSec 300
