@echo off
setlocal
"%~dp0runtime\node.exe" "%~dp0launcher.js" "%~dp0config.json" %*
exit /b %errorlevel%
