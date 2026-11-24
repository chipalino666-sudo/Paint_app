@echo off
chcp 65001 >nul
setlocal

rem ============================================================
rem  Сборка APK для Лонжерона без Android Studio и Gradle
rem  Нужны: JDK 17 и Android SDK (platform 34, build-tools 34)
rem ============================================================

set "JAVA_HOME=C:\AndroidBuild\jdk-17.0.21.1+2"
set "SDK=C:\AndroidBuild\sdk"
set "BT=%SDK%\build-tools\34.0.0"
set "PLATFORM=%SDK%\platforms\android-34\android.jar"

set "PROJ=%~dp0Lonjeron"
set "OUT=%PROJ%\build"
set "SRC=%PROJ%\src"
set "RES=%PROJ%\res"
set "MANIFEST=%PROJ%\AndroidManifest.xml"

set "KEYSTORE=%PROJ%\lonjeron.keystore"
set "KS_PASS=lonjeron2026"
set "KS_ALIAS=lonjeron"

if not exist "%JAVA_HOME%\bin\java.exe" (
  echo НЕ найден JDK: %JAVA_HOME%
  exit /b 1
)

if not exist "%BT%\aapt2.exe" (
  echo НЕ найдены build-tools: %BT%
  exit /b 1
)

if not exist "%PLATFORM%" (
  echo НЕ найден android.jar: %PLATFORM%
  exit /b 1
)

if exist "%OUT%" rmdir /s /q "%OUT%"
mkdir "%OUT%\gen" 2>nul
mkdir "%OUT%\classes" 2>nul
mkdir "%OUT%\dex" 2>nul

echo [1/7] Компиляция ресурсов...
"%BT%\aapt2.exe" compile --dir "%RES%" -o "%OUT%\res.zip"
if errorlevel 1 exit /b 1

echo [2/7] Сборка таблицы ресурсов и R.java...
"%BT%\aapt2.exe" link -o "%OUT%\base.apk" -I "%PLATFORM%" --manifest "%MANIFEST%" -R "%OUT%\res.zip" --java "%OUT%\gen" --auto-add-overlay
if errorlevel 1 exit /b 1

echo [3/7] Компиляция Java...
dir /s /b "%SRC%\*.java" > "%OUT%\sources.txt"
dir /s /b "%OUT%\gen\*.java" >> "%OUT%\sources.txt"
"%JAVA_HOME%\bin\javac.exe" -source 17 -target 17 -encoding UTF-8 -bootclasspath "%PLATFORM%" -classpath "%PLATFORM%" -d "%OUT%\classes" @"%OUT%\sources.txt"
if errorlevel 1 exit /b 1

echo [4/7] Перевод классов в dex...
dir /s /b "%OUT%\classes\*.class" > "%OUT%\classes.txt"
"%BT%\d8.bat" --min-api 23 --output "%OUT%\dex" --lib "%PLATFORM%" @"%OUT%\classes.txt"
if errorlevel 1 exit /b 1

echo [5/7] Добавляем dex в APK...
copy /y "%OUT%\base.apk" "%OUT%\app-unsigned.apk" >nul
"%JAVA_HOME%\bin\jar.exe" --update --file "%OUT%\app-unsigned.apk" -C "%OUT%\dex" classes.dex
if errorlevel 1 exit /b 1

echo [6/7] Выравнивание...
"%BT%\zipalign.exe" -f -p 4 "%OUT%\app-unsigned.apk" "%OUT%\app-aligned.apk"
if errorlevel 1 exit /b 1

echo [7/7] Подпись...
if not exist "%KEYSTORE%" (
  echo   создаю ключ подписи...
  "%JAVA_HOME%\bin\keytool.exe" -genkeypair -v -keystore "%KEYSTORE%" -alias "%KS_ALIAS%" -keyalg RSA -keysize 2048 -validity 10000 -storepass "%KS_PASS%" -keypass "%KS_PASS%" -dname "CN=Lonjeron, O=Paint Shop, C=RU"
  if errorlevel 1 exit /b 1
)

"%BT%\apksigner.bat" sign --ks "%KEYSTORE%" --ks-key-alias "%KS_ALIAS%" --ks-pass "pass:%KS_PASS%" --key-pass "pass:%KS_PASS%" --out "%OUT%\lonjeron.apk" "%OUT%\app-aligned.apk"
if errorlevel 1 exit /b 1

"%BT%\apksigner.bat" verify --print-certs "%OUT%\lonjeron.apk"

echo.
echo ГОТОВО: %OUT%\lonjeron.apk
for %%F in ("%OUT%\lonjeron.apk") do echo Размер: %%~zF байт
