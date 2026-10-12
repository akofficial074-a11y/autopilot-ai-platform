@echo off
start "Backend" cmd /k "cd backend && venv\Scripts\python -m uvicorn main:app --port 8000"
start "Frontend" cmd /k "cd frontend && npm run dev"
timeout /t 6 >nul
start http://localhost:5173
