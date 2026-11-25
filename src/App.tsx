import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { TopNav, type StudioStepId } from './components/TopNav';
import { GuidedStepper } from './components/GuidedStepper';
import { IngestionPanel } from './components/IngestionPanel';
import { ComparisonPlayer } from './components/ComparisonPlayer';
import { BatchQueuePanel } from './components/BatchQueuePanel';

const ScriptStudioPanel = lazy(() =>
  import('./components/ScriptStudioPanel').then((m) => ({ default: m.ScriptStudioPanel }))
);
const VoiceoverStudioPanel = lazy(() =>
  import('./components/VoiceoverStudioPanel').then((m) => ({ default: m.VoiceoverStudioPanel }))
);
const CaptionsStepPanel = lazy(() =>
  import('./components/CaptionsStepPanel').then((m) => ({ default: m.CaptionsStepPanel }))
);
const ColorExportPanel = lazy(() =>
  import('./components/ColorExportPanel').then((m) => ({ default: m.ColorExportPanel }))
);
const HistoryPanel = lazy(() =>
  import('./components/HistoryPanel').then((m) => ({ default: m.HistoryPanel }))
);
const SubtitleEditor = lazy(() =>
  import('./components/SubtitleEditor').then((m) => ({ default: m.SubtitleEditor }))
);

function TabFallback() {
  return (
    <div className="py-10 flex items-center justify-center text-xs text-slate-400">
      Loading tools...
    </div>
  );
}
import {
  applySettingsToQueuedItems,
  clearFinishedQueueItems,
  createQueueItem,
  DEFAULT_STUDIO_SETTINGS,
  getNextQueuedItem,
  isItemBusy,
  moveQueueItem,
  removeQueueItem,
  retryFailedQueueItems,
  type QueueItem,
  type StudioSettings,
} from './lib/batchQueue';
import {
  ACCOUNT_HISTORY_LIMIT,
  addHistoryEntryWithLimit,
  createHistoryEntry,
  GUEST_HISTORY_LIMIT,
  loadGuestHistory,
  saveGuestHistory,
  type HistoryEntry,
  type HistoryUser,
} from './lib/historyStore';
import {
  estimateSpeechDurationSec,
  stripGeminiYapping,
  translatePromptForInhouseStudio,
} from './lib/scriptCleaner';
import {
  presetToCustomCaptionStyle,
  type AiVoiceId,
  type ContentAwareColorAnalysis,
  type RenderResult,
  type SubtitleSegment,
  type VideoMetadata,
} from './lib/studioPresets';
import {
  detectHorizontalSwipe,
  extractTouchTargetSnapshot,
  getNextStepFromSwipe,
  shouldIgnoreTouchTarget,
  triggerSubtleHaptic,
  type SwipeDirection,
} from './lib/touchGestures';

const STEP_ORDER: StudioStepId[] = ['video', 'voice', 'export', 'history'];

const STEP_LABELS: Record<StudioStepId, string> = {
  video: 'Video',
  voice: 'Voice',
  export: 'Export',
  history: 'History',
};

export default function App() {
  const [activeStep, setActiveStep] = useState<StudioStepId>('video');
  const [tabSwipeDir, setTabSwipeDir] = useState<SwipeDirection | null>(null);
  const tabTouchStartRef = useRef<{ x: number; y: number; timeMs: number } | null>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const queueRef = useRef<QueueItem[]>([]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void Promise.all([
        import('./components/ScriptStudioPanel'),
        import('./components/VoiceoverStudioPanel'),
        import('./components/CaptionsStepPanel'),
        import('./components/ColorExportPanel'),
        import('./components/HistoryPanel'),
        import('./components/SubtitleEditor'),
      ]).catch(() => undefined);
    }, 900);
    return () => window.clearTimeout(timer);
  }, []);

  const [activeItemId, setActiveItemIdState] = useState<string | null>(null);
  const activeItemIdRef = useRef<string | null>(null);

  const [draftSettings, setDraftSettings] = useState<StudioSettings>(DEFAULT_STUDIO_SETTINGS);

  const [historyUser, setHistoryUser] = useState<HistoryUser | null>(null);
  const historyUserRef = useRef<HistoryUser | null>(null);
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>(() => loadGuestHistory());
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  const [isIngesting, setIsIngesting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [ingestStatusText, setIngestStatusText] = useState<string | null>(null);
  const [ingestError, setIngestError] = useState<string | null>(null);

  const [isGeneratingScript, setIsGeneratingScript] = useState(false);
  const [scriptError, setScriptError] = useState<string | null>(null);
  const [cleanerReport, setCleanerReport] = useState<string | null>(null);

  const [isSynthesizingVoice, setIsSynthesizingVoice] = useState(false);
  const [voiceoverError, setVoiceoverError] = useState<string | null>(null);

  const [isAnalyzingColor, setIsAnalyzingColor] = useState(false);
  const [colorError, setColorError] = useState<string | null>(null);

  const [renderError, setRenderError] = useState<string | null>(null);

  const [isQueueRunning, setIsQueueRunning] = useState(false);
  const [stopAfterCurrent, setStopAfterCurrent] = useState(false);
  const isQueueRunningRef = useRef(false);
  const stopRequestedRef = useRef(false);
  const voiceSigByItemRef = useRef<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    const bootstrapAuthAndHistory = async () => {
      try {
        const res = await fetch('/api/auth/me', { credentials: 'same-origin' });
        if (!res.ok) return;
        const data = (await res.json()) as { user?: HistoryUser | null };
        if (cancelled) return;
        if (data.user) {
          historyUserRef.current = data.user;
          setHistoryUser(data.user);
          setIsLoadingHistory(true);
          const histRes = await fetch('/api/history', { credentials: 'same-origin' });
          if (histRes.ok && !cancelled) {
            const histData = (await histRes.json()) as { entries?: HistoryEntry[] };
            setHistoryEntries(Array.isArray(histData.entries) ? histData.entries : []);
          }
        }
      } catch {
        // Keep guest mode cleanly
      } finally {
        if (!cancelled) setIsLoadingHistory(false);
      }
    };
    void bootstrapAuthAndHistory();
    return () => {
      cancelled = true;
    };
  }, []);

  const updateQueue = (updater: (prev: QueueItem[]) => QueueItem[]): QueueItem[] => {
    const next = updater(queueRef.current);
    queueRef.current = next;
    setQueue(next);
    return next;
  };

  const setActiveItemId = (id: string | null) => {
    activeItemIdRef.current = id;
    setActiveItemIdState(id);
  };

  const activeItem =
    queue.find((item) => item.id === activeItemId) ?? queue[0] ?? null;

  const currentSettings: Required<StudioSettings> = {
    ...DEFAULT_STUDIO_SETTINGS,
    ...(activeItem ? activeItem.settings : draftSettings),
    customCaptionStyle:
      (activeItem ? activeItem.settings.customCaptionStyle : draftSettings.customCaptionStyle) ??
      presetToCustomCaptionStyle(
        (activeItem ? activeItem.settings.captionStyleId : draftSettings.captionStyleId) ??
          DEFAULT_STUDIO_SETTINGS.captionStyleId
      ),
  };

  const metadata = activeItem?.metadata ?? null;
  const segments = activeItem?.segments ?? [];
  const renderResult = activeItem?.renderResult ?? null;
  const transcribeEngine = activeItem?.transcribeEngine ?? null;
  const transcribeWarning = activeItem?.transcribeWarning ?? null;
  const isTranscribing = activeItem?.status === 'transcribing';
  const isRendering = activeItem?.status === 'rendering';
  const displayedRenderError = activeItem?.error || renderError;

  const parseApiResponse = async <T,>(res: Response, fallbackMsg: string): Promise<T> => {
    const text = await res.text();
    let data: Record<string, unknown> = {};
    if (text) {
      try {
        data = JSON.parse(text) as Record<string, unknown>;
      } catch {
        if (!res.ok) {
          throw new Error(`${fallbackMsg} (HTTP ${res.status})`);
        }
        throw new Error(`Unexpected response from server (HTTP ${res.status}).`);
      }
    }
    if (!res.ok) {
      throw new Error(
        typeof data.error === 'string' ? data.error : `${fallbackMsg} (HTTP ${res.status})`
      );
    }
    return data as T;
  };

  const patchActiveSettings = (partial: Partial<StudioSettings>) => {
    setDraftSettings((prev) => ({ ...prev, ...partial }));
    setRenderError(null);
    if (!activeItem) return;
    if (isItemBusy(activeItem.status)) return;

    const targetId = activeItem.id;
    updateQueue((prev) =>
      prev.map((item) => {
        if (item.id !== targetId) return item;
        return {
          ...item,
          settings: { ...item.settings, ...partial },
          renderResult: null,
          error: null,
          status:
            item.status === 'completed' || item.status === 'failed'
              ? 'queued'
              : item.status,
        };
      })
    );
  };

  const handleSelectStep = (
    step: StudioStepId,
    options?: { skipMobileScroll?: boolean; swipeDir?: SwipeDirection | null }
  ) => {
    setTabSwipeDir(options?.swipeDir ?? null);
    setActiveStep(step);
    const el = document.getElementById('workflow-stepper');
    if (el && !options?.skipMobileScroll && window.innerWidth < 1024) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const handleWorkspaceTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length !== 1) {
      tabTouchStartRef.current = null;
      return;
    }
    const targetSnapshot = extractTouchTargetSnapshot(e.target);
    if (shouldIgnoreTouchTarget(targetSnapshot, { allowButtons: true })) {
      tabTouchStartRef.current = null;
      return;
    }
    const t = e.touches[0];
    tabTouchStartRef.current = { x: t.clientX, y: t.clientY, timeMs: Date.now() };
  };

  const handleWorkspaceTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    const start = tabTouchStartRef.current;
    tabTouchStartRef.current = null;
    if (!start || e.changedTouches.length === 0) return;

    const t = e.changedTouches[0];
    const dir = detectHorizontalSwipe(start, {
      x: t.clientX,
      y: t.clientY,
      timeMs: Date.now(),
    });
    if (!dir) return;

    const nextStep = getNextStepFromSwipe(activeStep, dir, STEP_ORDER);
    if (nextStep) {
      triggerSubtleHaptic(10);
      handleSelectStep(nextStep, { skipMobileScroll: true, swipeDir: dir });
    }
  };

  const runTranscribeForJob = async (
    itemId: string,
    jobId: string,
    force = false,
    source: 'auto' | 'voiceover' | 'source' = 'auto'
  ) => {
    updateQueue((prev) =>
      prev.map((item) =>
        item.id === itemId && !isItemBusy(item.status)
          ? {
              ...item,
              status: 'transcribing',
              transcribeWarning: null,
              error: null,
            }
          : item
      )
    );

    try {
      const res = await fetch('/api/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId, force, source }),
      });
      const data = await parseApiResponse<{
        segments?: SubtitleSegment[];
        engine?: string;
        warning?: string;
      }>(res, 'Caption sync failed');

      const nextSegments = data.segments || [];
      const engine = data.engine || 'asr';
      const warning =
        data.warning ||
        (data.engine === 'silent-source'
          ? 'Video has no audio track and no voiceover yet.'
          : null);

      updateQueue((prev) =>
        prev.map((item) =>
          item.id === itemId
            ? {
                ...item,
                status: item.status === 'transcribing' ? 'queued' : item.status,
                segments: nextSegments,
                transcribeEngine: engine,
                transcribeWarning: warning,
                renderResult: force ? null : item.renderResult,
              }
            : item
        )
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Caption sync failed.';
      updateQueue((prev) =>
        prev.map((item) =>
          item.id === itemId
            ? {
                ...item,
                status: item.status === 'transcribing' ? 'queued' : item.status,
                transcribeWarning: msg,
              }
            : item
        )
      );
      if (activeItemIdRef.current === itemId) {
        setRenderError(msg);
      }
    }
  };

  const uploadSingleFileToServer = async (
    file: File,
    fileIdx: number,
    totalFiles: number
  ): Promise<VideoMetadata> => {
    const CHUNK_THRESHOLD_BYTES = 8 * 1024 * 1024;
    const prefix =
      totalFiles > 1 ? `Uploading ${fileIdx + 1}/${totalFiles}: ${file.name}` : 'Uploading video';

    if (file.size <= CHUNK_THRESHOLD_BYTES) {
      setIngestStatusText(`${prefix}...`);
      const formData = new FormData();
      formData.append('video', file);
      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });
      setUploadProgress(100);
      const data = await parseApiResponse<{ metadata: VideoMetadata }>(res, 'Upload failed.');
      return data.metadata;
    }

    setIngestStatusText(`${prefix} (0%)...`);
    const initRes = await fetch('/api/upload/init', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename: file.name,
        fileSize: file.size,
        mimeType: file.type,
      }),
    });
    const initData = await parseApiResponse<{ uploadId: string; chunkSize: number }>(
      initRes,
      'Could not start video upload.'
    );

    const chunkSize = initData.chunkSize || 4 * 1024 * 1024;
    let offset = 0;
    while (offset < file.size) {
      const slice = file.slice(offset, offset + chunkSize);
      const chunkRes = await fetch(`/api/upload/chunk/${initData.uploadId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: slice,
      });
      await parseApiResponse<{ receivedBytes: number }>(chunkRes, 'Video chunk upload failed.');
      offset += slice.size;
      const pct = Math.min(99, Math.round((offset / file.size) * 100));
      setUploadProgress(pct);
      setIngestStatusText(`${prefix} (${pct}%)...`);
    }

    setIngestStatusText(
      totalFiles > 1 ? `Loading ${fileIdx + 1}/${totalFiles}: ${file.name}...` : 'Loading clip...'
    );
    const completeRes = await fetch(`/api/upload/complete/${initData.uploadId}`, {
      method: 'POST',
    });
    setUploadProgress(100);
    const data = await parseApiResponse<{ metadata: VideoMetadata }>(
      completeRes,
      'Failed to finalize uploaded video.'
    );
    return data.metadata;
  };

  const handleUploadFiles = async (files: File[]) => {
    if (files.length === 0) return;
    setIsIngesting(true);
    setUploadProgress(0);
    setIngestStatusText(null);
    setIngestError(null);
    setRenderError(null);

    const addedItems: QueueItem[] = [];
    const failedMessages: string[] = [];
    const inheritedSettings = { ...draftSettings };

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setUploadProgress(0);
        try {
          const uploadedMeta = await uploadSingleFileToServer(file, i, files.length);
          const queueItem = createQueueItem({
            id: uploadedMeta.jobId,
            metadata: uploadedMeta,
            settings: inheritedSettings,
          });
          addedItems.push(queueItem);
          updateQueue((prev) => [...prev, queueItem]);

          if (!activeItemIdRef.current) {
            setActiveItemId(queueItem.id);
          }
        } catch (err) {
          const reason = err instanceof Error ? err.message : 'Upload failed.';
          failedMessages.push(`${file.name}: ${reason}`);
        }
      }

      if (failedMessages.length > 0) {
        setIngestError(failedMessages.join(' | '));
      }

      if (
        addedItems.length > 0 &&
        !isQueueRunningRef.current &&
        activeItemIdRef.current === addedItems[0].id &&
        addedItems[0].settings.captionsEnabled &&
        addedItems[0].metadata.hasAudio
      ) {
        await runTranscribeForJob(addedItems[0].id, addedItems[0].metadata.jobId);
      }
    } finally {
      setIsIngesting(false);
      setUploadProgress(null);
      setIngestStatusText(null);
    }
  };

  const handleIngestUrls = async (urls: string[]) => {
    if (urls.length === 0) return;
    setIsIngesting(true);
    setIngestError(null);
    setIngestStatusText(null);
    setRenderError(null);

    const addedItems: QueueItem[] = [];
    const failedMessages: string[] = [];
    const inheritedSettings = { ...draftSettings };

    try {
      for (let i = 0; i < urls.length; i++) {
        const targetUrl = urls[i];
        setIngestStatusText(
          urls.length > 1 ? `Loading ${i + 1}/${urls.length}...` : 'Loading video...'
        );
        try {
          const res = await fetch('/api/ingest-url', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: targetUrl }),
          });
          const data = await parseApiResponse<{ metadata: VideoMetadata }>(
            res,
            'Could not load video link.'
          );
          const queueItem = createQueueItem({
            id: data.metadata.jobId,
            metadata: data.metadata,
            settings: inheritedSettings,
          });
          addedItems.push(queueItem);
          updateQueue((prev) => [...prev, queueItem]);

          if (!activeItemIdRef.current) {
            setActiveItemId(queueItem.id);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Failed to load video link.';
          failedMessages.push(urls.length > 1 ? `${targetUrl}: ${msg}` : msg);
        }
      }

      if (failedMessages.length > 0) {
        setIngestError(failedMessages.join(' | '));
      }

      if (
        addedItems.length > 0 &&
        !isQueueRunningRef.current &&
        activeItemIdRef.current === addedItems[0].id &&
        addedItems[0].settings.captionsEnabled &&
        addedItems[0].metadata.hasAudio
      ) {
        await runTranscribeForJob(addedItems[0].id, addedItems[0].metadata.jobId);
      }
    } finally {
      setIsIngesting(false);
      setIngestStatusText(null);
    }
  };

  const handleLoadSample = async (orientation: 'landscape' | 'portrait' = 'landscape') => {
    setIsIngesting(true);
    setIngestError(null);
    setIngestStatusText('Loading sample...');
    setRenderError(null);
    try {
      const res = await fetch('/api/sample', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orientation }),
      });
      const data = await parseApiResponse<{ metadata: VideoMetadata; segments?: SubtitleSegment[] }>(
        res,
        'Failed to load sample clip.'
      );
      const queueItem = createQueueItem({
        id: data.metadata.jobId,
        metadata: data.metadata,
        segments: data.segments || [],
        transcribeEngine: 'sample-dialogue',
        transcribeWarning: null,
        settings: draftSettings,
      });
      updateQueue((prev) => [...prev, queueItem]);
      if (!isQueueRunningRef.current) {
        setActiveItemId(queueItem.id);
      }
    } catch (err) {
      setIngestError(err instanceof Error ? err.message : 'Failed to load sample clip.');
    } finally {
      setIsIngesting(false);
      setIngestStatusText(null);
    }
  };

  const handleGenerateScriptFromVideo = async () => {
    if (!activeItem || isItemBusy(activeItem.status)) return;
    setIsGeneratingScript(true);
    setScriptError(null);
    setCleanerReport(null);

    try {
      const res = await fetch('/api/script/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId: activeItem.metadata.jobId,
          prompt: currentSettings.narrationPrompt,
        }),
      });
      const data = await parseApiResponse<{
        cleanScript: string;
        wordCount: number;
        estimatedDurationSec: number;
        visualSummary?: string;
        voiceTranslation?: {
          hadVoiceModelInstructions?: boolean;
          ignoredDirectives?: string[];
          suggestedVoiceId?: AiVoiceId | null;
          suggestedVoiceName?: string | null;
          suggestedRate?: number | null;
          inhouseDeliveryInstruction?: string | null;
        };
      }>(res, 'Could not write script.');

      const vt = data.voiceTranslation;
      const tunedPatch: Partial<StudioSettings> = {
        scriptText: data.cleanScript,
        tailoredVoiceInstruction: vt?.inhouseDeliveryInstruction || '',
      };
      if (vt?.suggestedVoiceId) {
        tunedPatch.aiVoiceId = vt.suggestedVoiceId;
      }
      if (typeof vt?.suggestedRate === 'number') {
        tunedPatch.speakingRate = vt.suggestedRate;
      }

      const targetId = activeItem.id;
      updateQueue((prev) =>
        prev.map((q) =>
          q.id === targetId
            ? {
                ...q,
                visualSummary: data.visualSummary || q.visualSummary,
                settings: { ...q.settings, ...tunedPatch },
                renderResult: null,
              }
            : q
        )
      );
      setDraftSettings((prev) => ({ ...prev, ...tunedPatch }));
    } catch (err) {
      setScriptError(err instanceof Error ? err.message : 'Script generation failed.');
    } finally {
      setIsGeneratingScript(false);
    }
  };

  const handleCleanScriptOutput = async () => {
    setScriptError(null);
    const raw = currentSettings.rawGeminiOutput || '';
    if (!raw.trim()) return;

    const cleaned = stripGeminiYapping(raw);
    const translatedPrompt = translatePromptForInhouseStudio(currentSettings.narrationPrompt);
    const effectiveRate = translatedPrompt.suggestedRate ?? currentSettings.speakingRate;
    const { wordCount, estimatedSec } = estimateSpeechDurationSec(
      cleaned.cleanScript,
      effectiveRate
    );

    const nextPatch: Partial<StudioSettings> = {
      scriptText: cleaned.cleanScript,
      tailoredVoiceInstruction: translatedPrompt.inhouseDeliveryInstruction || '',
    };
    if (translatedPrompt.suggestedVoiceId) {
      nextPatch.aiVoiceId = translatedPrompt.suggestedVoiceId;
    }
    if (translatedPrompt.suggestedRate) {
      nextPatch.speakingRate = translatedPrompt.suggestedRate;
    }
    patchActiveSettings(nextPatch);

    if (cleaned.removedLinesCount > 0 || cleaned.removedTags.length > 0) {
      setCleanerReport(
        `Cleaned ${cleaned.removedLinesCount} extra lines · ${wordCount} words (~${estimatedSec}s)`
      );
    } else {
      setCleanerReport(`Ready · ${wordCount} words (~${estimatedSec}s)`);
    }
  };

  const handleGenerateVoiceover = async () => {
    if (!activeItem || isItemBusy(activeItem.status)) return;
    setIsSynthesizingVoice(true);
    setVoiceoverError(null);
    const targetId = activeItem.id;
    const jobId = activeItem.metadata.jobId;
    const effectiveTailored =
      currentSettings.tailoredVoiceInstruction ||
      translatePromptForInhouseStudio(currentSettings.narrationPrompt).inhouseDeliveryInstruction ||
      '';

    try {
      const res = await fetch('/api/voiceover/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId,
          aiVoiceId: currentSettings.aiVoiceId,
          script: currentSettings.scriptText,
          speakingRate: currentSettings.speakingRate,
          tailoredInstruction: effectiveTailored,
        }),
      });
      const data = await parseApiResponse<{
        voiceoverUrl: string;
        durationSec: number;
        engine: string;
        cleanScript: string;
      }>(res, 'Could not create voiceover.');

      const sig = `${currentSettings.aiVoiceId}|${currentSettings.speakingRate.toFixed(2)}|${data.cleanScript}`;
      voiceSigByItemRef.current[targetId] = sig;

      updateQueue((prev) =>
        prev.map((q) =>
          q.id === targetId
            ? {
                ...q,
                voiceoverUrl: data.voiceoverUrl,
                voiceoverDurationSec: data.durationSec,
                voiceoverEngine: data.engine,
                settings: { ...q.settings, scriptText: data.cleanScript, useAiVoiceover: true },
                renderResult: null,
              }
            : q
        )
      );

      if (currentSettings.captionsEnabled) {
        await runTranscribeForJob(targetId, jobId, true, 'voiceover');
      }
    } catch (err) {
      setVoiceoverError(err instanceof Error ? err.message : 'Failed to create voiceover.');
    } finally {
      setIsSynthesizingVoice(false);
    }
  };

  const handleAnalyzeContentAwareColor = async () => {
    if (!activeItem || isItemBusy(activeItem.status)) return;
    setIsAnalyzingColor(true);
    setColorError(null);
    const targetId = activeItem.id;

    try {
      const res = await fetch('/api/color/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: activeItem.metadata.jobId, force: true }),
      });
      const data = await parseApiResponse<{ analysis: ContentAwareColorAnalysis }>(
        res,
        'Auto color check failed.'
      );

      updateQueue((prev) =>
        prev.map((q) =>
          q.id === targetId
            ? {
                ...q,
                contentAwareAnalysis: data.analysis,
                settings: { ...q.settings, colorGradeId: 'ai_content_aware' },
                renderResult: null,
              }
            : q
        )
      );
      setDraftSettings((prev) => ({ ...prev, colorGradeId: 'ai_content_aware' }));
    } catch (err) {
      setColorError(err instanceof Error ? err.message : 'Auto color check failed.');
    } finally {
      setIsAnalyzingColor(false);
    }
  };

  const processSingleQueueItem = async (itemId: string) => {
    const latestItem = queueRef.current.find((q) => q.id === itemId);
    if (!latestItem) return;

    const { metadata: itemMeta } = latestItem;
    const itemSettings: Required<StudioSettings> = {
      ...DEFAULT_STUDIO_SETTINGS,
      ...latestItem.settings,
    };
    let activeSegments = latestItem.segments;
    let activeColorAnalysis = latestItem.contentAwareAnalysis ?? undefined;
    let currentVoiceoverUrl = latestItem.voiceoverUrl ?? null;

    const saveRenderedToHistory = async (
      renderedItem: QueueItem,
      result: RenderResult,
      resolvedSegments: SubtitleSegment[],
      resolvedColor: ContentAwareColorAnalysis | undefined,
      resolvedVoiceoverUrl: string | null
    ) => {
      const entry = createHistoryEntry({
        metadata: renderedItem.metadata,
        settings: { ...DEFAULT_STUDIO_SETTINGS, ...renderedItem.settings },
        segments: resolvedSegments,
        visualSummary: renderedItem.visualSummary,
        contentAwareAnalysis: resolvedColor ?? result.contentAwareStats ?? null,
        voiceoverUrl: resolvedVoiceoverUrl,
        voiceoverDurationSec: renderedItem.voiceoverDurationSec ?? null,
        voiceoverEngine: renderedItem.voiceoverEngine ?? null,
        renderResult: result,
      });

      if (historyUserRef.current) {
        try {
          const histRes = await fetch('/api/history', {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
              'Content-Type': 'application/json',
              'X-Requested-With': 'HarFrame',
            },
            body: JSON.stringify({ entry }),
          });
          if (histRes.ok) {
            const histData = (await histRes.json()) as { entries?: HistoryEntry[] };
            if (Array.isArray(histData.entries)) {
              setHistoryEntries(histData.entries);
              return;
            }
          }
        } catch {
          // Fallback local state update below
        }
        setHistoryEntries((prev) => addHistoryEntryWithLimit(prev, entry, ACCOUNT_HISTORY_LIMIT));
      } else {
        setHistoryEntries((prev) => {
          const next = addHistoryEntryWithLimit(prev, entry, GUEST_HISTORY_LIMIT);
          saveGuestHistory(next);
          return next;
        });
      }
    };

    try {
      setRenderError(null);

      const effectiveScriptForVoice =
        itemSettings.scriptText.trim() ||
        activeSegments
          .map((s) => s.text)
          .join(' ')
          .trim();
      const desiredVoiceSig = `${itemSettings.aiVoiceId}|${itemSettings.speakingRate.toFixed(2)}|${effectiveScriptForVoice}`;
      const needsVoiceSynthesis =
        itemSettings.useAiVoiceover !== false &&
        effectiveScriptForVoice.length > 0 &&
        (!currentVoiceoverUrl || voiceSigByItemRef.current[itemId] !== desiredVoiceSig);

      if (needsVoiceSynthesis) {
        updateQueue((prev) =>
          prev.map((q) =>
            q.id === itemId ? { ...q, status: 'synthesizing', error: null } : q
          )
        );
        const voRes = await fetch('/api/voiceover/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jobId: itemMeta.jobId,
            aiVoiceId: itemSettings.aiVoiceId,
            script: effectiveScriptForVoice,
            speakingRate: itemSettings.speakingRate,
            tailoredInstruction:
              itemSettings.tailoredVoiceInstruction ||
              translatePromptForInhouseStudio(itemSettings.narrationPrompt)
                .inhouseDeliveryInstruction ||
              '',
          }),
        });
        if (voRes.ok) {
          const voData = await parseApiResponse<{
            voiceoverUrl: string;
            durationSec: number;
            engine: string;
          }>(voRes, 'Voice creation failed');
          currentVoiceoverUrl = voData.voiceoverUrl;
          voiceSigByItemRef.current[itemId] = desiredVoiceSig;
          updateQueue((prev) =>
            prev.map((q) =>
              q.id === itemId
                ? {
                    ...q,
                    voiceoverUrl: voData.voiceoverUrl,
                    voiceoverDurationSec: voData.durationSec,
                    voiceoverEngine: voData.engine,
                  }
                : q
            )
          );
        }
      }

      if (
        itemSettings.captionsEnabled &&
        (activeSegments.length === 0 || (currentVoiceoverUrl && latestItem.transcribeEngine !== 'voiceover-script-sync')) &&
        (itemMeta.hasAudio || Boolean(currentVoiceoverUrl))
      ) {
        updateQueue((prev) =>
          prev.map((q) =>
            q.id === itemId
              ? { ...q, status: 'transcribing', transcribeWarning: null, error: null }
              : q
          )
        );
        const transRes = await fetch('/api/transcribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jobId: itemMeta.jobId,
            force: Boolean(currentVoiceoverUrl),
            source: currentVoiceoverUrl ? 'voiceover' : 'auto',
          }),
        });
        if (transRes.ok) {
          const transData = await parseApiResponse<{
            segments?: SubtitleSegment[];
            engine?: string;
            warning?: string;
          }>(transRes, 'Caption sync failed');
          if (Array.isArray(transData.segments)) {
            activeSegments = transData.segments;
            updateQueue((prev) =>
              prev.map((q) =>
                q.id === itemId
                  ? {
                      ...q,
                      segments: activeSegments,
                      transcribeEngine: transData.engine || 'asr',
                      transcribeWarning: transData.warning || null,
                    }
                  : q
              )
            );
          }
        }
      }

      if (itemSettings.colorGradeId === 'ai_content_aware' && !activeColorAnalysis) {
        updateQueue((prev) =>
          prev.map((q) => (q.id === itemId ? { ...q, status: 'analyzing', error: null } : q))
        );
        const colorRes = await fetch('/api/color/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jobId: itemMeta.jobId }),
        });
        if (colorRes.ok) {
          const cData = await parseApiResponse<{ analysis: ContentAwareColorAnalysis }>(
            colorRes,
            'Auto color check failed'
          );
          activeColorAnalysis = cData.analysis;
          updateQueue((prev) =>
            prev.map((q) =>
              q.id === itemId ? { ...q, contentAwareAnalysis: activeColorAnalysis } : q
            )
          );
        }
      }

      updateQueue((prev) =>
        prev.map((q) => (q.id === itemId ? { ...q, status: 'rendering', error: null } : q))
      );

      const res = await fetch('/api/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId: itemMeta.jobId,
          voiceId: itemSettings.voiceId,
          aiVoiceId: itemSettings.aiVoiceId,
          useAiVoiceover: itemSettings.useAiVoiceover,
          script: effectiveScriptForVoice,
          speakingRate: itemSettings.speakingRate,
          tailoredInstruction:
            itemSettings.tailoredVoiceInstruction ||
            translatePromptForInhouseStudio(itemSettings.narrationPrompt)
              .inhouseDeliveryInstruction ||
            '',
          audioMixMode: itemSettings.audioMixMode,
          frameAspect: itemSettings.frameAspect,
          resolutionTier: itemSettings.resolutionTier,
          frameFit: itemSettings.frameFit,
          colorGradeId: itemSettings.colorGradeId,
          contentAwareAnalysis: activeColorAnalysis,
          captionsEnabled: itemSettings.captionsEnabled,
          captionStyleId: itemSettings.captionStyleId,
          customCaptionStyle: itemSettings.customCaptionStyle,
          segments: activeSegments,
        }),
      });

      const data = await parseApiResponse<{ result: RenderResult }>(
        res,
        `${itemSettings.resolutionTier === '2160p' ? '4K' : itemSettings.resolutionTier} export failed.`
      );

      const updatedList = updateQueue((prev) =>
        prev.map((q) =>
          q.id === itemId
            ? {
                ...q,
                status: 'completed',
                renderResult: data.result,
                contentAwareAnalysis: data.result.contentAwareStats ?? q.contentAwareAnalysis,
                error: null,
              }
            : q
        )
      );
      const completedItem = updatedList.find((q) => q.id === itemId) ?? latestItem;
      await saveRenderedToHistory(
        completedItem,
        data.result,
        activeSegments,
        activeColorAnalysis,
        currentVoiceoverUrl
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Export failed.';
      updateQueue((prev) =>
        prev.map((q) =>
          q.id === itemId ? { ...q, status: 'failed', error: msg } : q
        )
      );
      if (activeItemIdRef.current === itemId) {
        setRenderError(msg);
      }
    }
  };

  const handleRenderActive = async () => {
    if (!activeItem || isItemBusy(activeItem.status)) return;
    await processSingleQueueItem(activeItem.id);
  };

  const handleStartQueue = async () => {
    if (isQueueRunningRef.current) return;
    isQueueRunningRef.current = true;
    stopRequestedRef.current = false;
    setIsQueueRunning(true);
    setStopAfterCurrent(false);

    try {
      while (!stopRequestedRef.current) {
        const nextItem = getNextQueuedItem(queueRef.current);
        if (!nextItem) break;
        setActiveItemId(nextItem.id);
        await processSingleQueueItem(nextItem.id);
      }
    } finally {
      isQueueRunningRef.current = false;
      stopRequestedRef.current = false;
      setIsQueueRunning(false);
      setStopAfterCurrent(false);
    }
  };

  const handleStopQueue = () => {
    if (!isQueueRunningRef.current) return;
    stopRequestedRef.current = true;
    setStopAfterCurrent(true);
  };

  const handleSelectItem = (itemId: string) => {
    setRenderError(null);
    setScriptError(null);
    setVoiceoverError(null);
    setColorError(null);
    setActiveItemId(itemId);
    const chosen = queueRef.current.find((item) => item.id === itemId);
    if (chosen) {
      setDraftSettings({ ...DEFAULT_STUDIO_SETTINGS, ...chosen.settings });
    }
  };

  const handleMoveItem = (itemId: string, direction: 'up' | 'down') => {
    updateQueue((prev) => moveQueueItem(prev, itemId, direction));
  };

  const handleRemoveItem = (itemId: string) => {
    const target = queueRef.current.find((item) => item.id === itemId);
    if (!target || isItemBusy(target.status)) return;

    const { queue: nextQueue, nextActiveId } = removeQueueItem(
      queueRef.current,
      itemId,
      activeItemIdRef.current
    );
    queueRef.current = nextQueue;
    setQueue(nextQueue);
    setActiveItemId(nextActiveId);

    void fetch(`/api/jobs/${encodeURIComponent(target.metadata.jobId)}`, {
      method: 'DELETE',
    }).catch(() => undefined);
  };

  const handleRetryFailed = () => {
    updateQueue((prev) => retryFailedQueueItems(prev));
  };

  const handleClearFinished = () => {
    const finishedItems = queueRef.current.filter(
      (item) => item.status === 'completed' || item.status === 'failed'
    );
    const { queue: nextQueue, nextActiveId } = clearFinishedQueueItems(
      queueRef.current,
      activeItemIdRef.current
    );
    queueRef.current = nextQueue;
    setQueue(nextQueue);
    setActiveItemId(nextActiveId);

    for (const item of finishedItems) {
      void fetch(`/api/jobs/${encodeURIComponent(item.metadata.jobId)}`, {
        method: 'DELETE',
      }).catch(() => undefined);
    }
  };

  const handleApplyCurrentSettingsToQueued = () => {
    updateQueue((prev) => applySettingsToQueuedItems(prev, currentSettings));
  };

  const handleAuthRegister = async (username: string, password: string) => {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await parseApiResponse<{ user: HistoryUser }>(
      res,
      'Could not create account.'
    );
    historyUserRef.current = data.user;
    setHistoryUser(data.user);

    // Migrate guest entries into new account seamlessly
    const guestEntries = loadGuestHistory();
    if (guestEntries.length > 0) {
      for (let i = guestEntries.length - 1; i >= 0; i--) {
        await fetch('/api/history', {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'HarFrame',
          },
          body: JSON.stringify({ entry: guestEntries[i] }),
        }).catch(() => {});
      }
    }

    const histRes = await fetch('/api/history', { credentials: 'same-origin' });
    if (histRes.ok) {
      const histData = (await histRes.json()) as { entries?: HistoryEntry[] };
      setHistoryEntries(Array.isArray(histData.entries) ? histData.entries : []);
    }
  };

  const handleAuthLogin = async (username: string, password: string) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await parseApiResponse<{ user: HistoryUser }>(res, 'Sign in failed.');
    historyUserRef.current = data.user;
    setHistoryUser(data.user);

    setIsLoadingHistory(true);
    try {
      const histRes = await fetch('/api/history', { credentials: 'same-origin' });
      if (histRes.ok) {
        const histData = (await histRes.json()) as { entries?: HistoryEntry[] };
        setHistoryEntries(Array.isArray(histData.entries) ? histData.entries : []);
      }
    } finally {
      setIsLoadingHistory(false);
    }
  };

  const handleAuthLogout = async () => {
    await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'X-Requested-With': 'HarFrame' },
    }).catch(() => {});
    historyUserRef.current = null;
    setHistoryUser(null);
    setHistoryEntries(loadGuestHistory());
  };

  const handleDeleteHistoryEntry = async (entryId: string) => {
    if (historyUserRef.current) {
      const res = await fetch(`/api/history/${encodeURIComponent(entryId)}`, {
        method: 'DELETE',
        credentials: 'same-origin',
        headers: { 'X-Requested-With': 'HarFrame' },
      });
      if (res.ok) {
        const data = (await res.json()) as { entries?: HistoryEntry[] };
        if (Array.isArray(data.entries)) {
          setHistoryEntries(data.entries);
          return;
        }
      }
    } else {
      setHistoryEntries((prev) => {
        const next = prev.filter((item) => item.id !== entryId);
        saveGuestHistory(next);
        return next;
      });
    }
  };

  const handleReloadHistoryEntry = async (entry: HistoryEntry) => {
    setRenderError(null);
    setIngestError(null);
    setScriptError(null);
    setVoiceoverError(null);
    setColorError(null);

    try {
      await fetch('/api/jobs/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          metadata: entry.metadata,
          segments: entry.segments,
          visualSummary: entry.visualSummary,
          contentAwareAnalysis: entry.contentAwareAnalysis,
          voiceoverUrl: entry.voiceoverUrl,
          voiceoverDurationSec: entry.voiceoverDurationSec,
          voiceoverEngine: entry.voiceoverEngine,
        }),
      }).catch(() => {});
    } catch {
      // Non-fatal; workspace metadata & settings still load cleanly
    }

    const mergedSettings: Required<StudioSettings> = {
      ...DEFAULT_STUDIO_SETTINGS,
      ...entry.settings,
      customCaptionStyle:
        entry.settings.customCaptionStyle ??
        presetToCustomCaptionStyle(entry.settings.captionStyleId),
    };

    const existing = queueRef.current.find((q) => q.metadata.jobId === entry.metadata.jobId);
    if (existing) {
      updateQueue((prev) =>
        prev.map((q) =>
          q.id === existing.id
            ? {
                ...q,
                metadata: entry.metadata,
                settings: mergedSettings,
                segments: entry.segments.map((s) => ({ ...s })),
                visualSummary: entry.visualSummary ?? null,
                contentAwareAnalysis: entry.contentAwareAnalysis ?? null,
                voiceoverUrl: entry.voiceoverUrl ?? null,
                voiceoverDurationSec: entry.voiceoverDurationSec ?? null,
                voiceoverEngine: entry.voiceoverEngine ?? null,
                renderResult: entry.renderResult ?? null,
                status: entry.renderResult ? 'completed' : 'queued',
                error: null,
              }
            : q
        )
      );
      setActiveItemId(existing.id);
    } else {
      const restoredItem: QueueItem = {
        ...createQueueItem({
          id: entry.metadata.jobId,
          metadata: entry.metadata,
          settings: mergedSettings,
          segments: entry.segments,
          transcribeEngine: 'history-restored',
        }),
        visualSummary: entry.visualSummary ?? null,
        contentAwareAnalysis: entry.contentAwareAnalysis ?? null,
        voiceoverUrl: entry.voiceoverUrl ?? null,
        voiceoverDurationSec: entry.voiceoverDurationSec ?? null,
        voiceoverEngine: entry.voiceoverEngine ?? null,
        renderResult: entry.renderResult ?? null,
        status: entry.renderResult ? 'completed' : 'queued',
      };
      updateQueue((prev) => [restoredItem, ...prev]);
      setActiveItemId(restoredItem.id);
    }

    setDraftSettings(mergedSettings);
    setActiveStep('video');
  };

  const handleResetAndRefresh = () => {
    for (const item of queueRef.current) {
      void fetch(`/api/jobs/${encodeURIComponent(item.metadata.jobId)}`, {
        method: 'DELETE',
        keepalive: true,
      }).catch(() => undefined);
    }
    queueRef.current = [];
    setQueue([]);
    setActiveItemId(null);
    setDraftSettings(DEFAULT_STUDIO_SETTINGS);
    setActiveStep('video');
    window.location.assign(window.location.pathname || '/');
  };

  const resolutionBadgeLabel =
    currentSettings.resolutionTier === '2160p' ? '4K' : currentSettings.resolutionTier;

  const stepIndex = STEP_ORDER.indexOf(activeStep);
  const completedSteps = {
    video: Boolean(metadata),
    voice: Boolean(activeItem?.voiceoverUrl) || !currentSettings.useAiVoiceover,
    export: Boolean(renderResult),
    history: false,
  };

  return (
    <div id="studio" className="min-h-screen flex flex-col bg-[#F8F9FC] text-slate-900">
      <TopNav
        activeStep={activeStep}
        onSelectStep={handleSelectStep}
        hasSource={Boolean(metadata)}
        isRendering={isRendering}
        hasOutput={Boolean(renderResult)}
        downloadUrl={renderResult?.downloadUrl}
        resolutionLabel={resolutionBadgeLabel}
        onRenderClick={handleRenderActive}
        onResetAndRefresh={handleResetAndRefresh}
      />

      <main className="flex-1 max-w-[1440px] w-full mx-auto px-3 sm:px-6 py-3 sm:py-5">
        <div className="grid grid-cols-1 lg:grid-cols-[380px_minmax(0,1fr)] xl:grid-cols-[440px_minmax(0,1fr)] gap-3.5 sm:gap-5 items-start">
          {/* Left Pane: Single Preview Player & Video Queue (bounded height on laptops) */}
          <div className="space-y-3.5 sm:space-y-4 min-w-0 lg:sticky lg:top-20 lg:max-h-[calc(100dvh-5.5rem)] lg:overflow-y-auto no-scrollbar">
            <ComparisonPlayer
              metadata={metadata}
              renderResult={renderResult}
              isRendering={isRendering}
              renderError={displayedRenderError}
              frameAspect={currentSettings.frameAspect}
              resolutionTier={currentSettings.resolutionTier}
              frameFit={currentSettings.frameFit}
              voiceId={currentSettings.voiceId}
              useAiVoiceover={currentSettings.useAiVoiceover}
              aiVoiceId={currentSettings.aiVoiceId}
              hasVoiceoverTake={Boolean(activeItem?.voiceoverUrl)}
              audioMixMode={currentSettings.audioMixMode}
              colorGradeId={currentSettings.colorGradeId}
              contentAwareAnalysis={activeItem?.contentAwareAnalysis ?? null}
              captionsEnabled={currentSettings.captionsEnabled}
              captionStyleId={currentSettings.captionStyleId}
              customCaptionStyle={currentSettings.customCaptionStyle}
              segments={segments}
              onRender={handleRenderActive}
            />

            <div className={queue.length === 0 ? 'hidden lg:block' : ''}>
              <BatchQueuePanel
                queue={queue}
                activeItemId={activeItem?.id ?? null}
                isQueueRunning={isQueueRunning}
                stopAfterCurrent={stopAfterCurrent}
                onSelectItem={handleSelectItem}
                onMoveItem={handleMoveItem}
                onRemoveItem={handleRemoveItem}
                onStartQueue={handleStartQueue}
                onStopQueue={handleStopQueue}
                onRetryFailed={handleRetryFailed}
                onClearFinished={handleClearFinished}
                onApplyCurrentSettingsToQueued={handleApplyCurrentSettingsToQueued}
              />
            </div>
          </div>

          {/* Right Bigger Screen: Full Editing Workspace & Caption Lines */}
          <div id="editing-workspace" className="space-y-3.5 sm:space-y-5 min-w-0">
            <div
              data-testid="workflow-swipe-surface"
              onTouchStart={handleWorkspaceTouchStart}
              onTouchEnd={handleWorkspaceTouchEnd}
              onTouchCancel={() => {
                tabTouchStartRef.current = null;
              }}
              className="rounded-xl border border-slate-200 bg-white min-w-0 flex flex-col touch-pan-y"
            >
              <GuidedStepper
                activeStep={activeStep}
                completedSteps={completedSteps}
                onSelectStep={handleSelectStep}
              />

              <div
                key={`${activeStep}-${tabSwipeDir ?? 'tap'}`}
                className={`p-3.5 sm:p-5 space-y-4 sm:space-y-5 ${
                  tabSwipeDir === 'left'
                    ? 'tab-enter-left'
                    : tabSwipeDir === 'right'
                      ? 'tab-enter-right'
                      : ''
                }`}
              >
                {activeStep === 'video' && (
                  <IngestionPanel
                    metadata={metadata}
                    queueCount={queue.length}
                    isIngesting={isIngesting}
                    uploadProgress={uploadProgress}
                    ingestStatusText={ingestStatusText}
                    ingestError={ingestError}
                    onUploadFiles={handleUploadFiles}
                    onIngestUrls={handleIngestUrls}
                    onLoadSample={handleLoadSample}
                  />
                )}

                {activeStep === 'voice' && (
                  <Suspense fallback={<TabFallback />}>
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
                    <div className="min-w-0">
                      <ScriptStudioPanel
                        hasSource={Boolean(metadata)}
                        metadata={metadata}
                        narrationPrompt={currentSettings.narrationPrompt}
                        onNarrationPromptChange={(narrationPrompt) => {
                          const translated = translatePromptForInhouseStudio(narrationPrompt);
                          patchActiveSettings({
                            narrationPrompt,
                            tailoredVoiceInstruction: translated.inhouseDeliveryInstruction || '',
                          });
                        }}
                        rawGeminiOutput={currentSettings.rawGeminiOutput}
                        onRawGeminiOutputChange={(rawGeminiOutput) =>
                          patchActiveSettings({ rawGeminiOutput })
                        }
                        scriptText={currentSettings.scriptText}
                        onScriptTextChange={(scriptText) => patchActiveSettings({ scriptText })}
                        speakingRate={currentSettings.speakingRate}
                        visualSummary={activeItem?.visualSummary ?? null}
                        tailoredVoiceInstruction={currentSettings.tailoredVoiceInstruction || null}
                        isGeneratingScript={isGeneratingScript}
                        scriptError={scriptError}
                        cleanerReport={cleanerReport}
                        onGenerateScriptFromVideo={handleGenerateScriptFromVideo}
                        onCleanGeminiResponse={handleCleanScriptOutput}
                      />
                    </div>

                    <div className="min-w-0 pt-5 xl:pt-0 border-t xl:border-t-0 xl:border-l border-slate-200 xl:pl-6">
                      <VoiceoverStudioPanel
                        hasSource={Boolean(metadata)}
                        hasScript={Boolean(currentSettings.scriptText.trim())}
                        hasSourceAudio={Boolean(metadata?.hasAudio)}
                        aiVoiceId={currentSettings.aiVoiceId}
                        onAiVoiceChange={(aiVoiceId) => patchActiveSettings({ aiVoiceId })}
                        speakingRate={currentSettings.speakingRate}
                        onSpeakingRateChange={(speakingRate) => patchActiveSettings({ speakingRate })}
                        tailoredVoiceInstruction={
                          currentSettings.tailoredVoiceInstruction ||
                          translatePromptForInhouseStudio(currentSettings.narrationPrompt)
                            .inhouseDeliveryInstruction ||
                          null
                        }
                        useAiVoiceover={currentSettings.useAiVoiceover}
                        onUseAiVoiceoverChange={(useAiVoiceover) =>
                          patchActiveSettings({ useAiVoiceover })
                        }
                        audioMixMode={currentSettings.audioMixMode}
                        onAudioMixModeChange={(audioMixMode) => patchActiveSettings({ audioMixMode })}
                        fallbackCharacterVoiceId={currentSettings.voiceId}
                        onFallbackCharacterVoiceChange={(voiceId) => patchActiveSettings({ voiceId })}
                        voiceoverUrl={activeItem?.voiceoverUrl ?? null}
                        voiceoverDurationSec={activeItem?.voiceoverDurationSec ?? null}
                        voiceoverEngine={activeItem?.voiceoverEngine ?? null}
                        isSynthesizing={isSynthesizingVoice}
                        voiceoverError={voiceoverError}
                        onGenerateVoiceover={handleGenerateVoiceover}
                      />
                    </div>
                  </div>
                  </Suspense>
                )}

                {activeStep === 'export' && (
                  <Suspense fallback={<TabFallback />}>
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
                    <div className="min-w-0">
                      <CaptionsStepPanel
                        captionsEnabled={currentSettings.captionsEnabled}
                        onCaptionsEnabledChange={(enabled) => {
                          patchActiveSettings({ captionsEnabled: enabled });
                          if (
                            enabled &&
                            activeItem &&
                            (activeItem.metadata.hasAudio || Boolean(activeItem.voiceoverUrl)) &&
                            activeItem.segments.length === 0 &&
                            !isItemBusy(activeItem.status)
                          ) {
                            void runTranscribeForJob(
                              activeItem.id,
                              activeItem.metadata.jobId,
                              false,
                              activeItem.voiceoverUrl ? 'voiceover' : 'auto'
                            );
                          }
                        }}
                        captionStyleId={currentSettings.captionStyleId}
                        onCaptionStyleChange={(captionStyleId) =>
                          patchActiveSettings({
                            captionStyleId,
                            customCaptionStyle: presetToCustomCaptionStyle(captionStyleId),
                          })
                        }
                        customCaptionStyle={currentSettings.customCaptionStyle}
                        onCustomCaptionStyleChange={(customCaptionStyle) =>
                          patchActiveSettings({ customCaptionStyle })
                        }
                        hasSource={Boolean(metadata)}
                        hasVoiceover={Boolean(activeItem?.voiceoverUrl)}
                        hasSegments={segments.length > 0}
                        isTranscribing={isTranscribing}
                        transcribeEngine={transcribeEngine}
                        transcribeWarning={transcribeWarning}
                        onSyncCaptions={() =>
                          activeItem &&
                          !isItemBusy(activeItem.status) &&
                          runTranscribeForJob(
                            activeItem.id,
                            activeItem.metadata.jobId,
                            true,
                            activeItem.voiceoverUrl ? 'voiceover' : 'auto'
                          )
                        }
                      />
                    </div>

                    <div className="min-w-0 pt-5 xl:pt-0 border-t xl:border-t-0 xl:border-l border-slate-200 xl:pl-6">
                      <ColorExportPanel
                        hasSource={Boolean(metadata)}
                        isRendering={isRendering}
                        isAnalyzingColor={isAnalyzingColor}
                        colorError={colorError}
                        colorGradeId={currentSettings.colorGradeId}
                        onColorGradeChange={(colorGradeId) => patchActiveSettings({ colorGradeId })}
                        contentAwareAnalysis={activeItem?.contentAwareAnalysis ?? null}
                        onAnalyzeContentAwareColor={handleAnalyzeContentAwareColor}
                        frameAspect={currentSettings.frameAspect}
                        onFrameAspectChange={(frameAspect) => patchActiveSettings({ frameAspect })}
                        resolutionTier={currentSettings.resolutionTier}
                        onResolutionTierChange={(resolutionTier) =>
                          patchActiveSettings({ resolutionTier })
                        }
                        frameFit={currentSettings.frameFit}
                        onFrameFitChange={(frameFit) => patchActiveSettings({ frameFit })}
                        onRender={handleRenderActive}
                      />
                    </div>
                  </div>
                  </Suspense>
                )}

                {activeStep === 'history' && (
                  <Suspense fallback={<TabFallback />}>
                    <HistoryPanel
                      user={historyUser}
                      entries={historyEntries}
                      isLoadingHistory={isLoadingHistory}
                      onReloadEntry={handleReloadHistoryEntry}
                      onDeleteEntry={handleDeleteHistoryEntry}
                      onAuthLogin={handleAuthLogin}
                      onAuthRegister={handleAuthRegister}
                      onAuthLogout={handleAuthLogout}
                    />
                  </Suspense>
                )}
              </div>

              {/* Clean Tab Footer */}
              <div className="px-3 sm:px-6 py-3 border-t border-slate-200 bg-slate-50/70 rounded-b-xl flex items-center justify-between gap-2">
                <button
                  type="button"
                  disabled={stepIndex === 0}
                  onClick={() => handleSelectStep(STEP_ORDER[Math.max(0, stepIndex - 1)])}
                  className="inline-flex items-center gap-1 min-h-[38px] px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-medium bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-35 disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <ChevronLeft className="w-3.5 h-3.5" aria-hidden="true" />
                  {stepIndex > 0 ? STEP_LABELS[STEP_ORDER[stepIndex - 1]] : 'Start'}
                </button>

                <span className="text-xs font-mono-tabular text-slate-500 whitespace-nowrap">
                  {stepIndex + 1} / {STEP_ORDER.length}
                  <span className="sm:hidden text-slate-400"> &middot; Swipe</span>
                </span>

                <button
                  type="button"
                  disabled={stepIndex === STEP_ORDER.length - 1}
                  onClick={() =>
                    handleSelectStep(STEP_ORDER[Math.min(STEP_ORDER.length - 1, stepIndex + 1)])
                  }
                  className="inline-flex items-center gap-1 min-h-[38px] px-3 sm:px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-[#7C3AED] hover:bg-[#6D28D9] text-white disabled:opacity-35 disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {stepIndex < STEP_ORDER.length - 1
                    ? `Next: ${STEP_LABELS[STEP_ORDER[stepIndex + 1]]}`
                    : 'Done'}
                  <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              </div>
            </div>

            {(segments.length > 0 || isTranscribing || transcribeWarning) && (
              <Suspense fallback={null}>
                <SubtitleEditor
                  segments={segments}
                  captionsEnabled={currentSettings.captionsEnabled}
                  isTranscribing={isTranscribing}
                  transcribeWarning={transcribeWarning}
                  onChange={(nextSegments) => {
                    if (!activeItem || isItemBusy(activeItem.status)) return;
                    const targetId = activeItem.id;
                    updateQueue((prev) =>
                      prev.map((item) =>
                        item.id === targetId
                          ? {
                              ...item,
                              segments: nextSegments,
                              renderResult: null,
                              status:
                                item.status === 'completed' || item.status === 'failed'
                                  ? 'queued'
                                  : item.status,
                              error: null,
                            }
                          : item
                      )
                    );
                  }}
                />
              </Suspense>
            )}
          </div>
        </div>
      </main>

      <footer className="border-t border-slate-200 bg-white pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] px-4 sm:px-6 text-center text-xs text-slate-500">
        HarFrame &middot; Bring Stories to Life
      </footer>
    </div>
  );
}
