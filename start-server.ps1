param(
    [int]$Port = 8000,
    [switch]$Hidden,
    [switch]$AtSignIn
)

$ErrorActionPreference = 'Stop'
$backend = Join-Path $PSScriptRoot 'backend'
$python = Join-Path $backend '.venv\Scripts\python.exe'
$taskName = 'Voice Translator'

if (-not (Test-Path $python)) {
    Write-Host "There is no Python environment at $python. Set up the backend first (README, Backend setup)."
    exit 1
}

if ($AtSignIn) {
    $arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$PSCommandPath`" -Hidden -Port $Port"
    $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
    try { Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue } catch { }
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
    Start-ScheduledTask -TaskName $taskName
    Write-Host "The backend is starting in the background, and from now on it starts by itself when you sign in to Windows."
    Write-Host "Its messages, the host key included, are in $backend\data\server.log"
    Write-Host "To stop starting it by itself: Unregister-ScheduledTask -TaskName '$taskName' -Confirm:`$false"
    exit 0
}

if (-not $Hidden) {
    try { Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue } catch { }
}

$all = @(Get-CimInstance Win32_Process -Filter "Name='python.exe' OR Name='uvicorn.exe'")
$servers = @($all | Where-Object { $_.CommandLine -match 'uvicorn' -and $_.CommandLine -match 'app\.main' })
$serverIds = @($servers | ForEach-Object { $_.ProcessId })
$running = @(Get-Process | ForEach-Object { $_.Id })
$orphans = @($all | Where-Object {
        $_.CommandLine -match 'spawn_main' -and (($serverIds -contains $_.ParentProcessId) -or ($running -notcontains $_.ParentProcessId))
    })
foreach ($process in ($servers + $orphans)) {
    Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
}

$deadline = (Get-Date).AddSeconds(15)
while (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
    if ((Get-Date) -gt $deadline) {
        $holder = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)[0]
        $name = (Get-Process -Id $holder.OwningProcess -ErrorAction SilentlyContinue).ProcessName
        Write-Host "Port $Port is still used by another program ($name, process $($holder.OwningProcess)). Close it, or use another port: .\start-server.ps1 -Port 8001"
        exit 1
    }
    Start-Sleep -Milliseconds 500
}

$ErrorActionPreference = 'Continue'
if ($Hidden) {
    $data = Join-Path $backend 'data'
    New-Item -ItemType Directory -Force -Path $data | Out-Null
    $started = Start-Process -FilePath $python -ArgumentList @('-m', 'uvicorn', 'app.main:app', '--port', "$Port") -WorkingDirectory $backend -RedirectStandardOutput (Join-Path $data 'server-output.log') -RedirectStandardError (Join-Path $data 'server.log') -NoNewWindow -PassThru -Wait
    exit $started.ExitCode
}

Write-Host "Voice Translator is starting on http://localhost:$Port. Keep this window open; closing it stops the website."
Set-Location $backend
& $python -m uvicorn app.main:app --port $Port
exit $LASTEXITCODE
