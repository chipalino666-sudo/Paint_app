' Запускает Малярный цех без окна консоли.
' Двойной щелчок по этому файлу — как по обычной программе.

Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")

dir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = dir

sh.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & dir & "\launch.ps1""", 0, False
