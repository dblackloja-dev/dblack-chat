@echo off
title D'Black Chat - Servidor Local
echo.
echo ========================================
echo   D'BLACK CHAT - INICIANDO SERVIDOR
echo ========================================
echo.

:: Inicia o backend
echo [1/2] Iniciando backend...
start "D'Black Chat - Backend" cmd /c "cd backend && npm run dev"

:: Aguarda o backend iniciar
timeout /t 3 /nobreak > nul

:: Inicia o frontend
echo [2/2] Iniciando frontend...
start "D'Black Chat - Frontend" cmd /c "cd frontend && npm run dev"

echo.
echo ========================================
echo   SERVIDOR INICIADO COM SUCESSO!
echo ========================================
echo.
echo   Backend: http://localhost:3002
echo   Frontend: http://localhost:5174
echo.
echo   Para os atendentes acessarem na rede:
echo   Descubra seu IP com: ipconfig
echo   Acesse: http://SEU_IP:5174
echo.
echo   Login: admin@dblack.com / admin123
echo.
echo ========================================
echo.
pause
