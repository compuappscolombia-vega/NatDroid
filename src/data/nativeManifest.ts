export type NativeLayer = 'abi' | 'rust' | 'cpp_hal' | 'cpp_gpu' | 'jni_build';

export interface NativeSourceFile {
  path: string;
  fileName: string;
  language: 'C' | 'C++20' | 'Rust' | 'CMake' | 'TOML' | 'Bash' | 'PowerShell';
  layer: NativeLayer;
  summary: string;
  content: string;
  lineCount: number;
  byteSize: number;
}

const rawNativeModules = import.meta.glob('/native/**/*', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const FILE_META: Record<
  string,
  { language: NativeSourceFile['language']; layer: NativeLayer; summary: string }
> = {
  '/native/include/emu_plugin_api.h': {
    language: 'C',
    layer: 'abi',
    summary: 'Contrato ABI estable en C11/C++20 para plugins modulares, capacidades por bitmask y servicios del host.',
  },
  '/native/plugins/dxvk_turnip_plugin.cpp': {
    language: 'C++20',
    layer: 'abi',
    summary: 'Implementación de plugin modular GPU DXVK/Turnip con exportación emu_plugin_entry y afinidad de núcleos.',
  },
  '/native/rust_host/Cargo.toml': {
    language: 'TOML',
    layer: 'rust',
    summary: 'Manifiesto Cargo del host seguro en memoria (staticlib + cdylib) para Android 15 ARM64 y x86_64.',
  },
  '/native/rust_host/src/lib.rs': {
    language: 'Rust',
    layer: 'rust',
    summary: 'Cargador dlopen seguro, validación estricta del descriptor ABI (0x454D5535) y ordenamiento topológico de dependencias.',
  },
  '/native/rust_host/src/memory_hal.rs': {
    language: 'Rust',
    layer: 'rust',
    summary: 'Cola lock-free SPSC (SpscInputRing) para baja latencia HID y reserva mmap alineada a páginas de 4KB/16KB.',
  },
  '/native/cpp_core/hw_driver_hal.hpp': {
    language: 'C++20',
    layer: 'cpp_hal',
    summary: 'Interfaz HAL de drivers de hardware: topología CPU, ADPF, AHardwareBuffer, memfd, DMA-BUF y nodos evdev.',
  },
  '/native/cpp_core/hw_driver_hal.cpp': {
    language: 'C++20',
    layer: 'cpp_hal',
    summary: 'Integración directa Android 15 NDK: APerformanceHintManager, sched_setaffinity, DMA_BUF_IOCTL_SYNC y /dev/input/event*.',
  },
  '/native/cpp_core/gpu_vulkan_bridge.hpp': {
    language: 'C++20',
    layer: 'cpp_gpu',
    summary: 'Cabecera del puente Vulkan 1.3 para importación zero-copy de AHardwareBuffer y semáforos timeline.',
  },
  '/native/cpp_core/gpu_vulkan_bridge.cpp': {
    language: 'C++20',
    layer: 'cpp_gpu',
    summary: 'Cargador ICD Mesa Turnip/libvulkan.so, VK_ANDROID_external_memory_android_hardware_buffer, Mailbox y VkPipelineCache.',
  },
  '/native/cpp_core/plugin_manager.cpp': {
    language: 'C++20',
    layer: 'cpp_hal',
    summary: 'Puente C++20 que expone EmuHostServices hacia el registro de plugins Rust (emu_rust_registry_*).',
  },
  '/native/jni/emu_jni_bridge.cpp': {
    language: 'C++20',
    layer: 'jni_build',
    summary: 'Puntos de entrada JNI para ANativeWindow_fromSurface, APerformanceHint_getManager y reenvío de entrada.',
  },
  '/native/CMakeLists.txt': {
    language: 'CMake',
    layer: 'jni_build',
    summary: 'Configuración NDK r27+ con alineación obligatoria de 16KB (-Wl,-z,max-page-size=16384) y enlace Vulkan/Rust.',
  },
  '/native/build_android15.sh': {
    language: 'Bash',
    layer: 'jni_build',
    summary: 'Script de compilación cruzada con cargo-ndk y CMake para Android 15 (API 35) arm64-v8a / x86_64.',
  },
  '/native/build_android15.ps1': {
    language: 'PowerShell',
    layer: 'jni_build',
    summary: 'Script Windows PowerShell que redirige Rustup, Cargo, TEMP, NDK y CMake/Ninja íntegramente al disco D:.',
  },
};

export const NATIVE_SOURCE_FILES: NativeSourceFile[] = Object.entries(rawNativeModules)
  .map(([path, content]) => {
    const meta = FILE_META[path] ?? {
      language: 'C++20' as const,
      layer: 'cpp_hal' as const,
      summary: 'Módulo nativo de AndroCore NDK.',
    };
    const fileName = path.split('/').pop() ?? path;
    return {
      path,
      fileName,
      language: meta.language,
      layer: meta.layer,
      summary: meta.summary,
      content,
      lineCount: content.split('\n').length,
      byteSize: new TextEncoder().encode(content).byteLength,
    };
  })
  .sort((a, b) => a.path.localeCompare(b.path));

export function buildSelfExtractingBundleScript(files: NativeSourceFile[]): string {
  const lines: string[] = [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    '# Paquete de código nativo AndroCore NDK (C++20 + Rust + JNI + CMake para Android 15 API 35)',
    'ROOT_DIR="androcore_native"',
    'mkdir -p "${ROOT_DIR}"',
    'cd "${ROOT_DIR}"',
    '',
  ];

  for (const file of files) {
    const relPath = file.path.replace(/^\/native\//, '');
    const dir = relPath.includes('/') ? relPath.slice(0, relPath.lastIndexOf('/')) : '.';
    if (dir !== '.') {
      lines.push(`mkdir -p "${dir}"`);
    }
    const marker = `EOF_${relPath.replace(/[^A-Za-z0-9]/g, '_').toUpperCase()}`;
    lines.push(`cat <<'${marker}' > "${relPath}"`);
    lines.push(file.content.replace(/\n$/, ''));
    lines.push(marker);
    lines.push('');
  }

  lines.push('chmod +x build_android15.sh');
  lines.push('echo "Archivos extraídos en $(pwd). Ejecuta: ANDROID_NDK_HOME=/ruta/ndk ./build_android15.sh arm64-v8a"');
  return lines.join('\n');
}
