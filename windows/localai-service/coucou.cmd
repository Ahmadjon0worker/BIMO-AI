@echo off
"%~dp0runtime\python.exe" "%~dp0src\service_main.py" --tools %*
exit /b %errorlevel%
