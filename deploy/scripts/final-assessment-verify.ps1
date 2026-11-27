param([string]$Project = "marketsphere-final-assessment-$(Get-Date -Format yyyyMMddHHmmss)",[int]$ApiPort=4400,[int]$WebPort=3300,[int]$PythonPort=8800,[switch]$Cleanup)
$ErrorActionPreference="Stop"
$root=(Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$evidence=Join-Path $root ("docs/evidence/runtime-"+(Get-Date -Format "yyyyMMdd-HHmmss")); New-Item -ItemType Directory -Path $evidence -Force|Out-Null
$compose=@("compose","-p",$Project); $env:API_HOST_PORT="$ApiPort"; $env:WEB_HOST_PORT="$WebPort"; $env:PYTHON_HOST_PORT="$PythonPort"; $env:MARKETSPHERE_WEB_URL="http://localhost:$WebPort"
function Invoke-Docker([string[]]$Args){$o=& docker @Args 2>&1;if($LASTEXITCODE-ne 0){throw "docker failed ($LASTEXITCODE): $($o -join [Environment]::NewLine)"};@($o)}
function Invoke-Compose([string[]]$Args){Invoke-Docker($compose+$Args)}
function Wait-Ready([string]$Url){1..40|%{try{Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 3|Out-Null;return}catch{Start-Sleep 2}};throw "Readiness timeout: $Url"}
Start-Transcript -Path (Join-Path $evidence "session.log")|Out-Null
try{Push-Location $root
  "Project=$Project`nApiPort=$ApiPort`nWebPort=$WebPort`nPythonPort=$PythonPort"|Set-Content (Join-Path $evidence "metadata.txt")
  Invoke-Compose @("up","-d","--build")|Tee-Object (Join-Path $evidence "compose-up.txt")
  Wait-Ready "http://localhost:$ApiPort/health";Wait-Ready "http://localhost:$WebPort/api/health";Wait-Ready "http://localhost:$PythonPort/health"
  Invoke-Compose @("exec","-T","api","npx","prisma","migrate","deploy")|Tee-Object (Join-Path $evidence "migrate.txt")
  Invoke-Compose @("exec","-T","api","npx","prisma","db","seed")|Tee-Object (Join-Path $evidence "seed.txt")
  Invoke-Compose @("exec","-T","api","npx","vitest","run","tests/commerce.test.ts","tests/webhooks.test.ts","tests/regression.test.ts")|Tee-Object (Join-Path $evidence "api-incident-tests.txt")
  Push-Location (Join-Path $root "apps/web");npm.cmd run e2e:ci 2>&1|Tee-Object (Join-Path $evidence "browser-e2e.txt");if($LASTEXITCODE-ne 0){throw "Browser E2E failed: $LASTEXITCODE"};Pop-Location
  Invoke-Compose @("logs","--no-color","api","worker")|Set-Content (Join-Path $evidence "service-logs.txt")
  $cid=(Invoke-Compose @("ps","-q","postgres")|Select-Object -First 1).Trim();Invoke-Compose @("exec","-T","postgres","sh","-lc","pg_dump -U marketsphere -d marketsphere > /tmp/marketsphere-backup.sql")|Out-Null
  $backup=Join-Path $evidence "marketsphere-backup.sql";Invoke-Docker @("cp","${cid}:/tmp/marketsphere-backup.sql",$backup)|Out-Null
  $db="restore_verify_$([DateTime]::UtcNow.ToString('HHmmss'))";Invoke-Compose @("exec","-T","postgres","createdb","-U","marketsphere",$db)|Out-Null;Invoke-Compose @("exec","-T","postgres","sh","-lc","psql -U marketsphere -d $db -f /tmp/marketsphere-backup.sql")|Tee-Object (Join-Path $evidence "restore-output.txt")
  $rows=(Invoke-Compose @("exec","-T","postgres","psql","-U","marketsphere","-d",$db,"-tAc","SELECT count(*) FROM \"Order\";")-join "").Trim();"Backup=$backup`nRestoreDatabase=$db`nRestoredOrderRows=$rows`nRestoreCommandExit=0"|Set-Content (Join-Path $evidence "backup-restore.txt")
  "Executed evidence only; unique Compose project, isolated volume and alternate ports are used."|Set-Content (Join-Path $evidence "rca-verification.txt")
}finally{if($PWD.Path-ne $root){Pop-Location};Stop-Transcript|Out-Null;if($Cleanup){Invoke-Compose @("down","-v")}}
