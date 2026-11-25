import { Download, Film } from 'lucide-react';
import { HarFrameLogo } from './HarFrameLogo';

export type StudioStepId = 'video' | 'voice' | 'export' | 'history';

interface TopNavProps {
  activeStep: StudioStepId;
  onSelectStep: (step: StudioStepId) => void;
  hasSource: boolean;
  isRendering: boolean;
  hasOutput: boolean;
  downloadUrl?: string;
  resolutionLabel: string;
  onRenderClick: () => void;
  onResetAndRefresh: () => void;
}

const NAV_ITEMS: Array<{ id: StudioStepId; label: string }> = [
  { id: 'video', label: 'Video' },
  { id: 'voice', label: 'Voice' },
  { id: 'export', label: 'Export' },
  { id: 'history', label: 'History' },
];

export function TopNav({
  activeStep,
  onSelectStep,
  hasSource,
  isRendering,
  hasOutput,
  downloadUrl,
  resolutionLabel,
  onRenderClick,
  onResetAndRefresh,
}: TopNavProps) {
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white">
      <div className="max-w-[1440px] mx-auto px-3 sm:px-6 h-14 sm:h-16 flex items-center justify-between gap-3 sm:gap-8">
        {/* Zone 1: Brand Logo (Click refreshes & clears workspace data) */}
        <button
          type="button"
          onClick={onResetAndRefresh}
          aria-label="HarFrame — Refresh and clear workspace"
          title="Click to refresh and clear workspace"
          className="inline-flex items-center gap-2 min-h-[40px] shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7C3AED] rounded-lg cursor-pointer"
        >
          <HarFrameLogo className="h-10 sm:h-[50px] w-auto" />
        </button>

        {/* Zone 2: Minimal 4-Tab Navigation */}
        <nav
          aria-label="Workspace sections"
          className="hidden md:flex items-center gap-7 text-sm font-medium"
        >
          {NAV_ITEMS.map((item) => {
            const isActive = activeStep === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectStep(item.id)}
                className={`py-1.5 border-b-2 whitespace-nowrap shrink-0 cursor-pointer ${
                  isActive
                    ? 'border-[#7C3AED] text-slate-900 font-semibold'
                    : 'border-transparent text-slate-500 hover:text-slate-900'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: Single Primary Action */}
        <div className="flex items-center shrink-0">
          {hasOutput && downloadUrl ? (
            <a
              href={downloadUrl}
              download
              className="inline-flex items-center justify-center gap-2 min-h-[40px] px-4 py-2 rounded-lg text-xs font-semibold text-white bg-[#7C3AED] hover:bg-[#6D28D9] transition-colors whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5" aria-hidden="true" />
              Download {resolutionLabel}
            </a>
          ) : (
            <button
              type="button"
              disabled={!hasSource || isRendering}
              onClick={onRenderClick}
              className="inline-flex items-center justify-center gap-2 min-h-[40px] px-4 py-2 rounded-lg text-xs font-semibold text-slate-950 bg-gradient-to-r from-[#FBBF24] to-[#F59E0B] hover:brightness-105 disabled:opacity-45 disabled:cursor-not-allowed transition-all whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Film className="w-3.5 h-3.5" aria-hidden="true" />
              {isRendering ? `Exporting ${resolutionLabel}...` : `Export ${resolutionLabel}`}
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
