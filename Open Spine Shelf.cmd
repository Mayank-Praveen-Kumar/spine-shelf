@echo off
cd /d "%~dp0"
if not exist "dist\carousel.js" (
    where npm >nul 2>nul
    if errorlevel 1 (
        echo Node.js is needed to build the FlexCarousel. Opening the spine view.
    ) else (
        if exist package-lock.json (
            call npm ci --no-audit --no-fund
        ) else (
            call npm install --no-audit --no-fund
        )
        if not errorlevel 1 call npm run build
    )
)
python shelf.py
pause
