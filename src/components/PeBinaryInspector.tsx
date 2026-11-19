import { ChangeEvent, DragEvent, useRef, useState } from 'react';
import { AlertCircle, Binary, Upload } from 'lucide-react';
import { ParsedPeResult, parsePeBinary } from '../utils/peParser';

export function PeBinaryInspector() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [parsed, setParsed] = useState<ParsedPeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isParsing, setIsParsing] = useState(false);

  const inspectFile = async (file: File) => {
    setError(null);
    setIsParsing(true);
    try {
      const buffer = await file.arrayBuffer();
      const result = parsePeBinary(buffer, file.name);
      setParsed(result);
    } catch (err) {
      setParsed(null);
      setError(err instanceof Error ? err.message : 'No se pudo analizar el binario PE.');
    } finally {
      setIsParsing(false);
    }
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      void inspectFile(file);
    }
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      void inspectFile(file);
    }
  };

  return (
    <section id="inspector-pe" className="py-12 border-t border-slate-200">
      <div className="mb-6">
        <p className="text-xs font-medium text-slate-500 mb-2">
          Análisis local en navegador · Sin subida a servidores externos
        </p>
        <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight text-slate-900 text-balance">
          Inspector real de binarios Windows PE / PE32+
        </h2>
        <p className="text-sm text-slate-600 mt-2 max-w-3xl leading-relaxed">
          Selecciona un ejecutable <code className="font-mono text-xs text-slate-800">.exe</code> o biblioteca{' '}
          <code className="font-mono text-xs text-slate-800">.dll</code> real desde tu equipo para leer sus cabeceras
          COFF/PE, secciones y tabla de importaciones, y ver qué módulos del sistema de plugins necesita en Android 15.
        </p>
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        className={`bg-white border rounded-xl p-6 sm:p-8 transition-colors ${
          isDragging ? 'border-blue-600 bg-blue-50/40' : 'border-slate-200'
        }`}
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-200">
          <div className="flex items-start gap-3">
            <Binary className="w-5 h-5 text-slate-700 mt-0.5 shrink-0" aria-hidden="true" />
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                Cargar binario Windows (.exe / .dll)
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Lee encabezados DOS MZ, firma PE, arquitectura x86_64/x86 y tabla real de importaciones IAT.
              </p>
            </div>
          </div>

          <div>
            <input
              ref={inputRef}
              type="file"
              accept=".exe,.dll,.sys"
              onChange={handleFileChange}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={isParsing}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
            >
              <Upload className="w-3.5 h-3.5" aria-hidden="true" />
              {isParsing ? 'Analizando...' : 'Seleccionar .exe / .dll'}
            </button>
          </div>
        </div>

        {error && (
          <div className="mt-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
            <AlertCircle className="w-4 h-4 text-red-700 mt-0.5 shrink-0" aria-hidden="true" />
            <div className="text-xs text-red-900 leading-relaxed">
              <span className="font-semibold">Error de formato PE: </span>
              {error}
            </div>
          </div>
        )}

        {!parsed && !error && (
          <div className="py-10 text-center">
            <p className="text-sm font-medium text-slate-700">
              Ningún binario cargado todavía
            </p>
            <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
              Arrastra un archivo <code className="font-mono">.exe</code> o <code className="font-mono">.dll</code> aquí
              o usa el botón superior. Este lector inspecciona los bytes reales; no simula la ejecución del programa.
            </p>
          </div>
        )}

        {parsed && (
          <div className="mt-6 space-y-8">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-6">
              <div>
                <p className="text-xs text-slate-500 mb-1">Archivo</p>
                <p className="text-sm font-semibold text-slate-900 truncate" title={parsed.fileName}>
                  {parsed.fileName}
                </p>
                <p className="text-xs font-mono text-slate-500 tabular-nums mt-0.5">
                  {parsed.fileSizeBytes.toLocaleString('es-ES')} bytes
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-1">Arquitectura COFF</p>
                <p className="text-sm font-semibold text-slate-900">{parsed.machineName}</p>
                <p className="text-xs font-mono text-slate-500 tabular-nums mt-0.5">
                  {parsed.machineHex} · {parsed.is64Bit ? 'PE32+ (64-bit)' : 'PE32 (32-bit)'}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-1">Subsistema y Entrada</p>
                <p className="text-sm font-semibold text-slate-900">{parsed.subsystemName}</p>
                <p className="text-xs font-mono text-slate-500 tabular-nums mt-0.5">
                  Entry RVA 0x{parsed.entryPointRva.toString(16)}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-1">Alineación de sección</p>
                <p className="text-sm font-semibold font-mono text-slate-900 tabular-nums">
                  {parsed.sectionAlignment} B
                </p>
                <p className="text-xs font-mono text-slate-500 tabular-nums mt-0.5">
                  ImageBase {parsed.imageBaseHex}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
              <div className="lg:col-span-5">
                <h4 className="text-sm font-semibold text-slate-900 mb-3">
                  Secciones ({parsed.sections.length})
                </h4>
                <div className="border border-slate-200 rounded-lg overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                      <tr>
                        <th className="py-2.5 px-3 font-medium">Sección</th>
                        <th className="py-2.5 px-3 font-medium text-right">RVA</th>
                        <th className="py-2.5 px-3 font-medium text-right">Raw Size</th>
                        <th className="py-2.5 px-3 font-medium text-right">Permisos</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-mono tabular-nums">
                      {parsed.sections.map((sec, idx) => (
                        <tr key={`${sec.name}-${idx}`} className="hover:bg-slate-50">
                          <td className="py-2 px-3 font-semibold text-slate-900">{sec.name}</td>
                          <td className="py-2 px-3 text-right text-slate-600">
                            0x{sec.virtualAddress.toString(16)}
                          </td>
                          <td className="py-2 px-3 text-right text-slate-600">
                            {sec.rawSize.toLocaleString('es-ES')}
                          </td>
                          <td className="py-2 px-3 text-right text-slate-600">
                            R{sec.writable ? 'W' : '-'}{sec.executable ? 'X' : '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="lg:col-span-7">
                <h4 className="text-sm font-semibold text-slate-900 mb-3">
                  Mapeo de DLL importadas hacia plugins AndroCore ({parsed.pluginMappings.length})
                </h4>
                {parsed.pluginMappings.length === 0 ? (
                  <p className="text-xs text-slate-500 p-4 border border-slate-200 rounded-lg">
                    Este binario no declara una tabla de importaciones estándar o está empaquetado.
                  </p>
                ) : (
                  <div className="border border-slate-200 rounded-lg overflow-x-auto max-h-72 overflow-y-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 sticky top-0">
                        <tr>
                          <th className="py-2.5 px-3 font-medium">DLL Win32</th>
                          <th className="py-2.5 px-3 font-medium">Categoría Plugin ABI</th>
                          <th className="py-2.5 px-3 font-medium">Módulo en /native/</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {parsed.pluginMappings.map((item) => (
                          <tr key={item.dllName} className="hover:bg-slate-50">
                            <td className="py-2.5 px-3 font-mono font-semibold text-slate-900">
                              {item.dllName}
                            </td>
                            <td className="py-2.5 px-3 font-mono text-[11px] text-blue-700">
                              {item.requiredCategory}
                            </td>
                            <td className="py-2.5 px-3 text-slate-600">
                              <div className="font-mono text-[11px] text-slate-800">{item.nativeModule}</div>
                              <div className="text-[11px] text-slate-500 mt-0.5">{item.notes}</div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
