import { useMemo, useState } from 'react';
import { Check, Copy, Download, FileCode2 } from 'lucide-react';
import { NATIVE_SOURCE_FILES, NativeLayer, NativeSourceFile } from '../data/nativeManifest';

interface NativeCodeExplorerProps {
  selectedPath: string;
  onSelectPath: (path: string) => void;
}

const LAYER_TABS: { id: 'all' | NativeLayer; label: string }[] = [
  { id: 'all', label: 'Todos' },
  { id: 'abi', label: 'ABI y Plugins' },
  { id: 'rust', label: 'Host Rust' },
  { id: 'cpp_hal', label: 'C++20 HAL' },
  { id: 'cpp_gpu', label: 'GPU Vulkan' },
  { id: 'jni_build', label: 'JNI y Build' },
];

export function NativeCodeExplorer({ selectedPath, onSelectPath }: NativeCodeExplorerProps) {
  const [layerFilter, setLayerFilter] = useState<'all' | NativeLayer>('all');
  const [copiedPath, setCopiedPath] = useState<string | null>(null);

  const filteredFiles = useMemo(() => {
    if (layerFilter === 'all') return NATIVE_SOURCE_FILES;
    return NATIVE_SOURCE_FILES.filter((f) => f.layer === layerFilter);
  }, [layerFilter]);

  const activeFile: NativeSourceFile = useMemo(() => {
    const found = NATIVE_SOURCE_FILES.find((f) => f.path === selectedPath);
    return found ?? filteredFiles[0] ?? NATIVE_SOURCE_FILES[0];
  }, [selectedPath, filteredFiles]);

  const handleCopy = async (file: NativeSourceFile) => {
    try {
      await navigator.clipboard.writeText(file.content);
      setCopiedPath(file.path);
      setTimeout(() => setCopiedPath(null), 1800);
    } catch {
      // Clipboard may be blocked in restricted iframes
    }
  };

  const handleDownloadSingle = (file: NativeSourceFile) => {
    const blob = new Blob([file.content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.fileName;
    a.click();
    URL.revokeObjectURL(url);
  };

  const lines = useMemo(() => activeFile.content.split('\n'), [activeFile]);

  return (
    <section id="codigo" className="py-12 border-t border-slate-200">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 mb-6">
        <div>
          <p className="text-xs font-medium text-slate-500 mb-2">
            Código fuente real en disco · {NATIVE_SOURCE_FILES.length} archivos nativos
          </p>
          <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight text-slate-900 text-balance">
            Explorador de código C++20, Rust y NDK
          </h2>
        </div>

        <div className="inline-flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg self-start">
          {LAYER_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setLayerFilter(tab.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                layerFilter === tab.id
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden grid grid-cols-1 lg:grid-cols-12">
        <aside className="lg:col-span-4 border-b lg:border-b-0 lg:border-r border-slate-200 divide-y divide-slate-100 max-h-[560px] overflow-y-auto">
          {filteredFiles.map((file) => {
            const isSelected = file.path === activeFile.path;
            return (
              <button
                key={file.path}
                type="button"
                onClick={() => onSelectPath(file.path)}
                className={`w-full text-left px-4 py-3.5 transition-colors cursor-pointer ${
                  isSelected ? 'bg-slate-50' : 'hover:bg-slate-50/70'
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="inline-flex items-center gap-2 text-xs font-mono font-semibold text-slate-900 truncate">
                    <FileCode2 className="w-3.5 h-3.5 text-slate-500 shrink-0" aria-hidden="true" />
                    <span className="truncate">{file.path.replace('/native/', '')}</span>
                  </span>
                  <span className="text-[11px] font-mono text-slate-500 tabular-nums shrink-0">
                    {file.language}
                  </span>
                </div>
                <p className="text-xs text-slate-600 line-clamp-2 leading-relaxed">{file.summary}</p>
              </button>
            );
          })}
        </aside>

        <div className="lg:col-span-8 flex flex-col min-w-0">
          <div className="px-5 py-3.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-4 bg-slate-50">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-xs font-mono text-slate-900 font-semibold truncate">
                <span>{activeFile.path}</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-500 mt-0.5 tabular-nums">
                <span>{activeFile.language}</span>
                <span aria-hidden="true">·</span>
                <span>{activeFile.lineCount} líneas</span>
                <span aria-hidden="true">·</span>
                <span>{activeFile.byteSize} bytes</span>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => handleCopy(activeFile)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-100 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                {copiedPath === activeFile.path ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
                    Copiado
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                    Copiar
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() => handleDownloadSingle(activeFile)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" aria-hidden="true" />
                Descargar archivo
              </button>
            </div>
          </div>

          <div className="overflow-auto max-h-[500px] bg-slate-950 text-slate-100 p-4 text-xs font-mono leading-relaxed">
            <table className="w-full border-collapse">
              <tbody>
                {lines.map((line, idx) => (
                  <tr key={idx} className="hover:bg-slate-900/80">
                    <td className="select-none pr-4 text-right text-slate-500 w-10 align-top tabular-nums">
                      {idx + 1}
                    </td>
                    <td className="whitespace-pre text-slate-100">{line || ' '}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}
