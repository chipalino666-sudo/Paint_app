# Заливка программы на сервер и её установка.
#
#   .\deploy\upload.ps1 -Server 123.45.67.89 -Domain ceh.example.ru
#
# Параметры:
#   -Server  адрес сервера (обязательно)
#   -User    пользователь SSH, по умолчанию root
#   -Domain  домен для HTTPS; без него программа откроется по IP:3000
#   -Key     путь к приватному ключу, если вход не по паролю

param(
    [Parameter(Mandatory = $true)][string]$Server,
    [string]$User = 'root',
    [string]$Domain = '',
    [string]$Key = '',
    # Перезаписать базу на сервере локальной (по умолчанию не трогаем)
    [switch]$ForceDb
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$target = "$User@$Server"

$sshArgs = @()
$scpArgs = @()
if ($Key) {
    $sshArgs += @('-i', $Key)
    $scpArgs += @('-i', $Key)
}

function Invoke-Remote([string]$command) {
    & ssh @sshArgs -o StrictHostKeyChecking=accept-new $target $command
    if ($LASTEXITCODE -ne 0) { throw "Команда на сервере не удалась: $command" }
}

Write-Host "`n== 1. Проверка связи ==" -ForegroundColor Cyan
Invoke-Remote "echo connected: \$(hostname)"

Write-Host "`n== 2. Создание каталога ==" -ForegroundColor Cyan
Invoke-Remote "mkdir -p /opt/paint"

Write-Host "`n== 3. Копирование файлов ==" -ForegroundColor Cyan
& scp @scpArgs -r "$root\server" "$root\deploy" "$root\docs" "${target}:/opt/paint/"
if ($LASTEXITCODE -ne 0) { throw "Не удалось скопировать файлы" }

Write-Host "`n== 4. Перенос базы ==" -ForegroundColor Cyan
$dbPath = Join-Path $root 'server\data\paint.db'
$remoteDb = (& ssh @sshArgs $target "test -f /opt/paint/server/data/paint.db && echo yes || echo no").Trim()

if ($remoteDb -eq 'yes' -and -not $ForceDb) {
    Write-Host "   на сервере уже есть база — не перезаписываю" -ForegroundColor Yellow
    Write-Host "   (нужно перезаписать — добавьте -ForceDb)"
} elseif (Test-Path $dbPath) {
    Invoke-Remote "mkdir -p /opt/paint/server/data"
    & scp @scpArgs "$dbPath" "${target}:/opt/paint/server/data/paint.db"
    if ($LASTEXITCODE -ne 0) { throw "Не удалось скопировать базу" }
    Write-Host "   база перенесена (все заказы и сотрудники останутся)"
} else {
    Write-Host "   локальной базы нет — на сервере будет пустая, с одним администратором" -ForegroundColor Yellow
}

Write-Host "`n== 5. Чистка служебных файлов ==" -ForegroundColor Cyan
Invoke-Remote "rm -rf /opt/paint/server/shots /opt/paint/server/data/*.log || true"

Write-Host "`n== 6. Установка ==" -ForegroundColor Cyan
$setup = if ($Domain) { "bash /opt/paint/deploy/setup-server.sh $Domain" } else { "bash /opt/paint/deploy/setup-server.sh" }
& ssh @sshArgs -t $target $setup
if ($LASTEXITCODE -ne 0) { throw "Установка завершилась ошибкой" }

Write-Host "`nГотово." -ForegroundColor Green
