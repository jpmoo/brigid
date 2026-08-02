<#
.SYNOPSIS
  Install Brigid on Windows.

.DESCRIPTION
  The counterpart to install.sh (Ubuntu/Debian) and install-macos.sh. Installs
  Node, pnpm and PostgreSQL via winget, creates the database, builds the app,
  and registers a scheduled task that starts Brigid at boot.

  Run from an elevated PowerShell in the checkout:

      Set-ExecutionPolicy -Scope Process Bypass -Force
      .\install-windows.ps1

  Safe to run twice. Every step checks for what it is about to do.

.PARAMETER Port
  Port to serve on. Defaults to 8090.

.PARAMETER DbName
  Database to create. Defaults to brigid.
#>
[CmdletBinding()]
param(
  [int]$Port = 8090,
  [string]$DbName = 'brigid',
  [string]$DbUser = 'brigid'
)

$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot

function Say  { param($m) Write-Host "`n==> $m" -ForegroundColor Cyan }
function Note { param($m) Write-Host "    $m" }
function Die  { param($m) Write-Host "`n!!! $m" -ForegroundColor Red; exit 1 }

# --- Checks before anything is changed --------------------------------------

$admin = ([Security.Principal.WindowsPrincipal] `
  [Security.Principal.WindowsIdentity]::GetCurrent()
).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) {
  Die 'Run this from an elevated PowerShell — registering a startup task needs it.'
}

if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
  Die 'winget is not available. Install "App Installer" from the Microsoft Store, then run this again.'
}

Say "Installing Brigid from $PSScriptRoot"
Note "Port $Port · database '$DbName'"

# --- Packages ---------------------------------------------------------------

function Ensure-Package {
  param($Command, $WingetId, $Label)
  if (Get-Command $Command -ErrorAction SilentlyContinue) {
    Note "$Label already installed."
    return
  }
  Say $Label
  winget install --id $WingetId --exact --silent `
    --accept-source-agreements --accept-package-agreements | Out-Null
  # winget puts new commands on the machine PATH, which this process inherited
  # at launch and will not see until it is rebuilt by hand.
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
              [Environment]::GetEnvironmentVariable('Path', 'User')
}

Ensure-Package -Command node -WingetId 'OpenJS.NodeJS.LTS' -Label 'Node'
Ensure-Package -Command psql -WingetId 'PostgreSQL.PostgreSQL.16' -Label 'PostgreSQL 16'

if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
  Say 'pnpm'
  npm install -g pnpm@9.12.0 | Out-Null
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
              [Environment]::GetEnvironmentVariable('Path', 'User')
}

if (-not (Get-Command psql -ErrorAction SilentlyContinue)) {
  # The PostgreSQL installer does not always add its bin to PATH.
  $pgBin = Get-ChildItem 'C:\Program Files\PostgreSQL' -Directory -ErrorAction SilentlyContinue |
           Sort-Object Name -Descending | Select-Object -First 1
  if ($pgBin) { $env:Path = "$($pgBin.FullName)\bin;$env:Path" }
}
if (-not (Get-Command psql -ErrorAction SilentlyContinue)) {
  Die 'psql is still not on PATH. Open a new elevated PowerShell and run this again.'
}

# --- PostgreSQL -------------------------------------------------------------

Say 'PostgreSQL'
$service = Get-Service -Name 'postgresql*' -ErrorAction SilentlyContinue | Select-Object -First 1
if ($service) {
  if ($service.Status -ne 'Running') { Start-Service $service.Name }
  Set-Service $service.Name -StartupType Automatic
  Note "Service '$($service.Name)' is running and set to start at boot."
} else {
  Note 'No PostgreSQL service found; assuming it is reachable some other way.'
}

# Unlike Debian and Homebrew, Windows has no passwordless local path to the
# superuser: the installer sets a password for 'postgres' and nothing else can
# get in. It has to be asked for, once.
$pgPass = Read-Host -AsSecureString "Password for the PostgreSQL 'postgres' user (set when it was installed)"
$env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
  [Runtime.InteropServices.Marshal]::SecureStringToBSTR($pgPass))

try { psql -U postgres -h localhost -tAc 'SELECT 1' | Out-Null }
catch { Die 'Could not connect as postgres. Check the password and that the service is running.' }

# A generated password, because nobody types this one — it goes straight into a
# file the app reads.
$bytes = New-Object byte[] 24
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$appPass = [Convert]::ToBase64String($bytes) -replace '[/+=]', ''

$roleExists = psql -U postgres -h localhost -tAc "SELECT 1 FROM pg_roles WHERE rolname='$DbUser'"
if ($roleExists -match '1') {
  Note "Role '$DbUser' already exists; leaving its password alone."
  $appPass = $null
} else {
  psql -U postgres -h localhost -q -c "CREATE ROLE $DbUser WITH LOGIN PASSWORD '$appPass';" | Out-Null
  Note "Created role '$DbUser'."
}

$dbExists = psql -U postgres -h localhost -tAc "SELECT 1 FROM pg_database WHERE datname='$DbName'"
if ($dbExists -match '1') {
  Note "Database '$DbName' already exists."
} else {
  psql -U postgres -h localhost -q -c "CREATE DATABASE $DbName OWNER $DbUser;" | Out-Null
  Note "Created database '$DbName'."
}

psql -U postgres -h localhost -q -d $DbName -c 'CREATE EXTENSION IF NOT EXISTS pgcrypto;' | Out-Null
Remove-Item Env:PGPASSWORD

# --- Configuration ----------------------------------------------------------

Say 'Configuration'
if (Test-Path '.env.local') {
  Note '.env.local already exists; leaving it alone.'
  if ($appPass) {
    Note 'NOTE: a new role was created but .env.local was not touched. Add:'
    Note "      DATABASE_URL=postgres://${DbUser}:${appPass}@localhost:5432/${DbName}"
  }
} else {
  $secretBytes = New-Object byte[] 48
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($secretBytes)
  $secret = [Convert]::ToBase64String($secretBytes)

  $lines = @(
    '# Written by install-windows.ps1. Safe to edit; nothing overwrites it.'
    "PORT=$Port"
    'HOST=0.0.0.0'
    "SESSION_SECRET=$secret"
  )
  if ($appPass) {
    $lines += "DATABASE_URL=postgres://${DbUser}:${appPass}@localhost:5432/${DbName}"
  } else {
    $lines += '# The role already existed, so its password is not known here.'
    $lines += "# DATABASE_URL=postgres://${DbUser}:PASSWORD@localhost:5432/${DbName}"
  }
  # ASCII, not the PowerShell default: a UTF-16 or BOM-prefixed file is not
  # something a dotenv parser will read.
  $lines | Out-File -FilePath '.env.local' -Encoding ascii
  Note 'Wrote .env.local'
}

# --- Build ------------------------------------------------------------------

Say 'Installing dependencies'
pnpm install
if ($LASTEXITCODE -ne 0) { Die 'pnpm install failed.' }

Say 'Building the web app'
# apps/web/dist is gitignored, so without this every page is a bare 404 while
# the API answers perfectly — a confusing way to arrive.
pnpm build:web
if ($LASTEXITCODE -ne 0) { Die 'The web build failed.' }

Say 'Applying database migrations'
if (Select-String -Path '.env.local' -Pattern '^\s*DATABASE_URL=' -Quiet) {
  pnpm db:migrate
  if ($LASTEXITCODE -ne 0) { Die 'Migrations failed. Check DATABASE_URL in .env.local, then rerun.' }
} else {
  Note 'Skipped — no DATABASE_URL yet.'
  Note 'Add it to .env.local, then run: pnpm db:migrate'
}

# --- Start at boot ----------------------------------------------------------

Say 'Starting at boot'
# A scheduled task rather than a Windows service. A service must be a program
# built to talk the service control protocol, which Node is not — the usual
# answer is a third-party wrapper like NSSM, and a scheduled task at startup
# does the same job with nothing extra to install or keep up to date.
$taskName = 'Brigid'
$pnpmCmd = (Get-Command pnpm).Source

$action = New-ScheduledTaskAction -Execute $pnpmCmd -Argument 'start' -WorkingDirectory $PSScriptRoot
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit (New-TimeSpan -Seconds 0)

Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
  -Principal $principal -Settings $settings -Description 'Brigid novel writing application' | Out-Null
Start-ScheduledTask -TaskName $taskName
Note "Registered scheduled task '$taskName' and started it."

Start-Sleep -Seconds 5
try {
  Invoke-WebRequest -Uri "http://localhost:$Port/api/health" -UseBasicParsing -TimeoutSec 5 | Out-Null
} catch {
  Die "Brigid did not answer on port $Port. Check the task in Task Scheduler, or run 'pnpm start' here to see the error."
}

# --- Firewall ---------------------------------------------------------------

if (-not (Get-NetFirewallRule -DisplayName 'Brigid' -ErrorAction SilentlyContinue)) {
  New-NetFirewallRule -DisplayName 'Brigid' -Direction Inbound -Protocol TCP `
    -LocalPort $Port -Action Allow -Profile Private | Out-Null
  Note "Opened port $Port on private networks."
}

# --- Done -------------------------------------------------------------------

Say 'Brigid is running.'
Write-Host ''
Note "Open   http://localhost:$Port"
Note 'and create your account — the first visit sets it up.'
Write-Host ''
Note "Restart  Restart-ScheduledTask -TaskName $taskName"
Note "Stop     Stop-ScheduledTask -TaskName $taskName"
Note 'Update   git pull; pnpm install; pnpm build:web; pnpm db:migrate; Restart-ScheduledTask -TaskName Brigid'
Write-Host ''
