param(
    [string]$TargetBase = "D:\RustEnv",
    [switch]$CleanOldCache
)

$ErrorActionPreference = "Stop"
$CleanBase = $TargetBase.TrimEnd('\', '/')

$NewCargoHome  = Join-Path $CleanBase ".cargo"
$NewRustupHome = Join-Path $CleanBase ".rustup"
$NewTargetDir  = Join-Path $CleanBase "target"
$NewTempDir    = Join-Path $CleanBase "tmp"

Write-Host "[1/4] Creando estructura en $CleanBase..."
New-Item -ItemType Directory -Force -Path $NewCargoHome, $NewRustupHome, $NewTargetDir, $NewTempDir | Out-Null

$OldCargo  = Join-Path $env:USERPROFILE ".cargo"
$OldRustup = Join-Path $env:USERPROFILE ".rustup"

if (Test-Path $OldCargo) {
    Write-Host "Copiando $OldCargo -> $NewCargoHome..."
    robocopy $OldCargo $NewCargoHome /E /COPY:DAT /R:2 /W:2 | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "Error de robocopy copiando .cargo (codigo $LASTEXITCODE)." }
}

if (Test-Path $OldRustup) {
    Write-Host "Copiando $OldRustup -> $NewRustupHome..."
    robocopy $OldRustup $NewRustupHome /E /COPY:DAT /R:2 /W:2 | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "Error de robocopy copiando .rustup (codigo $LASTEXITCODE)." }
}

Write-Host "[2/4] Aplicando variables en la sesion actual..."
$env:CARGO_HOME       = $NewCargoHome
$env:RUSTUP_HOME      = $NewRustupHome
$env:CARGO_TARGET_DIR = $NewTargetDir
$env:TEMP             = $NewTempDir
$env:TMP              = $NewTempDir
$CargoBin             = Join-Path $NewCargoHome "bin"
if ($env:PATH -notlike "*$CargoBin*") {
    $env:PATH = "$CargoBin;$env:PATH"
}

Write-Host "[3/4] Persistiendo variables de entorno en Windows (HKCU\Environment)..."
[Environment]::SetEnvironmentVariable("CARGO_HOME", $NewCargoHome, "User")
[Environment]::SetEnvironmentVariable("RUSTUP_HOME", $NewRustupHome, "User")
[Environment]::SetEnvironmentVariable("CARGO_TARGET_DIR", $NewTargetDir, "User")

$UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
if (-not $UserPath) { $UserPath = "" }
if ($UserPath -notlike "*$CargoBin*") {
    $UpdatedPath = ("$CargoBin;$UserPath").TrimEnd(';')
    [Environment]::SetEnvironmentVariable("Path", $UpdatedPath, "User")
}

Write-Host "[4/4] Verificando Rust e instalando targets Android 15..."
if (Get-Command cargo -ErrorAction SilentlyContinue) {
    rustup show
    rustup target add aarch64-linux-android x86_64-linux-android
    cargo install cargo-ndk
    if ($CleanOldCache) {
        if (Test-Path $OldCargo)  { Remove-Item -Recurse -Force $OldCargo }
        if (Test-Path $OldRustup) { Remove-Item -Recurse -Force $OldRustup }
        Write-Host "Cache antiguo eliminado de C:\."
    } else {
        Write-Host "Migracion lista. Para liberar espacio en C: ejecuta con -CleanOldCache tras verificar."
    }
} else {
    Write-Host "Variables persistidas en $CleanBase. Instala rustup-init.exe ahora y detectara las nuevas rutas."
}
