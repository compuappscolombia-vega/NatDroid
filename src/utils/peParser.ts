export interface PeSectionInfo {
  name: string;
  virtualAddress: number;
  virtualSize: number;
  rawSize: number;
  rawOffset: number;
  executable: boolean;
  writable: boolean;
}

export interface PluginMappingRecommendation {
  dllName: string;
  requiredCategory: string;
  nativeModule: string;
  notes: string;
}

export interface ParsedPeResult {
  fileName: string;
  fileSizeBytes: number;
  machineHex: string;
  machineName: string;
  is64Bit: boolean;
  subsystemName: string;
  entryPointRva: number;
  imageBaseHex: string;
  sectionAlignment: number;
  fileAlignment: number;
  sections: PeSectionInfo[];
  importedDlls: string[];
  pluginMappings: PluginMappingRecommendation[];
}

function readAsciiCString(view: DataView, offset: number, maxLen = 256): string {
  if (offset < 0 || offset >= view.byteLength) return '';
  let out = '';
  const limit = Math.min(view.byteLength, offset + maxLen);
  for (let i = offset; i < limit; i++) {
    const ch = view.getUint8(i);
    if (ch === 0) break;
    if (ch >= 32 && ch <= 126) {
      out += String.fromCharCode(ch);
    }
  }
  return out;
}

function rvaToFileOffset(rva: number, sections: PeSectionInfo[]): number | null {
  for (const sec of sections) {
    const span = Math.max(sec.virtualSize, sec.rawSize);
    if (rva >= sec.virtualAddress && rva < sec.virtualAddress + span) {
      const delta = rva - sec.virtualAddress;
      if (delta < sec.rawSize) {
        return sec.rawOffset + delta;
      }
    }
  }
  return null;
}

function mapDllToPlugin(dllName: string): PluginMappingRecommendation {
  const lower = dllName.toLowerCase();
  if (lower.startsWith('d3d11') || lower.startsWith('d3d10') || lower.startsWith('dxgi') || lower.startsWith('d3d9')) {
    return {
      dllName,
      requiredCategory: 'EMU_PLUGIN_CAT_GPU_BACKEND',
      nativeModule: 'plugins/dxvk_turnip_plugin.cpp + gpu_vulkan_bridge.cpp',
      notes: 'Traducción Direct3D hacia Vulkan 1.3 con swapchain AHardwareBuffer.',
    };
  }
  if (lower.startsWith('d3d12')) {
    return {
      dllName,
      requiredCategory: 'EMU_PLUGIN_CAT_GPU_BACKEND',
      nativeModule: 'gpu_vulkan_bridge.cpp (VKD3D-Proton)',
      notes: 'Requiere VK_KHR_dynamic_rendering, timeline semaphores y descriptor indexing.',
    };
  }
  if (lower.includes('vulkan')) {
    return {
      dllName,
      requiredCategory: 'EMU_PLUGIN_CAT_GPU_BACKEND',
      nativeModule: 'cpp_core/gpu_vulkan_bridge.cpp',
      notes: 'Reenvío directo ICD a libvulkan.so / Mesa Turnip con VK_KHR_android_surface.',
    };
  }
  if (lower.startsWith('opengl')) {
    return {
      dllName,
      requiredCategory: 'EMU_PLUGIN_CAT_GPU_BACKEND',
      nativeModule: 'Zink / Turnip sobre gpu_vulkan_bridge.cpp',
      notes: 'Capa OpenGL sobre Vulkan 1.3 con caché persistente VkPipelineCache.',
    };
  }
  if (lower.startsWith('xinput') || lower.startsWith('dinput') || lower.startsWith('hid')) {
    return {
      dllName,
      requiredCategory: 'EMU_PLUGIN_CAT_INPUT_HID',
      nativeModule: 'rust_host/src/memory_hal.rs (SpscInputRing)',
      notes: 'Mapeo sin bloqueos desde evdev / AGameController hacia eventos Win32.',
    };
  }
  if (lower.startsWith('xaudio') || lower.startsWith('dsound') || lower.startsWith('winmm') || lower.startsWith('mmdevapi')) {
    return {
      dllName,
      requiredCategory: 'EMU_PLUGIN_CAT_AUDIO_BACKEND',
      nativeModule: 'Plugin AAudio MMAP (emu_plugin_api.h)',
      notes: 'Salida de audio de baja latencia vía AAudio exclusivo en Android 15.',
    };
  }
  if (lower.startsWith('kernel32') || lower.startsWith('ntdll') || lower.startsWith('kernelbase') || lower.startsWith('advapi32')) {
    return {
      dllName,
      requiredCategory: 'EMU_PLUGIN_CAT_SYSCALL_TRANSLATOR',
      nativeModule: 'cpp_core/hw_driver_hal.cpp + rust_host/src/memory_hal.rs',
      notes: 'Reserva de memoria alineada a 16KB, hilos fijados vía ADPF y syscalls Linux.',
    };
  }
  return {
    dllName,
    requiredCategory: 'EMU_PLUGIN_CAT_BINARY_LOADER',
    nativeModule: 'rust_host/src/lib.rs (PluginRegistry)',
    notes: 'Resolución dinámica de DLL Win32 o carga PE32+ en espacio GuestAddressSpace.',
  };
}

export function parsePeBinary(buffer: ArrayBuffer, fileName: string): ParsedPeResult {
  const view = new DataView(buffer);
  if (view.byteLength < 64) {
    throw new Error('El archivo es demasiado pequeño para ser un binario PE válido.');
  }

  const mz = view.getUint16(0, true);
  if (mz !== 0x5a4d) {
    throw new Error('Cabecera DOS inválida: no comienza con la firma MZ (0x5A4D).');
  }

  const peOffset = view.getUint32(0x3c, true);
  if (peOffset + 24 > view.byteLength) {
    throw new Error('Desplazamiento e_lfanew fuera de los límites del archivo.');
  }

  const peSig = view.getUint32(peOffset, true);
  if (peSig !== 0x00004550) {
    throw new Error('Firma PE\\0\\0 (0x00004550) no encontrada en e_lfanew.');
  }

  const coffOffset = peOffset + 4;
  const machine = view.getUint16(coffOffset, true);
  const numberOfSections = view.getUint16(coffOffset + 2, true);
  const sizeOfOptionalHeader = view.getUint16(coffOffset + 16, true);

  const optOffset = coffOffset + 20;
  if (optOffset + sizeOfOptionalHeader > view.byteLength || sizeOfOptionalHeader < 2) {
    throw new Error('Optional Header PE incompleto o corrupto.');
  }

  const optMagic = view.getUint16(optOffset, true);
  const is64Bit = optMagic === 0x020b;
  if (!is64Bit && optMagic !== 0x010b) {
    throw new Error(`Magic Optional Header no soportado: 0x${optMagic.toString(16)}`);
  }

  const entryPointRva = view.getUint32(optOffset + 16, true);
  const imageBaseBig = is64Bit
    ? view.getBigUint64(optOffset + 24, true)
    : BigInt(view.getUint32(optOffset + 28, true));

  const sectionAlignment = view.getUint32(optOffset + 32, true);
  const fileAlignment = view.getUint32(optOffset + 36, true);
  const subsystem = view.getUint16(optOffset + 68, true);

  const numRvaAndSizesOffset = is64Bit ? optOffset + 108 : optOffset + 92;
  const numDataDirs = numRvaAndSizesOffset + 4 <= view.byteLength ? view.getUint32(numRvaAndSizesOffset, true) : 0;
  const dataDirsOffset = numRvaAndSizesOffset + 4;

  const sectionTableOffset = optOffset + sizeOfOptionalHeader;
  const sections: PeSectionInfo[] = [];

  for (let i = 0; i < numberOfSections; i++) {
    const sOff = sectionTableOffset + i * 40;
    if (sOff + 40 > view.byteLength) break;

    let secName = '';
    for (let c = 0; c < 8; c++) {
      const byte = view.getUint8(sOff + c);
      if (byte === 0) break;
      secName += String.fromCharCode(byte);
    }

    const virtualSize = view.getUint32(sOff + 8, true);
    const virtualAddress = view.getUint32(sOff + 12, true);
    const rawSize = view.getUint32(sOff + 16, true);
    const rawOffset = view.getUint32(sOff + 20, true);
    const characteristics = view.getUint32(sOff + 36, true);

    sections.push({
      name: secName || `sec_${i}`,
      virtualAddress,
      virtualSize,
      rawSize,
      rawOffset,
      executable: (characteristics & 0x20000000) !== 0,
      writable: (characteristics & 0x80000000) !== 0,
    });
  }

  // Import Directory Table is DataDirectory[1]
  const importedDlls: string[] = [];
  if (numDataDirs >= 2 && dataDirsOffset + 16 <= view.byteLength) {
    const importDirRva = view.getUint32(dataDirsOffset + 8, true);
    if (importDirRva !== 0) {
      let importOffset = rvaToFileOffset(importDirRva, sections);
      let guard = 0;
      while (importOffset !== null && importOffset + 20 <= view.byteLength && guard < 256) {
        const originalFirstThunk = view.getUint32(importOffset, true);
        const nameRva = view.getUint32(importOffset + 12, true);
        const firstThunk = view.getUint32(importOffset + 16, true);
        if (originalFirstThunk === 0 && nameRva === 0 && firstThunk === 0) {
          break;
        }
        const nameOffset = rvaToFileOffset(nameRva, sections);
        if (nameOffset !== null) {
          const dllName = readAsciiCString(view, nameOffset, 128);
          if (dllName && !importedDlls.includes(dllName)) {
            importedDlls.push(dllName);
          }
        }
        importOffset += 20;
        guard++;
      }
    }
  }

  const machineMap: Record<number, string> = {
    0x8664: 'x86_64 (AMD64)',
    0x014c: 'x86 (i386)',
    0xaa64: 'ARM64 (AArch64)',
    0x01c4: 'ARMv7 Thumb-2',
  };

  const subsystemMap: Record<number, string> = {
    1: 'Native (Kernel/Driver)',
    2: 'Windows GUI (Escritorio)',
    3: 'Windows CUI (Consola)',
    10: 'EFI Application',
  };

  return {
    fileName,
    fileSizeBytes: buffer.byteLength,
    machineHex: `0x${machine.toString(16).padStart(4, '0')}`,
    machineName: machineMap[machine] ?? 'Arquitectura desconocida',
    is64Bit,
    subsystemName: subsystemMap[subsystem] ?? `Subsistema ${subsystem}`,
    entryPointRva,
    imageBaseHex: `0x${imageBaseBig.toString(16)}`,
    sectionAlignment,
    fileAlignment,
    sections,
    importedDlls,
    pluginMappings: importedDlls.map(mapDllToPlugin),
  };
}
