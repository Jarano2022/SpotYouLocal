import { Check, Copy, Download, Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { AudioFormat, AudioQuality, SystemSettings } from '../types';
import { formatBytes } from '../utils/format';

interface DockerSettingsViewProps {
  settings: SystemSettings | null;
  onSaveSettings: (next: {
    concurrency: number;
    defaultFormat: AudioFormat;
    defaultQuality: AudioQuality;
    filenameTemplate: string;
  }) => Promise<void>;
}

export function DockerSettingsView({
  settings,
  onSaveSettings,
}: DockerSettingsViewProps) {
  const [concurrency, setConcurrency] = useState(2);
  const [defaultFormat, setDefaultFormat] = useState<AudioFormat>('mp3');
  const [defaultQuality, setDefaultQuality] = useState<AudioQuality>('320');
  const [filenameTemplate, setFilenameTemplate] = useState('{index} - {artist} - {title}');
  const [saving, setSaving] = useState(false);
  const [savedOk, setSavedOk] = useState(false);

  const [dockerFiles, setDockerFiles] = useState<{
    dockerfile: string;
    compose: string;
    envExample: string;
  } | null>(null);
  const [activeFile, setActiveFile] = useState<'compose' | 'dockerfile' | 'envExample'>('compose');
  const [copiedFile, setCopiedFile] = useState(false);

  useEffect(() => {
    if (settings) {
      setConcurrency(settings.concurrency);
      setDefaultFormat(settings.defaultFormat);
      setDefaultQuality(settings.defaultQuality);
      setFilenameTemplate(settings.filenameTemplate);
    }
  }, [settings]);

  useEffect(() => {
    fetch('/api/docker/files')
      .then((r) => r.json())
      .then((data) => setDockerFiles(data))
      .catch(() => {});
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSavedOk(false);
    try {
      await onSaveSettings({
        concurrency,
        defaultFormat,
        defaultQuality,
        filenameTemplate,
      });
      setSavedOk(true);
      setTimeout(() => setSavedOk(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  const currentContent = dockerFiles ? dockerFiles[activeFile] : '';
  const currentFilename =
    activeFile === 'compose'
      ? 'docker-compose.yml'
      : activeFile === 'dockerfile'
      ? 'Dockerfile'
      : '.env.example';

  const handleCopyCode = () => {
    if (!currentContent) return;
    void navigator.clipboard.writeText(currentContent);
    setCopiedFile(true);
    setTimeout(() => setCopiedFile(false), 1800);
  };

  const handleDownloadCode = () => {
    if (!currentContent) return;
    const blob = new Blob([currentContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = currentFilename;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
          Contenedor Docker y almacenamiento
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Configura el motor de descargas y despliega CrateDock en tu servidor con volúmenes persistentes para audio y base de datos.
        </p>
      </div>

      {/* System capabilities summary */}
      {settings && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white border border-zinc-200 rounded-lg p-4">
            <p className="text-xs text-zinc-500">Espacio utilizado</p>
            <p className="mt-1 text-lg font-semibold font-mono tabular-nums text-zinc-900">
              {formatBytes(settings.diskUsedBytes)}
            </p>
          </div>
          <div className="bg-white border border-zinc-200 rounded-lg p-4">
            <p className="text-xs text-zinc-500">Archivos generados</p>
            <p className="mt-1 text-lg font-semibold font-mono tabular-nums text-zinc-900">
              {settings.totalFilesCount}
            </p>
          </div>
          <div className="bg-white border border-zinc-200 rounded-lg p-4">
            <p className="text-xs text-zinc-500">Conversor FFmpeg</p>
            <p className="mt-1 text-sm font-semibold text-zinc-900">
              {settings.hasFfmpeg ? 'Disponible' : 'No detectado'}
            </p>
          </div>
          <div className="bg-white border border-zinc-200 rounded-lg p-4">
            <p className="text-xs text-zinc-500">Extractor yt-dlp</p>
            <p className="mt-1 text-sm font-semibold text-zinc-900">
              {settings.hasYtDlp ? 'Activo en contenedor' : 'Incluido en Dockerfile'}
            </p>
          </div>
        </div>
      )}

      {/* Worker & Format Preferences */}
      <form
        onSubmit={handleSave}
        className="bg-white border border-zinc-200 rounded-lg p-6 space-y-5"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-zinc-900">
            Preferencias de descarga
          </h2>
          {settings && (
            <span className="text-xs font-mono text-zinc-500 truncate max-w-xs">
              Ruta: {settings.downloadDir}
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs font-medium text-zinc-700 mb-1.5">
              Listas en paralelo
            </label>
            <select
              value={concurrency}
              onChange={(e) => setConcurrency(Number(e.target.value))}
              className="w-full px-3 py-2 text-xs font-mono bg-white border border-zinc-200 rounded-md text-zinc-900 focus:outline-none focus:border-zinc-400"
            >
              <option value={1}>1 lista simultánea</option>
              <option value={2}>2 listas simultáneas</option>
              <option value={3}>3 listas simultáneas</option>
              <option value={4}>4 listas simultáneas</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-700 mb-1.5">
              Formato predeterminado
            </label>
            <select
              value={defaultFormat}
              onChange={(e) => setDefaultFormat(e.target.value as AudioFormat)}
              className="w-full px-3 py-2 text-xs bg-white border border-zinc-200 rounded-md text-zinc-900 focus:outline-none focus:border-zinc-400"
            >
              <option value="mp3">MP3 (Compatible)</option>
              <option value="m4a">M4A / AAC</option>
              <option value="opus">OPUS (Alta eficiencia)</option>
              <option value="flac">FLAC (Sin pérdida)</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-700 mb-1.5">
              Calidad de audio
            </label>
            <select
              value={defaultQuality}
              onChange={(e) => setDefaultQuality(e.target.value as AudioQuality)}
              className="w-full px-3 py-2 text-xs font-mono bg-white border border-zinc-200 rounded-md text-zinc-900 focus:outline-none focus:border-zinc-400"
            >
              <option value="320">320 kbps</option>
              <option value="256">256 kbps</option>
              <option value="192">192 kbps</option>
              <option value="128">128 kbps</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-700 mb-1.5">
              Plantilla de archivo
            </label>
            <input
              type="text"
              value={filenameTemplate}
              onChange={(e) => setFilenameTemplate(e.target.value)}
              className="w-full px-3 py-2 text-xs font-mono bg-white border border-zinc-200 rounded-md text-zinc-900 focus:outline-none focus:border-zinc-400"
            />
          </div>
        </div>

        <div className="flex items-center justify-between pt-2">
          <p className="text-xs text-zinc-500">
            Variables disponibles: <code className="font-mono">{'{index}'}</code>,{' '}
            <code className="font-mono">{'{artist}'}</code>,{' '}
            <code className="font-mono">{'{title}'}</code>,{' '}
            <code className="font-mono">{'{album}'}</code>
          </p>
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 text-xs font-semibold bg-zinc-900 hover:bg-zinc-800 text-white rounded-md inline-flex items-center gap-2 transition-colors cursor-pointer"
          >
            {savedOk ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Save className="w-3.5 h-3.5" />}
            {savedOk ? 'Guardado' : saving ? 'Guardando...' : 'Guardar preferencias'}
          </button>
        </div>
      </form>

      {/* Docker Configuration Viewer */}
      <div className="bg-white border border-zinc-200 rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-zinc-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="inline-flex items-center gap-1 p-1 bg-zinc-100 rounded-lg self-start">
            {(
              [
                { key: 'compose', label: 'docker-compose.yml' },
                { key: 'dockerfile', label: 'Dockerfile' },
                { key: 'envExample', label: '.env.example' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveFile(tab.key)}
                className={`px-3 py-1.5 text-xs font-mono rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  activeFile === tab.key
                    ? 'bg-white text-zinc-900 shadow-xs'
                    : 'text-zinc-600 hover:text-zinc-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopyCode}
              className="px-3 py-1.5 text-xs font-medium border border-zinc-200 hover:bg-zinc-50 text-zinc-700 rounded-md inline-flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              {copiedFile ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
              {copiedFile ? 'Copiado' : 'Copiar'}
            </button>
            <button
              type="button"
              onClick={handleDownloadCode}
              className="px-3 py-1.5 text-xs font-medium border border-zinc-200 hover:bg-zinc-50 text-zinc-700 rounded-md inline-flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              Descargar
            </button>
          </div>
        </div>

        <pre className="p-6 text-xs font-mono text-zinc-800 bg-zinc-50/70 overflow-x-auto leading-relaxed">
          {currentContent || 'Cargando archivo Docker...'}
        </pre>

        <div className="px-6 py-3.5 border-t border-zinc-200 bg-white flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500">
          <span>Ejecución rápida en tu servidor:</span>
          <code className="font-mono text-zinc-800 bg-zinc-100 px-2.5 py-1 rounded">
            docker compose up -d --build
          </code>
        </div>
      </div>
    </div>
  );
}
