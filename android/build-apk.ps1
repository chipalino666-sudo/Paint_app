# ============================================================
#  Сборка APK для Лонжерона без Android Studio и Gradle
#  Нужны: JDK 17 и Android SDK (platform 34, build-tools 34)
#
#  Запуск:  powershell -ExecutionPolicy Bypass -File build-apk.ps1
# ============================================================

$ErrorActionPreference = 'Stop'

$JAVA_HOME = 'C:\AndroidBuild\jdk-17.0.21.1+2'
$SDK = 'C:\AndroidBuild\sdk'
$BT = Join-Path $SDK 'build-tools\34.0.0'
$PLATFORM = Join-Path $SDK 'platforms\android-34\android.jar'

$PROJ = Join-Path $PSScriptRoot 'Lonjeron'
$OUT = Join-Path $PROJ 'build'
$SRC = Join-Path $PROJ 'src'
$RES = Join-Path $PROJ 'res'
$MANIFEST = Join-Path $PROJ 'AndroidManifest.xml'

$KEYSTORE = Join-Path $PROJ 'lonjeron.keystore'
$KS_PASS = 'lonjeron2026'
$KS_ALIAS = 'lonjeron'

function Step($text) { Write-Host "  $text" -ForegroundColor Cyan }

if (-not (Test-Path (Join-Path $JAVA_HOME 'bin\java.exe'))) { throw "НЕ найден JDK: $JAVA_HOME" }

# d8 и apksigner ищут java через JAVA_HOME и PATH
$env:JAVA_HOME = $JAVA_HOME
$env:PATH = "$JAVA_HOME\bin;$BT;$env:PATH"
if (-not (Test-Path (Join-Path $BT 'aapt2.exe'))) { throw "НЕ найдены build-tools: $BT" }
if (-not (Test-Path $PLATFORM)) { throw "НЕ найден android.jar: $PLATFORM" }

if (Test-Path $OUT) { Remove-Item $OUT -Recurse -Force }
foreach ($dir in 'gen', 'classes', 'dex') { New-Item -ItemType Directory -Path (Join-Path $OUT $dir) -Force | Out-Null }

Step '[1/7] Компиляция ресурсов'
& (Join-Path $BT 'aapt2.exe') compile --dir $RES -o (Join-Path $OUT 'res.zip')
if ($LASTEXITCODE -ne 0) { throw 'aapt2 compile не удался' }

Step '[2/7] Таблица ресурсов и R.java'
& (Join-Path $BT 'aapt2.exe') link -o (Join-Path $OUT 'base.apk') -I $PLATFORM --manifest $MANIFEST -R (Join-Path $OUT 'res.zip') --java (Join-Path $OUT 'gen') --auto-add-overlay
if ($LASTEXITCODE -ne 0) { throw 'aapt2 link не удался' }

Step '[3/7] Компиляция Java'
$sources = @()
$sources += Get-ChildItem -Path $SRC -Recurse -Filter '*.java' | ForEach-Object { $_.FullName }
$sources += Get-ChildItem -Path (Join-Path $OUT 'gen') -Recurse -Filter '*.java' | ForEach-Object { $_.FullName }
$sourcesFile = Join-Path $OUT 'sources.txt'
[System.IO.File]::WriteAllLines($sourcesFile, $sources, (New-Object System.Text.UTF8Encoding($false)))

& (Join-Path $JAVA_HOME 'bin\javac.exe') -encoding UTF-8 -source 8 -target 8 -classpath $PLATFORM -d (Join-Path $OUT 'classes') "@$sourcesFile"
if ($LASTEXITCODE -ne 0) { throw 'javac не удался' }

Step '[4/7] Перевод классов в dex'
$classes = Get-ChildItem -Path (Join-Path $OUT 'classes') -Recurse -Filter '*.class' | ForEach-Object { $_.FullName }
$classesFile = Join-Path $OUT 'classes.txt'
[System.IO.File]::WriteAllLines($classesFile, $classes, (New-Object System.Text.UTF8Encoding($false)))

& (Join-Path $BT 'd8.bat') --min-api 23 --output (Join-Path $OUT 'dex') --lib $PLATFORM "@$classesFile"
if ($LASTEXITCODE -ne 0) { throw 'd8 не удался' }

Step '[5/7] Добавляем dex в APK'
Copy-Item (Join-Path $OUT 'base.apk') (Join-Path $OUT 'app-unsigned.apk') -Force
& (Join-Path $JAVA_HOME 'bin\jar.exe') --update --file (Join-Path $OUT 'app-unsigned.apk') -C (Join-Path $OUT 'dex') classes.dex
if ($LASTEXITCODE -ne 0) { throw 'jar не удался' }

Step '[6/7] Выравнивание'
& (Join-Path $BT 'zipalign.exe') -f -p 4 (Join-Path $OUT 'app-unsigned.apk') (Join-Path $OUT 'app-aligned.apk')
if ($LASTEXITCODE -ne 0) { throw 'zipalign не удался' }

Step '[7/7] Подпись'
if (-not (Test-Path $KEYSTORE)) {
  Write-Host '  создаю ключ подписи…'
  & (Join-Path $JAVA_HOME 'bin\keytool.exe') -genkeypair -v -keystore $KEYSTORE -alias $KS_ALIAS -keyalg RSA -keysize 2048 -validity 10000 -storepass $KS_PASS -keypass $KS_PASS -dname 'CN=Lonjeron, O=Paint Shop, C=RU'
  if ($LASTEXITCODE -ne 0) { throw 'keytool не удался' }
}

& (Join-Path $BT 'apksigner.bat') sign --ks $KEYSTORE --ks-key-alias $KS_ALIAS --ks-pass "pass:$KS_PASS" --key-pass "pass:$KS_PASS" --out (Join-Path $OUT 'lonjeron.apk') (Join-Path $OUT 'app-aligned.apk')
if ($LASTEXITCODE -ne 0) { throw 'apksigner не удался' }

& (Join-Path $BT 'apksigner.bat') verify --print-certs (Join-Path $OUT 'lonjeron.apk')
if ($LASTEXITCODE -ne 0) { throw 'подпись не прошла проверку' }

$apk = Get-Item (Join-Path $OUT 'lonjeron.apk')
Write-Host ''

# Файл версии: по нему приложение узнаёт про обновление
$manifestText = Get-Content $MANIFEST -Raw -Encoding UTF8
$versionCode = [regex]::Match($manifestText, 'versionCode="(\d+)"').Groups[1].Value
$versionName = [regex]::Match($manifestText, 'versionName="([^"]+)"').Groups[1].Value

$versionFile = Join-Path $OUT 'lonjeron-version.json'

$versionData = [ordered]@{
  versionCode = [int]$versionCode
  versionName = $versionName
  apk         = '/downloads/lonjeron.apk'
  size        = $apk.Length
  date        = (Get-Date -Format 'yyyy-MM-dd HH:mm')
}

$json = $versionData | ConvertTo-Json
[System.IO.File]::WriteAllText($versionFile, $json, (New-Object System.Text.UTF8Encoding($false)))

Write-Host ''
Write-Host "  ГОТОВО: $($apk.FullName)" -ForegroundColor Green
Write-Host "  Размер: $([math]::Round($apk.Length / 1KB)) КБ" -ForegroundColor Green
Write-Host "  Версия: $versionName ($versionCode)" -ForegroundColor Green
Write-Host "  Файл версии: $versionFile" -ForegroundColor Green
