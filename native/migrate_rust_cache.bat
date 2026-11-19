@echo off
setlocal EnableDelayedExpansion

REM ============================================================================
REM Migracion de cache de Cargo y Rustup hacia particion D:\ o unidad externa
REM Uso: migrate_rust_cache.bat [RUTA_DESTINO]
REM Ejemplo: migrate_rust_cache.bat D:\RustEnv
REM ============================================================================

set "TARGET_BASE=%~1"
if "%TARGET_BASE%"=="" set "TARGET_BASE=D:\RustEnv"

REM Eliminar barra final si existe
if "%TARGET_BASE:~-1%"=="\" set "TARGET_BASE=%TARGET_BASE:~0,-1%"

set "NEW_CARGO_HOME=%TARGET_BASE%\.cargo"
set "NEW_RUSTUP_HOME=%TARGET_BASE%\.rustup"
set "NEW_TARGET_DIR=%TARGET_BASE%\target"
set "NEW_TEMP_DIR=%TARGET_BASE%\tmp"

echo [1/4] Creando directorios en "%TARGET_BASE%"...
mkdir "%NEW_CARGO_HOME%" 2>nul
mkdir "%NEW_RUSTUP_HOME%" 2>nul
mkdir "%NEW_TARGET_DIR%" 2>nul
mkdir "%NEW_TEMP_DIR%" 2>nul

if exist "%USERPROFILE%\.cargo" (
    echo Copiando "%USERPROFILE%\.cargo" hacia "%NEW_CARGO_HOME%"...
    robocopy "%USERPROFILE%\.cargo" "%NEW_CARGO_HOME%" /E /COPY:DAT /R:2 /W:2 >nul
)
if exist "%USERPROFILE%\.rustup" (
    echo Copiando "%USERPROFILE%\.rustup" hacia "%NEW_RUSTUP_HOME%"...
    robocopy "%USERPROFILE%\.rustup" "%NEW_RUSTUP_HOME%" /E /COPY:DAT /R:2 /W:2 >nul
)

echo [2/4] Aplicando variables en la sesion actual (set)...
set "CARGO_HOME=%NEW_CARGO_HOME%"
set "RUSTUP_HOME=%NEW_RUSTUP_HOME%"
set "CARGO_TARGET_DIR=%NEW_TARGET_DIR%"
set "TEMP=%NEW_TEMP_DIR%"
set "TMP=%NEW_TEMP_DIR%"
set "PATH=%NEW_CARGO_HOME%\bin;%PATH%"

echo [3/4] Persistiendo variables de entorno en Windows (setx)...
setx CARGO_HOME "%NEW_CARGO_HOME%"
setx RUSTUP_HOME "%NEW_RUSTUP_HOME%"
setx CARGO_TARGET_DIR "%NEW_TARGET_DIR%"

REM Actualizar Path de usuario de forma segura sin truncamiento de 1024 caracteres
powershell -NoProfile -Command "$bin='%NEW_CARGO_HOME%\bin'; $p=[Environment]::GetEnvironmentVariable('Path','User'); if(-not $p){$p=''}; if($p -notlike ('*' + $bin + '*')){ [Environment]::SetEnvironmentVariable('Path', ($bin + ';' + $p).TrimEnd(';'), 'User') }"

echo [4/4] Verificando instalacion e instalando targets Android 15...
echo CARGO_HOME=%CARGO_HOME%
echo RUSTUP_HOME=%RUSTUP_HOME%
where cargo >nul 2>&1
if %ERRORLEVEL%==0 (
    rustup show
    rustup target add aarch64-linux-android x86_64-linux-android
    cargo install cargo-ndk
    echo.
    echo Migracion completada. Abre una NUEVA terminal para usar las variables persistidas.
    echo Cuando verifiques que todo compila en "%TARGET_BASE%", puedes liberar C: ejecutando:
    echo   rmdir /S /Q "%USERPROFILE%\.cargo" "%USERPROFILE%\.rustup"
) else (
    echo AVISO: No se encontro cargo en "%NEW_CARGO_HOME%\bin".
    echo Instala rustup-init.exe ahora en esta misma consola y usara automaticamente "%TARGET_BASE%".
)

endlocal
