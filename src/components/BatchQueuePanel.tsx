import { useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Download,
  Layers,
  Loader2,
  Play,
  RotateCcw,
  SlidersHorizontal,
  Square,
  Trash2,
} from 'lucide-react';
import {
  isItemBusy,
  summarizeQueue,
  type QueueItem,
} from '../lib/batchQueue';
import {
  AI_VOICE_CATALOG,
  CAPTION_STYLE_PRESETS,
  VOICE_PRESETS,
} from '../lib/studioPresets';
import {
  computeQueueSwipeOffset,
  shouldTriggerQueueSwipeDelete,
  triggerSubtleHaptic,
} from '../lib/touchGestures';

interface BatchQueuePanelProps {
  queue: QueueItem[];
  activeItemId: string | null;
  isQueueRunning: boolean;
  stopAfterCurrent: boolean;
  onSelectItem: (itemId: string) => void;
  onMoveItem: (itemId: string, direction: 'up' | 'down') => void;
  onRemoveItem: (itemId: string) => void;
  onStartQueue: () => void;
  onStopQueue: () => void;
  onRetryFailed: () => void;
  onClearFinished: () => void;
  onApplyCurrentSettingsToQueued: () => void;
}

export function BatchQueuePanel({
  queue,
  activeItemId,
  isQueueRunning,
  stopAfterCurrent,
  onSelectItem,
  onMoveItem,
  onRemoveItem,
  onStartQueue,
  onStopQueue,
  onRetryFailed,
  onClearFinished,
  onApplyCurrentSettingsToQueued,
}: BatchQueuePanelProps) {
  const summary = summarizeQueue(queue);
  const [swipeState, setSwipeState] = useState<{ itemId: string; offsetX: number } | null>(null);
  const itemTouchRef = useRef<{
    itemId: string;
    startX: number;
    startY: number;
    startTime: number;
    movedHorizontal: boolean;
  } | null>(null);
  const suppressClickIdRef = useRef<string | null>(null);

  const getVoiceSummary = (item: QueueItem) => {
    if (item.settings.useAiVoiceover !== false) {
      return AI_VOICE_CATALOG.find((v) => v.id === item.settings.aiVoiceId)?.name ?? 'Aria';
    }
    return VOICE_PRESETS.find((v) => v.id === item.settings.voiceId)?.name ?? item.settings.voiceId;
  };

  const getCaptionName = (captionStyleId: string) =>
    CAPTION_STYLE_PRESETS.find((c) => c.id === captionStyleId)?.name ?? captionStyleId;

  const renderStatusLabel = (item: QueueItem) => {
    switch (item.status) {
      case 'analyzing':
        return (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#7C3AED]">
            <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
            Color Check
          </span>
        );
      case 'synthesizing':
        return (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#7C3AED]">
            <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
            Voice
          </span>
        );
      case 'transcribing':
        return (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#7C3AED]">
            <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
            Captions
          </span>
        );
      case 'rendering':
        return (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700">
            <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
            Exporting
          </span>
        );
      case 'completed':
        return (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700">
            <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
            Done
          </span>
        );
      case 'failed':
        return (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-rose-700">
            <AlertCircle className="w-3.5 h-3.5" aria-hidden="true" />
            Failed
          </span>
        );
      case 'queued':
      default:
        return (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500">
            <Clock className="w-3.5 h-3.5" aria-hidden="true" />
            Queued
          </span>
        );
    }
  };

  return (
    <section
      id="queue"
      aria-label="Video queue"
      className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 space-y-3.5 scroll-mt-16"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-[#7C3AED]" aria-hidden="true" />
            <h2 className="font-display text-base font-semibold text-slate-900">
              Queue
            </h2>
          </div>
          <p className="text-xs text-slate-500 font-mono-tabular">
            {summary.total === 0
              ? 'No videos in queue'
              : `${summary.completed} done · ${summary.queued} waiting${
                  summary.processing > 0 ? ` · ${summary.processing} running` : ''
                }${summary.failed > 0 ? ` · ${summary.failed} failed` : ''}`}
          </p>
        </div>

        <div className="w-full sm:w-auto flex flex-wrap items-center gap-2">
          {isQueueRunning ? (
            <button
              type="button"
              onClick={onStopQueue}
              disabled={stopAfterCurrent}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 min-h-[38px] px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-amber-100 border border-amber-300 text-amber-900 hover:bg-amber-200 disabled:opacity-60 transition-colors whitespace-nowrap cursor-pointer"
            >
              <Square className="w-3.5 h-3.5 fill-current" aria-hidden="true" />
              {stopAfterCurrent ? 'Stopping...' : 'Stop Queue'}
            </button>
          ) : (
            <button
              type="button"
              disabled={summary.queued === 0}
              onClick={onStartQueue}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 min-h-[38px] px-3.5 py-1.5 rounded-lg text-xs font-semibold text-slate-950 bg-gradient-to-r from-[#FBBF24] to-[#F59E0B] hover:brightness-105 disabled:opacity-45 disabled:cursor-not-allowed transition-all whitespace-nowrap cursor-pointer"
            >
              <Play className="w-3.5 h-3.5 fill-current" aria-hidden="true" />
              {summary.queued > 0 ? `Run Queue (${summary.queued})` : 'Run Queue'}
            </button>
          )}

          {summary.queued > 0 && !isQueueRunning && (
            <button
              type="button"
              onClick={onApplyCurrentSettingsToQueued}
              className="inline-flex items-center justify-center gap-1.5 min-h-[38px] px-3 py-1.5 rounded-lg text-xs font-medium bg-purple-50 border border-purple-200 text-[#6D28D9] hover:bg-purple-100 transition-colors whitespace-nowrap cursor-pointer"
              title="Apply current settings to all queued clips"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" aria-hidden="true" />
              Apply to All
            </button>
          )}

          {summary.failed > 0 && !isQueueRunning && (
            <button
              type="button"
              onClick={onRetryFailed}
              className="inline-flex items-center justify-center gap-1.5 min-h-[38px] px-3 py-1.5 rounded-lg text-xs font-medium bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
              Retry
            </button>
          )}

          {(summary.completed > 0 || summary.failed > 0) && (
            <button
              type="button"
              onClick={onClearFinished}
              className="inline-flex items-center justify-center gap-1.5 min-h-[38px] px-3 py-1.5 rounded-lg text-xs font-medium bg-white border border-slate-300 text-slate-600 hover:text-slate-900 hover:bg-slate-50 transition-colors whitespace-nowrap cursor-pointer"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {queue.length === 0 ? (
        <p className="text-xs text-slate-500 bg-slate-50 rounded-lg px-3 py-3 text-center">
          Add multiple videos or links in the Video tab to export them one after another.
        </p>
      ) : (
        <ul className="space-y-2 max-h-[320px] overflow-y-auto pr-1" aria-label="Queued videos list">
          {queue.map((item, idx) => {
            const isSelected = item.id === activeItemId;
            const busy = isItemBusy(item.status);
            const activeSwipeOffset =
              swipeState && swipeState.itemId === item.id ? swipeState.offsetX : 0;
            const isSwipingThis = activeSwipeOffset < 0;
            const resLabel =
              item.settings.resolutionTier === '2160p' ? '4K' : item.settings.resolutionTier;
            const aspectLabel =
              item.settings.frameAspect === 'auto' ? 'Auto' : item.settings.frameAspect;

            return (
              <li
                key={item.id}
                data-testid={`queue-item-${item.id}`}
                className="relative overflow-hidden rounded-lg"
              >
                {!busy && (
                  <div
                    aria-hidden="true"
                    className={`absolute inset-y-0 right-0 w-28 flex items-center justify-end gap-1.5 pr-4 rounded-lg bg-rose-600 text-white text-xs font-semibold transition-opacity ${
                      isSwipingThis ? 'opacity-100' : 'opacity-0 pointer-events-none'
                    }`}
                  >
                    <Trash2 className="w-4 h-4" />
                    <span>Remove</span>
                  </div>
                )}

                <div
                  onTouchStart={(e) => {
                    if (busy || e.touches.length !== 1) return;
                    const t = e.touches[0];
                    itemTouchRef.current = {
                      itemId: item.id,
                      startX: t.clientX,
                      startY: t.clientY,
                      startTime: Date.now(),
                      movedHorizontal: false,
                    };
                  }}
                  onTouchMove={(e) => {
                    const activeTouch = itemTouchRef.current;
                    if (!activeTouch || activeTouch.itemId !== item.id || e.touches.length !== 1) {
                      return;
                    }
                    const t = e.touches[0];
                    const dx = t.clientX - activeTouch.startX;
                    const dy = t.clientY - activeTouch.startY;
                    if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy)) {
                      activeTouch.movedHorizontal = true;
                    }
                    const nextOffset = computeQueueSwipeOffset(dx, dy);
                    if (nextOffset < 0) {
                      setSwipeState({ itemId: item.id, offsetX: nextOffset });
                    } else if (swipeState?.itemId === item.id) {
                      setSwipeState(null);
                    }
                  }}
                  onTouchEnd={(e) => {
                    const activeTouch = itemTouchRef.current;
                    itemTouchRef.current = null;
                    setSwipeState(null);
                    if (!activeTouch || activeTouch.itemId !== item.id) return;
                    if (activeTouch.movedHorizontal) {
                      suppressClickIdRef.current = item.id;
                      window.setTimeout(() => {
                        if (suppressClickIdRef.current === item.id) {
                          suppressClickIdRef.current = null;
                        }
                      }, 250);
                    }
                    const t = e.changedTouches[0];
                    if (!t) return;
                    const dx = t.clientX - activeTouch.startX;
                    const dy = t.clientY - activeTouch.startY;
                    const elapsed = Date.now() - activeTouch.startTime;
                    if (!busy && shouldTriggerQueueSwipeDelete(dx, dy, elapsed)) {
                      triggerSubtleHaptic(15);
                      onRemoveItem(item.id);
                    }
                  }}
                  onTouchCancel={() => {
                    itemTouchRef.current = null;
                    setSwipeState(null);
                  }}
                  style={{
                    transform: isSwipingThis ? `translate3d(${activeSwipeOffset}px, 0, 0)` : undefined,
                  }}
                  className={`relative rounded-lg border px-3 py-2.5 touch-pan-y ${
                    isSwipingThis
                      ? ''
                      : 'transition-[transform,border-color,background-color] duration-200'
                  } ${
                    isSelected
                      ? 'border-[#7C3AED] bg-purple-50/90'
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        if (suppressClickIdRef.current === item.id) return;
                        onSelectItem(item.id);
                      }}
                      aria-current={isSelected ? 'true' : undefined}
                      className="flex-1 min-w-0 flex flex-col justify-center text-left focus:outline-none cursor-pointer"
                    >
                      <div className="flex items-center justify-between gap-2 w-full min-w-0">
                        <span className="text-sm font-semibold text-slate-900 truncate min-w-0">
                          <span className="font-mono-tabular text-slate-400 mr-1.5">
                            #{idx + 1}
                          </span>
                          {item.title}
                        </span>
                        <span className="shrink-0">{renderStatusLabel(item)}</span>
                      </div>
                      <p className="text-xs text-slate-500 font-mono-tabular mt-0.5 truncate w-full">
                        {item.metadata.width}&times;{item.metadata.height} &middot;{' '}
                        {item.metadata.durationSec.toFixed(1)}s &middot;{' '}
                        {getVoiceSummary(item)} &middot; {aspectLabel} {resLabel} &middot;{' '}
                        {item.settings.captionsEnabled
                          ? getCaptionName(item.settings.captionStyleId)
                          : 'No Captions'}
                      </p>
                    </button>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {item.status === 'completed' && item.renderResult && (
                        <a
                          href={item.renderResult.downloadUrl}
                          download
                          aria-label={`Download MP4 for ${item.title}`}
                          className="inline-flex items-center justify-center gap-1 min-h-[34px] px-2.5 rounded-md text-xs font-semibold bg-[#7C3AED] hover:bg-[#6D28D9] text-white transition-colors whitespace-nowrap"
                        >
                          <Download className="w-3.5 h-3.5" aria-hidden="true" />
                          MP4
                        </a>
                      )}

                      <button
                        type="button"
                        disabled={busy || idx === 0 || isItemBusy(queue[idx - 1]?.status)}
                        aria-label={`Move ${item.title} up`}
                        onClick={() => onMoveItem(item.id, 'up')}
                        className="inline-flex items-center justify-center w-8 h-8 rounded-md bg-slate-50 border border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-100 disabled:opacity-35 disabled:cursor-not-allowed transition-colors cursor-pointer"
                      >
                        <ChevronUp className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        disabled={
                          busy ||
                          idx === queue.length - 1 ||
                          isItemBusy(queue[idx + 1]?.status)
                        }
                        aria-label={`Move ${item.title} down`}
                        onClick={() => onMoveItem(item.id, 'down')}
                        className="inline-flex items-center justify-center w-8 h-8 rounded-md bg-slate-50 border border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-100 disabled:opacity-35 disabled:cursor-not-allowed transition-colors cursor-pointer"
                      >
                        <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        aria-label={`Remove ${item.title}`}
                        onClick={() => onRemoveItem(item.id)}
                        className="inline-flex items-center justify-center w-8 h-8 rounded-md bg-slate-50 border border-slate-200 text-slate-500 hover:text-rose-600 hover:bg-rose-50 disabled:opacity-35 disabled:cursor-not-allowed transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                    </div>
                  </div>

                  {item.error && (
                    <p role="alert" className="mt-1.5 text-xs text-rose-700 break-words">
                      {item.error}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
