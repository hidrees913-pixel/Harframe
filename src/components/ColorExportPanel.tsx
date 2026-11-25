import { Film, Loader2, Sparkles, Wand2 } from 'lucide-react';
import {
  COLOR_GRADE_PRESETS,
  FRAME_ASPECT_PRESETS,
  RESOLUTION_PRESETS,
  type ColorGradeId,
  type ContentAwareColorAnalysis,
  type FrameAspectId,
  type FrameFitMode,
  type ResolutionTierId,
} from '../lib/studioPresets';

interface ColorExportPanelProps {
  hasSource: boolean;
  isRendering: boolean;
  isAnalyzingColor: boolean;
  colorError: string | null;
  colorGradeId: ColorGradeId;
  onColorGradeChange: (gradeId: ColorGradeId) => void;
  contentAwareAnalysis: ContentAwareColorAnalysis | null;
  onAnalyzeContentAwareColor: () => void;
  frameAspect: FrameAspectId;
  onFrameAspectChange: (aspect: FrameAspectId) => void;
  resolutionTier: ResolutionTierId;
  onResolutionTierChange: (tier: ResolutionTierId) => void;
  frameFit: FrameFitMode;
  onFrameFitChange: (fit: FrameFitMode) => void;
  onRender: () => void;
}

export function ColorExportPanel({
  hasSource,
  isRendering,
  isAnalyzingColor,
  colorError,
  colorGradeId,
  onColorGradeChange,
  contentAwareAnalysis,
  onAnalyzeContentAwareColor,
  frameAspect,
  onFrameAspectChange,
  resolutionTier,
  onResolutionTierChange,
  frameFit,
  onFrameFitChange,
  onRender,
}: ColorExportPanelProps) {
  const resLabel = resolutionTier === '2160p' ? '4K' : resolutionTier;

  return (
    <section id="grading" aria-label="Color and Export" className="space-y-4">
      {/* Color Grading */}
      <div className="space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-display text-base font-semibold text-slate-900">
              Color &amp; Export
            </h2>
            <p className="text-xs text-slate-500">
              Choose a color look, size, and quality.
            </p>
          </div>

          <button
            type="button"
            disabled={!hasSource || isAnalyzingColor}
            onClick={onAnalyzeContentAwareColor}
            className="min-h-[38px] inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-100 hover:bg-amber-200 text-slate-900 disabled:opacity-45 disabled:cursor-not-allowed transition-colors whitespace-nowrap cursor-pointer"
          >
            {isAnalyzingColor ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Wand2 className="w-3.5 h-3.5 text-amber-700" aria-hidden="true" />
            )}
            {isAnalyzingColor ? 'Checking...' : 'Auto Color'}
          </button>
        </div>

        {colorError && (
          <p role="alert" className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
            {colorError}
          </p>
        )}

        {contentAwareAnalysis && (
          <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 space-y-0.5 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-slate-900">
                {contentAwareAnalysis.sceneType}
              </span>
              <span className="text-[11px] font-mono-tabular text-slate-500">
                {contentAwareAnalysis.lightingCondition}
              </span>
            </div>
            <p className="text-[11px] text-slate-600">
              {contentAwareAnalysis.rationale}
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 gap-1.5 max-h-[210px] overflow-y-auto pr-1">
          {COLOR_GRADE_PRESETS.map((grade) => {
            const active = grade.id === colorGradeId;
            return (
              <button
                key={grade.id}
                type="button"
                aria-pressed={active}
                onClick={() => onColorGradeChange(grade.id)}
                className={`flex items-center justify-between gap-2 min-h-[40px] px-3 py-1.5 rounded-lg border text-left transition-colors cursor-pointer ${
                  active
                    ? 'border-[#7C3AED] bg-purple-50/70 text-slate-900 font-semibold'
                    : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                }`}
              >
                <span className="text-xs truncate">{grade.name}</span>
                <span className="flex items-center gap-0.5 shrink-0" aria-hidden="true">
                  {grade.swatchColors.map((hex, idx) => (
                    <span
                      key={idx}
                      className="w-2.5 h-2.5 rounded-sm border border-black/15"
                      style={{ backgroundColor: hex }}
                    />
                  ))}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Size & Quality */}
      <div className="space-y-3 pt-3 border-t border-slate-200">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-slate-700">Frame Size</span>
            <span className="font-mono-tabular font-semibold text-[#7C3AED]">{resLabel}</span>
          </div>
          <div className="grid grid-cols-4 sm:grid-cols-7 gap-1.5">
            {FRAME_ASPECT_PRESETS.map((preset) => {
              const selected = frameAspect === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  aria-pressed={selected}
                  title={preset.name}
                  onClick={() => onFrameAspectChange(preset.id)}
                  className={`min-h-[36px] px-1.5 py-1 rounded-md border text-center transition-colors cursor-pointer ${
                    selected
                      ? 'border-[#7C3AED] bg-purple-50 text-[#6D28D9] font-semibold'
                      : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                  }`}
                >
                  <span className="block text-[11px] font-mono-tabular leading-tight">
                    {preset.shortLabel}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <div>
            <label htmlFor="export-resolution-select" className="block text-xs font-medium text-slate-700 mb-1">
              Quality
            </label>
            <select
              id="export-resolution-select"
              value={resolutionTier}
              onChange={(e) => onResolutionTierChange(e.target.value as ResolutionTierId)}
              className="w-full min-h-[40px] rounded-lg bg-white border border-slate-300 px-2.5 py-1.5 text-xs text-slate-900 focus:outline-none focus:border-[#7C3AED] cursor-pointer"
            >
              {RESOLUTION_PRESETS.map((res) => (
                <option key={res.id} value={res.id}>
                  {res.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <span className="block text-xs font-medium text-slate-700 mb-1">Fit Mode</span>
            <div className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-slate-100">
              <button
                type="button"
                aria-pressed={frameFit === 'fit'}
                onClick={() => onFrameFitChange('fit')}
                className={`min-h-[32px] rounded-md text-xs font-medium transition-colors cursor-pointer ${
                  frameFit === 'fit'
                    ? 'bg-white text-slate-900 shadow-sm font-semibold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Fit
              </button>
              <button
                type="button"
                aria-pressed={frameFit === 'fill'}
                onClick={() => onFrameFitChange('fill')}
                className={`min-h-[32px] rounded-md text-xs font-medium transition-colors cursor-pointer ${
                  frameFit === 'fill'
                    ? 'bg-white text-slate-900 shadow-sm font-semibold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Fill
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Primary Export Button */}
      <button
        type="button"
        disabled={!hasSource || isRendering}
        onClick={onRender}
        className="w-full min-h-[46px] inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold text-slate-950 bg-gradient-to-r from-[#FBBF24] to-[#F59E0B] hover:brightness-105 disabled:opacity-45 disabled:cursor-not-allowed transition-all cursor-pointer whitespace-nowrap"
      >
        {isRendering ? (
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
        ) : (
          <Sparkles className="w-4 h-4" aria-hidden="true" />
        )}
        {isRendering
          ? `Exporting ${resLabel}...`
          : hasSource
            ? `Export ${resLabel} Video`
            : 'Add Video First'}
      </button>

      {!hasSource && (
        <p className="inline-flex items-center gap-1.5 text-xs text-slate-500">
          <Film className="w-3.5 h-3.5" aria-hidden="true" />
          Upload or link a video in the Video tab to export.
        </p>
      )}
    </section>
  );
}
