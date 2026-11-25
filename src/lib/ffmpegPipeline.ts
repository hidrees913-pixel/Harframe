import {
  FRAME_ASPECT_PRESETS,
  RESOLUTION_PRESETS,
  type AudioMixMode,
  type CaptionStyleId,
  type ColorGradeId,
  type ContentAwareColorAnalysis,
  type FrameAspectId,
  type FrameFitMode,
  type ResolutionTierId,
  type VoiceId,
} from './studioPresets.ts';

export interface FrameLumaStats {
  avgLuma: number; // 0-255
  minLuma: number;
  maxLuma: number;
}

export interface AutoBalanceResult {
  filter: string;
  appliedBrightness: number;
  appliedContrast: number;
  appliedSaturation: number;
}

export interface PipelineOptions {
  inputPath: string;
  outputPath: string;
  sourceWidth: number;
  sourceHeight: number;
  hasAudio: boolean;
  isStereoAudio?: boolean;
  sourceDurationSec?: number;
  voiceId: VoiceId;
  voiceoverPath?: string;
  audioMixMode?: AudioMixMode;
  frameAspect?: FrameAspectId;
  resolutionTier?: ResolutionTierId;
  frameFit?: FrameFitMode;
  colorGradeId: ColorGradeId;
  contentAwareAnalysis?: ContentAwareColorAnalysis;
  assFilePath?: string;
  captionsEnabled: boolean;
  captionStyleId: CaptionStyleId;
  frameStats?: FrameLumaStats;
}

/**
 * Escapes a filesystem path for FFmpeg's filtergraph parser (e.g., ass='...').
 */
export function escapeFilterPath(filePath: string): string {
  return filePath
    .replace(/\\/g, '/')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

function clamp(val: number, min: number, max: number): number {
  return Number(Math.max(min, Math.min(max, val)).toFixed(3));
}

/**
 * Computes adaptive dynamic range correction without clipping highlights.
 */
export function computeAutoBalanceFilter(stats?: FrameLumaStats): AutoBalanceResult {
  const avgLuma = stats?.avgLuma ?? 112;
  const minLuma = stats?.minLuma ?? 18;
  const maxLuma = stats?.maxLuma ?? 232;
  const dynamicSpread = Math.max(40, maxLuma - minLuma);

  const rawBrightness = (124 - avgLuma) / 510;
  const appliedBrightness = Number(Math.max(-0.08, Math.min(0.14, rawBrightness)).toFixed(3));

  const rawContrast = 1 + Math.max(0, (215 - dynamicSpread) / 380);
  const appliedContrast = Number(Math.max(1.04, Math.min(1.24, rawContrast)).toFixed(3));

  const appliedSaturation = 1.15;

  const filter = [
    'normalize=blackpt=black:whitept=white:smoothing=12:independence=0.35',
    `eq=brightness=${appliedBrightness}:contrast=${appliedContrast}:saturation=${appliedSaturation}:gamma=1.03`,
    'unsharp=3:3:0.35:3:3:0.0',
  ].join(',');

  return {
    filter,
    appliedBrightness,
    appliedContrast,
    appliedSaturation,
  };
}

/**
 * Builds an FFmpeg color grading chain from AI vision + histogram telemetry.
 */
export function buildContentAwareColorFilter(
  analysis?: ContentAwareColorAnalysis,
  frameStats?: FrameLumaStats
): string {
  if (!analysis) {
    return computeAutoBalanceFilter(frameStats).filter;
  }

  const b = clamp(analysis.appliedBrightness, -0.25, 0.25);
  const c = clamp(analysis.appliedContrast, 0.75, 1.45);
  const s = clamp(analysis.appliedSaturation, 0.4, 1.6);
  const g = clamp(analysis.appliedGamma, 0.78, 1.35);

  const cb = analysis.colorBalance || {
    rs: 0,
    gs: 0,
    bs: 0,
    rm: 0,
    gm: 0,
    bm: 0,
    rh: 0,
    gh: 0,
    bh: 0,
  };

  const cbArgs = [
    `rs=${clamp(cb.rs, -0.35, 0.35)}`,
    `gs=${clamp(cb.gs, -0.35, 0.35)}`,
    `bs=${clamp(cb.bs, -0.35, 0.35)}`,
    `rm=${clamp(cb.rm, -0.35, 0.35)}`,
    `gm=${clamp(cb.gm, -0.35, 0.35)}`,
    `bm=${clamp(cb.bm, -0.35, 0.35)}`,
    `rh=${clamp(cb.rh, -0.35, 0.35)}`,
    `gh=${clamp(cb.gh, -0.35, 0.35)}`,
    `bh=${clamp(cb.bh, -0.35, 0.35)}`,
  ].join(':');

  return [
    `colorbalance=${cbArgs}`,
    `eq=brightness=${b}:contrast=${c}:saturation=${s}:gamma=${g}`,
    'unsharp=3:3:0.32:3:3:0.0',
  ].join(',');
}

export interface SafeZoneLayout {
  targetWidth: number;
  targetHeight: number;
  activeWidth: number;
  activeHeight: number;
  padX: number;
  padY: number;
  safeX: number;
  safeY: number;
  safeWidth: number;
  safeHeight: number;
  marginL: number;
  marginR: number;
  marginV: number;
  fontScale: number;
  isPortrait: boolean;
}

function toEven(value: number, min = 2): number {
  const floored = Math.floor(value);
  return Math.max(min, floored - (floored % 2));
}

/**
 * Builds multi-stage studio DSP chains simulating broadcast vocal booths:
 * Stage 1: 48kHz headroom + sub-rumble highpass + FFT denoise (afftdn) + expander/gate (agate)
 * Stage 2: Vocal-tract pitch/formant shaping
 * Stage 3: Multi-band parametric EQ + de-essing
 * Stage 4: Analog harmonic warmth / spatial booth or sci-fi modulation
 * Stage 5: Compander transfer curve + dynamic compressor
 * Stage 6: Lookahead brickwall limiter (alimiter) + EBU R128 broadcast loudnorm
 */
export function buildAudioFilterChain(voiceId: VoiceId, hasAudio: boolean): string | null {
  if (!hasAudio) {
    return null;
  }

  const studioPreStage = [
    'aresample=48000',
    'highpass=f=75',
    'afftdn=nr=10:nf=-48',
    'agate=threshold=0.015:ratio=3.5:attack=4:release=140:range=0.08:knee=2.5',
  ];

  const studioMasterStage = [
    'alimiter=limit=0.92:attack=2:release=40:level=disabled',
    'loudnorm=I=-14:TP=-1.0:LRA=7',
  ];

  switch (voiceId) {
    case 'marcus':
      return [
        ...studioPreStage,
        'asetrate=48000*0.76',
        'aresample=48000',
        'atempo=1.3158',
        'equalizer=f=85:t=q:w=0.8:g=11',
        'equalizer=f=360:t=q:w=1.3:g=-4.5',
        'equalizer=f=2100:t=q:w=1.2:g=5',
        'equalizer=f=6800:t=q:w=0.9:g=-3',
        'deesser=i=0.45:m=0.5:f=0.55:s=o',
        'asoftclip=type=tanh',
        'aecho=0.8:0.85:18:0.15',
        'compand=attacks=0.012:decays=0.18:points=-80/-90|-45/-48|-24/-20|-12/-10|0/-3:soft-knee=6',
        'acompressor=threshold=-20dB:ratio=4.5:attack=5:release=95:makeup=2',
        ...studioMasterStage,
      ].join(',');

    case 'elena':
      return [
        ...studioPreStage,
        'asetrate=48000*1.26',
        'aresample=48000',
        'atempo=0.7937',
        'highpass=f=135',
        'equalizer=f=320:t=q:w=1.2:g=-3',
        'equalizer=f=3200:t=q:w=1.1:g=6.5',
        'equalizer=f=8500:t=q:w=1.2:g=5.5',
        'deesser=i=0.55:m=0.55:f=0.6:s=o',
        'crystalizer=i=2.2',
        'compand=attacks=0.01:decays=0.15:points=-80/-90|-45/-47|-22/-19|-10/-9|0/-3:soft-knee=6',
        'acompressor=threshold=-18dB:ratio=3.5:attack=5:release=80:makeup=1.5',
        ...studioMasterStage,
      ].join(',');

    case 'dexter':
      return [
        ...studioPreStage,
        'asetrate=48000*0.85',
        'aresample=48000',
        'atempo=1.1765',
        'tremolo=f=42:d=0.72',
        'acrusher=bits=6:mix=0.42',
        'flanger=delay=8:depth=10:regen=75:width=100:speed=4:shape=triangular',
        'chorus=0.55:0.9:25|45|65:0.45|0.35|0.25:0.3|0.45|0.5:2.2|2.6|3.0',
        'highpass=f=150',
        'equalizer=f=1350:t=q:w=1.2:g=7',
        'equalizer=f=3600:t=q:w=1.4:g=4.5',
        'compand=attacks=0.008:decays=0.12:points=-80/-90|-40/-42|-20/-17|0/-3:soft-knee=4',
        'acompressor=threshold=-19dB:ratio=5:attack=3:release=70',
        ...studioMasterStage,
      ].join(',');

    case 'leo':
      return [
        ...studioPreStage,
        'highpass=f=460',
        'lowpass=f=2450',
        'equalizer=f=680:t=q:w=1.0:g=3.5',
        'equalizer=f=1250:t=q:w=1.1:g=9.5',
        'equalizer=f=2000:t=q:w=1.3:g=4',
        'compand=attacks=0.005:decays=0.14:points=-80/-90|-42/-44|-22/-16|0/-3:soft-knee=5',
        'acompressor=threshold=-24dB:ratio=8:attack=2:release=45:makeup=2.5',
        'asoftclip=type=tanh',
        'acrusher=bits=9:mix=0.20',
        ...studioMasterStage,
      ].join(',');

    case 'oliver':
      return [
        ...studioPreStage,
        'asetrate=48000*1.44',
        'aresample=48000',
        'atempo=0.75',
        'highpass=f=180',
        'equalizer=f=450:t=q:w=1.3:g=-3',
        'equalizer=f=2800:t=q:w=1.1:g=7',
        'equalizer=f=7200:t=q:w=1.2:g=4',
        'deesser=i=0.45:m=0.5:f=0.6:s=o',
        'crystalizer=i=1.8',
        'compand=attacks=0.01:decays=0.14:points=-80/-90|-44/-46|-20/-17|0/-3:soft-knee=5',
        'acompressor=threshold=-17dB:ratio=3.8:attack=4:release=60:makeup=1.5',
        ...studioMasterStage,
      ].join(',');

    case 'victor':
      return [
        ...studioPreStage,
        'asetrate=48000*0.64',
        'aresample=48000',
        'atempo=1.5625',
        'equalizer=f=62:t=q:w=0.65:g=13',
        'equalizer=f=320:t=q:w=1.2:g=-4',
        'equalizer=f=1500:t=q:w=1.2:g=5.5',
        'equalizer=f=5200:t=q:w=0.9:g=-3.5',
        'asoftclip=type=tanh',
        'aecho=0.8:0.88:36|78:0.26|0.14',
        'compand=attacks=0.008:decays=0.22:points=-80/-90|-44/-48|-24/-18|-10/-8|0/-2:soft-knee=6',
        'acompressor=threshold=-22dB:ratio=7:attack=2:release=90:makeup=3',
        ...studioMasterStage,
      ].join(',');

    case 'original':
    default:
      return [
        ...studioPreStage,
        'equalizer=f=280:t=q:w=1.2:g=-2',
        'equalizer=f=3000:t=q:w=1.2:g=2.5',
        'equalizer=f=8500:t=q:w=1.1:g=2',
        'deesser=i=0.3:m=0.4:f=0.55:s=o',
        'compand=attacks=0.015:decays=0.18:points=-80/-90|-45/-47|-22/-19|0/-3:soft-knee=6',
        'acompressor=threshold=-19dB:ratio=3:attack=6:release=90',
        ...studioMasterStage,
      ].join(',');
  }
}

/**
 * Builds the audio filter_complex fragment when embedding a generated AI voiceover track.
 * Supports:
 * - 'asmr_only': mutes center-panned spoken vocals and notches tonal music bands while keeping crispy ASMR / SFX foley audible with automatic voiceover sidechain ducking
 * - 'replace_all': mutes source audio completely so only the AI voiceover plays
 * - 'ambient_bed': retains softened source track with sidechain ducking
 */
export function buildVoiceoverMixFilterGraph(opts: {
  hasSourceAudio: boolean;
  audioMixMode: AudioMixMode;
  isStereoAudio: boolean;
  sourceDurationSec?: number;
}): string {
  const voMasterChain =
    'aresample=48000,highpass=f=70,deesser=i=0.3:m=0.4:f=0.55:s=o,acompressor=threshold=-18dB:ratio=3:attack=5:release=90,alimiter=limit=0.92:attack=2:release=40:level=disabled';

  const padFilter =
    opts.sourceDurationSec && opts.sourceDurationSec > 0
      ? `,apad=whole_dur=${opts.sourceDurationSec.toFixed(2)}`
      : ',apad';

  if (!opts.hasSourceAudio || opts.audioMixMode === 'replace_all') {
    return `[1:a]${voMasterChain}${padFilter},loudnorm=I=-14:TP=-1.0:LRA=7[aout]`;
  }

  // ASMR/Environmental isolation: cancel center-panned speech & remove melodic mid-range music while lifting airy environmental detail
  const sourceIsolateChain =
    opts.audioMixMode === 'asmr_only'
      ? opts.isStereoAudio
        ? [
            'aresample=48000',
            'aformat=channel_layouts=stereo',
            'stereotools=mlev=0.04:slev=1.24',
            'highpass=f=120',
            'equalizer=f=320:t=q:w=0.8:g=-12',
            'equalizer=f=1200:t=q:w=0.7:g=-14',
            'equalizer=f=2800:t=q:w=0.8:g=-10',
            'highshelf=f=6500:g=4.5',
            'volume=0.52',
          ].join(',')
        : [
            'aresample=48000',
            'aformat=channel_layouts=stereo',
            'highpass=f=180',
            'equalizer=f=350:t=q:w=0.7:g=-15',
            'equalizer=f=1400:t=q:w=0.7:g=-16',
            'equalizer=f=2900:t=q:w=0.8:g=-12',
            'highshelf=f=6500:g=4.0',
            'volume=0.42',
          ].join(',')
      : ['aresample=48000', 'aformat=channel_layouts=stereo', 'volume=0.35'].join(',');

  const bedPad =
    opts.sourceDurationSec && opts.sourceDurationSec > 0
      ? `,apad=whole_dur=${opts.sourceDurationSec.toFixed(2)}`
      : '';

  return [
    `[0:a]${sourceIsolateChain}${bedPad}[bed]`,
    `[1:a]${voMasterChain},aformat=channel_layouts=stereo${padFilter},volume=1.18,asplit=2[vo_sc][vo_mix]`,
    `[bed][vo_sc]sidechaincompress=threshold=0.022:ratio=4.5:attack=10:release=160[bed_duck]`,
    `[bed_duck][vo_mix]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.92:attack=2:release=40:level=disabled,loudnorm=I=-14:TP=-1.0:LRA=7[aout]`,
  ].join(';');
}

/**
 * Builds the FFmpeg color grading filter string for each preset.
 */
export function buildColorGradeFilter(
  colorGradeId: ColorGradeId,
  frameStats?: FrameLumaStats,
  contentAwareAnalysis?: ContentAwareColorAnalysis
): string | null {
  switch (colorGradeId) {
    case 'ai_content_aware':
      return buildContentAwareColorFilter(contentAwareAnalysis, frameStats);

    case 'ai_auto_balance':
      return computeAutoBalanceFilter(frameStats).filter;

    case 'teal_orange':
      return 'colorbalance=rs=-0.12:gs=-0.02:bs=0.14:rm=0.06:gm=0.0:bm=-0.06:rh=0.14:gh=0.04:bh=-0.12,eq=contrast=1.12:saturation=1.18';

    case 'moody_noir':
      return "hue=s=0,curves=master='0/0 0.25/0.14 0.5/0.5 0.75/0.88 1/1',eq=contrast=1.24:brightness=-0.03";

    case 'vintage_70s':
      return "curves=r='0/0.05 0.5/0.56 1/0.96':g='0/0.03 0.5/0.51 1/0.92':b='0/0.08 0.5/0.44 1/0.82',eq=saturation=0.88:contrast=1.04";

    case 'cyberpunk_neon':
      return 'colorbalance=rs=-0.18:gs=-0.08:bs=0.22:rh=0.18:gh=-0.08:bh=0.18,eq=contrast=1.18:saturation=1.32';

    case 'cold_nordic':
      return 'colorbalance=rs=-0.14:gs=0.04:bs=0.14:rm=-0.08:gm=0.02:bm=0.08,eq=saturation=0.72:contrast=1.12';

    case 'golden_sunset':
      return 'colorbalance=rs=0.12:gs=0.05:bs=-0.10:rh=0.20:gh=0.10:bh=-0.14,eq=saturation=1.16:brightness=0.02';

    case 'none':
    default:
      return null;
  }
}

/**
 * Computes exact even target dimensions from resolution tier (720p to 4K) and aspect frame.
 */
export function computeTargetDimensions(
  sourceWidth: number,
  sourceHeight: number,
  frameAspect: FrameAspectId = 'auto',
  resolutionTier: ResolutionTierId = '1080p'
): { targetWidth: number; targetHeight: number } {
  const safeW = Math.max(2, sourceWidth || 1280);
  const safeH = Math.max(2, sourceHeight || 720);
  const resPreset = RESOLUTION_PRESETS.find((r) => r.id === resolutionTier) ?? RESOLUTION_PRESETS[1];
  const shortEdge = resPreset.shortEdge;

  if (frameAspect === 'auto') {
    const isPortrait = safeH > safeW;
    if (isPortrait) {
      return {
        targetWidth: toEven(shortEdge),
        targetHeight: toEven((shortEdge * safeH) / safeW),
      };
    }
    return {
      targetWidth: toEven((shortEdge * safeW) / safeH),
      targetHeight: toEven(shortEdge),
    };
  }

  const aspectPreset = FRAME_ASPECT_PRESETS.find((a) => a.id === frameAspect);
  const ratio = aspectPreset?.ratio ?? safeW / safeH;

  if (ratio < 1) {
    return {
      targetWidth: toEven(shortEdge),
      targetHeight: toEven(shortEdge / ratio),
    };
  }

  return {
    targetWidth: toEven(shortEdge * ratio),
    targetHeight: toEven(shortEdge),
  };
}

export function computeTarget1080pDimensions(
  sourceWidth: number,
  sourceHeight: number
): { targetWidth: number; targetHeight: number } {
  const safeW = Math.max(2, sourceWidth || 1280);
  const safeH = Math.max(2, sourceHeight || 720);
  const isPortrait = safeH > safeW;

  if (isPortrait) {
    if (safeW >= 1080 && safeH >= 1920) {
      return { targetWidth: toEven(safeW), targetHeight: toEven(safeH) };
    }
    return { targetWidth: 1080, targetHeight: 1920 };
  }

  if (safeW >= 1920 && safeH >= 1080) {
    return { targetWidth: toEven(safeW), targetHeight: toEven(safeH) };
  }
  return { targetWidth: 1920, targetHeight: 1080 };
}

/**
 * Computes the active inner video frame bounds and even-aligned safe-zone box
 * with edge padding across 9:16, 16:9, 1:1, 4:5, 4:3, and 21:9 renders from 720p to 4K.
 */
export function computeSafeZoneLayout(
  sourceWidth: number,
  sourceHeight: number,
  frameAspect: FrameAspectId = 'auto',
  resolutionTier: ResolutionTierId = '1080p',
  frameFit: FrameFitMode = 'fit'
): SafeZoneLayout {
  const safeW = Math.max(2, sourceWidth || 1280);
  const safeH = Math.max(2, sourceHeight || 720);
  const { targetWidth, targetHeight } = computeTargetDimensions(
    safeW,
    safeH,
    frameAspect,
    resolutionTier
  );
  const isPortrait = targetHeight > targetWidth;

  let activeWidth = targetWidth;
  let activeHeight = targetHeight;
  let padX = 0;
  let padY = 0;

  if (frameFit === 'fit') {
    const scaleFactor = Math.min(targetWidth / safeW, targetHeight / safeH);
    activeWidth = Math.round(safeW * scaleFactor);
    activeHeight = Math.round(safeH * scaleFactor);
    padX = Math.max(0, Math.floor((targetWidth - activeWidth) / 2));
    padY = Math.max(0, Math.floor((targetHeight - activeHeight) / 2));
  }

  const horizEdgeRatio = isPortrait ? 0.10 : 0.07;
  const topEdgeRatio = isPortrait ? 0.08 : 0.06;
  const bottomEdgeRatio = isPortrait ? 0.15 : 0.07;

  const marginL = padX + Math.round(activeWidth * horizEdgeRatio);
  const marginR = padX + Math.round(activeWidth * horizEdgeRatio);
  const marginV = padY + Math.round(activeHeight * bottomEdgeRatio);
  const marginTop = padY + Math.round(activeHeight * topEdgeRatio);

  const safeX = toEven(marginL, 0);
  const safeY = toEven(marginTop, 0);
  const safeWidth = toEven(Math.min(targetWidth - safeX, targetWidth - safeX - marginR), 240);
  const safeHeight = toEven(Math.min(targetHeight - safeY, targetHeight - safeY - marginV), 240);

  const fontScale = Number(Math.max(0.46, Math.min(2.0, activeWidth / 1600)).toFixed(3));

  return {
    targetWidth,
    targetHeight,
    activeWidth,
    activeHeight,
    padX,
    padY,
    safeX,
    safeY,
    safeWidth,
    safeHeight,
    marginL,
    marginR,
    marginV,
    fontScale,
    isPortrait,
  };
}

/**
 * Builds the scale + pad (fit) or scale + center-crop (fill) filtergraph segment.
 */
export function buildScaleFrameFilter(
  sourceWidth: number,
  sourceHeight: number,
  frameAspect: FrameAspectId = 'auto',
  resolutionTier: ResolutionTierId = '1080p',
  frameFit: FrameFitMode = 'fit'
): string {
  const { targetWidth, targetHeight } = computeTargetDimensions(
    sourceWidth,
    sourceHeight,
    frameAspect,
    resolutionTier
  );

  if (frameFit === 'fill') {
    return [
      `scale=w=${targetWidth}:h=${targetHeight}:force_original_aspect_ratio=increase:flags=bicubic`,
      `crop=${targetWidth}:${targetHeight}`,
      'setsar=1',
    ].join(',');
  }

  return [
    `scale=w=${targetWidth}:h=${targetHeight}:force_original_aspect_ratio=decrease:flags=bicubic`,
    `pad=${targetWidth}:${targetHeight}:(ow-iw)/2:(oh-ih)/2:color=#0d0b14`,
    'setsar=1',
  ].join(',');
}

export function build1080pScalePadFilter(sourceWidth: number, sourceHeight: number): string {
  return buildScaleFrameFilter(sourceWidth, sourceHeight, 'auto', '1080p', 'fit');
}

/**
 * Builds the FFmpeg subtitle burn-in video filtergraph segment bounded strictly inside
 * the computed safe-zone rectangle (crop -> ass:original_size -> overlay).
 */
export function buildSafeZoneSubtitleVideoGraph(
  preVideoFilters: string[],
  assFilePath: string,
  layout: SafeZoneLayout
): string {
  const escapedAss = escapeFilterPath(assFilePath);
  const baseChain = preVideoFilters.join(',');

  return [
    `[0:v]${baseChain},split=2[base][sub]`,
    `[sub]crop=${layout.safeWidth}:${layout.safeHeight}:${layout.safeX}:${layout.safeY},ass='${escapedAss}':original_size=${layout.safeWidth}x${layout.safeHeight}[cap]`,
    `[base][cap]overlay=${layout.safeX}:${layout.safeY},format=yuv420p[vout]`,
  ].join(';');
}

export function buildSafeZoneSubtitleFilterGraph(
  preVideoFilters: string[],
  assFilePath: string,
  layout: SafeZoneLayout,
  audioFilter: string | null,
  hasAudio: boolean
): string {
  const videoGraph = buildSafeZoneSubtitleVideoGraph(preVideoFilters, assFilePath, layout);
  if (hasAudio && audioFilter) {
    return `${videoGraph};[0:a]${audioFilter}[aout]`;
  }
  return videoGraph;
}

/**
 * Builds the fast multi-threaded CLI arguments for FFmpeg H.264/AAC MP4 output.
 */
export function buildFfmpegArgs(options: PipelineOptions): string[] {
  const frameAspect = options.frameAspect ?? 'auto';
  const resolutionTier = options.resolutionTier ?? '1080p';
  const frameFit = options.frameFit ?? 'fit';

  const preVideoFilters: string[] = [];

  const gradeFilter = buildColorGradeFilter(
    options.colorGradeId,
    options.frameStats,
    options.contentAwareAnalysis
  );
  if (gradeFilter) {
    preVideoFilters.push(gradeFilter);
  }

  preVideoFilters.push(
    buildScaleFrameFilter(
      options.sourceWidth,
      options.sourceHeight,
      frameAspect,
      resolutionTier,
      frameFit
    )
  );

  const hasVoiceover = Boolean(options.voiceoverPath);
  const hasCaptions = Boolean(options.captionsEnabled && options.assFilePath);

  const args: string[] = ['-y', '-threads', '0', '-i', options.inputPath];

  if (options.voiceoverPath) {
    args.push('-i', options.voiceoverPath);
  } else if (!options.hasAudio) {
    args.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000');
  }

  const audioMixMode: AudioMixMode = options.audioMixMode ?? 'asmr_only';

  if (hasVoiceover || hasCaptions) {
    const graphParts: string[] = [];

    if (hasCaptions && options.assFilePath) {
      const layout = computeSafeZoneLayout(
        options.sourceWidth,
        options.sourceHeight,
        frameAspect,
        resolutionTier,
        frameFit
      );
      graphParts.push(buildSafeZoneSubtitleVideoGraph(preVideoFilters, options.assFilePath, layout));
    } else {
      graphParts.push(`[0:v]${preVideoFilters.join(',')},format=yuv420p[vout]`);
    }

    if (hasVoiceover) {
      graphParts.push(
        buildVoiceoverMixFilterGraph({
          hasSourceAudio: options.hasAudio,
          audioMixMode,
          isStereoAudio: options.isStereoAudio ?? true,
          sourceDurationSec: options.sourceDurationSec,
        })
      );
      args.push('-filter_complex', graphParts.join(';'));
      args.push('-map', '[vout]', '-map', '[aout]');
      if (!options.hasAudio || audioMixMode === 'replace_all') {
        args.push('-shortest');
      }
    } else {
      const audioFilter = buildAudioFilterChain(options.voiceId, options.hasAudio);
      if (options.hasAudio && audioFilter) {
        graphParts.push(`[0:a]${audioFilter}[aout]`);
        args.push('-filter_complex', graphParts.join(';'));
        args.push('-map', '[vout]', '-map', '[aout]');
      } else {
        args.push('-filter_complex', graphParts.join(';'));
        args.push('-map', '[vout]', '-map', '1:a:0', '-shortest');
      }
    }
  } else {
    args.push('-vf', [...preVideoFilters, 'format=yuv420p'].join(','));
    const audioFilter = buildAudioFilterChain(options.voiceId, options.hasAudio);
    if (options.hasAudio && audioFilter) {
      args.push('-af', audioFilter);
    } else if (!options.hasAudio) {
      args.push('-map', '0:v:0', '-map', '1:a:0', '-shortest');
    }
  }

  const encodePreset =
    resolutionTier === '2160p' || resolutionTier === '1440p' ? 'superfast' : 'veryfast';

  args.push(
    '-c:v',
    'libx264',
    '-preset',
    encodePreset,
    '-tune',
    'fastdecode',
    '-crf',
    '21',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-ar',
    '48000',
    '-movflags',
    '+faststart',
    options.outputPath
  );

  return args;
}
