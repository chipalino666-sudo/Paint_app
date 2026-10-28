# Запуск «Малярного цеха».
# Поднимает сервер, если он ещё не работает, и открывает окно программы.
# Вызывается из launch.vbs, чтобы не мелькало чёрное окно консоли.

param(
    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$port = 3000
$url = "http://localhost:$port"

function Test-Server {
    try {
        $client = New-Object System.Net.Sockets.TcpClient
        $client.Connect('127.0.0.1', $port)
        $client.Close()
        return $true
    } catch {
        return $false
    }
}

function Show-Error($text) {
    try {
        Add-Type -AssemblyName System.Windows.Forms
        [System.Windows.Forms.MessageBox]::Show($text, 'Малярный цех', 'OK', 'Error') | Out-Null
    } catch {
        # Если окон не завезли — молча выходим, ошибка уже в логе
    }
}

if (-not (Test-Server)) {
    $node = (Get-Command node.exe -ErrorAction SilentlyContinue).Source

    if (-not $node) {
        foreach ($candidate in @("$env:ProgramFiles\nodejs\node.exe", "${env:ProgramFiles(x86)}\nodejs\node.exe")) {
            if (Test-Path $candidate) { $node = $candidate; break }
        }
    }

    if (-not $node) {
        Show-Error "Не найден Node.js. Установите его с nodejs.org — без него программа не запустится."
        exit 1
    }

    $dataDir = Join-Path $root 'server\data'
    if (-not (Test-Path $dataDir)) { New-Item -ItemType Directory -Path $dataDir | Out-Null }

    Start-Process -FilePath $node `
        -ArgumentList 'server.js' `
        -WorkingDirectory (Join-Path $root 'server') `
        -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $dataDir 'server.log') `
        -RedirectStandardError (Join-Path $dataDir 'server.err.log')

    # Ждём, пока сервер начнёт отвечать (до 20 секунд)
    $ready = $false
    for ($i = 0; $i -lt 40; $i++) {
        Start-Sleep -Milliseconds 500
        if (Test-Server) { $ready = $true; break }
    }

    if (-not $ready) {
        Show-Error "Сервер не запустился. Что случилось — смотрите в файле server\data\server.err.log"
        exit 1
    }
}

if ($NoBrowser) { exit 0 }

# Открываем отдельным окном без вкладок и адресной строки
$browsers = @(
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe"
)

$browser = $null
foreach ($candidate in $browsers) {
    if (Test-Path $candidate) { $browser = $candidate; break }
}

if ($browser) {
    Start-Process -FilePath $browser -ArgumentList "--app=$url", '--window-size=1440,920', '--no-first-run'
} else {
    Start-Process $url
}
