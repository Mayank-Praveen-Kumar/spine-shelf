@echo off
cd /d "%~dp0"
if exist "release\SpineShelf-0.3.0-win-x64\SpineShelf.exe" (
    start "" "release\SpineShelf-0.3.0-win-x64\SpineShelf.exe"
    exit /b
)
if exist "build\desktop\SpineShelf.exe" (
    start "" "build\desktop\SpineShelf.exe" --app-root "%~dp0."
    exit /b
)
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
