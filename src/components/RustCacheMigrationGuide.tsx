import { useMemo, useState } from 'react';
import { Check, Copy, HardDrive } from 'lucide-react';

type ShellKind = 'cmd' | 'powershell';

interface MigrationStep {
  id: string;
  title: string;
  description: string;
  command: string;
  note?: string;
}

function normalizeWinBase(raw: string): string {
  const trimmed = raw.trim().replace(/\//g, '\\').replace(/\\+$/, '');
  return trimmed || 'D:\\RustEnv';
}

export function RustCacheMigrationGuide() {
  const [basePath, setBasePath] = useState<string>('D:\\RustEnv');
  const [shellKind, setShellKind] = useState<ShellKind>('cmd');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const cleanBase = useMemo(() => normalizeWinBase(basePath), [basePath]);
  const cargoHome = `${cleanBase}\\.cargo`;
  const rustupHome = `${cleanBase}\\.rustup`;
  const targetDir = `${cleanBase}\\target`;
  const tempDir = `${cleanBase}\\tmp`;

  const steps: MigrationStep[] = useMemo(() => {
    if (shellKind === 'cmd') {
      return [
        {
          id: 'step-move',
          title: '01. Mover cachés existentes desde C:\\ hacia la partición destino',
          description:
            'Cierra cualquier editor o terminal Rust activa y copia tus carpetas actuales (.cargo y .rustup) al nuevo disco antes de eliminarlas de C:. Si aún no instalaste Rust, crea solo los directorios.',
          command: `mkdir "${cargoHome}" "${rustupHome}" "${targetDir}" "${tempDir}"\nrobocopy "%USERPROFILE%\\.cargo" "${cargoHome}" /E /COPY:DAT /R:2 /W:2\nrobocopy "%USERPROFILE%\\.rustup" "${rustupHome}" /E /COPY:DAT /R:2 /W:2`,
          note: 'Cuando confirmes en el paso 04 que todo funciona, libera espacio en C: con rmdir /S /Q "%USERPROFILE%\\.cargo" "%USERPROFILE%\\.rustup".',
        },
        {
          id: 'step-session',
          title: '02. Configurar variables en la sesión actual (set CARGO_HOME y set RUSTUP_HOME)',
          description:
            'Aplica las rutas en la ventana actual del Símbolo del sistema (CMD) para pruebas inmediatas o instalaciones sin reiniciar Windows.',
          command: `set CARGO_HOME=${cargoHome}\nset RUSTUP_HOME=${rustupHome}\nset CARGO_TARGET_DIR=${targetDir}\nset TEMP=${tempDir}\nset TMP=${tempDir}\nset PATH=${cargoHome}\\bin;%PATH%`,
        },
        {
          id: 'step-persist',
          title: '03. Persistir configuración en variables de entorno de Windows',
          description:
            'Guarda CARGO_HOME, RUSTUP_HOME y CARGO_TARGET_DIR de forma permanente en el perfil de usuario de Windows mediante setx.',
          command: `setx CARGO_HOME "${cargoHome}"\nsetx RUSTUP_HOME "${rustupHome}"\nsetx CARGO_TARGET_DIR "${targetDir}"\npowershell -NoProfile -Command "$p=[Environment]::GetEnvironmentVariable('Path','User'); if($p -notlike '*${cargoHome}\\bin*'){[Environment]::SetEnvironmentVariable('Path','${cargoHome}\\bin;'+$p,'User')}"`,
          note: 'Se usa PowerShell para agregar \\bin a Path porque setx trunca la variable Path si supera los 1024 caracteres.',
        },
        {
          id: 'step-verify',
          title: '04. Verificar rutas activas en una nueva terminal e instalar targets Android 15',
          description:
            'Abre una ventana nueva de CMD (para que cargue las variables persistidas), valida que Rust apunta al disco destino e instala el target ARM64.',
          command: `echo %CARGO_HOME%\necho %RUSTUP_HOME%\nrustup show\ncargo --version\nrustup target add aarch64-linux-android x86_64-linux-android\ncargo install cargo-ndk`,
        },
      ];
    }

    return [
      {
        id: 'step-move',
        title: '01. Mover cachés existentes desde C:\\ hacia la partición destino',
        description:
          'Crea la estructura en el disco D: o unidad externa y copia los directorios actuales sin borrar los originales hasta comprobar que compila.',
        command: `New-Item -ItemType Directory -Force -Path "${cargoHome}", "${rustupHome}", "${targetDir}", "${tempDir}" | Out-Null\nif (Test-Path "$env:USERPROFILE\\.cargo")  { robocopy "$env:USERPROFILE\\.cargo"  "${cargoHome}"  /E /COPY:DAT /R:2 /W:2 }\nif (Test-Path "$env:USERPROFILE\\.rustup") { robocopy "$env:USERPROFILE\\.rustup" "${rustupHome}" /E /COPY:DAT /R:2 /W:2 }`,
        note: 'Si usas una unidad externa USB/NVMe, asegúrate de asignarle una letra de unidad fija en Administración de discos de Windows.',
      },
      {
        id: 'step-session',
        title: '02. Configurar variables en la sesión actual de PowerShell',
        description:
          'Redirige CARGO_HOME, RUSTUP_HOME, artefactos target y temporales en la consola abierta.',
        command: `$env:CARGO_HOME       = "${cargoHome}"\n$env:RUSTUP_HOME      = "${rustupHome}"\n$env:CARGO_TARGET_DIR = "${targetDir}"\n$env:TEMP             = "${tempDir}"\n$env:TMP              = "${tempDir}"\n$env:PATH             = "${cargoHome}\\bin;$env:PATH"`,
      },
      {
        id: 'step-persist',
        title: '03. Persistir configuración en el entorno de usuario de Windows',
        description:
          'Registra permanentemente las variables en HKCU\\Environment para que cualquier nueva consola, Android Studio o VS Code las herede.',
        command: `[Environment]::SetEnvironmentVariable("CARGO_HOME", "${cargoHome}", "User")\n[Environment]::SetEnvironmentVariable("RUSTUP_HOME", "${rustupHome}", "User")\n[Environment]::SetEnvironmentVariable("CARGO_TARGET_DIR", "${targetDir}", "User")\n$userPath = [Environment]::GetEnvironmentVariable("Path", "User")\nif ($userPath -notlike "*${cargoHome}\\bin*") {\n  [Environment]::SetEnvironmentVariable("Path", "${cargoHome}\\bin;$userPath", "User")\n}`,
        note: 'También puedes ejecutar setx desde PowerShell si prefieres sintaxis CMD, manteniendo Path intacto con SetEnvironmentVariable.',
      },
      {
        id: 'step-verify',
        title: '04. Verificar en una consola nueva y liberar espacio en C:\\',
        description:
          'Reinicia PowerShell, verifica que rustup y cargo lean desde el nuevo disco y elimina los cachés antiguos en C:.',
        command: `Write-Output "CARGO_HOME=$env:CARGO_HOME | RUSTUP_HOME=$env:RUSTUP_HOME"\nrustup show\nrustup target add aarch64-linux-android x86_64-linux-android\ncargo install cargo-ndk\n# Opcional tras verificar: Remove-Item -Recurse -Force "$env:USERPROFILE\\.cargo", "$env:USERPROFILE\\.rustup"`,
      },
    ];
  }, [cargoHome, rustupHome, shellKind, targetDir, tempDir]);

  const handleCopy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1800);
    } catch {
      // Clipboard may be restricted in sandboxed iframes
    }
  };

  return (
    <div className="mt-8 bg-white border border-slate-200 rounded-xl p-6 sm:p-8">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 pb-6 border-b border-slate-200">
        <div className="max-w-2xl">
          <div className="flex items-center gap-2 text-xs font-medium text-slate-500 mb-2">
            <HardDrive className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Guía paso a paso · Partición D:\ o unidad externa</span>
          </div>
          <h3 className="text-xl font-semibold text-slate-900">
            Mover caché de Cargo y Rustup fuera del disco C:\
          </h3>
          <p className="text-sm text-slate-600 mt-1.5 leading-relaxed">
            Personaliza la ruta de destino para generar los comandos exactos con{' '}
            <code className="font-mono text-xs text-slate-800">set CARGO_HOME</code>,{' '}
            <code className="font-mono text-xs text-slate-800">set RUSTUP_HOME</code> y persistencia en Windows.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg self-start">
            <button
              type="button"
              onClick={() => setShellKind('cmd')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                shellKind === 'cmd'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              CMD (set / setx)
            </button>
            <button
              type="button"
              onClick={() => setShellKind('powershell')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                shellKind === 'powershell'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              PowerShell
            </button>
          </div>
        </div>
      </div>

      <div className="py-5 border-b border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-slate-600 mr-1">Destinos rápidos:</span>
          <button
            type="button"
            onClick={() => setBasePath('D:\\RustEnv')}
            className={`px-3 py-1.5 text-xs font-mono rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              cleanBase === 'D:\\RustEnv'
                ? 'bg-slate-900 text-white border-slate-900'
                : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
            }`}
          >
            D:\RustEnv
          </button>
          <button
            type="button"
            onClick={() => setBasePath('D:\\AndroCore\\rust')}
            className={`px-3 py-1.5 text-xs font-mono rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              cleanBase === 'D:\\AndroCore\\rust'
                ? 'bg-slate-900 text-white border-slate-900'
                : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
            }`}
          >
            D:\AndroCore\rust
          </button>
          <button
            type="button"
            onClick={() => setBasePath('E:\\ExternalDev\\Rust')}
            className={`px-3 py-1.5 text-xs font-mono rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              cleanBase === 'E:\\ExternalDev\\Rust'
                ? 'bg-slate-900 text-white border-slate-900'
                : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
            }`}
          >
            E:\ExternalDev\Rust (Externa)
          </button>
        </div>

        <label className="flex items-center gap-2 text-xs text-slate-600">
          <span className="whitespace-nowrap shrink-0 font-medium">Ruta base:</span>
          <input
            type="text"
            value={basePath}
            onChange={(e) => setBasePath(e.target.value)}
            placeholder="D:\RustEnv"
            className="w-56 px-3 py-1.5 text-xs font-mono text-slate-900 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-slate-900"
          />
        </label>
      </div>

      <div className="divide-y divide-slate-200">
        {steps.map((step) => (
          <div key={step.id} className="py-6 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            <div className="lg:col-span-5">
              <h4 className="text-sm font-semibold text-slate-900">{step.title}</h4>
              <p className="text-xs text-slate-600 mt-1.5 leading-relaxed">{step.description}</p>
              {step.note && (
                <p className="text-[11px] text-slate-500 mt-2 leading-relaxed">{step.note}</p>
              )}
            </div>

            <div className="lg:col-span-7 relative">
              <div className="flex items-center justify-between px-3.5 py-2 bg-slate-900 text-slate-300 rounded-t-lg border-b border-slate-800 text-[11px] font-mono">
                <span>{shellKind === 'cmd' ? 'Símbolo del sistema (cmd.exe)' : 'Windows PowerShell'}</span>
                <button
                  type="button"
                  onClick={() => handleCopy(step.id, step.command)}
                  className="inline-flex items-center gap-1.5 text-slate-200 hover:text-white cursor-pointer"
                >
                  {copiedId === step.id ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" />
                      Copiado
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                      Copiar
                    </>
                  )}
                </button>
              </div>
              <pre className="bg-slate-950 text-slate-100 text-xs font-mono p-4 rounded-b-lg overflow-x-auto leading-relaxed">
                {step.command}
              </pre>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
