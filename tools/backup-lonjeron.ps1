# ============================================================================
#  Ежедневный бэкап Лонжерона: база + фото и документы
#
#  Куда:
#    C:\Backups\Лонжерон\                        (этот компьютер, храним 30 дней)
#    \\Asus\d\Лонжерон-бэкапы\                   (сетевой диск Z:, храним 365 дней)
#
#  Если бэкап не получился — пишет предупреждение в «Обсуждения» программы.
# ============================================================================

$ErrorActionPreference = 'Stop'

$serverHost = 'root@82.202.129.162'
$key = 'C:\Users\Maks\.ssh\paint_deploy'
$knownHosts = Join-Path $env:TEMP 'known_hosts_tmp'

$backupDir = 'C:\Backups\Лонжерон'
$networkDir = '\\Asus\d\Лонжерон-бэкапы'
$logFile = Join-Path $backupDir 'backup.log'

$localKeepDays = 30
$networkKeepDays = 365

New-Item -ItemType Directory -Path $backupDir -Force | Out-Null

$stamp = Get-Date -Format 'yyyy-MM-dd_HHmm'
$localFile = Join-Path $backupDir "lonjeron-$stamp.tar.gz"

$sshOptions = @(
  '-i', $key,
  '-o', 'IdentitiesOnly=yes',
  '-o', 'BatchMode=yes',
  '-o', "UserKnownHostsFile=$knownHosts",
  '-o', 'StrictHostKeyChecking=accept-new',
  '-o', 'ConnectTimeout=20'
)

function Write-Log($text) {
  $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $text"
  Add-Content -Path $logFile -Value $line -Encoding UTF8
}

function Send-Alert($text) {
  try {
    # Текст передаём в base64 — иначе кавычки и пробелы ломают команду
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($text)
    $b64 = [Convert]::ToBase64String($bytes)
    & ssh @sshOptions $serverHost "cd /opt/paint/server && node --no-warnings tools/backup-notify.js --b64 $b64" 2>$null | Out-Null
  } catch {
    Write-Log "не смог отправить предупреждение: $($_.Exception.Message)"
  }
}

$remoteFile = $null

try {
  # 1. На сервере собираем архив: база + загрузки + настройки
  $reply = & ssh @sshOptions $serverHost "cd /opt/paint/server && node --no-warnings tools/backup-all.js 2>/dev/null"
  Write-Log "снимок: $reply"

  $info = $reply | ConvertFrom-Json

  if (-not $info.ok) { throw "сервер не сделал снимок: $reply" }

  $remoteFile = $info.file

  # 2. Забираем архив к себе
  & scp @sshOptions "${serverHost}:$remoteFile" $localFile 2>$null | Out-Null

  if (-not (Test-Path $localFile)) { throw 'архив не скачался' }

  $sizeMb = [math]::Round((Get-Item $localFile).Length / 1MB, 1)
  Write-Log "скачано: $localFile ($sizeMb МБ, база $([math]::Round($info.db_bytes / 1KB)) КБ, файлы $([math]::Round($info.uploads_bytes / 1KB)) КБ)"

  # 3. Копия на сетевой диск
  try {
    if (-not (Test-Path $networkDir)) {
      New-Item -ItemType Directory -Path $networkDir -Force | Out-Null
    }

    Copy-Item -Path $localFile -Destination $networkDir -Force

    $netTarget = Join-Path $networkDir (Split-Path $localFile -Leaf)

    if (Test-Path $netTarget) {
      Write-Log "сетевая копия: $netTarget"
    } else {
      Write-Log "сетевая копия не появилась: $netTarget"
    }
  } catch {
    Write-Log "сетевая копия не удалась: $($_.Exception.Message)"
    Send-Alert "Бэкап Лонжерон: копия на сетевой диск не сделана ($(Get-Date -Format 'dd.MM HH:mm')). Причина: $($_.Exception.Message). Локальная копия сделана."
  }

  # 4. Чистим старое
  Get-ChildItem -Path $backupDir -Filter '*.tar.gz' -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$localKeepDays) } |
    ForEach-Object {
      Remove-Item $_.FullName -Force -ErrorAction SilentlyContinue
      Write-Log "удалена старая копия: $($_.Name)"
    }

  Get-ChildItem -Path $networkDir -Filter '*.tar.gz' -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$networkKeepDays) } |
    ForEach-Object {
      Remove-Item $_.FullName -Force -ErrorAction SilentlyContinue
      Write-Log "удалена старая сетевая копия: $($_.Name)"
    }

  # старые файлы прежнего формата (.db)
  Get-ChildItem -Path $backupDir -Filter 'paint-*.db' -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$localKeepDays) } |
    ForEach-Object { Remove-Item $_.FullName -Force -ErrorAction SilentlyContinue }

  # 5. Убираем архив на сервере
  if ($remoteFile) {
    & ssh @sshOptions $serverHost "rm -f $remoteFile" 2>$null | Out-Null
  }

  Write-Log 'готово'
} catch {
  Write-Log "ОШИБКА: $($_.Exception.Message)"
  Send-Alert "Бэкап Лонжерон не сделан ($(Get-Date -Format 'dd.MM HH:mm')). Причина: $($_.Exception.Message). Проверьте компьютер с бэкапом."

  if ($remoteFile) {
    & ssh @sshOptions $serverHost "rm -f $remoteFile" 2>$null | Out-Null
  }

  exit 1
}
