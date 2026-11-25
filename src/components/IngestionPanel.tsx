import { useRef, useState } from 'react';
import { Link2, ListPlus, Loader2, PlaySquare, Upload, X } from 'lucide-react';
import { extractAndNormalizeVideoUrl } from '../lib/urlUtils';
import type { VideoMetadata } from '../lib/studioPresets';

interface IngestionPanelProps {
  metadata: VideoMetadata | null;
  queueCount: number;
  isIngesting: boolean;
  uploadProgress: number | null;
  ingestStatusText: string | null;
  ingestError: string | null;
  onUploadFiles: (files: File[]) => void;
  onIngestUrls: (urls: string[]) => void;
  onLoadSample: (orientation: 'landscape' | 'portrait') => void;
}

export function IngestionPanel({
  metadata,
  queueCount,
  isIngesting,
  uploadProgress,
  ingestStatusText,
  ingestError,
  onUploadFiles,
  onIngestUrls,
  onLoadSample,
}: IngestionPanelProps) {
  const [mode, setMode] = useState<'upload' | 'url'>('upload');
  const [urlInput, setUrlInput] = useState('');
  const [multiUrlMode, setMultiUrlMode] = useState(false);
  const [localValidationError, setLocalValidationError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFilesSelected = (fileList: FileList | File[] | null | undefined) => {
    if (!fileList || isIngesting) return;
    const files = Array.from(fileList).filter((f) => f && f.size > 0);
    if (files.length === 0) return;
    setLocalValidationError(null);
    onUploadFiles(files);
  };

  const handleUrlSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const rawLines = multiUrlMode
      ? urlInput
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
      : [urlInput.trim()].filter(Boolean);

    if (rawLines.length === 0) {
      setLocalValidationError('Enter a video link to add.');
      return;
    }

    const validUrls: string[] = [];
    for (const rawLine of rawLines) {
      const parsed = extractAndNormalizeVideoUrl(rawLine);
      if (parsed.ok === false) {
        setLocalValidationError(parsed.error);
        return;
      }
      validUrls.push(parsed.originalUrl);
    }

    if (!multiUrlMode) {
      setUrlInput(validUrls[0]);
    }
    setLocalValidationError(null);
    onIngestUrls(validUrls);
  };

  const displayedError = localValidationError || ingestError;

  return (
    <section id="ingest" aria-label="Add Video" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-display text-base font-semibold text-slate-900">
            Add Video
          </h2>
          <p className="text-xs text-slate-500">
            Upload files from your device or paste a video link.
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onLoadSample('landscape')}
            disabled={isIngesting}
            className="inline-flex items-center gap-1.5 min-h-[38px] px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-900 bg-amber-100 hover:bg-amber-200 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <PlaySquare className="w-3.5 h-3.5 text-amber-700" aria-hidden="true" />
            Sample 16:9
          </button>
          <button
            type="button"
            onClick={() => onLoadSample('portrait')}
            disabled={isIngesting}
            className="inline-flex items-center gap-1.5 min-h-[38px] px-3 py-1.5 rounded-lg text-xs font-semibold text-[#6D28D9] bg-purple-100 hover:bg-purple-200 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Sample 9:16
          </button>
        </div>
      </div>

      {/* Mode switcher */}
      <div
        role="tablist"
        aria-label="Video source mode"
        className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-slate-100"
      >
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'upload'}
          onClick={() => {
            setMode('upload');
            setLocalValidationError(null);
          }}
          className={`flex items-center justify-center gap-2 min-h-[40px] py-1.5 px-3 rounded-md text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
            mode === 'upload'
              ? 'bg-white text-slate-900 shadow-sm font-semibold'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Upload className="w-3.5 h-3.5" aria-hidden="true" />
          Upload
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'url'}
          onClick={() => {
            setMode('url');
            setLocalValidationError(null);
          }}
          className={`flex items-center justify-center gap-2 min-h-[40px] py-1.5 px-3 rounded-md text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
            mode === 'url'
              ? 'bg-white text-slate-900 shadow-sm font-semibold'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Link2 className="w-3.5 h-3.5" aria-hidden="true" />
          Link
        </button>
      </div>

      {mode === 'upload' ? (
        <div>
          <input
            ref={fileInputRef}
            id="video-file-upload"
            type="file"
            multiple
            accept="video/*,.mp4,.mov,.mkv,.webm,.m4v,.avi,.3gp,.mpg,.mpeg,.ts,.mts,.m2ts,.ogv,.flv,.wmv"
            disabled={isIngesting}
            onChange={(e) => {
              const selected = e.currentTarget.files;
              handleFilesSelected(selected);
              e.currentTarget.value = '';
            }}
            className="sr-only"
          />
          <label
            htmlFor="video-file-upload"
            onDragOver={(e) => {
              e.preventDefault();
              if (!isIngesting) setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragging(false);
              if (!isIngesting) {
                handleFilesSelected(e.dataTransfer.files);
              }
            }}
            className={`flex flex-col items-center justify-center gap-2 min-h-[150px] rounded-xl border-2 border-dashed p-5 text-center transition-colors ${
              isIngesting
                ? 'border-purple-300 bg-purple-50/40 cursor-wait'
                : isDragging
                  ? 'border-[#F59E0B] bg-amber-50/70 cursor-pointer'
                  : 'border-slate-300 bg-slate-50/70 hover:border-[#7C3AED] hover:bg-purple-50/30 cursor-pointer'
            }`}
          >
            {isIngesting ? (
              <div className="w-full max-w-xs space-y-2 flex flex-col items-center">
                <Loader2 className="w-6 h-6 text-[#7C3AED] animate-spin" aria-hidden="true" />
                <span className="text-xs font-medium text-slate-700">
                  {ingestStatusText ||
                    (uploadProgress !== null && uploadProgress < 100
                      ? `Uploading (${uploadProgress}%)...`
                      : 'Loading clip...')}
                </span>
                {uploadProgress !== null && (
                  <div className="w-full h-1.5 rounded-full bg-slate-200 overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-[#FBBF24] to-[#7C3AED] transition-all duration-150"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                )}
              </div>
            ) : (
              <>
                <div className="w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center">
                  <Upload className="w-5 h-5 text-[#7C3AED]" aria-hidden="true" />
                </div>
                <span className="text-sm font-semibold text-slate-900">
                  {queueCount > 0 ? 'Add more videos' : 'Choose or drop video files'}
                </span>
                <span className="text-xs text-slate-500">
                  MP4, MOV, MKV, or WebM (select one or multiple)
                </span>
              </>
            )}
          </label>
        </div>
      ) : (
        <form onSubmit={handleUrlSubmit} className="space-y-3" noValidate>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="video-url-input" className="block text-xs font-medium text-slate-700">
                {multiUrlMode ? 'Video Links (one per line)' : 'Video Link'}
              </label>
              <button
                type="button"
                onClick={() => {
                  setMultiUrlMode((prev) => !prev);
                  setLocalValidationError(null);
                }}
                className="inline-flex items-center gap-1 min-h-[32px] text-xs font-medium text-[#7C3AED] hover:text-[#6D28D9] transition-colors cursor-pointer"
              >
                <ListPlus className="w-3.5 h-3.5" aria-hidden="true" />
                {multiUrlMode ? 'Single Link' : 'Multiple Links'}
              </button>
            </div>

            <div className={`flex ${multiUrlMode ? 'flex-col' : 'flex-col sm:flex-row'} gap-2`}>
              <div className="relative flex-1 min-w-0">
                {multiUrlMode ? (
                  <textarea
                    id="video-url-input"
                    rows={3}
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    value={urlInput}
                    onChange={(e) => {
                      setUrlInput(e.target.value);
                      if (localValidationError) setLocalValidationError(null);
                    }}
                    placeholder={'https://example.com/clip-1.mp4\nhttps://example.com/clip-2.mp4'}
                    className="w-full rounded-lg bg-white border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-[#7C3AED]"
                  />
                ) : (
                  <input
                    id="video-url-input"
                    type="text"
                    inputMode="url"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    value={urlInput}
                    onChange={(e) => {
                      setUrlInput(e.target.value);
                      if (localValidationError) setLocalValidationError(null);
                    }}
                    placeholder="https://... (MP4, Drive, Dropbox, Vimeo, YouTube)"
                    className="w-full min-h-[44px] rounded-lg bg-white border border-slate-300 pl-3 pr-10 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-[#7C3AED]"
                  />
                )}
                {urlInput && !multiUrlMode && (
                  <button
                    type="button"
                    aria-label="Clear link"
                    onClick={() => {
                      setUrlInput('');
                      setLocalValidationError(null);
                    }}
                    className="absolute right-0.5 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center text-slate-400 hover:text-slate-700 rounded-md cursor-pointer"
                  >
                    <X className="w-4 h-4" aria-hidden="true" />
                  </button>
                )}
              </div>
              <button
                type="submit"
                disabled={isIngesting}
                className={`inline-flex items-center justify-center gap-2 ${
                  multiUrlMode ? 'w-full' : 'w-full sm:w-auto'
                } min-h-[44px] px-4 py-2 rounded-lg text-xs font-semibold bg-[#7C3AED] hover:bg-[#6D28D9] text-white disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer`}
              >
                {isIngesting && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />}
                {isIngesting
                  ? ingestStatusText || 'Loading...'
                  : multiUrlMode
                    ? 'Add All'
                    : 'Add Link'}
              </button>
            </div>
          </div>
        </form>
      )}

      {displayedError && (
        <p role="alert" className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 break-words">
          {displayedError}
        </p>
      )}

      {metadata && (
        <div className="pt-3 border-t border-slate-200 space-y-1">
          <p className="text-xs font-semibold text-slate-900 truncate" title={metadata.filename}>
            {metadata.filename}
          </p>
          <p className="text-xs text-slate-500 font-mono-tabular break-words">
            {metadata.width}&times;{metadata.height} &middot; {metadata.durationSec.toFixed(1)}s &middot;{' '}
            {metadata.fps} fps &middot; {metadata.codec.toUpperCase()} &middot;{' '}
            {metadata.hasAudio ? (metadata.isStereoAudio ? 'Stereo' : 'Mono') : 'No Audio'}
          </p>
        </div>
      )}
    </section>
  );
}
