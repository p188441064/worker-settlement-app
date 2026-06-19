@echo off
cd /d "%~dp0"
echo Starting worker settlement app at http://localhost:3005
echo Keep this window open while using the app.
"C:\Program Files\nodejs\node.exe" "%~dp0node_modules\next\dist\bin\next" dev -p 3005 -H 127.0.0.1
pause
