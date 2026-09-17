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
echo.

rem --- Old copies (made before 2026-08-30) have "origin" pointing at the dev repo
rem     (Sanguine_System.git, branch "test"). That repo is private now, and git
rem     would stop and ask for a GitHub login/password that can never grant
rem     access - the update would only ever fail after prompting. The public
rem     release repo never asks for credentials (it is public), so force origin
rem     back to it before fetching.
if /i not "%CURRENT_URL%"=="%REPO_URL%" (
    echo   This checkout's "origin" points at the OLD repository, which is now
    echo   private since 2026-08-30 and would ask for GitHub login/password.
    echo   Switching it to the public release repo...
    git remote set-url origin %REPO_URL%
    echo   origin is now: %REPO_URL%
    echo.
)

echo   Checking for updates on branch "%BRANCH%" from GitHub...
echo.

git fetch origin %BRANCH%
if %errorlevel% neq 0 (
    echo.
    echo   ERROR: Failed to fetch branch "%BRANCH%" from GitHub.
    echo   Check that you're connected to the internet.
    echo   The checkout's origin has been reset to the public release repo:
    echo     %REPO_URL%
    echo   Run update.bat again once you're online.
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
