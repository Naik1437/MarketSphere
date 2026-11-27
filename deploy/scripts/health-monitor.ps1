param(
  [int]$Iterations = 3,
  [int]$IntervalSeconds = 10,
  [string]$Output = "health-monitor.jsonl"
)

$ErrorActionPreference = "Stop"
Remove-Item -LiteralPath $Output -ErrorAction SilentlyContinue
for ($i = 1; $i -le $Iterations; $i++) {
  $row = [ordered]@{
    timestamp = (Get-Date).ToUniversalTime().ToString("o")
    iteration = $i
    api = "down"
    web = "down"
    python = "down"
  }
  try { Invoke-WebRequest http://localhost:4000/health -UseBasicParsing -TimeoutSec 5 | Out-Null; $row.api = "ok" } catch {}
  try { Invoke-WebRequest http://localhost:3000/api/health -UseBasicParsing -TimeoutSec 5 | Out-Null; $row.web = "ok" } catch {}
  try { Invoke-WebRequest http://localhost:8000/health -UseBasicParsing -TimeoutSec 5 | Out-Null; $row.python = "ok" } catch {}
  ($row | ConvertTo-Json -Compress) | Add-Content -LiteralPath $Output
  if ($i -lt $Iterations) { Start-Sleep -Seconds $IntervalSeconds }
}
Get-Content -LiteralPath $Output
