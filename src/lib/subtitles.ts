import {
  CAPTION_STYLE_PRESETS,
  hexToAssColor,
  positionToAlignment,
  type CaptionAnimationKind,
  type CaptionStyleId,
  type CustomCaptionStyle,
  type FrameAspectId,
  type FrameFitMode,
  type ResolutionTierId,
  type SubtitleSegment,
} from './studioPresets.ts';
import { computeSafeZoneLayout } from './ffmpegPipeline.ts';

function pad2(n: number): string {
  return String(Math.floor(n)).padStart(2, '0');
}

export function formatSrtTime(seconds: number): string {
  const safe = Math.max(0, seconds);
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = Math.floor(safe % 60);
  const ms = Math.round((safe - Math.floor(safe)) * 1000);
  const normalizedMs = ms >= 1000 ? 999 : ms;
  return `${pad2(hrs)}:${pad2(mins)}:${pad2(secs)},${String(normalizedMs).padStart(3, '0')}`;
}

export function formatAssTime(seconds: number): string {
  const safe = Math.max(0, seconds);
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = Math.floor(safe % 60);
  const cs = Math.min(99, Math.round((safe - Math.floor(safe)) * 100));
  return `${hrs}:${pad2(mins)}:${pad2(secs)}.${pad2(cs)}`;
}

export function escapeAssText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/\r?\n/g, '\\N')
    .trim();
}

/**
 * Wraps caption text to stay strictly inside horizontal safe-zone width without clipping.
 */
export function wrapCaptionText(text: string, maxCharsPerLine: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean || clean.length <= maxCharsPerLine) return clean;

  const words = clean.split(' ');
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    if (!current) {
      current = word;
    } else if (current.length + 1 + word.length <= maxCharsPerLine) {
      current = `${current} ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);

  return lines.join('\n');
}

function buildAnimatedAssLine(
  wrappedText: string,
  durationSec: number,
  animation: CaptionAnimationKind
): string {
  const lines = wrappedText.split('\n');
  const escapedLines = lines.map((line) => escapeAssText(line));

  if (animation === 'none') {
    return escapedLines.join('\\N');
  }

  let prefix = '';
  let karaokeTag: 'k' | 'kf' | null = null;

  switch (animation) {
    case 'karaoke-bounce':
      prefix = '{\\fscx78\\fscy78\\t(0,95,\\fscx108\\fscy108)\\t(95,180,\\fscx100\\fscy100)}';
      karaokeTag = 'k';
      break;
    case 'elastic-pop':
      prefix = '{\\fad(50,40)\\fscx70\\fscy118\\t(0,110,\\fscx108\\fscy95)\\t(110,200,\\fscx100\\fscy100)}';
      karaokeTag = 'k';
      break;
    case 'glitch-pulse':
      prefix = '{\\blur4\\frz-1.5\\fscx88\\fscy88\\t(0,110,\\blur1\\frz1\\fscx106\\fscy106)\\t(110,220,\\blur0\\frz0\\fscx100\\fscy100)}';
      karaokeTag = 'kf';
      break;
    case 'aura-wave':
      prefix = '{\\fad(90,60)\\blur4\\fscx86\\fscy86\\t(0,180,\\blur1.2\\fscx104\\fscy104)\\t(180,320,\\blur0.5\\fscx100\\fscy100)}';
      karaokeTag = 'kf';
      break;
    case 'comic-slam':
      prefix = '{\\frz-3\\fscx135\\fscy135\\t(0,110,\\frz1\\fscx96\\fscy96)\\t(110,190,\\frz0\\fscx100\\fscy100)}';
      karaokeTag = 'k';
      break;
    case 'flash-alert':
      prefix = '{\\fscx84\\fscy84\\t(0,80,\\fscx112\\fscy112)\\t(80,160,\\fscx100\\fscy100)}';
      karaokeTag = 'k';
      break;
    case 'karaoke-sweep':
      prefix = '{\\fad(70,50)\\fscx90\\fscy90\\t(0,140,\\fscx103\\fscy103)\\t(140,240,\\fscx100\\fscy100)}';
      karaokeTag = 'kf';
      break;
  }

  if (!karaokeTag) {
    return `${prefix}${escapedLines.join('\\N')}`;
  }

  // Distribute karaoke timing across every word on every wrapped line
  const lineWords = escapedLines.map((line) => line.split(' ').filter(Boolean));
  const totalWords = lineWords.reduce((sum, words) => sum + words.length, 0);
  if (totalWords <= 0) {
    return `${prefix}${escapedLines.join('\\N')}`;
  }

  const totalCs = Math.max(25, Math.round(durationSec * 100));
  const baseCs = Math.max(8, Math.floor(totalCs / totalWords));
  let remainder = Math.max(0, totalCs - baseCs * totalWords);

  const animatedLines = lineWords.map((words) =>
    words
      .map((word) => {
        const extra = remainder > 0 ? 1 : 0;
        if (remainder > 0) remainder -= 1;
        const cs = baseCs + extra;
        return `{\\${karaokeTag}${cs}}${word}`;
      })
      .join(' ')
  );

  return `${prefix}${animatedLines.join('\\N')}`;
}

export interface CaptionOptimizationOptions {
  maxWordsPerCue?: number;
  minCueDurationSec?: number;
}

/**
 * Optimizes AI caption timing and pacing:
 * - Splits overly long dialogue lines into punchy 3–6 word cues on natural phrase boundaries
 * - Proportionally interpolates word-accurate start/end timestamps
 * - Enforces strictly monotonic non-overlapping timestamps
 */
export function optimizeCaptionSegments(
  segments: SubtitleSegment[],
  options: CaptionOptimizationOptions = {}
): SubtitleSegment[] {
  const maxWordsPerCue = Math.max(3, options.maxWordsPerCue ?? 6);
  const minCueDurationSec = Math.max(0.25, options.minCueDurationSec ?? 0.35);

  const base = normalizeSegments(segments);
  const expanded: SubtitleSegment[] = [];

  for (const seg of base) {
    const words = seg.text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
    if (words.length <= maxWordsPerCue) {
      expanded.push(seg);
      continue;
    }

    // Split into balanced chunks respecting punctuation boundaries where possible
    const chunks: string[][] = [];
    let current: string[] = [];
    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      current.push(word);
      const endsPhrase = /[,.;:!?]$/.test(word) && current.length >= 2;
      const reachedMax = current.length >= maxWordsPerCue;
      const remaining = words.length - 1 - i;

      if ((endsPhrase && remaining >= 2) || reachedMax) {
        chunks.push(current);
        current = [];
      }
    }
    if (current.length > 0) {
      // Avoid tiny 1-word trailing orphan if previous chunk can absorb or balance cleanly
      if (current.length === 1 && chunks.length > 0 && chunks[chunks.length - 1].length < maxWordsPerCue + 1) {
        chunks[chunks.length - 1].push(current[0]);
      } else {
        chunks.push(current);
      }
    }

    const totalWords = chunks.reduce((sum, c) => sum + c.length, 0);
    const totalDuration = Math.max(minCueDurationSec * chunks.length, seg.endSec - seg.startSec);
    let cursor = seg.startSec;

    chunks.forEach((chunkWords, idx) => {
      const share = (chunkWords.length / totalWords) * totalDuration;
      const chunkStart = Number(cursor.toFixed(2));
      const rawEnd = idx === chunks.length - 1 ? Math.max(seg.endSec, cursor + share) : cursor + share;
      const chunkEnd = Number(Math.max(chunkStart + 0.25, rawEnd).toFixed(2));
      expanded.push({
        id: `${seg.id}-${idx + 1}`,
        startSec: chunkStart,
        endSec: chunkEnd,
        text: chunkWords.join(' '),
      });
      cursor = chunkEnd;
    });
  }

  return normalizeSegments(expanded);
}

export function normalizeSegments(segments: SubtitleSegment[]): SubtitleSegment[] {
  const sorted = segments
    .filter((seg) => seg.text.trim().length > 0 && Number.isFinite(seg.startSec) && Number.isFinite(seg.endSec))
    .map((seg, idx) => {
      const start = Math.max(0, seg.startSec);
      const end = Math.max(start + 0.25, seg.endSec);
      return {
        id: seg.id || `seg-${idx + 1}`,
        startSec: Number(start.toFixed(2)),
        endSec: Number(end.toFixed(2)),
        text: seg.text.replace(/\s+/g, ' ').trim(),
      };
    })
    .sort((a, b) => a.startSec - b.startSec);

  // Prevent ASS line collision by clamping overlaps cleanly
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].startSec < sorted[i - 1].endSec) {
      const midpoint = Number(((sorted[i - 1].startSec + sorted[i].startSec) / 2 + 0.15).toFixed(2));
      if (midpoint > sorted[i - 1].startSec + 0.25 && midpoint < sorted[i].endSec - 0.2) {
        sorted[i - 1].endSec = midpoint;
        sorted[i].startSec = midpoint;
      } else {
        sorted[i].startSec = Number(Math.min(sorted[i - 1].endSec, sorted[i].endSec - 0.25).toFixed(2));
      }
    }
  }

  return sorted;
}

export function toSrt(segments: SubtitleSegment[]): string {
  const clean = normalizeSegments(segments);
  return clean
    .map((seg, idx) => {
      return `${idx + 1}\n${formatSrtTime(seg.startSec)} --> ${formatSrtTime(seg.endSec)}\n${seg.text}`;
    })
    .join('\n\n')
    .concat(clean.length > 0 ? '\n' : '');
}

/**
 * Generates an ASS subtitle script with automatic safe-zone margins,
 * aspect-ratio-aware font scaling, word wrapping, and kinetic animations.
 */
export function toAss(
  segments: SubtitleSegment[],
  styleId: CaptionStyleId,
  sourceWidth = 1920,
  sourceHeight = 1080,
  frameAspect: FrameAspectId = 'auto',
  resolutionTier: ResolutionTierId = '1080p',
  frameFit: FrameFitMode = 'fit',
  customStyle?: Partial<CustomCaptionStyle>
): string {
  const stylePreset =
    CAPTION_STYLE_PRESETS.find((s) => s.id === styleId) ?? CAPTION_STYLE_PRESETS[0];
  const base = stylePreset.ass;

  const borderStyle: 1 | 3 =
    typeof customStyle?.backgroundEnabled === 'boolean'
      ? customStyle.backgroundEnabled
        ? 3
        : 1
      : base.borderStyle;

  const fontName = customStyle?.fontName?.trim() || base.fontName;
  const fontSize =
    typeof customStyle?.fontSize === 'number' && Number.isFinite(customStyle.fontSize)
      ? Math.max(28, Math.min(110, Math.round(customStyle.fontSize)))
      : base.fontSize;
  const primaryColour = customStyle?.primaryColor
    ? hexToAssColor(customStyle.primaryColor, '00')
    : base.primaryColour;
  const secondaryColour = customStyle?.primaryColor ? '&H00FFFFFF' : base.secondaryColour;
  const bgHex = customStyle?.backgroundColor;
  const backColour = bgHex ? hexToAssColor(bgHex, '45') : base.backColour;
  const outlineColour =
    borderStyle === 3
      ? bgHex
        ? hexToAssColor(bgHex, '45')
        : base.backColour
      : customStyle?.outlineColor
        ? hexToAssColor(customStyle.outlineColor, '00')
        : base.outlineColour;
  const outlineRaw =
    borderStyle === 3
      ? Math.max(8, Math.round((customStyle?.outlineWidth ?? 4) * 2.5))
      : typeof customStyle?.outlineWidth === 'number' && Number.isFinite(customStyle.outlineWidth)
        ? Math.max(0, Math.min(12, Math.round(customStyle.outlineWidth)))
        : base.outline;
  const shadowRaw = borderStyle === 3 ? 0 : base.shadow;
  const bold: 0 | -1 =
    typeof customStyle?.bold === 'boolean' ? (customStyle.bold ? -1 : 0) : base.bold;
  const italic: 0 | -1 =
    typeof customStyle?.italic === 'boolean' ? (customStyle.italic ? -1 : 0) : base.italic;
  const uppercase =
    typeof customStyle?.uppercase === 'boolean' ? customStyle.uppercase : Boolean(base.uppercase);
  const alignment = customStyle?.position
    ? positionToAlignment(customStyle.position)
    : base.alignment;
  const animation: CaptionAnimationKind = customStyle?.animation ?? base.animation;

  const clean = normalizeSegments(segments);

  const layout = computeSafeZoneLayout(
    sourceWidth,
    sourceHeight,
    frameAspect,
    resolutionTier,
    frameFit
  );
  const scaledFontSize = Math.max(26, Math.round(fontSize * layout.fontScale));
  const scaledOutline =
    outlineRaw === 0 ? 0 : Math.max(1, Math.round(outlineRaw * layout.fontScale));
  const scaledShadow = Math.max(0, Math.round(shadowRaw * layout.fontScale));

  const innerMarginH = 20;
  const innerMarginV = 16;

  const avgGlyphFactor = uppercase ? 0.62 : 0.54;
  const usableWidth = Math.max(180, layout.safeWidth - innerMarginH * 2);
  const maxCharsPerLine = Math.max(12, Math.floor(usableWidth / (scaledFontSize * avgGlyphFactor)));

  const header = [
    '[Script Info]',
    '; Script generated by HarFrame Studio with Safe-Zone & Kinetic Animation',
    'Title: HarFrame Captions',
    'ScriptType: v4.00+',
    'WrapStyle: 1',
    'ScaledBorderAndShadow: yes',
    'YCbCr Matrix: TV.709',
    `PlayResX: ${layout.safeWidth}`,
    `PlayResY: ${layout.safeHeight}`,
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: HarFrameCaption,${fontName},${scaledFontSize},${primaryColour},${secondaryColour},${outlineColour},${backColour},${bold},${italic},0,0,100,100,0,0,${borderStyle},${scaledOutline},${scaledShadow},${alignment},${innerMarginH},${innerMarginH},${innerMarginV},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];

  const events = clean.map((seg) => {
    const raw = uppercase ? seg.text.toUpperCase() : seg.text;
    const wrapped = wrapCaptionText(raw, maxCharsPerLine);
    const animatedText = buildAnimatedAssLine(wrapped, seg.endSec - seg.startSec, animation);
    return `Dialogue: 0,${formatAssTime(seg.startSec)},${formatAssTime(seg.endSec)},HarFrameCaption,,0,0,0,,${animatedText}`;
  });

  return [...header, ...events, ''].join('\n');
}
