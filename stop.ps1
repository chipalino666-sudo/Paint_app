# Останавливает сервер «Малярного цеха».
# Нужен редко: обычно сервер просто работает, пока включён компьютер.

$ErrorActionPreference = 'SilentlyContinue'

$killed = 0

Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object {
    $_.CommandLine -like '*server.js*'
} | ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force
    $killed++
}

try {
    Add-Type -AssemblyName System.Windows.Forms

    if ($killed -gt 0) {
        $text = "Сервер остановлен."
    } else {
        $text = "Сервер и так не работал."
    }

    [System.Windows.Forms.MessageBox]::Show($text, 'Малярный цех', 'OK', 'Information') | Out-Null
} catch {
    # без окон — просто выходим
}
