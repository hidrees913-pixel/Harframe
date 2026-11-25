import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBatchProgressSnapshot,
  computeItemProgressPercent,
  estimateItemDurationSec,
  formatEtaDuration,
  parseFfmpegOutTimeSec,
} from './batchProgress.ts';
import { createQueueItem, DEFAULT_STUDIO_SETTINGS, type QueueItemStatus } from './batchQueue.ts';

function makeClip(id: string, durationSec: number, status: QueueItemStatus = 'queued') {
  const item = createQueueItem({
    id,
    metadata: {
      jobId: `job-${id}`,
      filename: `video_${id}.mp4`,
      sourceUrl: `/api/media/job-${id}/source`,
      sourceType: 'sample',
      width: 1280,
      height: 720,
      durationSec,
      fps: 30,
      hasAudio: true,
      isStereoAudio: true,
      codec: 'h264',
      fileSizeBytes: 1024000,
    },
    settings: {
      ...DEFAULT_STUDIO_SETTINGS,
      resolutionTier: '720p',
    },
  });
  item.status = status;
  return item;
}

test('parseFfmpegOutTimeSec parses latest out_time line from FFmpeg progress stream', () => {
  const chunk = [
    'frame=45',
    'out_time=00:00:01.500000',
    'progress=continue',
    'frame=90',
    'out_time=00:00:03.250000',
    'progress=continue',
  ].join('\n');

  assert.equal(parseFfmpegOutTimeSec(chunk), 3.25);
  assert.equal(parseFfmpegOutTimeSec('frame=12\nfps=30\n'), null);
});

test('computeItemProgressPercent maps pipeline phases and live FFmpeg percent cleanly', () => {
  const queued = makeClip('1', 6, 'queued');
  assert.equal(computeItemProgressPercent(queued), 0);

  const synth = makeClip('2', 6, 'synthesizing');
  assert.equal(computeItemProgressPercent(synth), 14);

  const trans = makeClip('3', 6, 'transcribing');
  assert.equal(computeItemProgressPercent(trans), 24);

  const color = makeClip('4', 6, 'analyzing');
  assert.equal(computeItemProgressPercent(color), 34);

  const renderingMid = makeClip('5', 6, 'rendering');
  const pct = computeItemProgressPercent(renderingMid, {
    phase: 'encoding',
    percent: 50,
    encodedSec: 3,
    totalSec: 6,
    startedAtMs: 1000,
    updatedAtMs: 3000,
  });
  assert.equal(pct, 68);

  const done = makeClip('6', 6, 'completed');
  assert.equal(computeItemProgressPercent(done), 100);
});

test('buildBatchProgressSnapshot aggregates per-video progress and calibrated ETA', () => {
  const clip1 = makeClip('1', 6, 'completed');
  const clip2 = makeClip('2', 6, 'rendering');
  const clip3 = makeClip('3', 12, 'queued');

  const nowMs = 20_000;
  const snapshot = buildBatchProgressSnapshot({
    queue: [clip1, clip2, clip3],
    liveByItemId: {
      '2': {
        phase: 'encoding',
        percent: 50,
        encodedSec: 3,
        totalSec: 6,
        startedAtMs: 16_000,
        updatedAtMs: 19_800,
      },
    },
    startedAtByItemId: {
      '1': 10_000,
      '2': 15_000,
    },
    completedDurationsByItemId: {
      '1': 5.0,
    },
    nowMs,
  });

  assert.equal(snapshot.totalCount, 3);
  assert.equal(snapshot.completedCount, 1);
  assert.equal(snapshot.processingCount, 1);
  assert.equal(snapshot.queuedCount, 1);
  assert.equal(snapshot.isComplete, false);

  // Clip 1 done -> 0s left; Clip 2 encoding ~68% after 5s -> positive ETA; Clip 3 queued -> positive ETA
  assert.equal(snapshot.items[0].percent, 100);
  assert.equal(snapshot.items[0].etaLabel, 'Done');
  assert.equal(snapshot.items[1].percent, 68);
  assert.ok((snapshot.items[1].etaSec ?? 0) >= 1);
  assert.ok((snapshot.items[2].etaSec ?? 0) >= 5);
  assert.ok((snapshot.totalEtaSec ?? 0) >= (snapshot.items[2].etaSec ?? 0));
  assert.ok(estimateItemDurationSec(clip3) > estimateItemDurationSec(clip2));
});

test('formatEtaDuration formats seconds, minutes, and completion clearly', () => {
  assert.equal(formatEtaDuration(null), 'Estimating...');
  assert.equal(formatEtaDuration(0), 'Done');
  assert.equal(formatEtaDuration(18), '18s left');
  assert.equal(formatEtaDuration(95), '1m 35s left');
  assert.equal(formatEtaDuration(120), '2m left');
});
