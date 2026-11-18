# ============================================================================
#  Лонжерон — локальный агент запуска программ
#
#  Зачем: браузер не может сам запускать программы на компьютере.
#  Этот маленький агент слушает только локальный адрес 127.0.0.1:8787
#  и запускает то, что разрешено в списке ниже.
#
#  Запуск: двойной клик по lonjeron-agent.cmd (или этот файл правой кнопкой →
#  «Выполнить с помощью PowerShell»).
#  Остановка: закройте чёрное окно консоли.
# ============================================================================

$ErrorActionPreference = 'Stop'

$port = 8787

# С каких сайтов разрешены запросы (защита от чужих страниц)
$allowedOrigins = @(
  'https://ceh-lonjeron.ru',
  'https://www.ceh-lonjeron.ru',
  'http://localhost:3000',
  'http://127.0.0.1:3000'
)

# Разрешённые программы. id — как в интерфейсе, title — подпись на кнопке.
$apps = @(
  @{ id = 'calc';      title = 'Калькулятор';        type = 'exe'; path = 'calc.exe' },
  @{ id = 'notepad';   title = 'Блокнот';            type = 'exe'; path = 'notepad.exe' },
  @{ id = 'explorer';  title = 'Проводник';          type = 'exe'; path = 'explorer.exe' },
  @{ id = 'paint';     title = 'Paint';              type = 'exe'; path = 'mspaint.exe' },
  @{ id = 'snipping';  title = 'Ножницы';            type = 'exe'; path = 'snippingtool.exe' },
  @{ id = 'cmd';       title = 'Командная строка';   type = 'exe'; path = 'cmd.exe' },
  @{ id = 'chrome';    title = 'Chrome';             type = 'app'; path = 'chrome' },
  @{ id = 'edge';      title = 'Edge';               type = 'app'; path = 'msedge' },
  @{ id = 'yandex';    title = 'Яндекс.Браузер';     type = 'app'; path = 'browser' },
  @{ id = 'settings';  title = 'Параметры Windows';  type = 'uri'; path = 'ms-settings:' }
)

function Send-Response($stream, $status, $body) {
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($body)
  $head = "HTTP/1.1 $status`r`n"
  $head += "Content-Type: application/json; charset=utf-8`r`n"
  $head += "Content-Length: $($bytes.Length)`r`n"
  $head += "Access-Control-Allow-Origin: *`r`n"
  $head += "Access-Control-Allow-Methods: GET, POST, OPTIONS`r`n"
  $head += "Access-Control-Allow-Headers: Content-Type`r`n"
  $head += "Connection: close`r`n`r`n"

  $headBytes = [System.Text.Encoding]::ASCII.GetBytes($head)
  $stream.Write($headBytes, 0, $headBytes.Length)
  $stream.Write($bytes, 0, $bytes.Length)
  $stream.Flush()
}

function Start-App($app) {
  switch ($app.type) {
    'exe' { Start-Process -FilePath $app.path | Out-Null }
    'app' { Start-Process -FilePath $app.path | Out-Null }
    'uri' { Start-Process $app.path | Out-Null }
    default { throw 'Неизвестный тип' }
  }
}

$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $port)

try {
  $listener.Start()
} catch {
  Write-Host "Порт $port занят. Возможно, агент уже запущен." -ForegroundColor Yellow
  Start-Sleep -Seconds 6
  exit 1
}

Write-Host ''
Write-Host '  Лонжерон: агент запуска программ' -ForegroundColor Green
Write-Host "  Слушает: http://127.0.0.1:$port" -ForegroundColor Gray
Write-Host '  Разрешено запускать: ' -NoNewline -ForegroundColor Gray
Write-Host (($apps | ForEach-Object { $_.title }) -join ', ')
Write-Host ''
Write-Host '  Не закрывайте это окно, пока работаете в программе.' -ForegroundColor Yellow
Write-Host '  Свернуть можно, закрывать — нет.' -ForegroundColor Yellow
Write-Host ''

while ($true) {
  $client = $null

  try {
    $client = $listener.AcceptTcpClient()
    $stream = $client.GetStream()
    $stream.ReadTimeout = 5000

    # --- читаем запрос до пустой строки ---
    $buffer = New-Object byte[] 8192
    $text = ''
    while ($true) {
      $read = $stream.Read($buffer, 0, $buffer.Length)
      if ($read -le 0) { break }
      $text += [System.Text.Encoding]::UTF8.GetString($buffer, 0, $read)
      if ($text.Contains("`r`n`r`n")) { break }
    }

    $parts = $text -split "`r`n"
    $requestLine = $parts[0]
    $method, $path = $requestLine -split ' ' | Select-Object -First 2

    # --- строка Origin для проверки ---
    $origin = ''
    foreach ($line in $parts) {
      if ($line -match '^Origin:\s*(.+)$') { $origin = $Matches[1].Trim() }
    }

    # --- тело запроса (для POST) ---
    $length = 0
    foreach ($line in $parts) {
      if ($line -match '^Content-Length:\s*(\d+)$') { $length = [int]$Matches[1] }
    }

    $body = ''
    if ($length -gt 0) {
      $headerEnd = $text.IndexOf("`r`n`r`n")
      $already = $text.Length - ($headerEnd + 4)
      $body = $text.Substring($headerEnd + 4)

      while ($already -lt $length) {
        $read = $stream.Read($buffer, 0, $buffer.Length)
        if ($read -le 0) { break }
        $chunk = [System.Text.Encoding]::UTF8.GetString($buffer, 0, $read)
        $body += $chunk
        $already += $read
      }
    }

    if ($method -eq 'OPTIONS') {
      Send-Response $stream '204 No Content' ''
    }
    elseif ($origin -and ($allowedOrigins -notcontains $origin)) {
      Send-Response $stream '403 Forbidden' '{"error":"чужой сайт"}'
    }
    elseif ($method -eq 'GET' -and $path -like '/apps*') {
      $list = $apps | ForEach-Object { @{ id = $_.id; title = $_.title } }
      Send-Response $stream '200 OK' (ConvertTo-Json -InputObject @{ apps = $list } -Depth 4 -Compress)
    }
    elseif ($method -eq 'POST' -and $path -like '/run*') {
      $id = ''

      if ($body -match '"id"\s*:\s*"([^"]+)"') { $id = $Matches[1] }

      $app = $apps | Where-Object { $_.id -eq $id } | Select-Object -First 1

      if (-not $app) {
        Send-Response $stream '404 Not Found' '{"error":"такая программа не разрешена"}'
      } else {
        Start-App $app
        Send-Response $stream '200 OK' ('{"ok":true,"title":"' + $app.title + '"}')
      }
    }
    else {
      Send-Response $stream '404 Not Found' '{"error":"неизвестный запрос"}'
    }
  } catch {
    # Тихо пропускаем сбойное соединение и продолжаем работу
  } finally {
    if ($client) { $client.Close() }
  }
}
