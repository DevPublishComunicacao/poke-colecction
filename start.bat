@echo off
title PokéCollection

set ROOT=%~dp0

echo ==========================================
echo  INICIANDO BANCO DE DADOS (Docker)
echo ==========================================

docker info >nul 2>&1
if %errorlevel% neq 0 (
    echo [AVISO] Docker nao esta rodando.
    echo         Inicie o Docker Desktop e tente novamente.
    echo.
    echo Deseja continuar sem o banco de dados Docker?
    choice /C SN /M "Usar PostgreSQL local ja existente"
    if errorlevel 2 exit /b
    goto :start_server
)

docker compose -f "%ROOT%docker-compose.yml" up -d
if %errorlevel% neq 0 (
    echo [ERRO] Falha ao iniciar container Docker.
    pause
    exit /b
)

echo Aguardando PostgreSQL ficar pronto...
:wait_db
docker exec poke-colecction-db pg_isready -U pokecollection >nul 2>&1
if %errorlevel% neq 0 (
    timeout /t 2 >nul
    goto wait_db
)
echo Banco de dados pronto!

:start_server

echo.
echo ==========================================
echo  LIBERANDO PORTA 3000
echo ==========================================
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000 "') do (
    taskkill /f /pid %%a >nul 2>&1
)
timeout /t 2 >nul

echo.
echo ==========================================
echo  INICIANDO SERVIDOR (PORTA 3000)
echo ==========================================
set DATABASE_URL=postgresql://pokecollection:pokecollection@localhost:5433/pokecollection_dev
start "PokéCollection" cmd /k "cd /d %ROOT% && npm start"

echo.
echo ==========================================
echo  SISTEMA INICIADO
echo ==========================================
echo  URL: http://localhost:3000
echo ==========================================
echo  Feche esta janela para parar tudo.
echo ==========================================

pause
