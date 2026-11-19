import { useMemo, useState } from 'react';
import { Download, Info, Terminal } from 'lucide-react';
import { ArchitecturePillars } from './components/ArchitecturePillars';
import { NativeCodeExplorer } from './components/NativeCodeExplorer';
import { PeBinaryInspector } from './components/PeBinaryInspector';
import { RustCacheMigrationGuide } from './components/RustCacheMigrationGuide';
import { buildSelfExtractingBundleScript, NATIVE_SOURCE_FILES } from './data/nativeManifest';

export default function App() {
  const [selectedCodePath, setSelectedCodePath] = useState<string>(
    '/native/include/emu_plugin_api.h'
  );
  const [buildPlatform, setBuildPlatform] = useState<'windows_d' | 'linux'>('windows_d');

  const totalLines = useMemo(
    () => NATIVE_SOURCE_FILES.reduce((acc, file) => acc + file.lineCount, 0),
    []
  );

  const totalBytes = useMemo(
    () => NATIVE_SOURCE_FILES.reduce((acc, file) => acc + file.byteSize, 0),
    []
  );

  const handleOpenCodeFile = (path: string) => {
    setSelectedCodePath(path);
    const el = document.getElementById('codigo');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const handleDownloadBundle = () => {
    const script = buildSelfExtractingBundleScript(NATIVE_SOURCE_FILES);
    const blob = new Blob([script], { type: 'text/x-shellscript;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'extract_androcore_native.sh';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between gap-8">
          <a
            href="#top"
            className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
          >
            AndroCore NDK
          </a>

          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
            <a
              href="#arquitectura"
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
            >
              Arquitectura
            </a>
            <a
              href="#codigo"
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
            >
              Código Nativo
            </a>
            <a
              href="#inspector-pe"
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
            >
              Inspector PE
            </a>
            <a
              href="#compilacion"
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
            >
              Compilación NDK
            </a>
          </nav>

          <div className="flex items-center shrink-0">
            <button
              type="button"
              onClick={handleDownloadBundle}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" aria-hidden="true" />
              Exportar Bundle
            </button>
          </div>
        </div>
      </header>

      <main id="top" className="max-w-7xl mx-auto px-6">
        <section className="py-12 sm:py-16">
          <div className="max-w-4xl">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 mb-3">
              <span>Android 15 (API 35)</span>
              <span aria-hidden="true">·</span>
              <span>C++20 HAL &amp; Vulkan 1.3</span>
              <span aria-hidden="true">·</span>
              <span>Host Modular en Rust</span>
            </div>
            <h1 className="text-3xl sm:text-5xl font-bold tracking-tight text-slate-900 text-balance leading-[1.12]">
              Arquitectura modular de plugins, HAL de hardware y puente GPU para Android 15
            </h1>
            <p className="mt-4 text-base text-slate-600 leading-relaxed max-w-3xl">
              Implementación nativa en C++20 y Rust diseñada para carga dinámica de módulos (.so),
              alineación obligatoria de páginas de 16 KB en Android 15, afinidad CPU/ADPF, colas HID
              sin bloqueos e importación directa de superficies <code className="font-mono text-sm text-slate-800">AHardwareBuffer</code> en Vulkan 1.3.
            </p>
          </div>

          <div className="mt-8 p-4 sm:p-5 bg-white border border-slate-200 rounded-xl flex items-start gap-3">
            <Info className="w-4 h-4 text-blue-700 mt-0.5 shrink-0" aria-hidden="true" />
            <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
              <span className="font-semibold text-slate-900">Alcance de ejecución real (sin simulación): </span>
              este entorno web muestra e inspecciona el código fuente real ubicado en <code className="font-mono text-xs text-slate-800">/native/</code> y analiza binarios <code className="font-mono text-xs text-slate-800">.exe/.dll</code> locales. La compilación del binario <code className="font-mono text-xs text-slate-800">libemu_android15_core.so</code> y la ejecución directa sobre GPU Adreno/Mali y kernel Linux requieren compilar localmente con Android NDK r27+ y <code className="font-mono text-xs text-slate-800">cargo-ndk</code>.
            </p>
          </div>

          <div className="mt-8 grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="p-5 bg-white border border-slate-200 rounded-xl">
              <p className="text-xs text-slate-500">Archivos fuente nativos</p>
              <p className="text-2xl font-semibold font-mono tabular-nums text-slate-900 mt-1">
                {NATIVE_SOURCE_FILES.length}
              </p>
              <p className="text-xs text-slate-500 mt-1 tabular-nums">
                {totalLines.toLocaleString('es-ES')} líneas · {(totalBytes / 1024).toFixed(1)} KB
              </p>
            </div>
            <div className="p-5 bg-white border border-slate-200 rounded-xl">
              <p className="text-xs text-slate-500">Contrato ABI Plugins</p>
              <p className="text-2xl font-semibold font-mono tabular-nums text-slate-900 mt-1">
                v1.0
              </p>
              <p className="text-xs text-slate-500 mt-1">
                Magic 0x454D5535 · 6 categorías
              </p>
            </div>
            <div className="p-5 bg-white border border-slate-200 rounded-xl">
              <p className="text-xs text-slate-500">Alineación de páginas</p>
              <p className="text-2xl font-semibold font-mono tabular-nums text-slate-900 mt-1">
                16 KB
              </p>
              <p className="text-xs text-slate-500 mt-1">
                Android 15 ELF &amp; mmap dinámico
              </p>
            </div>
            <div className="p-5 bg-white border border-slate-200 rounded-xl">
              <p className="text-xs text-slate-500">Ruta gráfica GPU</p>
              <p className="text-2xl font-semibold font-mono tabular-nums text-slate-900 mt-1">
                VK 1.3
              </p>
              <p className="text-xs text-slate-500 mt-1">
                AHardwareBuffer + Turnip ICD
              </p>
            </div>
          </div>
        </section>

        <ArchitecturePillars onOpenFile={handleOpenCodeFile} />

        <NativeCodeExplorer
          selectedPath={selectedCodePath}
          onSelectPath={setSelectedCodePath}
        />

        <PeBinaryInspector />

        <section id="compilacion" className="py-12 border-t border-slate-200">
          <div className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
            <div className="max-w-xl">
              <div className="flex items-center gap-2 text-xs font-medium text-slate-500 mb-2">
                <Terminal className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Compilación cruzada local para dispositivo físico</span>
              </div>
              <h2 className="text-xl font-semibold text-slate-900">
                Compilar biblioteca nativa para Android 15 (arm64-v8a / x86_64)
              </h2>
              <p className="text-sm text-slate-600 mt-1.5 leading-relaxed">
                Si tienes el disco <code className="font-mono text-xs text-slate-800">C:</code> lleno, usa el script{' '}
                <code className="font-mono text-xs text-slate-800">build_android15.ps1</code> para mover Rustup, Cargo, temporales y salida CMake/Ninja íntegramente al disco{' '}
                <code className="font-mono text-xs text-slate-800">D:</code>.
              </p>

              <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg mt-4">
                <button
                  type="button"
                  onClick={() => setBuildPlatform('windows_d')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    buildPlatform === 'windows_d'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Windows (Disco D:)
                </button>
                <button
                  type="button"
                  onClick={() => setBuildPlatform('linux')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    buildPlatform === 'linux'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Linux / macOS / WSL
                </button>
              </div>
            </div>

            {buildPlatform === 'windows_d' ? (
              <pre className="bg-slate-950 text-slate-100 text-xs font-mono p-4 rounded-lg overflow-x-auto shrink-0">
{`# En PowerShell sobre D:\\AndroCore\\native
.\\build_android15.ps1 \`
  -Abi arm64-v8a \`
  -WorkDrive "D:\\AndroCore" \`
  -NdkPath "D:\\AndroCore\\Android\\Sdk\\ndk\\27.2.12479018"`}
              </pre>
            ) : (
              <pre className="bg-slate-950 text-slate-100 text-xs font-mono p-4 rounded-lg overflow-x-auto shrink-0">
{`chmod +x extract_androcore_native.sh
./extract_androcore_native.sh
cd androcore_native
ANDROID_NDK_HOME=/opt/android-ndk-r27 ./build_android15.sh arm64-v8a`}
              </pre>
            )}
          </div>

          <RustCacheMigrationGuide />
        </section>
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="max-w-7xl mx-auto px-6 py-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-xs text-slate-500">
          <span>AndroCore NDK · Arquitectura C++20, Rust y Vulkan 1.3 para Android 15</span>
          <span>Código fuente disponible en /native/ para compilación NDK local</span>
        </div>
      </footer>
    </div>
  );
}
