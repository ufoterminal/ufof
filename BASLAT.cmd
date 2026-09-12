@echo off
cd /d "%~dp0"
if not exist node_modules call npm ci --cache .npm-cache --no-audit --no-fund
call npm start
