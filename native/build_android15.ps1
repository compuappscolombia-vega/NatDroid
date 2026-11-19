param(
    [string]$Abi = "arm64-v8a",
    [string]$WorkDrive = "D:\AndroCore",
    [string]$NdkPath = "D:\AndroCore\Android\Sdk\ndk\27.2.12479018"
)

$ErrorActionPreference = "Stop"
$AndroidApi = 35

# Respetar CARGO_HOME/RUSTUP_HOME si ya fueron migrados a D:\ o unidad externa; si no, ubicarlos en $WorkDrive
if (-not $env:RUSTUP_HOME)      { $env:RUSTUP_HOME      = Join-Path $WorkDrive "rust\.rustup" }
if (-not $env:CARGO_HOME)       { $env:CARGO_HOME       = Join-Path $WorkDrive "rust\.cargo" }
if (-not $env:CARGO_TARGET_DIR) { $env:CARGO_TARGET_DIR = Join-Path $WorkDrive "build\rust_target" }
$env:TEMP             = Join-Path $WorkDrive "tmp"
$env:TMP              = Join-Path $WorkDrive "tmp"
$env:ANDROID_NDK_HOME = $NdkPath

New-Item -ItemType Directory -Force -Path $env:RUSTUP_HOME, $env:CARGO_HOME, $env:CARGO_TARGET_DIR, $env:TEMP | Out-Null

# Asegurar binarios de Cargo en PATH
$CargoBin = Join-Path $env:CARGO_HOME "bin"
if ($env:PATH -notlike "*$CargoBin*") {
    $env:PATH = "$CargoBin;$env:PATH"
}

if (-not (Test-Path $env:ANDROID_NDK_HOME)) {
    throw "No se encontró el NDK en '$($env:ANDROID_NDK_HOME)'. Instala Android NDK r27+ en el disco D: o pasa -NdkPath."
}

$ToolchainFile = Join-Path $env:ANDROID_NDK_HOME "build\cmake\android.toolchain.cmake"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "[1/2] Compilando host Rust en disco destino ($Abi, API $AndroidApi)..."
Write-Host "      CARGO_HOME=$($env:CARGO_HOME) | CARGO_TARGET_DIR=$($env:CARGO_TARGET_DIR)"
Push-Location (Join-Path $ScriptDir "rust_host")
try {
    cargo ndk -t $Abi -p $AndroidApi build --release
    if ($LASTEXITCODE -ne 0) { throw "Fallo al compilar emu_rust_host con cargo-ndk." }

    $RustTriple = if ($Abi -eq "arm64-v8a") { "aarch64-linux-android" } elseif ($Abi -eq "x86_64") { "x86_64-linux-android" } else { throw "ABI no soportada: $Abi" }
    $BuiltLib = Join-Path $env:CARGO_TARGET_DIR "$RustTriple\release\libemu_rust_host.a"
    $RustOutAbiDir = Join-Path $WorkDrive "build\rust_abi\$Abi\release"
    New-Item -ItemType Directory -Force -Path $RustOutAbiDir | Out-Null
    Copy-Item -Force $BuiltLib (Join-Path $RustOutAbiDir "libemu_rust_host.a")
}
finally {
    Pop-Location
}

Write-Host "[2/2] Compilando C++20 HAL + Vulkan 1.3 + JNI con CMake/Ninja en disco destino..."
$CmakeBuildDir = Join-Path $WorkDrive "build\cmake_$Abi"
New-Item -ItemType Directory -Force -Path $CmakeBuildDir | Out-Null

cmake -S $ScriptDir -B $CmakeBuildDir `
    -G "Ninja" `
    -DCMAKE_TOOLCHAIN_FILE="$ToolchainFile" `
    -DANDROID_ABI="$Abi" `
    -DANDROID_PLATFORM="android-$AndroidApi" `
    -DANDROID_SUPPORT_FLEXIBLE_PAGE_SIZES=ON `
    -DRUST_LIB_OVERRIDE="$(Join-Path $WorkDrive "build\rust_abi\$Abi\release\libemu_rust_host.a")" `
    -DCMAKE_BUILD_TYPE=Release

if ($LASTEXITCODE -ne 0) { throw "Fallo en configuracion CMake." }

cmake --build $CmakeBuildDir --parallel
if ($LASTEXITCODE -ne 0) { throw "Fallo en compilacion CMake/Ninja." }

Write-Host "Compilacion completada en disco D: $(Join-Path $CmakeBuildDir 'libemu_android15_core.so')"
