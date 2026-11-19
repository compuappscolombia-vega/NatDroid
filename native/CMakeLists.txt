cmake_minimum_required(VERSION 3.22.1)
project(emu_android15_core LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# Android 15 mandatory 16KB ELF page alignment
add_link_options("-Wl,-z,max-page-size=16384")

find_library(ANDROID_LIB android REQUIRED)
find_library(LOG_LIB log REQUIRED)
find_library(VULKAN_LIB vulkan REQUIRED)
find_library(NATIVEWINDOW_LIB nativewindow REQUIRED)

set(RUST_LIB_PATH "${CMAKE_CURRENT_SOURCE_DIR}/rust_host/target/${ANDROID_ABI}/release/libemu_rust_host.a")

add_library(emu_android15_core SHARED
    cpp_core/hw_driver_hal.cpp
    cpp_core/gpu_vulkan_bridge.cpp
    cpp_core/plugin_manager.cpp
    jni/emu_jni_bridge.cpp
)

target_include_directories(emu_android15_core PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/include
    ${CMAKE_CURRENT_SOURCE_DIR}/cpp_core
)

target_compile_options(emu_android15_core PRIVATE
    -O3
    -fvisibility=hidden
    -Wall
    -Wextra
    -Werror=return-type
)

target_link_libraries(emu_android15_core
    ${RUST_LIB_PATH}
    ${ANDROID_LIB}
    ${LOG_LIB}
    ${VULKAN_LIB}
    ${NATIVEWINDOW_LIB}
    dl
)
