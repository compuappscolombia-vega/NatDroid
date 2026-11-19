#!/usr/bin/env bash
set -euo pipefail

# Build script for Android 15 (API 35) arm64-v8a & x86_64
# Requires: Android NDK r27+, Rust toolchain, cargo-ndk, CMake 3.22+

ANDROID_API=35
ABI="${1:-arm64-v8a}"

if [[ -z "${ANDROID_NDK_HOME:-}" ]]; then
  echo "ERROR: Set ANDROID_NDK_HOME to your Android NDK r27+ installation."
  exit 1
fi

echo "[1/2] Building Rust memory-safe plugin host & lock-free HAL (${ABI}, API ${ANDROID_API})..."
pushd rust_host > /dev/null
cargo ndk -t "${ABI}" -p "${ANDROID_API}" build --release
mkdir -p "target/${ABI}/release"
if [[ "${ABI}" == "arm64-v8a" ]]; then
  cp "target/aarch64-linux-android/release/libemu_rust_host.a" "target/${ABI}/release/"
elif [[ "${ABI}" == "x86_64" ]]; then
  cp "target/x86_64-linux-android/release/libemu_rust_host.a" "target/${ABI}/release/"
fi
popd > /dev/null

echo "[2/2] Building C++20 Hardware HAL + Vulkan 1.3 Bridge + JNI shared library..."
cmake -S . -B "build/${ABI}" \
  -DCMAKE_TOOLCHAIN_FILE="${ANDROID_NDK_HOME}/build/cmake/android.toolchain.cmake" \
  -DANDROID_ABI="${ABI}" \
  -DANDROID_PLATFORM="android-${ANDROID_API}" \
  -DANDROID_SUPPORT_FLEXIBLE_PAGE_SIZES=ON \
  -DCMAKE_BUILD_TYPE=Release

cmake --build "build/${ABI}" --parallel "$(nproc)"
echo "Built native core: build/${ABI}/libemu_android15_core.so"
