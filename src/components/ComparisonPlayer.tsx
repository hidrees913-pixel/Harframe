import { useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  Download,
  Eye,
  Film,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Sparkles,
} from 'lucide-react';
import { computeTargetDimensions } from '../lib/ffmpegPipeline';
import {
  clampVideoSeekTime,
  classifyPreviewDoubleTapZone,
  detectHorizontalSwipe,
  triggerSubtleHaptic,
} from '../lib/touchGestures';
import {
  AI_VOICE_CATALOG,
  CAPTION_STYLE_PRESETS,
  COLOR_GRADE_PRESETS,
  VOICE_PRESETS,
  getCaptionFontCssFamily,
  presetToCustomCaptionStyle,
  type AiVoiceId,
  type AudioMixMode,
  type CaptionStyleId,
  type ColorGradeId,
  type ContentAwareColorAnalysis,
  type CustomCaptionStyle,
  type FrameAspectId,
  type FrameFitMode,
  type RenderResult,
  type ResolutionTierId,
  type SubtitleSegment,
  type VideoMetadata,
  type VoiceId,
} from '../lib/studioPresets';

interface ComparisonPlayerProps {
  metadata: VideoMetadata | null;
  renderResult: RenderResult | null;
  isRendering: boolean;
  renderError: string | null;
  frameAspect: FrameAspectId;
  resolutionTier: ResolutionTierId;
  frameFit: FrameFitMode;
  voiceId: VoiceId;
  useAiVoiceover: boolean;
  aiVoiceId: AiVoiceId;
  hasVoiceoverTake: boolean;
  audioMixMode: AudioMixMode;
  colorGradeId: ColorGradeId;
  contentAwareAnalysis: ContentAwareColorAnalysis | null;
  captionsEnabled: boolean;
  captionStyleId: CaptionStyleId;
  customCaptionStyle?: CustomCaptionStyle;
  segments: SubtitleSegment[];
  onRender: () => void;
}

function getViewportAspectClass(
  frameAspect: FrameAspectId,
  sourceWidth: number,
  sourceHeight: number
): { containerClass: string; isTall: boolean } {
  const effectiveAspect =
    frameAspect === 'auto'
      ? sourceHeight > sourceWidth
        ? '9:16'
        : sourceHeight === sourceWidth
          ? '1:1'
          : '16:9'
      : frameAspect;

  switch (effectiveAspect) {
    case '9:16':
      return { containerClass: 'aspect-[9/16] max-h-[42svh] sm:max-h-[400px] mx-auto', isTall: true };
    case '4:5':
      return { containerClass: 'aspect-[4/5] max-h-[42svh] sm:max-h-[400px] mx-auto', isTall: true };
    case '1:1':
      return { containerClass: 'aspect-square max-h-[38svh] sm:max-h-[380px] mx-auto', isTall: true };
    case '4:3':
      return { containerClass: 'aspect-[4/3] w-full', isTall: false };
    case '21:9':
      return { containerClass: 'aspect-[21/9] w-full', isTall: false };
    case '16:9':
    default:
      return { containerClass: 'aspect-video w-full', isTall: false };
  }
}

export function ComparisonPlayer({
  metadata,
  renderResult,
  isRendering,
  renderError,
  frameAspect,
  resolutionTier,
  frameFit,
  voiceId,
  useAiVoiceover,
  aiVoiceId,
  hasVoiceoverTake,
  colorGradeId,
  contentAwareAnalysis,
  captionsEnabled,
  captionStyleId,
  customCaptionStyle,
  segments,
  onRender,
}: ComparisonPlayerProps) {
  const [showOriginal, setShowOriginal] = useState(false);
  const [isHoldingOriginal, setIsHoldingOriginal] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [previewErrorJobId, setPreviewErrorJobId] = useState<string | null>(null);
  const [touchFeedback, setTouchFeedback] = useState<{
    kind: 'back' | 'forward' | 'play' | 'pause' | 'original' | 'edited';
    label: string;
  } | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const touchStartRef = useRef<{ x: number; y: number; timeMs: number } | null>(null);
  const holdTimerRef = useRef<number | null>(null);
  const singleTapTimerRef = useRef<number | null>(null);
  const feedbackTimerRef = useRef<number | null>(null);
  const lastTapRef = useRef<{ x: number; y: number; timeMs: number } | null>(null);
  const didHoldCompareRef = useRef(false);

  useEffect(() => {
    return () => {
      if (holdTimerRef.current) window.clearTimeout(holdTimerRef.current);
      if (singleTapTimerRef.current) window.clearTimeout(singleTapTimerRef.current);
      if (feedbackTimerRef.current) window.clearTimeout(feedbackTimerRef.current);
    };
  }, []);

  const flashFeedback = (
    kind: 'back' | 'forward' | 'play' | 'pause' | 'original' | 'edited',
    label: string
  ) => {
    if (feedbackTimerRef.current) window.clearTimeout(feedbackTimerRef.current);
    setTouchFeedback({ kind, label });
    feedbackTimerRef.current = window.setTimeout(() => {
      setTouchFeedback(null);
    }, 850);
  };

  const clearHoldTimer = () => {
    if (holdTimerRef.current) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  };

  const handleStageTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!metadata || isRendering || hasPreviewError || e.touches.length !== 1) return;
    const t = e.touches[0];
    const startPoint = { x: t.clientX, y: t.clientY, timeMs: Date.now() };
    touchStartRef.current = startPoint;
    didHoldCompareRef.current = false;

    clearHoldTimer();
    holdTimerRef.current = window.setTimeout(() => {
      didHoldCompareRef.current = true;
      setIsHoldingOriginal(true);
      triggerSubtleHaptic(12);
    }, 260);
  };

  const handleStageTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!touchStartRef.current || e.touches.length !== 1) return;
    const t = e.touches[0];
    const dist = Math.hypot(t.clientX - touchStartRef.current.x, t.clientY - touchStartRef.current.y);
    if (dist > 14) {
      clearHoldTimer();
      if (didHoldCompareRef.current) {
        didHoldCompareRef.current = false;
        setIsHoldingOriginal(false);
      }
    }
  };

  const handleStageTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    clearHoldTimer();
    if (didHoldCompareRef.current) {
      didHoldCompareRef.current = false;
      setIsHoldingOriginal(false);
      touchStartRef.current = null;
      return;
    }

    const start = touchStartRef.current;
    touchStartRef.current = null;
    if (!start || e.changedTouches.length === 0) return;

    const t = e.changedTouches[0];
    const endPoint = { x: t.clientX, y: t.clientY, timeMs: Date.now() };
    const swipeDir = detectHorizontalSwipe(start, endPoint, {
      minDistancePx: 50,
      horizontalDominanceRatio: 1.4,
    });

    if (swipeDir) {
      lastTapRef.current = null;
      if (singleTapTimerRef.current) {
        window.clearTimeout(singleTapTimerRef.current);
        singleTapTimerRef.current = null;
      }
      setShowOriginal((prev) => {
        const next = !prev;
        flashFeedback(next ? 'original' : 'edited', next ? 'Original' : 'Edited');
        return next;
      });
      triggerSubtleHaptic(10);
      return;
    }

    const moveDist = Math.hypot(endPoint.x - start.x, endPoint.y - start.y);
    const tapDuration = endPoint.timeMs - start.timeMs;
    if (moveDist > 18 || tapDuration > 255) return;

    const prevTap = lastTapRef.current;
    const isDoubleTap =
      prevTap !== null &&
      endPoint.timeMs - prevTap.timeMs <= 300 &&
      Math.hypot(endPoint.x - prevTap.x, endPoint.y - prevTap.y) <= 44;

    const stageRect = e.currentTarget.getBoundingClientRect();
    const videoEl = videoRef.current;

    if (isDoubleTap) {
      lastTapRef.current = null;
      if (singleTapTimerRef.current) {
        window.clearTimeout(singleTapTimerRef.current);
        singleTapTimerRef.current = null;
      }
      const action = classifyPreviewDoubleTapZone(endPoint.x, stageRect.left, stageRect.width);
      if (videoEl) {
        if (action === 'seek-back') {
          const target = clampVideoSeekTime(videoEl.currentTime, -5, videoEl.duration || metadata?.durationSec || 0);
          videoEl.currentTime = target;
          setCurrentTime(target);
          flashFeedback('back', '-5s');
          triggerSubtleHaptic(10);
        } else if (action === 'seek-forward') {
          const target = clampVideoSeekTime(videoEl.currentTime, 5, videoEl.duration || metadata?.durationSec || 0);
          videoEl.currentTime = target;
          setCurrentTime(target);
          flashFeedback('forward', '+5s');
          triggerSubtleHaptic(10);
        } else {
          if (videoEl.paused) {
            void videoEl.play().catch(() => undefined);
            flashFeedback('play', 'Play');
          } else {
            videoEl.pause();
            flashFeedback('pause', 'Paused');
          }
          triggerSubtleHaptic(8);
        }
      }
    } else {
      lastTapRef.current = endPoint;
      if (singleTapTimerRef.current) window.clearTimeout(singleTapTimerRef.current);
      singleTapTimerRef.current = window.setTimeout(() => {
        lastTapRef.current = null;
        if (!videoRef.current) return;
        if (videoRef.current.paused) {
          void videoRef.current.play().catch(() => undefined);
        } else {
          videoRef.current.pause();
        }
      }, 290);
    }
  };

  const handleStageTouchCancel = () => {
    clearHoldTimer();
    touchStartRef.current = null;
    if (didHoldCompareRef.current) {
      didHoldCompareRef.current = false;
      setIsHoldingOriginal(false);
    }
  };

  const effectiveShowOriginal = showOriginal || isHoldingOriginal;
  const hasPreviewError = Boolean(metadata && previewErrorJobId === metadata.jobId);

  const activeCaptionPreset =
    CAPTION_STYLE_PRESETS.find((c) => c.id === captionStyleId) ?? CAPTION_STYLE_PRESETS[0];
  const resolvedCaptionStyle: CustomCaptionStyle =
    customCaptionStyle ?? presetToCustomCaptionStyle(captionStyleId);
  const activeGradePreset =
    COLOR_GRADE_PRESETS.find((g) => g.id === colorGradeId) ?? COLOR_GRADE_PRESETS[0];
  const activeAiVoice =
    AI_VOICE_CATALOG.find((v) => v.id === aiVoiceId) ?? AI_VOICE_CATALOG[0];
  const activeCharacterVoice =
    VOICE_PRESETS.find((v) => v.id === voiceId) ?? VOICE_PRESETS[0];

  const liveCssFilter =
    colorGradeId === 'ai_content_aware' && contentAwareAnalysis?.cssPreviewFilter
      ? contentAwareAnalysis.cssPreviewFilter
      : activeGradePreset.cssFilter === 'none'
        ? undefined
        : activeGradePreset.cssFilter;

  const voiceLabel = useAiVoiceover
    ? `${activeAiVoice.name}${hasVoiceoverTake ? ' (Ready)' : ''}`
    : activeCharacterVoice.name;

  const resLabel = resolutionTier === '2160p' ? '4K' : resolutionTier;

  const activeSubtitle = captionsEnabled
    ? segments.find((s) => currentTime >= s.startSec && currentTime <= s.endSec)
    : undefined;

  const formatBytes = (bytes: number) => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  return (
    <section
      id="monitor"
      aria-label="Video preview and export"
      className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 space-y-3.5"
    >
      {/* Top toolbar: single preview header + Show Original toggle */}
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="min-w-0">
          <h2 className="font-display text-base sm:text-lg font-semibold text-slate-900">
            Preview
          </h2>
          <p className="text-xs text-slate-500 break-words">
            {voiceLabel} &middot; {activeGradePreset.name} &middot;{' '}
            {captionsEnabled ? activeCaptionPreset.name : 'Captions Off'} &middot;{' '}
            {frameAspect === 'auto' ? 'Auto' : frameAspect} ({resLabel})
          </p>
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={effectiveShowOriginal}
          disabled={!metadata}
          onClick={() => setShowOriginal((prev) => !prev)}
          className={`inline-flex items-center gap-1.5 min-h-[36px] px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed ${
            effectiveShowOriginal
              ? 'border-[#7C3AED] bg-[#7C3AED] text-white'
              : 'border-slate-300 bg-white text-slate-700 hover:border-[#7C3AED] hover:text-[#7C3AED]'
          }`}
        >
          <Eye className="w-3.5 h-3.5" aria-hidden="true" />
          {isHoldingOriginal ? 'Original (Hold)' : 'Show Original'}
        </button>
      </div>

      {/* Single Video Viewport */}
      {!metadata ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/70 min-h-[150px] sm:min-h-[240px] flex flex-col items-center justify-center p-4 sm:p-6 text-center space-y-2.5">
          <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-gradient-to-br from-amber-100 to-purple-100 flex items-center justify-center">
            <Film className="w-5 h-5 sm:w-6 sm:h-6 text-[#7C3AED]" aria-hidden="true" />
          </div>
          <div className="max-w-xs space-y-1">
            <h3 className="font-display text-sm sm:text-base font-semibold text-slate-900">
              No video loaded yet
            </h3>
            <p className="text-xs sm:text-sm text-slate-500">
              Upload a clip, paste a link, or try a sample on the right to start.
            </p>
          </div>
        </div>
      ) : (
        (() => {
          const sourceAspectClass =
            metadata.height > metadata.width
              ? 'aspect-[9/16] max-h-[42svh] sm:max-h-[400px] mx-auto'
              : metadata.height === metadata.width
                ? 'aspect-square max-h-[38svh] sm:max-h-[380px] mx-auto'
                : 'aspect-video w-full';

          const { targetWidth, targetHeight } = computeTargetDimensions(
            metadata.width,
            metadata.height,
            frameAspect,
            resolutionTier
          );
          const targetDimLabel = `${targetWidth}×${targetHeight}`;
          const { containerClass: targetAspectClass, isTall: isTargetTall } =
            getViewportAspectClass(frameAspect, metadata.width, metadata.height);

          return (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs text-slate-500 px-0.5">
                <span className={`font-semibold ${effectiveShowOriginal ? 'text-slate-800' : 'text-[#7C3AED]'}`}>
                  {effectiveShowOriginal
                    ? isHoldingOriginal
                      ? 'Original Source (Hold)'
                      : 'Original Source'
                    : renderResult
                      ? `Exported ${resLabel}`
                      : 'Edited Preview'}
                </span>
                <span className="font-mono-tabular">
                  {effectiveShowOriginal
                    ? `${metadata.width}×${metadata.height} · ${metadata.durationSec.toFixed(1)}s`
                    : renderResult
                      ? `${renderResult.width}×${renderResult.height} · ${formatBytes(renderResult.fileSizeBytes)}`
                      : `${targetDimLabel} · MP4`}
                </span>
              </div>

              <div
                className={`relative ${
                  effectiveShowOriginal ? sourceAspectClass : targetAspectClass
                } rounded-lg overflow-hidden bg-slate-950 border border-slate-200`}
              >
                {effectiveShowOriginal ? (
                  hasPreviewError ? (
                    <div className="w-full h-full flex flex-col items-center justify-center p-5 text-center space-y-2 bg-slate-900">
                      <Film className="w-7 h-7 text-amber-400" aria-hidden="true" />
                      <p className="text-xs font-medium text-white">
                        {metadata.codec.toUpperCase()} clip loaded
                      </p>
                      <p className="text-xs text-slate-300 max-w-xs">
                        Browser cannot preview this codec directly, but export converts cleanly to MP4.
                      </p>
                    </div>
                  ) : (
                    <video
                      ref={videoRef}
                      key={`orig-${metadata.jobId}`}
                      src={metadata.sourceUrl}
                      preload="metadata"
                      controls
                      playsInline
                      onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                      onError={() => setPreviewErrorJobId(metadata.jobId)}
                      className="w-full h-full object-contain"
                    />
                  )
                ) : renderResult ? (
                  <video
                    ref={videoRef}
                    key={`out-${renderResult.outputUrl}`}
                    src={renderResult.outputUrl}
                    preload="metadata"
                    controls
                    playsInline
                    onLoadedData={(e) => {
                      if (e.currentTarget.duration > 1 && e.currentTarget.currentTime === 0) {
                        e.currentTarget.currentTime = 0.6;
                      }
                    }}
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <>
                    {hasPreviewError ? (
                      <div className="w-full h-full flex flex-col items-center justify-center p-5 text-center space-y-2 bg-slate-900">
                        <Film className="w-7 h-7 text-amber-400" aria-hidden="true" />
                        <p className="text-xs font-medium text-white">
                          {metadata.codec.toUpperCase()} clip loaded
                        </p>
                        <p className="text-xs text-slate-300 max-w-xs">
                          Browser cannot preview this codec directly, but export renders cleanly to MP4.
                        </p>
                      </div>
                    ) : (
                      <video
                        ref={videoRef}
                        key={`prev-${metadata.jobId}`}
                        src={metadata.sourceUrl}
                        preload="metadata"
                        muted
                        controls
                        playsInline
                        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                        onError={() => setPreviewErrorJobId(metadata.jobId)}
                        className={`w-full h-full ${
                          frameFit === 'fill' ? 'object-cover' : 'object-contain'
                        }`}
                        style={{ filter: liveCssFilter }}
                      />
                    )}
                    {captionsEnabled && (
                      <div
                        className={`pointer-events-none absolute inset-x-0 flex justify-center ${
                          resolvedCaptionStyle.position === 'top'
                            ? 'top-5'
                            : resolvedCaptionStyle.position === 'middle'
                              ? 'top-1/2 -translate-y-1/2'
                              : isTargetTall
                                ? 'bottom-14'
                                : 'bottom-12'
                        } ${isTargetTall ? 'px-[9%]' : 'px-[8%]'}`}
                      >
                        <span
                          className={`text-center leading-tight break-words max-w-full caption-anim-${resolvedCaptionStyle.animation}`}
                          style={{
                            color: resolvedCaptionStyle.primaryColor,
                            fontFamily: getCaptionFontCssFamily(resolvedCaptionStyle.fontName),
                            fontWeight: resolvedCaptionStyle.bold ? 800 : 500,
                            fontStyle: resolvedCaptionStyle.italic ? 'italic' : 'normal',
                            textTransform: resolvedCaptionStyle.uppercase
                              ? 'uppercase'
                              : 'none',
                            fontSize: `${Math.max(
                              12,
                              Math.round(
                                resolvedCaptionStyle.fontSize * (isTargetTall ? 0.22 : 0.26)
                              )
                            )}px`,
                            backgroundColor: resolvedCaptionStyle.backgroundEnabled
                              ? resolvedCaptionStyle.backgroundColor
                              : 'transparent',
                            padding: resolvedCaptionStyle.backgroundEnabled
                              ? '4px 10px'
                              : undefined,
                            borderRadius: resolvedCaptionStyle.backgroundEnabled
                              ? '6px'
                              : undefined,
                            textShadow: resolvedCaptionStyle.backgroundEnabled
                              ? 'none'
                              : resolvedCaptionStyle.outlineWidth > 0
                                ? `-2px -2px 0 ${resolvedCaptionStyle.outlineColor}, 2px -2px 0 ${resolvedCaptionStyle.outlineColor}, -2px 2px 0 ${resolvedCaptionStyle.outlineColor}, 2px 2px 0 ${resolvedCaptionStyle.outlineColor}`
                                : 'none',
                          }}
                        >
                          {activeSubtitle?.text ??
                            (segments[0]?.text || 'Captions Preview')}
                        </span>
                      </div>
                    )}
                  </>
                )}

                {!hasPreviewError && !isRendering && (
                  <div
                    data-testid="preview-touch-stage"
                    aria-hidden="true"
                    onTouchStart={handleStageTouchStart}
                    onTouchMove={handleStageTouchMove}
                    onTouchEnd={handleStageTouchEnd}
                    onTouchCancel={handleStageTouchCancel}
                    className="absolute inset-x-0 top-0 bottom-12 z-10 touch-pan-y select-none"
                  />
                )}

                {touchFeedback && (
                  <div
                    aria-live="polite"
                    className={`pointer-events-none absolute top-1/2 -translate-y-1/2 z-20 inline-flex items-center gap-1.5 rounded-full bg-slate-950/80 text-white px-3 py-1.5 text-xs font-semibold shadow-sm ${
                      touchFeedback.kind === 'back'
                        ? 'left-4'
                        : touchFeedback.kind === 'forward'
                          ? 'right-4'
                          : 'left-1/2 -translate-x-1/2'
                    }`}
                  >
                    {touchFeedback.kind === 'back' && <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />}
                    {touchFeedback.kind === 'forward' && <RotateCw className="w-3.5 h-3.5" aria-hidden="true" />}
                    {touchFeedback.kind === 'play' && <Play className="w-3.5 h-3.5" aria-hidden="true" />}
                    {touchFeedback.kind === 'pause' && <Pause className="w-3.5 h-3.5" aria-hidden="true" />}
                    {touchFeedback.label}
                  </div>
                )}

                {isHoldingOriginal && (
                  <div className="pointer-events-none absolute top-2.5 left-2.5 z-20 rounded-md bg-slate-950/80 text-white px-2.5 py-1 text-[11px] font-semibold">
                    Original
                  </div>
                )}

                {isRendering && (
                  <div
                    role="status"
                    aria-live="polite"
                    className="absolute inset-0 bg-slate-950/85 flex flex-col items-center justify-center gap-3 p-6 text-center"
                  >
                    <Loader2 className="w-8 h-8 text-[#FBBF24] animate-spin" aria-hidden="true" />
                    <div className="space-y-1">
                      <p className="font-display text-sm font-semibold text-white">
                        Exporting {resLabel} ({targetDimLabel})...
                      </p>
                      <p className="text-xs text-slate-300">
                        {voiceLabel} &middot; {activeGradePreset.name}
                      </p>
                    </div>
                  </div>
                )}
              </div>
              <p className="sm:hidden text-[11px] text-slate-400 text-center">
                Hold or swipe video for original &middot; Double-tap &plusmn;5s
              </p>
            </div>
          );
        })()
      )}

      {renderError && (
        <p role="alert" className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3.5 py-2.5">
          {renderError}
        </p>
      )}

      {/* Primary Action & Download Row */}
      <div className="pt-3 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2.5">
        <div className="w-full sm:w-auto flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={!metadata || isRendering}
            onClick={onRender}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 min-h-[42px] px-4 py-2 rounded-lg text-xs font-semibold text-slate-950 bg-gradient-to-r from-[#FBBF24] to-[#F59E0B] hover:brightness-105 disabled:opacity-45 disabled:cursor-not-allowed transition-all whitespace-nowrap cursor-pointer"
          >
            {isRendering ? (
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
            ) : (
              <Sparkles className="w-4 h-4" aria-hidden="true" />
            )}
            {isRendering ? 'Exporting...' : `Export ${resLabel}`}
          </button>

          {renderResult && (
            <div className="w-full sm:w-auto flex flex-wrap items-center gap-1.5">
              <a
                href={renderResult.downloadUrl}
                download
                className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 min-h-[42px] px-3.5 py-2 rounded-lg text-xs font-semibold bg-[#7C3AED] hover:bg-[#6D28D9] text-white transition-colors whitespace-nowrap"
              >
                <Download className="w-4 h-4" aria-hidden="true" />
                Download MP4
              </a>

              {renderResult.srtUrl && (
                <a
                  href={renderResult.srtUrl}
                  download
                  className="inline-flex items-center justify-center min-h-[42px] px-2.5 py-2 rounded-lg text-xs font-medium bg-white border border-slate-300 text-slate-700 hover:border-[#7C3AED] transition-colors whitespace-nowrap"
                >
                  .SRT
                </a>
              )}
              {renderResult.assUrl && (
                <a
                  href={renderResult.assUrl}
                  download
                  className="inline-flex items-center justify-center min-h-[42px] px-2.5 py-2 rounded-lg text-xs font-medium bg-white border border-slate-300 text-slate-700 hover:border-[#7C3AED] transition-colors whitespace-nowrap"
                >
                  .ASS
                </a>
              )}
            </div>
          )}
        </div>

        {renderResult && (
          <div className="flex items-center gap-1.5 text-xs text-emerald-700 font-medium">
            <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span className="font-mono-tabular">
              Ready &middot; {renderResult.width}&times;{renderResult.height}
            </span>
          </div>
        )}
      </div>
    </section>
  );
}
