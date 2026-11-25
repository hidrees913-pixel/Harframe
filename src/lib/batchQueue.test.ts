import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applySettingsToQueuedItems,
  clearFinishedQueueItems,
  createQueueItem,
  DEFAULT_STUDIO_SETTINGS,
  getNextQueuedItem,
  moveQueueItem,
  removeQueueItem,
  retryFailedQueueItems,
  summarizeQueue,
  type QueueItem,
  type StudioSettings,
} from './batchQueue.ts';
import type { VideoMetadata } from './studioPresets.ts';

const baseSettings: StudioSettings = {
  frameAspect: 'auto',
  resolutionTier: '1080p',
  frameFit: 'fit',
  voiceId: 'marcus',
  captionsEnabled: true,
  captionStyleId: 'hormozi_yellow',
  colorGradeId: 'ai_auto_balance',
};

function makeMeta(id: string, filename: string): VideoMetadata {
  return {
    jobId: id,
    filename,
    sourceUrl: `/api/media/${id}.mp4?kind=upload`,
    sourceType: 'upload',
    width: 1280,
    height: 720,
    durationSec: 6,
    fps: 30,
    hasAudio: true,
    codec: 'h264',
    fileSizeBytes: 512000,
  };
}

function sampleQueue(): QueueItem[] {
  return [
    createQueueItem({ id: 'q1', metadata: makeMeta('j1', 'clip_1.mp4'), settings: baseSettings }),
    createQueueItem({ id: 'q2', metadata: makeMeta('j2', 'clip_2.mp4'), settings: baseSettings }),
    createQueueItem({ id: 'q3', metadata: makeMeta('j3', 'clip_3.mp4'), settings: baseSettings }),
  ];
}

test('moveQueueItem reorders queued items and blocks moving actively processing items', () => {
  const queue = sampleQueue();
  const movedDown = moveQueueItem(queue, 'q1', 'down');
  assert.deepEqual(
    movedDown.map((q) => q.id),
    ['q2', 'q1', 'q3']
  );

  const movedUp = moveQueueItem(movedDown, 'q3', 'up');
  assert.deepEqual(
    movedUp.map((q) => q.id),
    ['q2', 'q3', 'q1']
  );

  // Busy item cannot move or be swapped
  const busyQueue = movedUp.map((q) => (q.id === 'q2' ? { ...q, status: 'rendering' as const } : q));
  const blockedMove = moveQueueItem(busyQueue, 'q2', 'down');
  assert.deepEqual(
    blockedMove.map((q) => q.id),
    ['q2', 'q3', 'q1']
  );
  const blockedSwapIntoBusy = moveQueueItem(busyQueue, 'q3', 'up');
  assert.deepEqual(
    blockedSwapIntoBusy.map((q) => q.id),
    ['q2', 'q3', 'q1']
  );
});

test('removeQueueItem updates active item selection safely and blocks removing busy items', () => {
  const queue = sampleQueue();
  const afterRemoveActive = removeQueueItem(queue, 'q1', 'q1');
  assert.deepEqual(
    afterRemoveActive.queue.map((q) => q.id),
    ['q2', 'q3']
  );
  assert.equal(afterRemoveActive.nextActiveId, 'q2');

  const busyQueue = afterRemoveActive.queue.map((q) =>
    q.id === 'q2' ? { ...q, status: 'transcribing' as const } : q
  );
  const blockedRemove = removeQueueItem(busyQueue, 'q2', 'q2');
  assert.equal(blockedRemove.queue.length, 2);
  assert.equal(blockedRemove.nextActiveId, 'q2');
});

test('getNextQueuedItem, retryFailedQueueItems, clearFinishedQueueItems, and summarizeQueue track sequential execution', () => {
  let queue = sampleQueue();
  queue[0] = { ...queue[0], status: 'completed' };
  queue[1] = { ...queue[1], status: 'failed', error: 'Test encode failure' };

  const firstPending = getNextQueuedItem(queue);
  assert.equal(firstPending?.id, 'q3');

  const summary = summarizeQueue(queue);
  assert.deepEqual(summary, {
    total: 3,
    queued: 1,
    processing: 0,
    completed: 1,
    failed: 1,
    activeItemId: null,
  });

  queue = retryFailedQueueItems(queue);
  assert.equal(queue[1].status, 'queued');
  assert.equal(queue[1].error, null);
  assert.equal(getNextQueuedItem(queue)?.id, 'q2');

  const cleared = clearFinishedQueueItems(queue, 'q1');
  assert.deepEqual(
    cleared.queue.map((q) => q.id),
    ['q2', 'q3']
  );
  assert.equal(cleared.nextActiveId, 'q2');
});

test('applySettingsToQueuedItems stamps batch studio settings onto pending items without mutating completed jobs', () => {
  let queue = sampleQueue();
  queue[0] = { ...queue[0], status: 'completed' };

  const updatedSettings: StudioSettings = {
    ...baseSettings,
    frameAspect: '9:16',
    resolutionTier: '2160p',
    voiceId: 'victor',
  };

  queue = applySettingsToQueuedItems(queue, updatedSettings);
  assert.equal(queue[0].settings.voiceId, 'marcus');
  assert.equal(queue[1].settings.voiceId, 'victor');
  assert.equal(queue[1].settings.resolutionTier, '2160p');
  assert.equal(queue[2].settings.frameAspect, '9:16');
  assert.equal(queue[1].settings.audioMixMode, 'asmr_only');
  assert.equal(DEFAULT_STUDIO_SETTINGS.colorGradeId, 'ai_content_aware');
});
