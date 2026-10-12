@echo off
cd backend && python -m venv venv && venv\Scripts\pip install -r requirements.txt && cd ..\frontend && call npm install
echo Setup finished. Now double-click run.bat
pause
