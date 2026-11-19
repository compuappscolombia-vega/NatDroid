import { useState } from 'react';
import { ArrowUpRight, Cpu, Layers, MonitorPlay } from 'lucide-react';

interface ArchitecturePillarsProps {
  onOpenFile: (path: string) => void;
}

type PillarId = 'plugins' | 'drivers' | 'gpu';

interface PillarDetail {
  id: PillarId;
  tabLabel: string;
  title: string;
  summary: string;
  specs: { label: string; detail: string; symbol: string; filePath: string }[];
  pipelineSteps: { step: string; role: string; file: string }[];
}

const PILLARS: Record<PillarId, PillarDetail> = {
  plugins: {
    id: 'plugins',
    tabLabel: '01. Arquitectura de Plugins',
    title: 'Contrato ABI estable en C y host seguro en Rust',
    summary:
      'Cada subsistema (cargador PE32+/ELF64, traductor de syscalls, backend Vulkan, HAL de hardware, HID y AAudio) se compila como biblioteca compartida .so independiente y se carga mediante validación estricta de ABI.',
    specs: [
      {
        label: 'Validación ABI y Magic',
        detail: 'Verifica EMU_PLUGIN_MAGIC (0x454D5535), tamaño de struct y versión mayor antes de ejecutar init().',
        symbol: 'EmuPluginDescriptor',
        filePath: '/native/include/emu_plugin_api.h',
      },
      {
        label: 'Resolución topológica',
        detail: 'Ordena dependencias declaradas entre módulos mediante DFS y detecta ciclos antes de inicializar.',
        symbol: 'PluginRegistry::resolve_topological_order',
        filePath: '/native/rust_host/src/lib.rs',
      },
      {
        label: 'Despacho por prioridad',
        detail: 'Múltiples backends pueden implementar la misma interfaz; el registro selecciona el de mayor prioridad activo.',
        symbol: 'PluginRegistry::query_interface',
        filePath: '/native/rust_host/src/lib.rs',
      },
      {
        label: 'Inyección de servicios del host',
        detail: 'Los plugins reciben punteros C para memoria AHardwareBuffer, topología CPU, ADPF y registro de logs.',
        symbol: 'EmuHostServices',
        filePath: '/native/cpp_core/plugin_manager.cpp',
      },
    ],
    pipelineSteps: [
      { step: 'dlopen() en namespace aislado', role: 'Carga dinámica del módulo .so desde el directorio nativo de Android 15', file: 'rust_host/src/lib.rs' },
      { step: 'emu_plugin_entry()', role: 'Resolución del símbolo C único exportado por cada plugin', file: 'plugins/dxvk_turnip_plugin.cpp' },
      { step: 'Comprobación struct_size', role: 'Rechazo inmediato con EMU_ERR_ABI_MISMATCH ante binarios incompatibles', file: 'include/emu_plugin_api.h' },
      { step: 'vtable.init(ctx, host)', role: 'Entrega de EmuHostServices y enlace cruzado mediante query_interface()', file: 'cpp_core/plugin_manager.cpp' },
    ],
  },
  drivers: {
    id: 'drivers',
    tabLabel: '02. Drivers de Hardware',
    title: 'Integración directa HAL con CPU, memoria de 16 KB y periféricos',
    summary:
      'Conecta las aplicaciones de escritorio con el silicio del dispositivo mediante llamadas reales de Linux y el NDK de Android 15, evitando copias intermedias en memoria y reduciendo la latencia de entrada.',
    specs: [
      {
        label: 'Páginas de 4 KB y 16 KB (Android 15)',
        detail: 'Consulta sysconf(_SC_PAGESIZE) en tiempo de ejecución y enlaza segmentos ELF con -Wl,-z,max-page-size=16384.',
        symbol: 'GuestAddressSpace::reserve',
        filePath: '/native/rust_host/src/memory_hal.rs',
      },
      {
        label: 'Afinidad de núcleos y ADPF',
        detail: 'Clasifica núcleos Prime/Big vía sysfs cpufreq, fija hilos con sched_setaffinity y reporta tiempos a APerformanceHintManager.',
        symbol: 'HardwareDriverHal::initialize',
        filePath: '/native/cpp_core/hw_driver_hal.cpp',
      },
      {
        label: 'Memoria compartida DMA-BUF / memfd',
        detail: 'Crea regiones memfd_create y ejecuta ioctl DMA_BUF_IOCTL_SYNC para coherencia de caché entre CPU y GPU.',
        symbol: 'HardwareDriverHal::sync_dmabuf',
        filePath: '/native/cpp_core/hw_driver_hal.cpp',
      },
      {
        label: 'Cola de entrada SPSC sin bloqueos',
        detail: 'Buffer circular alineado a línea de caché (64 B) con semántica Acquire/Release para eventos evdev y teclado/ratón.',
        symbol: 'SpscInputRing<EmuRawInputPacket, 4096>',
        filePath: '/native/rust_host/src/memory_hal.rs',
      },
    ],
    pipelineSteps: [
      { step: 'AInputQueue / /dev/input/event*', role: 'Captura de eventos crudos HID, teclado, ratón y mando', file: 'cpp_core/hw_driver_hal.cpp' },
      { step: 'emu_input_ring_push()', role: 'Escritura atómica sin mutex desde el hilo de interfaz Android', file: 'rust_host/src/memory_hal.rs' },
      { step: 'sched_setaffinity + ADPF', role: 'Ejecución de hilos críticos en núcleos de alto rendimiento sin throttling', file: 'cpp_core/hw_driver_hal.cpp' },
      { step: 'AHardwareBuffer_allocate()', role: 'Asignación física compartible directamente con el controlador GPU', file: 'cpp_core/hw_driver_hal.hpp' },
    ],
  },
  gpu: {
    id: 'gpu',
    tabLabel: '03. Aceleración GPU Vulkan 1.3',
    title: 'Ruta zero-copy con AHardwareBuffer, Turnip ICD y Timeline Semaphores',
    summary:
      'Exposición directa del hardware gráfico Adreno/Mali mediante Vulkan 1.3, permitiendo cargar drivers Mesa Turnip personalizados e importar superficies DXVK sin copiar píxeles por CPU.',
    specs: [
      {
        label: 'Importación AHardwareBuffer a VkImage',
        detail: 'Usa VK_ANDROID_external_memory_android_hardware_buffer para enlazar memoria dedicada de GPU directamente.',
        symbol: 'VulkanGpuBridge::import_ahardware_buffer',
        filePath: '/native/cpp_core/gpu_vulkan_bridge.cpp',
      },
      {
        label: 'Selector ICD Mesa Turnip / sistema',
        detail: 'Permite configurar VK_ICD_FILENAMES dinámicamente antes de resolver vkGetInstanceProcAddr desde libvulkan.so.',
        symbol: 'VulkanGpuBridge::load_icd_symbols',
        filePath: '/native/cpp_core/gpu_vulkan_bridge.cpp',
      },
      {
        label: 'Sincronización Timeline y Mailbox',
        detail: 'Activa VK_KHR_timeline_semaphore, dynamicRendering y modo VK_PRESENT_MODE_MAILBOX_KHR para menor latencia.',
        symbol: 'VulkanGpuBridge::submit_and_present',
        filePath: '/native/cpp_core/gpu_vulkan_bridge.cpp',
      },
      {
        label: 'Caché persistente de shaders',
        detail: 'Serializa y recarga VkPipelineCache en almacenamiento local para mitigar tirones al compilar shaders DXVK/VKD3D.',
        symbol: 'VulkanGpuBridge::save_pipeline_cache',
        filePath: '/native/cpp_core/gpu_vulkan_bridge.cpp',
      },
    ],
    pipelineSteps: [
      { step: 'DX11 / DX12 / OpenGL invitado', role: 'Llamadas gráficas del binario Windows interceptadas por plugin GPU', file: 'plugins/dxvk_turnip_plugin.cpp' },
      { step: 'vkGetAndroidHardwareBufferPropertiesANDROID', role: 'Mapeo directo del buffer gráfico como VkImage nativo sin copias CPU', file: 'cpp_core/gpu_vulkan_bridge.cpp' },
      { step: 'VkTimelineSemaphoreSubmitInfo', role: 'Sincronización GPU-GPU con Vulkan 1.3 synchronization2', file: 'cpp_core/gpu_vulkan_bridge.cpp' },
      { step: 'VK_KHR_android_surface', role: 'Presentación directa sobre ANativeWindow de Android 15', file: 'jni/emu_jni_bridge.cpp' },
    ],
  },
};

export function ArchitecturePillars({ onOpenFile }: ArchitecturePillarsProps) {
  const [activePillar, setActivePillar] = useState<PillarId>('plugins');
  const current = PILLARS[activePillar];

  return (
    <section id="arquitectura" className="py-12 border-t border-slate-200">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-8">
        <div>
          <p className="text-xs font-medium text-slate-500 mb-2">
            Diseño de sistemas · C++20 · Rust · Android 15 API 35
          </p>
          <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight text-slate-900 text-balance">
            Subsistemas nativos implementados
          </h2>
        </div>

        <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg self-start">
          <button
            type="button"
            onClick={() => setActivePillar('plugins')}
            className={`inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activePillar === 'plugins'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Layers className="w-3.5 h-3.5" aria-hidden="true" />
            Plugins Modular
          </button>
          <button
            type="button"
            onClick={() => setActivePillar('drivers')}
            className={`inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activePillar === 'drivers'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Cpu className="w-3.5 h-3.5" aria-hidden="true" />
            Drivers Hardware
          </button>
          <button
            type="button"
            onClick={() => setActivePillar('gpu')}
            className={`inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activePillar === 'gpu'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <MonitorPlay className="w-3.5 h-3.5" aria-hidden="true" />
            GPU Vulkan 1.3
          </button>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8">
        <div className="max-w-3xl mb-8">
          <p className="text-xs font-medium text-blue-700 mb-1.5">{current.tabLabel}</p>
          <h3 className="text-xl font-semibold text-slate-900 mb-2">{current.title}</h3>
          <p className="text-sm leading-relaxed text-slate-600">{current.summary}</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          <div className="lg:col-span-7 divide-y divide-slate-200 border-t border-b border-slate-200">
            {current.specs.map((spec) => (
              <div key={spec.label} className="py-4 flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-slate-900">{spec.label}</span>
                    <span className="text-slate-300" aria-hidden="true">·</span>
                    <code className="text-xs font-mono text-slate-600">{spec.symbol}</code>
                  </div>
                  <p className="text-sm text-slate-600 leading-relaxed">{spec.detail}</p>
                </div>
                <button
                  type="button"
                  onClick={() => onOpenFile(spec.filePath)}
                  className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:text-blue-900 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Ver código
                  <ArrowUpRight className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>

          <div className="lg:col-span-5">
            <h4 className="text-sm font-semibold text-slate-900 mb-3">
              Flujo de ejecución nativo
            </h4>
            <ol className="space-y-3">
              {current.pipelineSteps.map((item, idx) => (
                <li
                  key={item.step}
                  className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg"
                >
                  <div className="flex items-center justify-between gap-2 text-xs text-slate-500 mb-1">
                    <span className="font-mono tabular-nums font-medium text-slate-700">
                      0{idx + 1}. {item.step}
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed mb-1.5">{item.role}</p>
                  <span className="text-[11px] font-mono text-slate-500">{item.file}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </section>
  );
}
