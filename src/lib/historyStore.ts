import type { StudioSettings } from './batchQueue.ts';
import type {
  ContentAwareColorAnalysis,
  RenderResult,
  SubtitleSegment,
  VideoMetadata,
} from './studioPresets.ts';

export const GUEST_HISTORY_LIMIT = 2;
export const ACCOUNT_HISTORY_LIMIT = 10;
export const GUEST_HISTORY_STORAGE_KEY = 'harframe_guest_history_v1';

export interface HistoryUser {
  id: string;
  username: string;
}

export interface HistoryEntry {
  id: string;
  filename: string;
  timestamp: number;
  metadata: VideoMetadata;
  settings: StudioSettings;
  segments: SubtitleSegment[];
  visualSummary?: string | null;
  contentAwareAnalysis?: ContentAwareColorAnalysis | null;
  voiceoverUrl?: string | null;
  voiceoverDurationSec?: number | null;
  voiceoverEngine?: string | null;
  renderResult: RenderResult;
}

export function createHistoryEntry(params: {
  id?: string;
  timestamp?: number;
  metadata: VideoMetadata;
  settings: StudioSettings;
  segments: SubtitleSegment[];
  visualSummary?: string | null;
  contentAwareAnalysis?: ContentAwareColorAnalysis | null;
  voiceoverUrl?: string | null;
  voiceoverDurationSec?: number | null;
  voiceoverEngine?: string | null;
  renderResult: RenderResult;
}): HistoryEntry {
  return {
    id: params.id || `hist_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    filename: params.metadata.filename,
    timestamp: params.timestamp ?? Date.now(),
    metadata: { ...params.metadata },
    settings: {
      ...params.settings,
      customCaptionStyle: params.settings.customCaptionStyle
        ? { ...params.settings.customCaptionStyle }
        : undefined,
    },
    segments: params.segments.map((s) => ({ ...s })),
    visualSummary: params.visualSummary ?? null,
    contentAwareAnalysis: params.contentAwareAnalysis ?? null,
    voiceoverUrl: params.voiceoverUrl ?? null,
    voiceoverDurationSec: params.voiceoverDurationSec ?? null,
    voiceoverEngine: params.voiceoverEngine ?? null,
    renderResult: { ...params.renderResult },
  };
}

export function addHistoryEntryWithLimit(
  entries: HistoryEntry[],
  incoming: HistoryEntry,
  maxLimit: number
): HistoryEntry[] {
  const limit = Math.max(1, maxLimit);
  const filtered = entries.filter(
    (item) => item.id !== incoming.id && item.renderResult?.outputUrl !== incoming.renderResult?.outputUrl
  );
  return [incoming, ...filtered].slice(0, limit);
}

export function enforceHistoryLimit(entries: HistoryEntry[], maxLimit: number): HistoryEntry[] {
  return entries.slice(0, Math.max(1, maxLimit));
}

export function parseGuestHistoryJson(raw: string | null): HistoryEntry[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is HistoryEntry =>
        Boolean(item && typeof item === 'object' && item.metadata && item.settings && item.renderResult)
      )
      .slice(0, GUEST_HISTORY_LIMIT);
  } catch {
    return [];
  }
}

export function loadGuestHistory(): HistoryEntry[] {
  if (typeof window === 'undefined' || !window.localStorage) return [];
  return parseGuestHistoryJson(window.localStorage.getItem(GUEST_HISTORY_STORAGE_KEY));
}

export function saveGuestHistory(entries: HistoryEntry[]): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(
      GUEST_HISTORY_STORAGE_KEY,
      JSON.stringify(enforceHistoryLimit(entries, GUEST_HISTORY_LIMIT))
    );
  } catch {
    // Ignore storage quota errors
  }
}
