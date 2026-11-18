@echo off
chcp 65001 >nul
title Лонжерон - агент запуска программ

rem Запускает локального агента в этом окне.
rem Окно нельзя закрывать, пока работаете в программе — можно свернуть.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0lonjeron-agent.ps1"

echo.
echo Агент остановлен. Нажмите любую клавишу, чтобы закрыть окно.
pause >nul
