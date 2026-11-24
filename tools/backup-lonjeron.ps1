# ============================================================================
#  Ежедневный бэкап базы Лонжерон с сервера на этот компьютер
#
#  Запускается планировщиком Windows раз в день.
#  Кладёт файл в C:\Backups\Лонжерон\paint-ГГГГ-ММ-ДД_ЧЧмм.db
#  Старые копии (старше 30 дней) удаляет.
# ============================================================================

$ErrorActionPreference = 'Stop'

$host_ = 'root@82.202.129.162'
$key = 'C:\Users\Maks\.ssh\paint_deploy'
$knownHosts = Join-Path $env:TEMP 'known_hosts_tmp'

$backupDir = 'C:\Backups\Лонжерон'
$logFile = Join-Path $backupDir 'backup.log'

# Сетевая папка на диске Z: (\\Asus\d). UNC надёжнее буквы диска:
# в задачах планировщика буква Z: может быть не подключена.
$networkDir = '\\Asus\d\Лонжерон-бэкапы'

New-Item -ItemType Directory -Path $backupDir -Force | Out-Null

$stamp = Get-Date -Format 'yyyy-MM-dd_HHmm'
$localFile = Join-Path $backupDir "paint-$stamp.db"
$remoteFile = "/tmp/paint-backup-$stamp.db"

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

try {
  # 1. На сервере делаем цельный снимок базы
  $make = & ssh @sshOptions $host_ "cd /opt/paint/server && node --no-warnings tools/backup-db.js $remoteFile 2>/dev/null"
  Write-Log "снимок: $make"

  # 2. Забираем файл к себе
  & scp @sshOptions "${host_}:$remoteFile" $localFile 2>$null | Out-Null

  if (-not (Test-Path $localFile)) {
    throw 'файл не скачался'
  }

  $size = (Get-Item $localFile).Length
  Write-Log "скачано: $localFile ($([math]::Round($size / 1KB)) КБ)"

  # 2.1. Копия на сетевой диск
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

    # чистим сетевые копии старше 30 дней
    Get-ChildItem -Path $networkDir -Filter 'paint-*.db' -ErrorAction SilentlyContinue |
      Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } |
      ForEach-Object {
        Remove-Item $_.FullName -Force -ErrorAction SilentlyContinue
        Write-Log "удалена старая сетевая копия: $($_.Name)"
      }
  } catch {
    Write-Log "сетевая копия не удалась: $($_.Exception.Message)"
  }

  # 3. Убираем временный файл на сервере
  & ssh @sshOptions $host_ "rm -f $remoteFile" 2>$null | Out-Null

  # 4. Чистим копии старше 30 дней
  $old = Get-ChildItem -Path $backupDir -Filter 'paint-*.db' |
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) }

  foreach ($file in $old) {
    Remove-Item $file.FullName -Force
    Write-Log "удалена старая копия: $($file.Name)"
  }
} catch {
  Write-Log "ОШИБКА: $($_.Exception.Message)"
  exit 1
}
