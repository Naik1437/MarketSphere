param(
  [string]$Project = "marketsphere-final-assessment",
  [switch]$Cleanup
)

$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$evidence = Join-Path $root ("docs/evidence/runtime-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
New-Item -ItemType Directory -Path $evidence -Force | Out-Null
Start-Transcript -Path (Join-Path $evidence "session.log") | Out-Null
try {
  Push-Location $root
  $compose = @("compose", "-p", $Project)
  function Run-Compose([string[]]$args) { & docker @compose @args }

  "Project=$Project" | Set-Content (Join-Path $evidence "metadata.txt")
  Run-Compose @("up", "-d", "--build")
  Run-Compose @("exec", "-T", "api", "npx", "prisma", "migrate", "deploy")
  Run-Compose @("exec", "-T", "api", "npx", "prisma", "db", "seed")

  Run-Compose @("exec", "-T", "api", "npx", "vitest", "run", "tests/commerce.test.ts", "tests/webhooks.test.ts", "tests/regression.test.ts") 2>&1 | Tee-Object (Join-Path $evidence "api-incident-tests.txt")
  Push-Location (Join-Path $root "apps/web")
  npm.cmd run e2e:ci 2>&1 | Tee-Object (Join-Path $evidence "browser-e2e.txt")
  Pop-Location

  Run-Compose @("exec", "-T", "postgres", "psql", "-U", "marketsphere", "-d", "marketsphere", "-c", "SELECT 'orders' AS table_name, count(*) FROM \"Order\" UNION ALL SELECT 'payments', count(*) FROM \"Payment\" UNION ALL SELECT 'refunds', count(*) FROM \"Refund\" UNION ALL SELECT 'webhooks', count(*) FROM \"WebhookEvent\";") | Set-Content (Join-Path $evidence "database-state.txt")
  Run-Compose @("logs", "--no-color", "api", "worker") | Set-Content (Join-Path $evidence "service-logs.txt")
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root "deploy/scripts/health-monitor.ps1") -Output (Join-Path $evidence "health-monitor.jsonl") | Out-Null

  $backup = Join-Path $evidence "marketsphere-backup.sql"
  Run-Compose @("exec", "-T", "postgres", "pg_dump", "-U", "marketsphere", "-d", "marketsphere") | Set-Content -Encoding utf8 $backup
  $restoreDb = "restore_verify_" + (Get-Date -Format "HHmmss")
  Run-Compose @("exec", "-T", "postgres", "createdb", "-U", "marketsphere", $restoreDb)
  Get-Content -Raw -LiteralPath $backup | & docker @compose exec -T postgres psql -U marketsphere -d $restoreDb | Set-Content (Join-Path $evidence "restore-output.txt")
  $restoreState = Run-Compose @("exec", "-T", "postgres", "psql", "-U", "marketsphere", "-d", $restoreDb, "-tAc", "SELECT count(*) FROM \"Order\";")
  "Backup created: $backup" | Set-Content (Join-Path $evidence "backup-restore.txt")
  "Restore database: $restoreDb; restored Order rows: $restoreState" | Add-Content (Join-Path $evidence "backup-restore.txt")
  "Incident mapping: commerce.test.ts covers overselling, stale stock, shipment/refund paths; webhooks.test.ts covers signed failure/retry; regression.test.ts covers scoped idempotency, concurrent refunds, partial shipment idempotency, cart cleanup, and inventory validation." | Set-Content (Join-Path $evidence "rca-verification.txt")
  "Runtime evidence generated without modifying the demonstration database. The isolated Compose project is left running unless -Cleanup is supplied." | Add-Content (Join-Path $evidence "rca-verification.txt")
}
finally {
  Pop-Location
  Stop-Transcript | Out-Null
  if ($Cleanup) { & docker @compose down }
}
