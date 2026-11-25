export interface TouchPoint {
  x: number;
  y: number;
  timeMs: number;
}

export interface SwipeThresholds {
  minDistancePx?: number;
  longDragDistancePx?: number;
  maxDurationMs?: number;
  horizontalDominanceRatio?: number;
}

export type SwipeDirection = 'left' | 'right';

export type PreviewDoubleTapAction = 'seek-back' | 'toggle-play' | 'seek-forward';

const IGNORED_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'OPTION', 'BUTTON', 'A']);

export interface TouchTargetSnapshot {
  tagName?: string | null;
  inputType?: string | null;
  isContentEditable?: boolean;
  insideNoSwipe?: boolean;
}

export function shouldIgnoreTouchTarget(
  target: TouchTargetSnapshot,
  options?: { allowButtons?: boolean }
): boolean {
  if (target.insideNoSwipe) return true;
  if (target.isContentEditable) return true;

  const tag = (target.tagName ?? '').toUpperCase();
  if (!tag) return false;
  if (tag === 'BUTTON' && options?.allowButtons) return false;
  if (IGNORED_TAGS.has(tag)) return true;

  return false;
}

export function extractTouchTargetSnapshot(el: EventTarget | null): TouchTargetSnapshot {
  if (!el || typeof el !== 'object') {
    return {};
  }
  const node = el as Partial<HTMLElement>;
  const tagName = typeof node.tagName === 'string' ? node.tagName : null;
  const inputType =
    tagName?.toUpperCase() === 'INPUT' && 'type' in node
      ? String((node as HTMLInputElement).type || '')
      : null;
  const isContentEditable = Boolean(node.isContentEditable);
  const insideNoSwipe =
    typeof node.closest === 'function'
      ? Boolean(node.closest('[data-no-swipe="true"], .overflow-x-auto'))
      : false;

  return { tagName, inputType, isContentEditable, insideNoSwipe };
}

export function detectHorizontalSwipe(
  start: TouchPoint,
  end: TouchPoint,
  thresholds: SwipeThresholds = {}
): SwipeDirection | null {
  const minDistancePx = thresholds.minDistancePx ?? 52;
  const longDragDistancePx = thresholds.longDragDistancePx ?? 96;
  const maxDurationMs = thresholds.maxDurationMs ?? 650;
  const horizontalDominanceRatio = thresholds.horizontalDominanceRatio ?? 1.45;

  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);
  const elapsedMs = Math.max(0, end.timeMs - start.timeMs);

  if (absDx < minDistancePx) return null;
  if (absDx < absDy * horizontalDominanceRatio) return null;
  if (elapsedMs > maxDurationMs && absDx < longDragDistancePx) return null;

  return dx < 0 ? 'left' : 'right';
}

export function getNextStepFromSwipe<T extends string>(
  currentStep: T,
  direction: SwipeDirection,
  stepOrder: readonly T[]
): T | null {
  const idx = stepOrder.indexOf(currentStep);
  if (idx === -1) return null;

  if (direction === 'left' && idx < stepOrder.length - 1) {
    return stepOrder[idx + 1];
  }
  if (direction === 'right' && idx > 0) {
    return stepOrder[idx - 1];
  }
  return null;
}

export function classifyPreviewDoubleTapZone(
  tapClientX: number,
  rectLeft: number,
  rectWidth: number
): PreviewDoubleTapAction {
  if (rectWidth <= 0) return 'toggle-play';
  const ratio = Math.max(0, Math.min(1, (tapClientX - rectLeft) / rectWidth));
  if (ratio < 0.32) return 'seek-back';
  if (ratio > 0.68) return 'seek-forward';
  return 'toggle-play';
}

export function clampVideoSeekTime(
  currentTimeSec: number,
  deltaSec: number,
  durationSec: number
): number {
  const safeDuration = Number.isFinite(durationSec) && durationSec > 0 ? durationSec : 0;
  const safeCurrent = Number.isFinite(currentTimeSec) ? currentTimeSec : 0;
  const raw = Math.max(0, safeCurrent + deltaSec);
  if (safeDuration <= 0) return raw;
  const maxTarget = Math.max(0, safeDuration - 0.05);
  return Math.min(maxTarget, raw);
}

export function computeQueueSwipeOffset(
  dx: number,
  dy: number,
  maxRevealPx = 104
): number {
  if (dx >= 0) return 0;
  if (Math.abs(dy) > Math.abs(dx) * 0.9 && Math.abs(dx) < 20) return 0;
  const raw = Math.abs(dx);
  if (raw <= maxRevealPx) return -raw;
  // Gentle rubber-band past maxRevealPx
  const extra = (raw - maxRevealPx) * 0.25;
  return -Math.min(maxRevealPx + 24, maxRevealPx + extra);
}

export function shouldTriggerQueueSwipeDelete(
  dx: number,
  dy: number,
  elapsedMs: number
): boolean {
  if (dx >= 0) return false;
  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);
  if (absDx < absDy * 1.4) return false;
  const velocity = elapsedMs > 0 ? absDx / elapsedMs : 0;
  return absDx >= 108 || (absDx >= 64 && velocity >= 0.45);
}

export function triggerSubtleHaptic(durationMs = 10): void {
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    try {
      navigator.vibrate(durationMs);
    } catch {
      // Ignore blocked vibration in restricted webviews
    }
  }
}
