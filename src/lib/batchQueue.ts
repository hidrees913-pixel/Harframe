import {
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
} from './studioPresets.ts';

export type QueueItemStatus =
  | 'queued'
  | 'analyzing'
  | 'synthesizing'
  | 'transcribing'
  | 'rendering'
  | 'completed'
  | 'failed';

export interface StudioSettings {
  narrationPrompt?: string;
  rawGeminiOutput?: string;
  scriptText?: string;
  aiVoiceId?: AiVoiceId;
  speakingRate?: number;
  tailoredVoiceInstruction?: string;
  useAiVoiceover?: boolean;
  audioMixMode?: AudioMixMode;
  frameAspect: FrameAspectId;
  resolutionTier: ResolutionTierId;
  frameFit: FrameFitMode;
  voiceId: VoiceId;
  captionsEnabled: boolean;
  captionStyleId: CaptionStyleId;
  customCaptionStyle?: CustomCaptionStyle;
  colorGradeId: ColorGradeId;
}

export const DEFAULT_STUDIO_SETTINGS: Required<StudioSettings> = {
  narrationPrompt:
    'Write a vivid, captivating voiceover script describing what happens visually on screen with natural conversational rhythm.',
  rawGeminiOutput: '',
  scriptText: '',
  aiVoiceId: 'aria_warm',
  speakingRate: 1.0,
  tailoredVoiceInstruction: '',
  useAiVoiceover: true,
  audioMixMode: 'asmr_only',
  frameAspect: 'auto',
  resolutionTier: '1080p',
  frameFit: 'fit',
  voiceId: 'original',
  captionsEnabled: true,
  captionStyleId: 'hormozi_yellow',
  customCaptionStyle: presetToCustomCaptionStyle('hormozi_yellow'),
  colorGradeId: 'ai_content_aware',
};

export interface QueueItem {
  id: string;
  title: string;
  sourceKind: 'upload' | 'url' | 'sample';
  status: QueueItemStatus;
  metadata: VideoMetadata;
  segments: SubtitleSegment[];
  transcribeEngine: string | null;
  transcribeWarning: string | null;
  voiceoverUrl?: string | null;
  voiceoverDurationSec?: number | null;
  voiceoverEngine?: string | null;
  visualSummary?: string | null;
  contentAwareAnalysis?: ContentAwareColorAnalysis | null;
  renderResult: RenderResult | null;
  error: string | null;
  settings: StudioSettings;
  createdAt: number;
}

export interface QueueSummary {
  total: number;
  queued: number;
  processing: number;
  completed: number;
  failed: number;
  activeItemId: string | null;
}

export function isItemBusy(status: QueueItemStatus): boolean {
  return (
    status === 'analyzing' ||
    status === 'synthesizing' ||
    status === 'transcribing' ||
    status === 'rendering'
  );
}

export function createQueueItem(params: {
  id: string;
  metadata: VideoMetadata;
  settings: StudioSettings;
  segments?: SubtitleSegment[];
  transcribeEngine?: string | null;
  transcribeWarning?: string | null;
  createdAt?: number;
}): QueueItem {
  return {
    id: params.id,
    title: params.metadata.filename,
    sourceKind: params.metadata.sourceType,
    status: 'queued',
    metadata: params.metadata,
    segments: params.segments ? [...params.segments] : [],
    transcribeEngine: params.transcribeEngine ?? null,
    transcribeWarning: params.transcribeWarning ?? null,
    voiceoverUrl: null,
    voiceoverDurationSec: null,
    voiceoverEngine: null,
    visualSummary: null,
    contentAwareAnalysis: null,
    renderResult: null,
    error: null,
    settings: { ...DEFAULT_STUDIO_SETTINGS, ...params.settings },
    createdAt: params.createdAt ?? Date.now(),
  };
}

export function moveQueueItem(
  queue: QueueItem[],
  itemId: string,
  direction: 'up' | 'down'
): QueueItem[] {
  const index = queue.findIndex((item) => item.id === itemId);
  if (index === -1) return queue;
  if (isItemBusy(queue[index].status)) return queue;

  const targetIndex = direction === 'up' ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= queue.length) return queue;
  if (isItemBusy(queue[targetIndex].status)) return queue;

  const next = [...queue];
  [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
  return next;
}

export function removeQueueItem(
  queue: QueueItem[],
  itemId: string,
  activeId: string | null
): { queue: QueueItem[]; nextActiveId: string | null } {
  const target = queue.find((item) => item.id === itemId);
  if (!target || isItemBusy(target.status)) {
    return { queue, nextActiveId: activeId };
  }

  const index = queue.findIndex((item) => item.id === itemId);
  const nextQueue = queue.filter((item) => item.id !== itemId);

  if (activeId !== itemId) {
    return { queue: nextQueue, nextActiveId: activeId };
  }

  if (nextQueue.length === 0) {
    return { queue: nextQueue, nextActiveId: null };
  }

  const fallbackIdx = Math.min(index, nextQueue.length - 1);
  return { queue: nextQueue, nextActiveId: nextQueue[fallbackIdx].id };
}

export function clearFinishedQueueItems(
  queue: QueueItem[],
  activeId: string | null
): { queue: QueueItem[]; nextActiveId: string | null } {
  const nextQueue = queue.filter(
    (item) => item.status !== 'completed' && item.status !== 'failed'
  );
  const stillHasActive = activeId ? nextQueue.some((item) => item.id === activeId) : false;
  return {
    queue: nextQueue,
    nextActiveId: stillHasActive ? activeId : (nextQueue[0]?.id ?? null),
  };
}

export function getNextQueuedItem(queue: QueueItem[]): QueueItem | null {
  return queue.find((item) => item.status === 'queued') ?? null;
}

export function retryFailedQueueItems(queue: QueueItem[]): QueueItem[] {
  return queue.map((item) =>
    item.status === 'failed'
      ? { ...item, status: 'queued', error: null }
      : item
  );
}

export function applySettingsToQueuedItems(
  queue: QueueItem[],
  settings: StudioSettings
): QueueItem[] {
  return queue.map((item) =>
    item.status === 'queued' || item.status === 'failed'
      ? {
          ...item,
          settings: {
            ...item.settings,
            ...settings,
            // Preserve per-clip generated script if batch source did not overwrite it
            scriptText: settings.scriptText || item.settings.scriptText,
            rawGeminiOutput: settings.rawGeminiOutput || item.settings.rawGeminiOutput,
            tailoredVoiceInstruction:
              settings.tailoredVoiceInstruction || item.settings.tailoredVoiceInstruction,
          },
          renderResult: null,
        }
      : item
  );
}

export function summarizeQueue(queue: QueueItem[]): QueueSummary {
  let queued = 0;
  let processing = 0;
  let completed = 0;
  let failed = 0;
  let activeItemId: string | null = null;

  for (const item of queue) {
    if (item.status === 'queued') queued++;
    else if (isItemBusy(item.status)) {
      processing++;
      activeItemId = item.id;
    } else if (item.status === 'completed') completed++;
    else if (item.status === 'failed') failed++;
  }

  return {
    total: queue.length,
    queued,
    processing,
    completed,
    failed,
    activeItemId,
  };
}
