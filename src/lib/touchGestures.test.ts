import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clampVideoSeekTime,
  classifyPreviewDoubleTapZone,
  computeQueueSwipeOffset,
  detectHorizontalSwipe,
  getNextStepFromSwipe,
  shouldIgnoreTouchTarget,
  shouldTriggerQueueSwipeDelete,
} from './touchGestures';

test('detectHorizontalSwipe recognizes crisp left and right swipes and rejects vertical scroll', () => {
  const start = { x: 250, y: 300, timeMs: 1000 };

  assert.equal(detectHorizontalSwipe(start, { x: 170, y: 312, timeMs: 1200 }), 'left');
  assert.equal(detectHorizontalSwipe(start, { x: 330, y: 292, timeMs: 1200 }), 'right');

  // Vertical scroll gesture must return null
  assert.equal(detectHorizontalSwipe(start, { x: 200, y: 420, timeMs: 1250 }), null);

  // Micro jitter must return null
  assert.equal(detectHorizontalSwipe(start, { x: 225, y: 302, timeMs: 1120 }), null);

  // Long deliberate drag passes even after maxDurationMs
  assert.equal(detectHorizontalSwipe(start, { x: 120, y: 310, timeMs: 1950 }), 'left');
});

test('getNextStepFromSwipe navigates bounded workflow tabs cleanly', () => {
  const steps = ['video', 'voice', 'export', 'history'] as const;
  assert.equal(getNextStepFromSwipe('video', 'left', steps), 'voice');
  assert.equal(getNextStepFromSwipe('voice', 'left', steps), 'export');
  assert.equal(getNextStepFromSwipe('history', 'left', steps), null);
  assert.equal(getNextStepFromSwipe('history', 'right', steps), 'export');
  assert.equal(getNextStepFromSwipe('video', 'right', steps), null);
});

test('shouldIgnoreTouchTarget skips sliders, inputs, textareas, and data-no-swipe', () => {
  assert.equal(shouldIgnoreTouchTarget({ tagName: 'INPUT', inputType: 'range' }), true);
  assert.equal(shouldIgnoreTouchTarget({ tagName: 'TEXTAREA' }), true);
  assert.equal(shouldIgnoreTouchTarget({ tagName: 'SELECT' }), true);
  assert.equal(shouldIgnoreTouchTarget({ insideNoSwipe: true }), true);
  assert.equal(shouldIgnoreTouchTarget({ tagName: 'BUTTON' }), true);
  assert.equal(shouldIgnoreTouchTarget({ tagName: 'BUTTON' }, { allowButtons: true }), false);
  assert.equal(shouldIgnoreTouchTarget({ tagName: 'DIV' }), false);
});

test('classifyPreviewDoubleTapZone maps left, center, and right regions', () => {
  assert.equal(classifyPreviewDoubleTapZone(40, 20, 300), 'seek-back');
  assert.equal(classifyPreviewDoubleTapZone(170, 20, 300), 'toggle-play');
  assert.equal(classifyPreviewDoubleTapZone(280, 20, 300), 'seek-forward');
});

test('clampVideoSeekTime bounds seek within [0, duration - 0.05]', () => {
  assert.equal(clampVideoSeekTime(2, -5, 10), 0);
  assert.equal(clampVideoSeekTime(8, 5, 10), 9.95);
  assert.equal(clampVideoSeekTime(2.5, 5, 10), 7.5);
});

test('computeQueueSwipeOffset & shouldTriggerQueueSwipeDelete handle swipe-left queue actions', () => {
  assert.equal(computeQueueSwipeOffset(25, 0), 0);
  assert.equal(computeQueueSwipeOffset(-60, 4), -60);
  assert.ok(computeQueueSwipeOffset(-200, 4) <= -104 && computeQueueSwipeOffset(-200, 4) >= -128);

  assert.equal(shouldTriggerQueueSwipeDelete(-120, 10, 300), true);
  assert.equal(shouldTriggerQueueSwipeDelete(-75, 5, 120), true);
  assert.equal(shouldTriggerQueueSwipeDelete(-35, 2, 200), false);
  assert.equal(shouldTriggerQueueSwipeDelete(-80, 90, 200), false);
});
