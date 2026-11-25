import { useMemo, useState } from 'react';
import { Check, ChevronDown, ClipboardCopy, Loader2, Sparkles, Wand2 } from 'lucide-react';
import {
  buildGeminiPromptForClip,
  estimateSpeechDurationSec,
  translatePromptForInhouseStudio,
} from '../lib/scriptCleaner';
import {
  NARRATION_PROMPT_TEMPLATES,
  type VideoMetadata,
} from '../lib/studioPresets';

interface ScriptStudioPanelProps {
  hasSource: boolean;
  metadata: VideoMetadata | null;
  narrationPrompt: string;
  onNarrationPromptChange: (value: string) => void;
  rawGeminiOutput: string;
  onRawGeminiOutputChange: (value: string) => void;
  scriptText: string;
  onScriptTextChange: (value: string) => void;
  speakingRate: number;
  visualSummary: string | null;
  tailoredVoiceInstruction: string | null;
  isGeneratingScript: boolean;
  scriptError: string | null;
  cleanerReport: string | null;
  onGenerateScriptFromVideo: () => void;
  onCleanGeminiResponse: () => void;
}

export function ScriptStudioPanel({
  hasSource,
  metadata,
  narrationPrompt,
  onNarrationPromptChange,
  rawGeminiOutput,
  onRawGeminiOutputChange,
  scriptText,
  onScriptTextChange,
  speakingRate,
  visualSummary,
  tailoredVoiceInstruction,
  isGeneratingScript,
  scriptError,
  cleanerReport,
  onGenerateScriptFromVideo,
  onCleanGeminiResponse,
}: ScriptStudioPanelProps) {
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const [showPasteCleaner, setShowPasteCleaner] = useState(false);

  const { wordCount, estimatedSec } = estimateSpeechDurationSec(scriptText, speakingRate);
  const promptTranslation = useMemo(
    () => translatePromptForInhouseStudio(narrationPrompt),
    [narrationPrompt]
  );

  const handleCopyPrompt = async () => {
    const metaForPrompt = metadata
      ? {
          filename: metadata.filename,
          durationSec: metadata.durationSec,
          width: metadata.width,
          height: metadata.height,
        }
      : { filename: 'video_clip.mp4', durationSec: 10, width: 1080, height: 1920 };

    const formatted = buildGeminiPromptForClip(narrationPrompt, metaForPrompt);
    try {
      await navigator.clipboard.writeText(formatted);
      setCopiedPrompt(true);
      setTimeout(() => setCopiedPrompt(false), 2200);
    } catch {
      setCopiedPrompt(false);
    }
  };

  const hasAutoVoiceMatch = Boolean(
    promptTranslation.hadVoiceModelInstructions || tailoredVoiceInstruction
  );

  return (
    <section id="script" aria-label="Story Script" className="space-y-4">
      <div>
        <h2 className="font-display text-base font-semibold text-slate-900">
          Script
        </h2>
        <p className="text-xs text-slate-500">
          Write narration from your clip or type your own script below.
        </p>
      </div>

      {/* Story Prompt & Quick Styles */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label htmlFor="narration-prompt-input" className="text-xs font-medium text-slate-700">
            Prompt
          </label>
          <div className="flex flex-wrap gap-1.5">
            {NARRATION_PROMPT_TEMPLATES.map((tpl) => (
              <button
                key={tpl.id}
                type="button"
                onClick={() => onNarrationPromptChange(tpl.prompt)}
                className="min-h-[30px] px-2.5 py-1 rounded-md text-[11px] font-medium bg-slate-100 hover:bg-purple-50 hover:text-[#7C3AED] text-slate-700 transition-colors cursor-pointer whitespace-nowrap"
              >
                {tpl.label}
              </button>
            ))}
          </div>
        </div>

        <textarea
          id="narration-prompt-input"
          rows={2}
          value={narrationPrompt}
          onChange={(e) => onNarrationPromptChange(e.target.value)}
          placeholder="Describe the story tone and what to focus on..."
          className="w-full rounded-lg bg-white border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-[#7C3AED]"
        />

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={!hasSource || isGeneratingScript}
            onClick={onGenerateScriptFromVideo}
            className="flex-1 min-h-[42px] inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold text-slate-950 bg-gradient-to-r from-[#FBBF24] to-[#F59E0B] hover:brightness-105 disabled:opacity-45 disabled:cursor-not-allowed transition-all cursor-pointer whitespace-nowrap"
          >
            {isGeneratingScript ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
            )}
            {isGeneratingScript ? 'Writing Script...' : 'Write Script'}
          </button>

          <button
            type="button"
            onClick={handleCopyPrompt}
            className="min-h-[42px] inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer whitespace-nowrap"
          >
            {copiedPrompt ? (
              <Check className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
            ) : (
              <ClipboardCopy className="w-3.5 h-3.5 text-[#7C3AED]" aria-hidden="true" />
            )}
            {copiedPrompt ? 'Copied' : 'Copy Prompt'}
          </button>
        </div>

        {hasAutoVoiceMatch && (
          <p className="text-[11px] text-[#6D28D9]">
            Voice tone and pacing matched automatically from your prompt.
          </p>
        )}
      </div>

      {visualSummary && (
        <p className="text-xs text-slate-600 bg-slate-50 rounded-lg px-3 py-2">
          <span className="font-semibold text-slate-900">Scene note:</span> {visualSummary}
        </p>
      )}

      {scriptError && (
        <p role="alert" className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 break-words">
          {scriptError}
        </p>
      )}

      {/* Editable Script */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <label htmlFor="final-voiceover-script" className="text-xs font-medium text-slate-700">
            Voiceover Text
          </label>
          <span className="text-[11px] font-mono-tabular text-slate-500">
            {wordCount} words &middot; ~{estimatedSec.toFixed(1)}s
            {metadata ? ` / ${metadata.durationSec.toFixed(1)}s` : ''}
          </span>
        </div>
        <textarea
          id="final-voiceover-script"
          rows={4}
          value={scriptText}
          onChange={(e) => onScriptTextChange(e.target.value)}
          placeholder="Your voiceover text appears here..."
          className="w-full rounded-lg bg-white border border-slate-300 px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 leading-relaxed focus:outline-none focus:border-[#7C3AED]"
        />
      </div>

      {/* Compact Optional Paste & Clean Disclosure */}
      <div className="pt-1">
        <button
          type="button"
          aria-expanded={showPasteCleaner}
          onClick={() => setShowPasteCleaner((v) => !v)}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-[#7C3AED] transition-colors cursor-pointer"
        >
          <ChevronDown
            className={`w-3.5 h-3.5 transition-transform ${showPasteCleaner ? 'rotate-180' : ''}`}
            aria-hidden="true"
          />
          Paste &amp; clean external script
        </button>

        {showPasteCleaner && (
          <div className="mt-2.5 space-y-2 pt-2.5 border-t border-slate-200">
            <label htmlFor="raw-script-paste" className="sr-only">
              Paste raw script text
            </label>
            <textarea
              id="raw-script-paste"
              rows={3}
              value={rawGeminiOutput}
              onChange={(e) => onRawGeminiOutputChange(e.target.value)}
              placeholder="Paste raw script text here to strip intro chatter, timestamps, and stage tags..."
              className="w-full rounded-lg bg-slate-50 border border-slate-300 px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-[#7C3AED]"
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                disabled={!rawGeminiOutput.trim()}
                onClick={onCleanGeminiResponse}
                className="min-h-[38px] inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#7C3AED] hover:bg-[#6D28D9] text-white disabled:opacity-45 disabled:cursor-not-allowed transition-colors cursor-pointer whitespace-nowrap"
              >
                <Wand2 className="w-3.5 h-3.5" aria-hidden="true" />
                Clean Script
              </button>
              {cleanerReport && (
                <span className="text-[11px] text-emerald-700">{cleanerReport}</span>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
