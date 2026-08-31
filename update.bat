@echo off
cd /d "%~dp0"

rem ============================================================
rem  Sanguine System - download/update the release
rem  Source: Sanguine_System_public on GitHub - a dedicated public
rem  repository that only ever contains built release trees (see
rem  .github/workflows/release-public.yml in the private dev repo).
rem  It replaced the old "test" branch of the dev repo (2026-08-30):
rem  the dev repo is private now, so a branch-within-it can no longer
rem  be the public distribution point.
rem ============================================================

set REPO_URL=https://github.com/Dominictm/Sanguine_System_public.git
set BRANCH=main
set CLONE_DIR=Sanguine_System

echo.
echo  =============================================
echo   Sanguine System - update (branch %BRANCH%)
echo  =============================================
echo.

rem --- 1. Check for Git ----------------------------------------
where git > nul 2>&1
if %errorlevel% neq 0 goto git_missing
goto git_ok

:git_missing
echo   Git not found.
echo.
choice /C YN /M "Install Git automatically via winget?"
if errorlevel 2 goto git_manual
if errorlevel 1 goto git_autoinstall

:git_manual
echo.
echo   Install Git manually: https://git-scm.com/download/win
echo   Then run update.bat again.
echo.
pause
exit /b 1

:git_autoinstall
where winget > nul 2>&1
if %errorlevel% neq 0 (
    echo   winget is not available on this system.
    echo   Install Git manually: https://git-scm.com/download/win
    pause
    exit /b 1
)
echo   Installing Git (a Windows administrator prompt may appear)...
winget install --id Git.Git -e --source winget --accept-package-agreements --accept-source-agreements
rem Make the freshly installed git visible in this session without restarting the terminal.
set PATH=%PATH%;%ProgramFiles%\Git\cmd
where git > nul 2>&1
if %errorlevel% neq 0 (
    echo   Git was installed but is not visible in this session.
    echo   Please restart update.bat or your terminal and try again.
    pause
    exit /b 1
)
echo   Git installed successfully.
echo.

:git_ok

rem --- 2. Fresh clone or update an existing checkout? -----------
if exist ".git\" goto update_existing
goto fresh_clone

rem --- 3a. Fresh clone -------------------------------------------
:fresh_clone
echo   No repository found here.
echo   Cloning the "%BRANCH%" branch into "%CLONE_DIR%"...
echo.
if exist "%CLONE_DIR%\" (
    echo   ERROR: Folder "%CLONE_DIR%" already exists. To avoid overwriting it,
    echo   run update.bat from an empty folder or remove it first.
    pause
    exit /b 1
)
git clone --branch %BRANCH% --single-branch "%REPO_URL%" "%CLONE_DIR%"
if %errorlevel% neq 0 (
    echo.
    echo   ERROR: Failed to clone branch "%BRANCH%".
    echo   Check that you're connected to GitHub.
    pause
    exit /b 1
)
echo.
echo   Done. The project is in folder "%CLONE_DIR%".
echo   Next time, run: %CLONE_DIR%\start.bat
echo.
pause
exit /b 0

rem --- 3b. Update an existing checkout -----------------------------
:update_existing
for /f "delims=" %%u in ('git config --get remote.origin.url') do set CURRENT_URL=%%u
echo   origin: %CURRENT_URL%
echo   Checking for updates on branch "%BRANCH%" from GitHub...
echo.

git fetch origin %BRANCH%
if %errorlevel% neq 0 (
    echo.
    echo   ERROR: Failed to fetch branch "%BRANCH%" from origin.
    echo   Check that you're connected to GitHub. If this checkout is older than
    echo   2026-08-30, "origin" may still point at the old repository (which is
    echo   now private) - fix it with:
    echo     git remote set-url origin %REPO_URL%
    echo   then run update.bat again.
    pause
    exit /b 1
)

rem Switch to the branch (create a local tracking branch if none exists yet).
git checkout %BRANCH% 2>nul || git checkout -b %BRANCH% origin/%BRANCH%
if %errorlevel% neq 0 (
    echo   ERROR: Failed to switch to branch "%BRANCH%".
    pause
    exit /b 1
)

rem This repository's main branch is rebuilt from scratch on every release
rem (see tools/build_release.js and .github/workflows/release-public.yml in
rem the private dev repo) - its history always diverges from what you have
rem locally, that's expected and not a sign anything is wrong, so a hard
rem reset is the correct way to sync. Your own cities/<city>/ data isn't
rem tracked here, so it's never touched by this reset.
echo   Applying the release update (rebuilt from scratch on every release).
echo   Your city/character data in cities/ isn't tracked by this branch and won't be touched.

git reset --hard origin/%BRANCH%
if %errorlevel% neq 0 (
    echo   ERROR: Update failed.
    pause
    exit /b 1
)

echo.
echo   Update complete. Now at:
git --no-pager log -1 --format="   %%h  %%s"
echo.
echo   Next time, run: start.bat
echo.
pause
exit /b 0
