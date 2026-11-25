import test from 'node:test';
import assert from 'node:assert/strict';
import {
  build1080pScalePadFilter,
  buildAudioFilterChain,
  buildColorGradeFilter,
  buildContentAwareColorFilter,
  buildFfmpegArgs,
  buildScaleFrameFilter,
  buildVoiceoverMixFilterGraph,
  computeAutoBalanceFilter,
  computeSafeZoneLayout,
  computeTarget1080pDimensions,
  computeTargetDimensions,
  escapeFilterPath,
} from './ffmpegPipeline.ts';
import {
  CAPTION_STYLE_PRESETS,
  COLOR_GRADE_PRESETS,
  FRAME_ASPECT_PRESETS,
  RESOLUTION_PRESETS,
  VOICE_PRESETS,
} from './studioPresets.ts';

test('all 6 named character voices + original produce multi-stage studio DSP chains', () => {
  assert.equal(VOICE_PRESETS.length, 7);
  for (const voice of VOICE_PRESETS) {
    const chain = buildAudioFilterChain(voice.id, true);
    assert.ok(chain && chain.length > 5, `Expected valid chain for ${voice.id}`);
    assert.match(chain!, /afftdn=/, `${voice.id} must include FFT denoise stage`);
    assert.match(chain!, /agate=/, `${voice.id} must include noise gate / expander stage`);
    assert.match(chain!, /compand=/, `${voice.id} must include compander dynamic stage`);
    assert.match(chain!, /acompressor=/, `${voice.id} must include compressor stage`);
    assert.match(chain!, /alimiter=/, `${voice.id} must include brickwall lookahead limiter`);
    assert.match(chain!, /loudnorm=/, `${voice.id} must include EBU R128 loudness normalization`);
  }
  assert.equal(buildAudioFilterChain('marcus', false), null);
  assert.match(buildAudioFilterChain('marcus', true)!, /asetrate=48000\*0\.76,aresample=48000,atempo=1\.3158/);
  assert.match(buildAudioFilterChain('marcus', true)!, /deesser=/);
  assert.match(buildAudioFilterChain('elena', true)!, /asetrate=48000\*1\.26,aresample=48000,atempo=0\.7937/);
  assert.match(buildAudioFilterChain('dexter', true)!, /asetrate=48000\*0\.85.*tremolo=.*acrusher=.*flanger=.*chorus=/);
  assert.match(buildAudioFilterChain('leo', true)!, /highpass=f=460,lowpass=f=2450/);
  assert.match(buildAudioFilterChain('oliver', true)!, /asetrate=48000\*1\.44,aresample=48000,atempo=0\.75/);
  assert.match(buildAudioFilterChain('victor', true)!, /asetrate=48000\*0\.64,aresample=48000,atempo=1\.5625/);
});

test('all 9 color grading presets including AI Content-Aware resolve cleanly', () => {
  assert.equal(COLOR_GRADE_PRESETS.length, 9);
  assert.equal(buildColorGradeFilter('none'), null);
  for (const grade of COLOR_GRADE_PRESETS) {
    if (grade.id === 'none') continue;
    const filter = buildColorGradeFilter(grade.id, { avgLuma: 70, minLuma: 10, maxLuma: 190 });
    assert.ok(filter && filter.length > 5, `Expected filter for ${grade.id}`);
  }
});

test('buildContentAwareColorFilter clamps extreme AI values safely', () => {
  const filter = buildContentAwareColorFilter({
    sceneType: 'Indoor Moody Cafe',
    lightingCondition: 'Low Key Tungsten',
    rationale: 'Cool shadows and lift midtones subtly.',
    appliedBrightness: 0.9, // Should clamp to 0.25
    appliedContrast: 2.5, // Should clamp to 1.45
    appliedSaturation: 0.1, // Should clamp to 0.4
    appliedGamma: 0.2, // Should clamp to 0.78
    colorBalance: {
      rs: -0.9,
      gs: 0.02,
      bs: 0.8,
      rm: 0.05,
      gm: 0,
      bm: -0.05,
      rh: 0.1,
      gh: 0.04,
      bh: -0.1,
    },
    avgLuma: 72,
    minLuma: 12,
    maxLuma: 190,
    cssPreviewFilter: 'contrast(1.12)',
  });

  assert.match(filter, /colorbalance=rs=-0\.35:gs=0\.02:bs=0\.35/);
  assert.match(filter, /eq=brightness=0\.25:contrast=1\.45:saturation=0\.4:gamma=0\.78/);
});

test('buildVoiceoverMixFilterGraph handles ASMR preservation, mono fallback, ambient bed, and full replace with duration padding', () => {
  const asmrStereo = buildVoiceoverMixFilterGraph({
    hasSourceAudio: true,
    audioMixMode: 'asmr_only',
    isStereoAudio: true,
    sourceDurationSec: 12,
  });
  assert.match(asmrStereo, /stereotools=mlev=0\.04:slev=1\.24/);
  assert.match(asmrStereo, /highshelf=f=6500:g=4\.5/);
  assert.match(asmrStereo, /apad=whole_dur=12\.00/);
  assert.match(asmrStereo, /sidechaincompress=/);
  assert.match(asmrStereo, /amix=inputs=2:duration=first/);

  const asmrMono = buildVoiceoverMixFilterGraph({
    hasSourceAudio: true,
    audioMixMode: 'asmr_only',
    isStereoAudio: false,
    sourceDurationSec: 12,
  });
  assert.doesNotMatch(asmrMono, /stereotools=/);
  assert.match(asmrMono, /equalizer=f=1400/);
  assert.match(asmrMono, /apad=whole_dur=12\.00/);

  const ambientBed = buildVoiceoverMixFilterGraph({
    hasSourceAudio: true,
    audioMixMode: 'ambient_bed',
    isStereoAudio: true,
    sourceDurationSec: 14.5,
  });
  assert.match(ambientBed, /volume=0\.35,apad=whole_dur=14\.50\[bed\]/);
  assert.match(ambientBed, /\[1:a\].*apad=whole_dur=14\.50,volume=1\.18/);

  const replaceAll = buildVoiceoverMixFilterGraph({
    hasSourceAudio: true,
    audioMixMode: 'replace_all',
    isStereoAudio: true,
    sourceDurationSec: 10,
  });
  assert.match(replaceAll, /apad=whole_dur=10\.00/);
  assert.doesNotMatch(replaceAll, /\[0:a\]/);
});

test('AI Auto-Balance lifts dark luma without clipping and enhances contrast', () => {
  const darkResult = computeAutoBalanceFilter({ avgLuma: 60, minLuma: 8, maxLuma: 150 });
  assert.ok(darkResult.appliedBrightness > 0.05);
  assert.ok(darkResult.appliedContrast > 1.1);
  assert.match(darkResult.filter, /normalize=/);

  const brightResult = computeAutoBalanceFilter({ avgLuma: 210, minLuma: 30, maxLuma: 250 });
  assert.ok(brightResult.appliedBrightness < 0);
});

test('computeTargetDimensions supports all aspect ratios and 720p to 4K resolutions', () => {
  assert.equal(FRAME_ASPECT_PRESETS.length, 7);
  assert.equal(RESOLUTION_PRESETS.length, 4);

  assert.deepEqual(computeTargetDimensions(1280, 720, '16:9', '720p'), { targetWidth: 1280, targetHeight: 720 });
  assert.deepEqual(computeTargetDimensions(1280, 720, '16:9', '1080p'), { targetWidth: 1920, targetHeight: 1080 });
  assert.deepEqual(computeTargetDimensions(1280, 720, '16:9', '1440p'), { targetWidth: 2560, targetHeight: 1440 });
  assert.deepEqual(computeTargetDimensions(1280, 720, '16:9', '2160p'), { targetWidth: 3840, targetHeight: 2160 });

  assert.deepEqual(computeTargetDimensions(1920, 1080, '9:16', '1080p'), { targetWidth: 1080, targetHeight: 1920 });
  assert.deepEqual(computeTargetDimensions(1920, 1080, '9:16', '2160p'), { targetWidth: 2160, targetHeight: 3840 });
  assert.deepEqual(computeTargetDimensions(1920, 1080, '1:1', '1080p'), { targetWidth: 1080, targetHeight: 1080 });
  assert.deepEqual(computeTargetDimensions(1920, 1080, '4:5', '1080p'), { targetWidth: 1080, targetHeight: 1350 });
  assert.deepEqual(computeTargetDimensions(1920, 1080, '4:3', '1080p'), { targetWidth: 1440, targetHeight: 1080 });
  assert.deepEqual(computeTargetDimensions(1920, 1080, '21:9', '1080p'), { targetWidth: 2520, targetHeight: 1080 });

  assert.deepEqual(computeTarget1080pDimensions(1280, 720), { targetWidth: 1920, targetHeight: 1080 });
  assert.deepEqual(computeTarget1080pDimensions(720, 1280), { targetWidth: 1080, targetHeight: 1920 });

  const portraitPadFilter = build1080pScalePadFilter(720, 1280);
  assert.match(portraitPadFilter, /scale=w=1080:h=1920:force_original_aspect_ratio=decrease:flags=bicubic/);
  assert.match(portraitPadFilter, /pad=1080:1920:\(ow-iw\)\/2:\(oh-ih\)\/2/);

  const fillFilter = buildScaleFrameFilter(1920, 1080, '1:1', '1080p', 'fill');
  assert.match(fillFilter, /force_original_aspect_ratio=increase:flags=bicubic,crop=1080:1080/);
});

test('computeSafeZoneLayout enforces even-aligned edge padding across fit and fill modes', () => {
  const vertical = computeSafeZoneLayout(720, 1280, '9:16', '1080p', 'fit');
  assert.equal(vertical.isPortrait, true);
  assert.equal(vertical.targetWidth, 1080);
  assert.equal(vertical.targetHeight, 1920);
  assert.equal(vertical.safeX, 108);
  assert.equal(vertical.safeY, 154);
  assert.equal(vertical.safeWidth, 864);
  assert.equal(vertical.safeHeight, 1478);
  assert.equal(vertical.safeX % 2, 0);
  assert.equal(vertical.safeY % 2, 0);
  assert.equal(vertical.safeWidth % 2, 0);
  assert.equal(vertical.safeHeight % 2, 0);

  const squareFit = computeSafeZoneLayout(1000, 1000, '16:9', '1080p', 'fit');
  assert.equal(squareFit.padX, 420);
  assert.ok(squareFit.safeX > 420, 'Safe-zone box must start inside active video, not in pillarbox');

  const verticalFill = computeSafeZoneLayout(1920, 1080, '9:16', '2160p', 'fill');
  assert.equal(verticalFill.padX, 0);
  assert.equal(verticalFill.padY, 0);
  assert.equal(verticalFill.targetWidth, 2160);
  assert.equal(verticalFill.targetHeight, 3840);
});

test('escapeFilterPath safely escapes colons, quotes, brackets, and backslashes', () => {
  assert.equal(
    escapeFilterPath("C:\\videos\\clip[1]:test's.ass"),
    "C\\:/videos/clip\\[1\\]\\:test\\'s.ass"
  );
});

test('buildFfmpegArgs merges voiceover, ASMR suppression, and captions into one -filter_complex', () => {
  assert.equal(CAPTION_STYLE_PRESETS.length, 19);
  const args = buildFfmpegArgs({
    inputPath: '/tmp/in.mp4',
    voiceoverPath: '/tmp/vo.wav',
    outputPath: '/tmp/out.mp4',
    sourceWidth: 720,
    sourceHeight: 1280,
    hasAudio: true,
    isStereoAudio: true,
    sourceDurationSec: 8.5,
    voiceId: 'original',
    audioMixMode: 'asmr_only',
    frameAspect: '9:16',
    resolutionTier: '1080p',
    frameFit: 'fit',
    colorGradeId: 'teal_orange',
    captionsEnabled: true,
    captionStyleId: 'hormozi_yellow',
    assFilePath: '/tmp/subs:1.ass',
  });

  assert.ok(!args.includes('-vf'), 'Must not pass -vf together with -filter_complex');
  const fcIdx = args.indexOf('-filter_complex');
  assert.ok(fcIdx !== -1, 'Expected -filter_complex for voiceover + captions');
  const fc = args[fcIdx + 1];
  assert.match(fc, /\[1:a\]aresample=48000/);
  assert.match(fc, /stereotools=mlev=0\.04:slev=1\.24/);
  assert.match(fc, /\[base\]\[cap\]overlay=108:154,format=yuv420p\[vout\]/);
});

test('buildFfmpegArgs uses safe-zone crop/ass/overlay filter_complex and fast preset', () => {
  const args = buildFfmpegArgs({
    inputPath: '/tmp/in.mp4',
    outputPath: '/tmp/out.mp4',
    sourceWidth: 720,
    sourceHeight: 1280,
    hasAudio: true,
    voiceId: 'marcus',
    frameAspect: '9:16',
    resolutionTier: '1080p',
    frameFit: 'fit',
    colorGradeId: 'teal_orange',
    captionsEnabled: true,
    captionStyleId: 'hormozi_yellow',
    assFilePath: '/tmp/subs:1.ass',
  });

  const fcIdx = args.indexOf('-filter_complex');
  assert.ok(fcIdx !== -1, 'Expected -filter_complex for safe-zone subtitle bounding');
  const fc = args[fcIdx + 1];
  assert.match(fc, /colorbalance=/);
  assert.match(fc, /scale=w=1080:h=1920/);
  assert.match(fc, /split=2\[base\]\[sub\]/);
  assert.match(fc, /\[sub\]crop=864:1478:108:154,ass='\/tmp\/subs\\:1\.ass':original_size=864x1478\[cap\]/);
  assert.match(fc, /\[base\]\[cap\]overlay=108:154,format=yuv420p\[vout\]/);
  assert.match(fc, /\[0:a\]aresample=48000,highpass=f=75,afftdn=.*agate=.*asetrate=48000\*0\.76.*alimiter=.*loudnorm=.*\[aout\]/);
  assert.ok(args.includes('libx264'));
  assert.ok(args.includes('veryfast'));
  assert.ok(args.includes('aac'));
});

test('buildFfmpegArgs uses superfast preset for 4K exports and synthesizes silent audio track', () => {
  const args = buildFfmpegArgs({
    inputPath: '/tmp/silent.mp4',
    outputPath: '/tmp/out.mp4',
    sourceWidth: 854,
    sourceHeight: 480,
    hasAudio: false,
    voiceId: 'victor',
    frameAspect: '1:1',
    resolutionTier: '2160p',
    frameFit: 'fill',
    colorGradeId: 'none',
    captionsEnabled: false,
    captionStyleId: 'clean_slate',
  });

  assert.ok(args.includes('superfast'));
  assert.ok(args.includes('anullsrc=channel_layout=stereo:sample_rate=48000'));
  assert.ok(args.includes('-shortest'));
});
