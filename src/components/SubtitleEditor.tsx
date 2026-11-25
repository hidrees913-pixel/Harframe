import { Loader2, Plus, Sparkles, Trash2 } from 'lucide-react';
import { optimizeCaptionSegments } from '../lib/subtitles';
import type { SubtitleSegment } from '../lib/studioPresets';

interface SubtitleEditorProps {
  segments: SubtitleSegment[];
  captionsEnabled: boolean;
  isTranscribing?: boolean;
  transcribeWarning?: string | null;
  onChange: (next: SubtitleSegment[]) => void;
}

export function SubtitleEditor({
  segments,
  captionsEnabled,
  isTranscribing = false,
  transcribeWarning = null,
  onChange,
}: SubtitleEditorProps) {
  const handleUpdate = (id: string, field: 'startSec' | 'endSec' | 'text', value: string) => {
    onChange(
      segments.map((seg) => {
        if (seg.id !== id) return seg;
        if (field === 'text') return { ...seg, text: value };
        const parsed = Number(value);
        return { ...seg, [field]: Number.isFinite(parsed) ? Math.max(0, parsed) : 0 };
      })
    );
  };

  const handleDelete = (id: string) => {
    onChange(segments.filter((s) => s.id !== id));
  };

  const handleAdd = () => {
    const lastEnd = segments.length > 0 ? segments[segments.length - 1].endSec : 0;
    onChange([
      ...segments,
      {
        id: `seg-${Date.now()}`,
        startSec: Number((lastEnd + 0.1).toFixed(2)),
        endSec: Number((lastEnd + 1.8).toFixed(2)),
        text: 'New caption line',
      },
    ]);
  };

  const handleOptimizePacing = () => {
    if (segments.length === 0) return;
    onChange(optimizeCaptionSegments(segments, { maxWordsPerCue: 5 }));
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-display text-sm font-semibold text-slate-900">
            Caption Lines
          </h3>
          <p className="text-xs text-slate-500">
            {captionsEnabled
              ? `${segments.length} line${segments.length === 1 ? '' : 's'}`
              : 'Turn captions on in Export tab to edit lines'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            disabled={segments.length === 0}
            onClick={handleOptimizePacing}
            className="inline-flex items-center justify-center gap-1.5 min-h-[36px] px-3 py-1.5 rounded-lg text-xs font-medium bg-purple-50 border border-purple-200 text-[#6D28D9] hover:bg-purple-100 disabled:opacity-45 disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
            Split Short
          </button>
          <button
            type="button"
            onClick={handleAdd}
            className="inline-flex items-center justify-center gap-1.5 min-h-[36px] px-3 py-1.5 rounded-lg text-xs font-medium bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" aria-hidden="true" />
            Add Line
          </button>
        </div>
      </div>

      {transcribeWarning && (
        <p
          role="status"
          className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2"
        >
          {transcribeWarning}
        </p>
      )}

      {isTranscribing && segments.length === 0 ? (
        <div className="rounded-lg bg-slate-50 p-4 flex items-center justify-center gap-2 text-xs text-slate-600">
          <Loader2 className="w-4 h-4 animate-spin text-[#7C3AED]" aria-hidden="true" />
          <span>Syncing captions...</span>
        </div>
      ) : segments.length === 0 ? (
        <p className="rounded-lg bg-slate-50 p-3.5 text-center text-xs text-slate-500">
          No caption lines yet. Sync captions or click Add Line.
        </p>
      ) : (
        <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
          {segments.map((seg, idx) => (
            <div
              key={seg.id}
              className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_36px] sm:grid-cols-[72px_72px_1fr_34px] items-center gap-2 rounded-lg bg-slate-50 border border-slate-200 p-2"
            >
              <label
                htmlFor={`start-${seg.id}`}
                className="flex items-center gap-1 min-h-[34px] rounded bg-white border border-slate-200 px-2 focus-within:border-[#7C3AED]"
              >
                <span className="text-[11px] font-medium text-slate-400 sm:hidden">In</span>
                <span className="sr-only">Line {idx + 1} start seconds</span>
                <input
                  id={`start-${seg.id}`}
                  type="number"
                  inputMode="decimal"
                  step="0.1"
                  min="0"
                  title="Start time (seconds)"
                  value={seg.startSec}
                  onChange={(e) => handleUpdate(seg.id, 'startSec', e.target.value)}
                  className="w-full min-w-0 bg-transparent py-1 text-xs font-mono-tabular text-slate-900 focus:outline-none"
                />
              </label>
              <label
                htmlFor={`end-${seg.id}`}
                className="flex items-center gap-1 min-h-[34px] rounded bg-white border border-slate-200 px-2 focus-within:border-[#7C3AED]"
              >
                <span className="text-[11px] font-medium text-slate-400 sm:hidden">Out</span>
                <span className="sr-only">Line {idx + 1} end seconds</span>
                <input
                  id={`end-${seg.id}`}
                  type="number"
                  inputMode="decimal"
                  step="0.1"
                  min="0"
                  title="End time (seconds)"
                  value={seg.endSec}
                  onChange={(e) => handleUpdate(seg.id, 'endSec', e.target.value)}
                  className="w-full min-w-0 bg-transparent py-1 text-xs font-mono-tabular text-slate-900 focus:outline-none"
                />
              </label>
              <label className="sr-only" htmlFor={`text-${seg.id}`}>
                Line {idx + 1} text
              </label>
              <input
                id={`text-${seg.id}`}
                type="text"
                value={seg.text}
                onChange={(e) => handleUpdate(seg.id, 'text', e.target.value)}
                className="col-span-3 sm:col-span-1 order-4 sm:order-3 w-full min-w-0 min-h-[34px] rounded bg-white border border-slate-200 px-2.5 py-1 text-xs text-slate-900 focus:outline-none focus:border-[#7C3AED]"
              />
              <button
                type="button"
                aria-label={`Delete caption line ${idx + 1}`}
                onClick={() => handleDelete(seg.id)}
                className="order-3 sm:order-4 justify-self-end inline-flex items-center justify-center w-8 h-8 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
