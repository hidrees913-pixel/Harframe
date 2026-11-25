import { isItemBusy, type QueueItem, type QueueItemStatus } from './batchQueue.ts';
import type { ResolutionTierId } from './studioPresets.ts';

export interface LiveRenderProgress {
  phase: 'preparing' | 'encoding' | 'completed' | 'failed';
  percent: number;
  encodedSec: number;
  totalSec: number;
  startedAtMs: number;
  updatedAtMs: number;
}

export interface ItemProgressView {
  id: string;
  title: string;
  index: number;
  status: QueueItemStatus;
  stageLabel: string;
  percent: number;
  etaSec: number | null;
  etaLabel: string;
  durationSec: number;
  width: number;
  height: number;
  resolutionTier: ResolutionTierId;
  error: string | null;
  downloadUrl?: string;
}

export interface BatchProgressSnapshot {
  totalCount: number;
  completedCount: number;
  failedCount: number;
  queuedCount: number;
  processingCount: number;
  overallPercent: number;
  totalEtaSec: number | null;
  totalEtaLabel: string;
  isComplete: boolean;
  items: ItemProgressView[];
}

export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

/**
 * Parses FFmpeg `-progress pipe:1` key=value blocks into encoded seconds (`out_time=HH:MM:SS.ffffff`).
 */
export function parseFfmpegOutTimeSec(chunk: string): number | null {
  const matches = [...chunk.matchAll(/out_time=(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/g)];
  if (matches.length === 0) return null;
  const last = matches[matches.length - 1];
  const hours = Number(last[1]);
  const minutes = Number(last[2]);
  const seconds = Number(last[3]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || !Number.isFinite(seconds)) {
    return null;
  }
  return Math.max(0, hours * 3600 + minutes * 60 + seconds);
}

/**
 * Estimates baseline render duration (seconds) for an item based on video length,
 * resolution tier, AI voiceover synthesis, and caption burn-in.
 */
export function estimateItemDurationSec(item: QueueItem): number {
  const clipSec = Math.max(2, item.metadata.durationSec || 6);
  const tierMultiplier: Record<ResolutionTierId, number> = {
    '720p': 0.75,
    '1080p': 1.15,
    '1440p': 1.85,
    '2160p': 3.1,
  };
  const mult = tierMultiplier[item.settings.resolutionTier] ?? 1.15;
  let overhead = 2.0;
  if (item.settings.useAiVoiceover !== false && !item.voiceoverUrl) {
    overhead += 2.4;
  }
  if (item.settings.captionsEnabled && item.segments.length === 0) {
    overhead += 1.5;
  }
  if (item.settings.colorGradeId === 'ai_content_aware' && !item.contentAwareAnalysis) {
    overhead += 1.2;
  }
  return Math.max(3, Math.round((clipSec * mult + overhead) * 10) / 10);
}

export function getStageLabel(status: QueueItemStatus, percent: number): string {
  switch (status) {
    case 'synthesizing':
      return 'Creating Voice';
    case 'transcribing':
      return 'Syncing Captions';
    case 'analyzing':
      return 'Analyzing Color';
    case 'rendering':
      return percent > 35 ? `Rendering ${percent}%` : 'Preparing Render';
    case 'completed':
      return 'Completed';
    case 'failed':
      return 'Failed';
    case 'queued':
    default:
      return 'Queued';
  }
}

export function computeItemProgressPercent(
  item: QueueItem,
  live?: LiveRenderProgress | null
): number {
  switch (item.status) {
    case 'completed':
      return 100;
    case 'failed':
      return live ? clampPercent(live.percent) : 0;
    case 'queued':
      return 0;
    case 'synthesizing':
      return 14;
    case 'transcribing':
      return 24;
    case 'analyzing':
      return 34;
    case 'rendering': {
      if (live && live.phase === 'encoding') {
        // Map FFmpeg 0..100% cleanly into 36..99% of overall clip pipeline
        const mapped = 36 + (clampPercent(live.percent) * 63) / 100;
        return clampPercent(Math.max(36, Math.min(99, mapped)));
      }
      if (live && live.phase === 'completed') {
        return 99;
      }
      return 36;
    }
  }
}

export function formatEtaDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) {
    return 'Estimating...';
  }
  const rounded = Math.max(0, Math.round(seconds));
  if (rounded === 0) return 'Done';
  if (rounded < 60) return `${rounded}s left`;
  const mins = Math.floor(rounded / 60);
  const secs = rounded % 60;
  if (mins < 60) {
    return secs > 0 ? `${mins}m ${secs}s left` : `${mins}m left`;
  }
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hours}h ${remMins}m left`;
}

export function computeItemEtaSec(params: {
  item: QueueItem;
  percent: number;
  live?: LiveRenderProgress | null;
  itemStartedAtMs?: number | null;
  nowMs?: number;
  speedMultiplier?: number;
}): number | null {
  const { item, percent, live, itemStartedAtMs, nowMs = Date.now(), speedMultiplier = 1 } = params;

  if (item.status === 'completed' || item.status === 'failed') {
    return 0;
  }

  const baselineSec = estimateItemDurationSec(item) * Math.max(0.35, Math.min(3.5, speedMultiplier));

  if (item.status === 'queued') {
    return Math.max(1, Math.round(baselineSec));
  }

  const startedAt = itemStartedAtMs ?? live?.startedAtMs ?? null;
  const elapsedSec = startedAt ? Math.max(0, (nowMs - startedAt) / 1000) : 0;

  // Once we have genuine forward progress and > 0.8s elapsed, blend observed throughput with heuristic
  if (percent >= 12 && elapsedSec >= 0.8) {
    const observedRemaining = (elapsedSec * (100 - percent)) / Math.max(1, percent);
    const heuristicRemaining = baselineSec * ((100 - percent) / 100);
    const liveWeight = Math.min(0.85, Math.max(0.3, (percent - 10) / 70));
    const blended = observedRemaining * liveWeight + heuristicRemaining * (1 - liveWeight);
    return Math.max(1, Math.round(blended));
  }

  return Math.max(1, Math.round(baselineSec * ((100 - percent) / 100)));
}

export function buildBatchProgressSnapshot(params: {
  queue: QueueItem[];
  liveByItemId: Record<string, LiveRenderProgress | undefined>;
  startedAtByItemId: Record<string, number | undefined>;
  completedDurationsByItemId?: Record<string, number | undefined>;
  nowMs?: number;
}): BatchProgressSnapshot {
  const {
    queue,
    liveByItemId,
    startedAtByItemId,
    completedDurationsByItemId = {},
    nowMs = Date.now(),
  } = params;

  // Derive observed throughput ratio from finished clips in this batch so subsequent ETAs self-calibrate
  let observedActualSum = 0;
  let observedEstimateSum = 0;
  for (const item of queue) {
    const actualSec = completedDurationsByItemId[item.id];
    if (item.status === 'completed' && typeof actualSec === 'number' && actualSec > 0.2) {
      observedActualSum += actualSec;
      observedEstimateSum += estimateItemDurationSec(item);
    }
  }
  const speedMultiplier =
    observedEstimateSum > 0 ? Math.max(0.4, Math.min(2.8, observedActualSum / observedEstimateSum)) : 1;

  let completedCount = 0;
  let failedCount = 0;
  let queuedCount = 0;
  let processingCount = 0;
  let weightedPercentSum = 0;
  let totalWeight = 0;
  let totalEtaSum = 0;

  const items: ItemProgressView[] = queue.map((item, idx) => {
    const live = liveByItemId[item.id];
    const percent = computeItemProgressPercent(item, live);
    const etaSec = computeItemEtaSec({
      item,
      percent,
      live,
      itemStartedAtMs: startedAtByItemId[item.id] ?? null,
      nowMs,
      speedMultiplier,
    });

    if (item.status === 'completed') completedCount++;
    else if (item.status === 'failed') failedCount++;
    else if (item.status === 'queued') queuedCount++;
    else if (isItemBusy(item.status)) processingCount++;

    const weight = Math.max(2, item.metadata.durationSec || 6);
    totalWeight += weight;
    weightedPercentSum += (item.status === 'failed' ? 100 : percent) * weight;

    if (etaSec !== null && item.status !== 'completed' && item.status !== 'failed') {
      totalEtaSum += etaSec;
    }

    return {
      id: item.id,
      title: item.title,
      index: idx + 1,
      status: item.status,
      stageLabel: getStageLabel(item.status, percent),
      percent,
      etaSec,
      etaLabel:
        item.status === 'failed'
          ? 'Failed'
          : item.status === 'completed'
            ? 'Done'
            : formatEtaDuration(etaSec),
      durationSec: item.metadata.durationSec,
      width: item.metadata.width,
      height: item.metadata.height,
      resolutionTier: item.settings.resolutionTier,
      error: item.error,
      downloadUrl: item.renderResult?.downloadUrl,
    };
  });

  const overallPercent = totalWeight > 0 ? clampPercent(weightedPercentSum / totalWeight) : 0;
  const isComplete = queue.length > 0 && queuedCount === 0 && processingCount === 0;
  const totalEtaSec = isComplete ? 0 : queue.length === 0 ? null : Math.max(1, Math.round(totalEtaSum));

  return {
    totalCount: queue.length,
    completedCount,
    failedCount,
    queuedCount,
    processingCount,
    overallPercent,
    totalEtaSec,
    totalEtaLabel: isComplete ? 'All Done' : formatEtaDuration(totalEtaSec),
    isComplete,
    items,
  };
}
