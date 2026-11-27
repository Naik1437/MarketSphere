param(
  [string]$Project = "marketsphere-final-assessment-$(Get-Date -Format yyyyMMddHHmmss)",
  [int]$ApiPort = 4400,
  [int]$WebPort = 3300,
  [int]$PythonPort = 8800,
  [switch]$Cleanup
)

$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$evidence = Join-Path $root ("docs/evidence/runtime-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
New-Item -ItemType Directory -Path $evidence -Force | Out-Null
$compose = @("compose", "-p", $Project)
$env:API_HOST_PORT = "$ApiPort"
$env:WEB_HOST_PORT = "$WebPort"
$env:PYTHON_HOST_PORT = "$PythonPort"
$env:MARKETSPHERE_WEB_URL = "http://localhost:$WebPort"
$env:NEXT_PUBLIC_API_URL = "http://localhost:$ApiPort"
$env:CORS_ORIGIN = "http://localhost:$WebPort"

function Invoke-Native([string]$File, [string[]]$CommandArgs) {
  $output = & $File @Args 2>&1
  if ($LASTEXITCODE -ne 0) { throw "$File failed with exit code $LASTEXITCODE`n$($output -join [Environment]::NewLine)" }
  return @($output)
}
function Invoke-Docker([string[]]$CommandArgs) { Invoke-Native "docker" $CommandArgs }
function Invoke-Compose([string[]]$CommandArgs) { Invoke-Docker ($compose + $CommandArgs) }
function Wait-Ready([string]$Url) {
  for ($attempt = 1; $attempt -le 40; $attempt++) {
    try {
      $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 3
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 400) { return }
    } catch { }
    Start-Sleep -Seconds 2
  }
  throw "Readiness timeout: $Url"
}

Start-Transcript -Path (Join-Path $evidence "session.log") | Out-Null
try {
  Push-Location $root
  "Project=$Project`nApiPort=$ApiPort`nWebPort=$WebPort`nPythonPort=$PythonPort" | Set-Content (Join-Path $evidence "metadata.txt")
  Invoke-Compose @("up", "-d", "--build") | Set-Content (Join-Path $evidence "compose-up.txt")
  Wait-Ready "http://localhost:$ApiPort/health"
  Wait-Ready "http://localhost:$WebPort/api/health"
  Wait-Ready "http://localhost:$PythonPort/health"
  Invoke-Compose @("exec", "-T", "api", "npx", "prisma", "migrate", "deploy") | Set-Content (Join-Path $evidence "migrate.txt")
  Invoke-Compose @("exec", "-T", "api", "npx", "prisma", "db", "seed") | Set-Content (Join-Path $evidence "seed.txt")

  $scenarios = @(
    @{ Name = "01-overselling"; Pattern = "prevents overselling on concurrent last-item checkout" },
    @{ Name = "02-stale-stock"; Pattern = "expires reservations idempotently" },
    @{ Name = "03-payment-order-mismatch"; Pattern = "deduplicates repeated signed payment webhook events" },
    @{ Name = "04-slow-search"; Pattern = "records a catalog slow-search benchmark" },
    @{ Name = "05-shipping-callback-recovery"; Pattern = "retries a failed shipping callback after the shipment is available" },
    @{ Name = "06-duplicate-refunds"; Pattern = "supports partial fulfillment, rejects invalid transitions, and deduplicates refunds" }
  )
  foreach ($scenario in $scenarios) {
    $scenarioOutput = Invoke-Compose @("exec", "-T", "api", "npx", "vitest", "run", "tests/commerce.test.ts", "tests/webhooks.test.ts", "tests/performance-shipping.test.ts", "--testNamePattern", $scenario.Pattern)
    $scenarioOutput | Set-Content (Join-Path $evidence "$($scenario.Name).log")
  }

  $npm = if ($IsWindows) { "npm.cmd" } else { "npm" }
  Push-Location (Join-Path $root "apps/web")
  $e2e = & $npm run e2e:ci 2>&1
  if ($LASTEXITCODE -ne 0) { throw "Browser E2E failed with exit code $LASTEXITCODE`n$($e2e -join [Environment]::NewLine)" }
  $e2e | Set-Content (Join-Path $evidence "browser-e2e.txt")
  Pop-Location

  $cid = (Invoke-Compose @("ps", "-q", "postgres") | Select-Object -First 1).Trim()
  if ([string]::IsNullOrWhiteSpace($cid)) { throw "Could not resolve isolated postgres container" }
  Invoke-Compose @("exec", "-T", "postgres", "sh", "-lc", "pg_dump -U marketsphere -d marketsphere > /tmp/marketsphere-backup.sql") | Out-Null
  $backup = Join-Path $evidence "marketsphere-backup.sql"
  Invoke-Docker @("cp", "${cid}:/tmp/marketsphere-backup.sql", $backup) | Out-Null
  $restoreDb = "restore_verify_$([DateTime]::UtcNow.ToString('HHmmss'))"
  Invoke-Compose @("exec", "-T", "postgres", "createdb", "-U", "marketsphere", $restoreDb) | Out-Null
  Invoke-Compose @("exec", "-T", "postgres", "sh", "-lc", "psql -v ON_ERROR_STOP=1 -U marketsphere -d $restoreDb -f /tmp/marketsphere-backup.sql") | Set-Content (Join-Path $evidence "restore-output.txt")
  $sql = "SELECT 'Order' || ':' || count(*) FROM `"Order`" UNION ALL SELECT 'Payment' || ':' || count(*) FROM `"Payment`" UNION ALL SELECT 'Refund' || ':' || count(*) FROM `"Refund`" UNION ALL SELECT 'WebhookEvent' || ':' || count(*) FROM `"WebhookEvent`" ORDER BY 1;"
  $source = (Invoke-Compose @("exec", "-T", "postgres", "psql", "-v", "ON_ERROR_STOP=1", "-U", "marketsphere", "-d", "marketsphere", "-tAc", $sql) -join "").Trim()
  $restored = (Invoke-Compose @("exec", "-T", "postgres", "psql", "-v", "ON_ERROR_STOP=1", "-U", "marketsphere", "-d", $restoreDb, "-tAc", $sql) -join "").Trim()
  if ($source -ne $restored) { throw "Backup restore count comparison failed`nSOURCE:`n$source`nRESTORED:`n$restored" }
  $sourceChecksum = (Invoke-Compose @("exec", "-T", "postgres", "psql", "-v", "ON_ERROR_STOP=1", "-U", "marketsphere", "-d", "marketsphere", "-tAc", "SELECT md5(string_agg(table_name || ':' || row_count, ',' ORDER BY table_name)) FROM (SELECT 'Order' table_name, count(*) row_count FROM `"Order`" UNION ALL SELECT 'Payment', count(*) FROM `"Payment`" UNION ALL SELECT 'Refund', count(*) FROM `"Refund`" UNION ALL SELECT 'WebhookEvent', count(*) FROM `"WebhookEvent`") s;") -join "").Trim()
  $restoredChecksum = (Invoke-Compose @("exec", "-T", "postgres", "psql", "-v", "ON_ERROR_STOP=1", "-U", "marketsphere", "-d", $restoreDb, "-tAc", "SELECT md5(string_agg(table_name || ':' || row_count, ',' ORDER BY table_name)) FROM (SELECT 'Order' table_name, count(*) row_count FROM `"Order`" UNION ALL SELECT 'Payment', count(*) FROM `"Payment`" UNION ALL SELECT 'Refund', count(*) FROM `"Refund`" UNION ALL SELECT 'WebhookEvent', count(*) FROM `"WebhookEvent`") s;") -join "").Trim()
  if ($sourceChecksum -ne $restoredChecksum) { throw "Backup restore checksum comparison failed" }
  "Backup=$backup`nRestoreDatabase=$restoreDb`nSourceCounts=$source`nRestoredCounts=$restored`nSourceChecksum=$sourceChecksum`nRestoredChecksum=$restoredChecksum" | Set-Content (Join-Path $evidence "backup-restore.txt")
  Invoke-Compose @("logs", "--no-color", "api", "worker") | Set-Content (Join-Path $evidence "service-logs.txt")
}
finally {
  if ($PWD.Path -ne $root) { Pop-Location }
  Stop-Transcript | Out-Null
  if ($Cleanup -and (Get-Command docker -ErrorAction SilentlyContinue)) { Invoke-Compose @("down") }
}


