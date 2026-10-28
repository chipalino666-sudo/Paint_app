# Открывает доступ к программе с телефона и показывает адрес.
# Запускать один раз перед показом: файл «Доступ с телефона.cmd».

$ErrorActionPreference = 'Stop'

$ruleName = 'Малярный цех (порт 3000)'

function Test-Admin {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

# Добавление правила брандмауэра требует прав администратора — перезапускаемся с запросом
if (-not (Test-Admin)) {
    try {
        Start-Process powershell -Verb RunAs -ArgumentList @(
            '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`""
        )
    } catch {
        [System.Windows.Forms.MessageBox]::Show('Нужно разрешить запуск от имени администратора', 'Малярный цех')
    }
    exit
}

# Открываем порт 3000 для любой сети: с точки доступа телефон видит ноутбук как «общественную» сеть
$existing = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue

if (-not $existing) {
    try {
        New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Action Allow `
            -Protocol TCP -LocalPort 3000 -Profile Any | Out-Null
    } catch {
        # запасной путь — старый netsh
        netsh advfirewall firewall add rule name="$ruleName" dir=in action=allow `
            protocol=TCP localport=3000 profile=any | Out-Null
    }
}

# Показываем адреса, по которым программа открывается с телефона
$addresses = @()

try {
    $addresses = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
        Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
        Select-Object -ExpandProperty IPAddress)
} catch {
    $addresses = @()
}

if (-not $addresses) {
    # Запасной путь: разбираем вывод ipconfig
    $addresses = @(ipconfig | Select-String -Pattern 'IPv4[^:]*:\s*([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+)' |
        ForEach-Object { $_.Matches[0].Groups[1].Value } |
        Where-Object { $_ -notlike '127.*' -and $_ -notlike '169.254.*' } |
        Select-Object -Unique)
}

Add-Type -AssemblyName System.Windows.Forms

if (-not $addresses) {
    [System.Windows.Forms.MessageBox]::Show(
        "Не вижу сетевых адресов. Проверьте, что ноутбук подключён к Wi-Fi или точке доступа.",
        'Малярный цех', 'OK', 'Warning') | Out-Null
    exit
}

$list = ($addresses | ForEach-Object { "http://${_}:3000" }) -join "`r`n"

$message = @"
Доступ открыт. На телефоне в браузере откройте:

$list

Важно: телефон и ноутбук должны быть в одной сети —
например, ноутбук подключён к точке доступа этого телефона.
"@

[System.Windows.Forms.MessageBox]::Show($message, 'Малярный цех', 'OK', 'Information') | Out-Null
