import test from 'node:test';
import assert from 'node:assert/strict';
import {
  escapeAssText,
  formatAssTime,
  formatSrtTime,
  normalizeSegments,
  optimizeCaptionSegments,
  toAss,
  toSrt,
  wrapCaptionText,
} from './subtitles.ts';
import { CAPTION_STYLE_PRESETS } from './studioPresets.ts';

test('timestamp formatters produce valid SRT and ASS timestamps', () => {
  assert.equal(formatSrtTime(0), '00:00:00,000');
  assert.equal(formatSrtTime(65.432), '00:01:05,432');
  assert.equal(formatAssTime(0), '0:00:00.00');
  assert.equal(formatAssTime(125.75), '0:02:05.75');
});

test('escapeAssText escapes ASS braces, backslashes, and newlines', () => {
  assert.equal(escapeAssText('Hello {world}\nLine 2'), 'Hello \\{world\\}\\NLine 2');
});

test('wrapCaptionText wraps long lines inside horizontal budget without splitting words', () => {
  const wrapped = wrapCaptionText('HarFrame vertical safe-zone captions stay crisp inside 9:16', 24);
  const lines = wrapped.split('\n');
  assert.ok(lines.length >= 2);
  for (const line of lines) {
    assert.ok(line.length <= 24, `Line "${line}" exceeded 24 chars`);
  }
});

test('optimizeCaptionSegments splits long AI cues cleanly and resolves overlapping timestamps', () => {
  const optimized = optimizeCaptionSegments(
    [
      {
        id: 'long-1',
        startSec: 0,
        endSec: 4,
        text: 'Welcome back to the studio today, let us craft an unforgettable cinematic story together.',
      },
      {
        id: 'overlap-2',
        startSec: 3.5,
        endSec: 5.5,
        text: 'Next cue starts cleanly.',
      },
    ],
    { maxWordsPerCue: 5 }
  );

  assert.ok(optimized.length >= 3, 'Expected long cue to split into punchy chunks');
  for (let i = 0; i < optimized.length; i++) {
    const words = optimized[i].text.split(/\s+/);
    assert.ok(words.length <= 6, `Cue "${optimized[i].text}" exceeded max words`);
    if (i > 0) {
      assert.ok(
        optimized[i].startSec >= optimized[i - 1].endSec,
        `Overlap detected between cue ${i - 1} and ${i}`
      );
    }
  }

  const normalized = normalizeSegments([
    { id: 'a', startSec: 0, endSec: 2.2, text: 'First' },
    { id: 'b', startSec: 1.5, endSec: 3.5, text: 'Second' },
  ]);
  assert.ok(normalized[1].startSec >= normalized[0].endSec);
});

test('toSrt outputs numbered SRT blocks sorted chronologically', () => {
  const srt = toSrt([
    { id: '2', startSec: 3.5, endSec: 5.8, text: 'Second line' },
    { id: '1', startSec: 0.2, endSec: 2.4, text: 'First line' },
  ]);

  assert.match(srt, /^1\n00:00:00,200 --> 00:00:02,400\nFirst line\n\n2\n00:00:03,500 --> 00:00:05,800\nSecond line\n$/);
});

test('toAss generates valid ASS styles and kinetic animations for all 19 presets', () => {
  assert.equal(CAPTION_STYLE_PRESETS.length, 19);
  const animatedPresets = CAPTION_STYLE_PRESETS.filter((p) => p.isAnimated);
  assert.ok(animatedPresets.length >= 10, 'Expected at least 10 kinetic animated caption styles');

  for (const preset of CAPTION_STYLE_PRESETS) {
    const ass = toAss(
      [{ id: '1', startSec: 0.5, endSec: 2.5, text: 'Bring every story to life with safe-zone captions inside vertical 9:16 video frames' }],
      preset.id,
      720,
      1280,
      '9:16',
      '1080p',
      'fit'
    );
    assert.match(ass, /\[Script Info\]/);
    assert.match(ass, /PlayResX: 864/);
    assert.match(ass, /PlayResY: 1478/);
    assert.match(ass, /WrapStyle: 1/);
    assert.match(ass, /Style: HarFrameCaption,/);
    assert.match(ass, /,20,20,16,1/);
    assert.match(ass, /Dialogue: 0,0:00:00\.50,0:00:02\.50,HarFrameCaption/);
    assert.match(ass, /\\N/, 'Long 9:16 caption should wrap across lines inside safe zone');

    if (preset.isAnimated) {
      assert.match(ass, /\{\\kf?\d+\}/, `Animated preset ${preset.id} must emit karaoke timing tags`);
    }
  }
});

test('toAss applies full customStyle overrides including hex colors, fontName, background box, and alignment', () => {
  const ass = toAss(
    [{ id: '1', startSec: 0, endSec: 2, text: 'Custom styled caption check' }],
    'clean_slate',
    1920,
    1080,
    '16:9',
    '1080p',
    'fit',
    {
      fontName: 'JetBrains Mono',
      fontSize: 64,
      primaryColor: '#FF3366',
      outlineColor: '#111827',
      backgroundColor: '#0F172A',
      backgroundEnabled: true,
      outlineWidth: 5,
      bold: true,
      italic: true,
      uppercase: true,
      position: 'top',
      animation: 'none',
    }
  );

  // #FF3366 -> ASS &H006633FF; #0F172A -> &H452A170F; top alignment -> 8; BorderStyle=3
  assert.match(
    ass,
    /Style: HarFrameCaption,JetBrains Mono,\d+,&H006633FF,&H00FFFFFF,&H452A170F,&H452A170F,-1,-1,0,0,100,100,0,0,3,\d+,0,8,20,20,16,1/
  );
  assert.match(ass, /CUSTOM STYLED CAPTION CHECK/);

  const middleAss = toAss(
    [{ id: '1', startSec: 0, endSec: 2, text: 'Centered text' }],
    'clean_slate',
    1920,
    1080,
    '16:9',
    '1080p',
    'fit',
    {
      position: 'middle',
      backgroundEnabled: false,
      outlineColor: '#112233',
      outlineWidth: 4,
    }
  );
  assert.match(middleAss, /,1,\d+,\d+,5,20,20,16,1/);
  assert.match(middleAss, /&H00332211/);
});

test('toAss scales safe zones properly for 4K square 1:1 renders', () => {
  const ass = toAss(
    [{ id: '1', startSec: 0, endSec: 2, text: 'Four K square frame test' }],
    'karaoke_gold_rush',
    1920,
    1080,
    '1:1',
    '2160p',
    'fill'
  );
  assert.match(ass, /PlayResX: 1858/);
  assert.match(ass, /PlayResY: 1878/);
  assert.match(ass, /\{\\kf\d+\}/);
});
