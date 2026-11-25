export type VoiceId =
  | 'original'
  | 'marcus'
  | 'elena'
  | 'dexter'
  | 'leo'
  | 'oliver'
  | 'victor';

export type AiVoiceProvider = 'edge' | 'gemini';

export type AiVoiceId =
  | 'aria_warm'
  | 'andrew_story'
  | 'brian_asmr'
  | 'emma_bright'
  | 'ryan_british'
  | 'gemini_kore'
  | 'gemini_fenrir'
  | 'gemini_puck';

export type AudioMixMode = 'asmr_only' | 'replace_all' | 'ambient_bed';

export interface AiVoiceProfile {
  id: AiVoiceId;
  name: string;
  role: string;
  provider: AiVoiceProvider;
  engineLabel: string;
  edgeVoiceName: string;
  geminiVoiceName: 'Kore' | 'Charon' | 'Zephyr' | 'Puck' | 'Fenrir';
  geminiStyle: string;
  samplePhrase: string;
  toneTag: string;
}

export const AI_VOICE_CATALOG: AiVoiceProfile[] = [
  {
    id: 'aria_warm',
    name: 'Aria',
    role: 'Warm Story Host',
    provider: 'edge',
    engineLabel: 'Natural Voice',
    edgeVoiceName: 'en-US-AriaNeural',
    geminiVoiceName: 'Kore',
    geminiStyle: 'Warm, articulate documentary narrator with natural pacing',
    samplePhrase: 'HarFrame turns every frame into a vivid, unforgettable story.',
    toneTag: 'Warm',
  },
  {
    id: 'andrew_story',
    name: 'Andrew',
    role: 'Calm Male Narrator',
    provider: 'edge',
    engineLabel: 'Natural Voice',
    edgeVoiceName: 'en-US-AndrewMultilingualNeural',
    geminiVoiceName: 'Charon',
    geminiStyle: 'Calm, confident conversational male storyteller',
    samplePhrase: 'Listen closely—sometimes the smallest detail changes the whole scene.',
    toneTag: 'Deep',
  },
  {
    id: 'brian_asmr',
    name: 'Brian',
    role: 'Soft ASMR Calm',
    provider: 'edge',
    engineLabel: 'Natural Voice',
    edgeVoiceName: 'en-US-BrianMultilingualNeural',
    geminiVoiceName: 'Zephyr',
    geminiStyle: 'Soft-spoken, gentle, relaxed close-mic voiceover',
    samplePhrase: 'Take a slow breath and let every gentle sound settle in.',
    toneTag: 'Soft ASMR',
  },
  {
    id: 'emma_bright',
    name: 'Emma',
    role: 'Upbeat Creator',
    provider: 'edge',
    engineLabel: 'Natural Voice',
    edgeVoiceName: 'en-US-EmmaMultilingualNeural',
    geminiVoiceName: 'Puck',
    geminiStyle: 'Crisp, upbeat short-form creator voice with lively hooks',
    samplePhrase: 'Wait until you see what happens in the very next second.',
    toneTag: 'Bright',
  },
  {
    id: 'ryan_british',
    name: 'Ryan',
    role: 'British Narrator',
    provider: 'edge',
    engineLabel: 'Natural Voice',
    edgeVoiceName: 'en-GB-RyanNeural',
    geminiVoiceName: 'Charon',
    geminiStyle: 'Polished British editorial documentary baritone',
    samplePhrase: 'Beneath the surface, an extraordinary craft comes sharply into focus.',
    toneTag: 'British',
  },
  {
    id: 'gemini_kore',
    name: 'Kore',
    role: 'Clear Broadcast Alto',
    provider: 'gemini',
    engineLabel: 'Expressive Voice',
    edgeVoiceName: 'en-US-JennyNeural',
    geminiVoiceName: 'Kore',
    geminiStyle: 'Clear, expressive broadcast narrator with warm resonance',
    samplePhrase: 'Every clip carries a rhythm—all it needs is the right voice.',
    toneTag: 'Alto',
  },
  {
    id: 'gemini_fenrir',
    name: 'Fenrir',
    role: 'Cinema Trailer Bass',
    provider: 'gemini',
    engineLabel: 'Expressive Voice',
    edgeVoiceName: 'en-US-ChristopherNeural',
    geminiVoiceName: 'Fenrir',
    geminiStyle: 'Deep cinematic trailer narrator with dramatic gravity',
    samplePhrase: 'When the lights fade down, the real story finally begins.',
    toneTag: 'Cinema',
  },
  {
    id: 'gemini_puck',
    name: 'Puck',
    role: 'Friendly Explainer',
    provider: 'gemini',
    engineLabel: 'Expressive Voice',
    edgeVoiceName: 'en-US-GuyNeural',
    geminiVoiceName: 'Puck',
    geminiStyle: 'Agile, friendly explainer with clear articulation',
    samplePhrase: 'Here is the hidden pattern most people miss on their first watch.',
    toneTag: 'Explainer',
  },
];

export interface AudioMixOption {
  id: AudioMixMode;
  label: string;
  description: string;
}

export const AUDIO_MIX_OPTIONS: AudioMixOption[] = [
  {
    id: 'asmr_only',
    label: 'Keep original environmental sound',
    description:
      'Keeps original environmental and ASMR sounds throughout the video while replacing vocals with your new voiceover.',
  },
  {
    id: 'replace_all',
    label: 'Replace all original sound',
    description:
      'Mutes all original video sound completely so only your new voiceover plays.',
  },
  {
    id: 'ambient_bed',
    label: 'Keep soft original sound',
    description:
      'Keeps quiet original background sound throughout the video beneath your new voiceover.',
  },
];

export const NARRATION_PROMPT_TEMPLATES = [
  {
    id: 'viral_hook',
    label: 'Story Hook',
    prompt:
      'Write a captivating first-sentence hook and crisp narrative voiceover describing what happens on screen with curiosity and emotional punch.',
  },
  {
    id: 'asmr_lore',
    label: 'Calm ASMR',
    prompt:
      'Write soothing, poetic, sensory-rich narration highlighting textures, motion, and small satisfying details without rushing.',
  },
  {
    id: 'documentary',
    label: 'Documentary',
    prompt:
      'Write an insightful documentary voiceover explaining the visual scene clearly with vivid, concise broadcast phrasing.',
  },
  {
    id: 'product_reveal',
    label: 'Quick Recap',
    prompt:
      'Summarize the key action happening in the clip in sharp, direct sentences ideal for short videos.',
  },
];

export type FrameAspectId =
  | 'auto'
  | '16:9'
  | '9:16'
  | '1:1'
  | '4:5'
  | '4:3'
  | '21:9';

export type ResolutionTierId = '720p' | '1080p' | '1440p' | '2160p';

export type FrameFitMode = 'fit' | 'fill';

export interface FrameAspectPreset {
  id: FrameAspectId;
  name: string;
  shortLabel: string;
  ratio: number | null; // width / height, null = auto from source
  useCase: string;
}

export interface ResolutionPreset {
  id: ResolutionTierId;
  name: string;
  shortEdge: number;
  badge: string;
}

export const FRAME_ASPECT_PRESETS: FrameAspectPreset[] = [
  {
    id: 'auto',
    name: 'Match Source Frame',
    shortLabel: 'Auto',
    ratio: null,
    useCase: 'Preserves original orientation',
  },
  {
    id: '9:16',
    name: 'Vertical (9:16)',
    shortLabel: '9:16',
    ratio: 9 / 16,
    useCase: 'Reels, TikTok, Shorts',
  },
  {
    id: '16:9',
    name: 'Horizontal (16:9)',
    shortLabel: '16:9',
    ratio: 16 / 9,
    useCase: 'YouTube, Widescreen',
  },
  {
    id: '1:1',
    name: 'Square (1:1)',
    shortLabel: '1:1',
    ratio: 1,
    useCase: 'Instagram & LinkedIn Feed',
  },
  {
    id: '4:5',
    name: 'Social Portrait (4:5)',
    shortLabel: '4:5',
    ratio: 4 / 5,
    useCase: 'Instagram Portrait',
  },
  {
    id: '4:3',
    name: 'Classic Broadcast (4:3)',
    shortLabel: '4:3',
    ratio: 4 / 3,
    useCase: 'Classic Film & Archive',
  },
  {
    id: '21:9',
    name: 'Cinema Scope (21:9)',
    shortLabel: '21:9',
    ratio: 21 / 9,
    useCase: 'Ultrawide Anamorphic',
  },
];

export const RESOLUTION_PRESETS: ResolutionPreset[] = [
  { id: '720p', name: '720p HD (Fastest)', shortEdge: 720, badge: 'HD' },
  { id: '1080p', name: '1080p Full HD', shortEdge: 1080, badge: 'FHD' },
  { id: '1440p', name: '1440p 2K QHD', shortEdge: 1440, badge: '2K' },
  { id: '2160p', name: '2160p 4K Ultra HD', shortEdge: 2160, badge: '4K' },
];

export type CaptionStyleId =
  | 'hormozi_yellow'
  | 'tiktok_neon_green'
  | 'netflix_classic'
  | 'cyberpunk_cyan'
  | 'golden_hour_amber'
  | 'red_alert_impact'
  | 'minimalist_dark_box'
  | 'anime_dub'
  | 'electric_violet'
  | 'vintage_typewriter'
  | 'comic_book_pop'
  | 'clean_slate'
  | 'karaoke_gold_rush'
  | 'retro_synthwave'
  | 'kinetic_word_slam'
  | 'documentary_lower_third'
  | 'editorial_serif_gold'
  | 'minimal_light_pill'
  | 'kinetic_cyan_pop';

export type CaptionAnimationKind =
  | 'none'
  | 'karaoke-bounce'
  | 'elastic-pop'
  | 'glitch-pulse'
  | 'aura-wave'
  | 'comic-slam'
  | 'flash-alert'
  | 'karaoke-sweep';

export type CaptionPosition = 'bottom' | 'middle' | 'top';
export type CaptionFolderCategory = 'Social Media' | 'Documentary' | 'Cinematic';

export const CAPTION_PRESET_FOLDERS: CaptionFolderCategory[] = [
  'Social Media',
  'Documentary',
  'Cinematic',
];

export interface CaptionFontOption {
  assFontName: string;
  label: string;
  cssFontFamily: string;
}

export const CAPTION_FONT_OPTIONS: CaptionFontOption[] = [
  {
    assFontName: 'Liberation Sans Narrow',
    label: 'Impact Condensed',
    cssFontFamily: "'Outfit', 'Liberation Sans Narrow', sans-serif",
  },
  {
    assFontName: 'Liberation Sans',
    label: 'Modern Sans',
    cssFontFamily: "'Plus Jakarta Sans', 'Liberation Sans', sans-serif",
  },
  {
    assFontName: 'Noto Sans',
    label: 'Clean Neutral Sans',
    cssFontFamily: "'Noto Sans', 'Plus Jakarta Sans', sans-serif",
  },
  {
    assFontName: 'Noto Sans Display',
    label: 'Display Bold',
    cssFontFamily: "'Outfit', 'Noto Sans Display', sans-serif",
  },
  {
    assFontName: 'DejaVu Sans',
    label: 'Wide Studio Sans',
    cssFontFamily: "'DejaVu Sans', 'Plus Jakarta Sans', sans-serif",
  },
  {
    assFontName: 'DejaVu Serif',
    label: 'Editorial Serif',
    cssFontFamily: "Georgia, 'DejaVu Serif', serif",
  },
  {
    assFontName: 'Liberation Serif',
    label: 'Cinema Classic Serif',
    cssFontFamily: "'Liberation Serif', Georgia, serif",
  },
  {
    assFontName: 'JetBrains Mono',
    label: 'Typewriter Mono',
    cssFontFamily: "'JetBrains Mono', monospace",
  },
];

export interface CustomCaptionStyle {
  fontName: string;
  primaryColor: string;
  outlineColor: string;
  backgroundColor: string;
  backgroundEnabled: boolean;
  fontSize: number;
  outlineWidth: number;
  bold: boolean;
  italic: boolean;
  uppercase: boolean;
  position: CaptionPosition;
  animation: CaptionAnimationKind;
}

export interface CustomCaptionPreset {
  id: string;
  name: string;
  folder: CaptionFolderCategory;
  baseStyleId: CaptionStyleId;
  customStyle: CustomCaptionStyle;
  createdAt: number;
}

export type ColorGradeId =
  | 'ai_content_aware'
  | 'ai_auto_balance'
  | 'teal_orange'
  | 'moody_noir'
  | 'vintage_70s'
  | 'cyberpunk_neon'
  | 'cold_nordic'
  | 'golden_sunset'
  | 'none';

export interface ContentAwareColorAnalysis {
  sceneType: string;
  lightingCondition: string;
  rationale: string;
  appliedBrightness: number;
  appliedContrast: number;
  appliedSaturation: number;
  appliedGamma: number;
  colorBalance: {
    rs: number;
    gs: number;
    bs: number;
    rm: number;
    gm: number;
    bm: number;
    rh: number;
    gh: number;
    bh: number;
  };
  avgLuma: number;
  minLuma: number;
  maxLuma: number;
  cssPreviewFilter: string;
  engine?: string;
}

export interface CharacterVoicePreset {
  id: VoiceId;
  name: string;
  role: string;
  dspSummary: string;
  pitchShiftLabel: string;
}

export interface AssStyleSpec {
  fontName: string;
  fontSize: number;
  primaryColour: string;
  secondaryColour: string;
  outlineColour: string;
  backColour: string;
  bold: 0 | -1;
  italic: 0 | -1;
  borderStyle: 1 | 3;
  outline: number;
  shadow: number;
  alignment: number;
  marginV: number;
  uppercase?: boolean;
  animation: CaptionAnimationKind;
}

export interface CaptionStylePreset {
  id: CaptionStyleId;
  name: string;
  description: string;
  isAnimated?: boolean;
  ass: AssStyleSpec;
  previewCss: {
    color: string;
    fontFamily: string;
    fontWeight: number;
    textTransform?: 'uppercase' | 'none';
    textShadow: string;
    backgroundColor?: string;
    padding?: string;
    borderRadius?: string;
    WebkitTextStroke?: string;
  };
}

export interface ColorGradePreset {
  id: ColorGradeId;
  name: string;
  description: string;
  cssFilter: string;
  swatchColors: [string, string, string];
}

export interface SubtitleSegment {
  id: string;
  startSec: number;
  endSec: number;
  text: string;
}

export interface VideoMetadata {
  jobId: string;
  filename: string;
  sourceUrl: string;
  sourceType: 'upload' | 'url' | 'sample';
  width: number;
  height: number;
  durationSec: number;
  fps: number;
  hasAudio: boolean;
  isStereoAudio?: boolean;
  codec: string;
  fileSizeBytes: number;
}

export interface RenderResult {
  jobId: string;
  outputUrl: string;
  downloadUrl: string;
  srtUrl?: string;
  assUrl?: string;
  width: number;
  height: number;
  durationSec: number;
  fileSizeBytes: number;
  voiceId: VoiceId;
  aiVoiceId?: AiVoiceId;
  voiceoverEmbedded?: boolean;
  audioMixMode?: AudioMixMode;
  frameAspect: FrameAspectId;
  resolutionTier: ResolutionTierId;
  frameFit: FrameFitMode;
  colorGradeId: ColorGradeId;
  captionsEnabled: boolean;
  captionStyleId: CaptionStyleId;
  customCaptionStyle?: CustomCaptionStyle;
  autoBalanceStats?: {
    avgLuma: number;
    minLuma: number;
    maxLuma: number;
    appliedBrightness: number;
    appliedContrast: number;
    appliedSaturation: number;
  };
  contentAwareStats?: ContentAwareColorAnalysis;
}

export function normalizeHexColor(hex: string, fallback = '#FFFFFF'): string {
  const trimmed = String(hex || '').trim();
  const match6 = /^#?([0-9a-f]{6})$/i.exec(trimmed);
  if (match6) return `#${match6[1].toUpperCase()}`;
  const match3 = /^#?([0-9a-f]{3})$/i.exec(trimmed);
  if (match3) {
    const [r, g, b] = match3[1].split('');
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  return fallback.toUpperCase();
}

export function hexToAssColor(hex: string, alphaHex = '00'): string {
  const norm = normalizeHexColor(hex, '#FFFFFF').slice(1);
  const r = norm.slice(0, 2);
  const g = norm.slice(2, 4);
  const b = norm.slice(4, 6);
  const alpha = /^[0-9a-f]{2}$/i.test(alphaHex) ? alphaHex.toUpperCase() : '00';
  return `&H${alpha}${b}${g}${r}`;
}

export function assColorToHex(assColor: string, fallback = '#FFFFFF'): string {
  const cleaned = String(assColor || '').trim().replace(/^&H/i, '').replace(/&$/, '');
  if (cleaned.length === 8) {
    const b = cleaned.slice(2, 4);
    const g = cleaned.slice(4, 6);
    const r = cleaned.slice(6, 8);
    return `#${r}${g}${b}`.toUpperCase();
  }
  if (cleaned.length === 6) {
    const b = cleaned.slice(0, 2);
    const g = cleaned.slice(2, 4);
    const r = cleaned.slice(4, 6);
    return `#${r}${g}${b}`.toUpperCase();
  }
  return normalizeHexColor(fallback);
}

export function alignmentToPosition(alignment: number): CaptionPosition {
  if (alignment >= 7) return 'top';
  if (alignment >= 4 && alignment <= 6) return 'middle';
  return 'bottom';
}

export function positionToAlignment(position: CaptionPosition): number {
  if (position === 'top') return 8;
  if (position === 'middle') return 5;
  return 2;
}

export function getCaptionFontCssFamily(assFontName: string): string {
  return (
    CAPTION_FONT_OPTIONS.find((f) => f.assFontName === assFontName)?.cssFontFamily ??
    `'${assFontName}', 'Plus Jakarta Sans', sans-serif`
  );
}

export function presetToCustomCaptionStyle(styleId: CaptionStyleId): CustomCaptionStyle {
  const preset =
    CAPTION_STYLE_PRESETS.find((c) => c.id === styleId) ?? CAPTION_STYLE_PRESETS[0];
  const a = preset.ass;
  return {
    fontName: a.fontName,
    primaryColor: assColorToHex(a.primaryColour, '#FFFFFF'),
    outlineColor: assColorToHex(a.outlineColour, '#000000'),
    backgroundColor: assColorToHex(a.backColour, '#0D0B14'),
    backgroundEnabled: a.borderStyle === 3,
    fontSize: a.fontSize,
    outlineWidth: a.borderStyle === 3 ? 3 : a.outline,
    bold: a.bold === -1,
    italic: a.italic === -1,
    uppercase: Boolean(a.uppercase),
    position: alignmentToPosition(a.alignment),
    animation: a.animation,
  };
}

export const VOICE_PRESETS: CharacterVoicePreset[] = [
  {
    id: 'original',
    name: 'Original Audio',
    role: 'Clean Studio Mastering',
    dspSummary: 'FFT denoise, noise gate, gentle vocal presence EQ, brickwall limiter & -14 LUFS master',
    pitchShiftLabel: 'Mastered 0%',
  },
  {
    id: 'marcus',
    name: 'Marcus',
    role: 'Studio Baritone Narrator',
    dspSummary: 'Gate + -24% vocal tract, 4-band chest/presence EQ, de-esser, tanh warmth, compand & FET comp',
    pitchShiftLabel: 'Deep Actor',
  },
  {
    id: 'elena',
    name: 'Elena',
    role: 'Broadcast Studio Host',
    dspSummary: 'FFT denoise + gate, +26% vocal tract, 4-band air EQ, de-esser, opto compressor & limiter',
    pitchShiftLabel: 'Crisp Host',
  },
  {
    id: 'dexter',
    name: 'Dexter',
    role: 'Cybernetic Android / Sci-Fi',
    dspSummary: 'Gate + -15% shift, 42Hz ring-mod, 6-bit crush, flanger/chorus, bandpass EQ & compander',
    pitchShiftLabel: 'Cyber AI',
  },
  {
    id: 'leo',
    name: 'Leo',
    role: 'Vintage Tube Broadcaster',
    dspSummary: 'Gate + 480Hz–2.4kHz horn bandpass, +10dB mid peak, tanh tube drive, 8:1 broadcast limiter',
    pitchShiftLabel: 'AM Tube',
  },
  {
    id: 'oliver',
    name: 'Oliver',
    role: 'Animated Cartoon Lead',
    dspSummary: 'Gate + +44% vocal tract, multi-band bright EQ, de-esser, snappy compander & lookahead limiter',
    pitchShiftLabel: 'Animated +44%',
  },
  {
    id: 'victor',
    name: 'Victor',
    role: 'Cinema Trailer Titan Bass',
    dspSummary: 'Gate + -36% titan tract, 60Hz sub-harmonic EQ, theater slapback, multi-stage comp & limiter',
    pitchShiftLabel: 'Titan -36%',
  },
];

// ASS colors use &HAABBGGRR (Alpha, Blue, Green, Red in hex; 00 alpha = opaque)
export const CAPTION_STYLE_PRESETS: CaptionStylePreset[] = [
  {
    id: 'hormozi_yellow',
    name: 'Hormozi Kinetic Pop',
    description: 'Animated word-by-word yellow karaoke pop with spring bounce',
    isAnimated: true,
    ass: {
      fontName: 'Liberation Sans Narrow',
      fontSize: 80,
      primaryColour: '&H0000DFEE',
      secondaryColour: '&H00FFFFFF',
      outlineColour: '&H00000000',
      backColour: '&H80000000',
      bold: -1,
      italic: 0,
      borderStyle: 1,
      outline: 6,
      shadow: 3,
      alignment: 2,
      marginV: 95,
      uppercase: true,
      animation: 'karaoke-bounce',
    },
    previewCss: {
      color: '#FFDF00',
      fontFamily: "'Outfit', sans-serif",
      fontWeight: 800,
      textTransform: 'uppercase',
      textShadow: '0 3px 0 #000, -2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000, 2px 2px 0 #000',
    },
  },
  {
    id: 'tiktok_neon_green',
    name: 'TikTok Beat Bounce',
    description: 'Elastic scale bounce with live electric-lime word highlight',
    isAnimated: true,
    ass: {
      fontName: 'Liberation Sans',
      fontSize: 72,
      primaryColour: '&H005EFF39',
      secondaryColour: '&H00FFFFFF',
      outlineColour: '&H00000000',
      backColour: '&H64000000',
      bold: -1,
      italic: 0,
      borderStyle: 1,
      outline: 5,
      shadow: 2,
      alignment: 2,
      marginV: 90,
      uppercase: true,
      animation: 'elastic-pop',
    },
    previewCss: {
      color: '#39FF5E',
      fontFamily: "'Outfit', sans-serif",
      fontWeight: 800,
      textTransform: 'uppercase',
      textShadow: '-2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000, 2px 2px 0 #000, 0 4px 14px rgba(57,255,94,0.6)',
    },
  },
  {
    id: 'netflix_classic',
    name: 'Netflix Classic White',
    description: 'Clean centered sans-serif with subtle cinematic drop-shadow',
    ass: {
      fontName: 'Noto Sans',
      fontSize: 56,
      primaryColour: '&H00FFFFFF',
      secondaryColour: '&H00FFFFFF',
      outlineColour: '&H00121212',
      backColour: '&H70000000',
      bold: 0,
      italic: 0,
      borderStyle: 1,
      outline: 2,
      shadow: 3,
      alignment: 2,
      marginV: 64,
      animation: 'none',
    },
    previewCss: {
      color: '#FFFFFF',
      fontFamily: "'Plus Jakarta Sans', sans-serif",
      fontWeight: 600,
      textShadow: '0 2px 6px rgba(0,0,0,0.92), 0 0 2px #000',
    },
  },
  {
    id: 'cyberpunk_cyan',
    name: 'Cyberpunk Glitch Pulse',
    description: 'Animated cyan-to-magenta neon sweep with kinetic tilt pulse',
    isAnimated: true,
    ass: {
      fontName: 'Liberation Sans Narrow',
      fontSize: 72,
      primaryColour: '&H00FFF000',
      secondaryColour: '&H00C850FF',
      outlineColour: '&H00A800FF',
      backColour: '&H00FF00AA',
      bold: -1,
      italic: -1,
      borderStyle: 1,
      outline: 3,
      shadow: 5,
      alignment: 2,
      marginV: 88,
      uppercase: true,
      animation: 'glitch-pulse',
    },
    previewCss: {
      color: '#00F0FF',
      fontFamily: "'Outfit', sans-serif",
      fontWeight: 800,
      textTransform: 'uppercase',
      textShadow: '3px 3px 0 #FF00AA, -1px -1px 0 #090612, 0 0 16px rgba(0,240,255,0.75)',
    },
  },
  {
    id: 'golden_hour_amber',
    name: 'Golden Hour Amber',
    description: 'Warm metallic amber tone with soft espresso rim glow',
    ass: {
      fontName: 'Liberation Sans',
      fontSize: 64,
      primaryColour: '&H0029A8FF',
      secondaryColour: '&H0000D7FF',
      outlineColour: '&H000A162B',
      backColour: '&H800A0A14',
      bold: -1,
      italic: 0,
      borderStyle: 1,
      outline: 4,
      shadow: 3,
      alignment: 2,
      marginV: 80,
      animation: 'none',
    },
    previewCss: {
      color: '#FFB43B',
      fontFamily: "'Outfit', sans-serif",
      fontWeight: 700,
      textShadow: '0 2px 12px rgba(255,140,0,0.65), 0 2px 3px #1a0f00',
    },
  },
  {
    id: 'red_alert_impact',
    name: 'Hyper Flash Alert',
    description: 'Animated white-to-crimson impact flash with punch-in zoom',
    isAnimated: true,
    ass: {
      fontName: 'Liberation Sans Narrow',
      fontSize: 76,
      primaryColour: '&H002626EF',
      secondaryColour: '&H00FFFFFF',
      outlineColour: '&H00FFFFFF',
      backColour: '&H90000000',
      bold: -1,
      italic: 0,
      borderStyle: 1,
      outline: 5,
      shadow: 3,
      alignment: 2,
      marginV: 90,
      uppercase: true,
      animation: 'flash-alert',
    },
    previewCss: {
      color: '#EF2626',
      fontFamily: "'Outfit', sans-serif",
      fontWeight: 800,
      textTransform: 'uppercase',
      textShadow: '-2px -2px 0 #fff, 2px -2px 0 #fff, -2px 2px 0 #fff, 2px 2px 0 #fff, 0 4px 12px rgba(239,38,38,0.65)',
    },
  },
  {
    id: 'minimalist_dark_box',
    name: 'Minimalist Dark Box',
    description: 'Translucent obsidian background badge for sharp legibility',
    ass: {
      fontName: 'Noto Sans',
      fontSize: 54,
      primaryColour: '&H00F8F8FA',
      secondaryColour: '&H00FFFFFF',
      outlineColour: '&H550D0B14',
      backColour: '&H550D0B14',
      bold: -1,
      italic: 0,
      borderStyle: 3,
      outline: 14,
      shadow: 0,
      alignment: 2,
      marginV: 68,
      animation: 'none',
    },
    previewCss: {
      color: '#F8F8FA',
      fontFamily: "'Plus Jakarta Sans', sans-serif",
      fontWeight: 600,
      backgroundColor: 'rgba(13, 11, 20, 0.82)',
      padding: '6px 14px',
      borderRadius: '6px',
      textShadow: 'none',
    },
  },
  {
    id: 'anime_dub',
    name: 'Anime Dub Style',
    description: 'Classic warm broadcast yellow with heavy 3px outline',
    ass: {
      fontName: 'DejaVu Sans',
      fontSize: 60,
      primaryColour: '&H005CF2FF',
      secondaryColour: '&H00FFFFFF',
      outlineColour: '&H00080808',
      backColour: '&H78000000',
      bold: -1,
      italic: 0,
      borderStyle: 1,
      outline: 4,
      shadow: 2,
      alignment: 2,
      marginV: 62,
      animation: 'none',
    },
    previewCss: {
      color: '#FFF25C',
      fontFamily: "'Plus Jakarta Sans', sans-serif",
      fontWeight: 700,
      textShadow: '-2px -2px 0 #080808, 2px -2px 0 #080808, -2px 2px 0 #080808, 2px 2px 0 #080808, 0 3px 4px #000',
    },
  },
  {
    id: 'electric_violet',
    name: 'Violet Aura Wave',
    description: 'Pulsing purple-to-gold karaoke glow with luminous aura',
    isAnimated: true,
    ass: {
      fontName: 'Liberation Sans',
      fontSize: 70,
      primaryColour: '&H00FA8BFF',
      secondaryColour: '&H0000DFEE',
      outlineColour: '&H003B0764',
      backColour: '&H8019142B',
      bold: -1,
      italic: 0,
      borderStyle: 1,
      outline: 4,
      shadow: 3,
      alignment: 2,
      marginV: 84,
      animation: 'aura-wave',
    },
    previewCss: {
      color: '#E0AAFF',
      fontFamily: "'Outfit', sans-serif",
      fontWeight: 800,
      textShadow: '0 0 16px rgba(168,85,247,0.9), -2px -2px 0 #240046, 2px 2px 0 #240046',
    },
  },
  {
    id: 'vintage_typewriter',
    name: 'Vintage Typewriter',
    description: 'Monospaced archival serif look for documentary storytelling',
    ass: {
      fontName: 'JetBrains Mono',
      fontSize: 52,
      primaryColour: '&H00D8EBFA',
      secondaryColour: '&H00FFFFFF',
      outlineColour: '&H40120F0A',
      backColour: '&H40120F0A',
      bold: 0,
      italic: 0,
      borderStyle: 3,
      outline: 10,
      shadow: 0,
      alignment: 2,
      marginV: 66,
      animation: 'none',
    },
    previewCss: {
      color: '#FAEBDC',
      fontFamily: "'JetBrains Mono', monospace",
      fontWeight: 500,
      backgroundColor: 'rgba(18, 15, 10, 0.78)',
      padding: '5px 12px',
      borderRadius: '3px',
      textShadow: 'none',
    },
  },
  {
    id: 'comic_book_pop',
    name: 'Comic Slam Zoom',
    description: 'Playful tilted slam-in animation with hard orange comic drop shadow',
    isAnimated: true,
    ass: {
      fontName: 'Liberation Sans Narrow',
      fontSize: 76,
      primaryColour: '&H00FFFFFF',
      secondaryColour: '&H0000AAFF',
      outlineColour: '&H00000000',
      backColour: '&H000066FF',
      bold: -1,
      italic: -1,
      borderStyle: 1,
      outline: 5,
      shadow: 6,
      alignment: 2,
      marginV: 86,
      uppercase: true,
      animation: 'comic-slam',
    },
    previewCss: {
      color: '#FFFFFF',
      fontFamily: "'Outfit', sans-serif",
      fontWeight: 800,
      textTransform: 'uppercase',
      textShadow: '-2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000, 2px 2px 0 #000, 5px 5px 0 #FF8000',
    },
  },
  {
    id: 'clean_slate',
    name: 'Clean Slate Subtitle',
    description: 'Low-margin understated cinema dialogue presentation',
    ass: {
      fontName: 'DejaVu Serif',
      fontSize: 48,
      primaryColour: '&H00EAEAF2',
      secondaryColour: '&H00FFFFFF',
      outlineColour: '&H0008080C',
      backColour: '&H60000000',
      bold: 0,
      italic: 0,
      borderStyle: 1,
      outline: 2,
      shadow: 2,
      alignment: 2,
      marginV: 44,
      animation: 'none',
    },
    previewCss: {
      color: '#EAEAF2',
      fontFamily: 'Georgia, serif',
      fontWeight: 500,
      textShadow: '0 2px 5px rgba(0,0,0,0.95)',
    },
  },
  {
    id: 'karaoke_gold_rush',
    name: 'Gold Rush Karaoke',
    description: 'Smooth progressive metallic gold fill sweep across every word',
    isAnimated: true,
    ass: {
      fontName: 'Liberation Sans',
      fontSize: 72,
      primaryColour: '&H0000D7FF',
      secondaryColour: '&H00E2D4CC',
      outlineColour: '&H00120B1C',
      backColour: '&H80000000',
      bold: -1,
      italic: 0,
      borderStyle: 1,
      outline: 5,
      shadow: 3,
      alignment: 2,
      marginV: 88,
      uppercase: true,
      animation: 'karaoke-sweep',
    },
    previewCss: {
      color: '#FFD700',
      fontFamily: "'Outfit', sans-serif",
      fontWeight: 800,
      textTransform: 'uppercase',
      textShadow: '0 0 18px rgba(255,215,0,0.75), -2px -2px 0 #120B1C, 2px 2px 0 #120B1C',
    },
  },
  {
    id: 'retro_synthwave',
    name: 'Retro Synthwave Pop',
    description: 'Funky hot-pink to electric-aqua animated karaoke sweep with glow',
    isAnimated: true,
    ass: {
      fontName: 'Liberation Sans Narrow',
      fontSize: 72,
      primaryColour: '&H009DFF00',
      secondaryColour: '&H00B446FF',
      outlineColour: '&H00260638',
      backColour: '&H00FF2A85',
      bold: -1,
      italic: -1,
      borderStyle: 1,
      outline: 4,
      shadow: 4,
      alignment: 2,
      marginV: 88,
      uppercase: true,
      animation: 'glitch-pulse',
    },
    previewCss: {
      color: '#00FF9D',
      fontFamily: "'Outfit', sans-serif",
      fontWeight: 800,
      textTransform: 'uppercase',
      textShadow: '3px 3px 0 #FF2A85, 0 0 16px rgba(0,255,157,0.65)',
    },
  },
  {
    id: 'kinetic_word_slam',
    name: 'Studio Word Slam',
    description: 'High-retention creator slam-bounce highlighting words in crisp white & amber',
    isAnimated: true,
    ass: {
      fontName: 'Liberation Sans',
      fontSize: 74,
      primaryColour: '&H001E9DFF',
      secondaryColour: '&H00FFFFFF',
      outlineColour: '&H00000000',
      backColour: '&H80000000',
      bold: -1,
      italic: 0,
      borderStyle: 1,
      outline: 6,
      shadow: 3,
      alignment: 2,
      marginV: 92,
      uppercase: true,
      animation: 'karaoke-bounce',
    },
    previewCss: {
      color: '#FF9D1E',
      fontFamily: "'Outfit', sans-serif",
      fontWeight: 800,
      textTransform: 'uppercase',
      textShadow: '-2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000, 2px 2px 0 #000, 0 4px 14px rgba(255,157,30,0.6)',
    },
  },
  {
    id: 'documentary_lower_third',
    name: 'Documentary Dark Slate',
    description: 'Clean high-contrast documentary bar with crisp sans lettering',
    ass: {
      fontName: 'Noto Sans Display',
      fontSize: 52,
      primaryColour: '&H00FFFFFF',
      secondaryColour: '&H00FFFFFF',
      outlineColour: '&H2812141E',
      backColour: '&H2812141E',
      bold: -1,
      italic: 0,
      borderStyle: 3,
      outline: 14,
      shadow: 0,
      alignment: 2,
      marginV: 62,
      animation: 'none',
    },
    previewCss: {
      color: '#FFFFFF',
      fontFamily: "'Outfit', 'Noto Sans Display', sans-serif",
      fontWeight: 700,
      backgroundColor: 'rgba(18, 20, 30, 0.88)',
      padding: '6px 14px',
      borderRadius: '4px',
      textShadow: 'none',
    },
  },
  {
    id: 'editorial_serif_gold',
    name: 'Editorial Cinema Gold',
    description: 'Refined warm cream-gold serif for film trailers and essays',
    ass: {
      fontName: 'Liberation Serif',
      fontSize: 54,
      primaryColour: '&H009DE6FF',
      secondaryColour: '&H00FFFFFF',
      outlineColour: '&H00120E08',
      backColour: '&H70000000',
      bold: 0,
      italic: -1,
      borderStyle: 1,
      outline: 3,
      shadow: 3,
      alignment: 2,
      marginV: 58,
      animation: 'none',
    },
    previewCss: {
      color: '#FFE69D',
      fontFamily: "'Liberation Serif', Georgia, serif",
      fontWeight: 500,
      textShadow: '0 2px 8px rgba(0,0,0,0.95)',
    },
  },
  {
    id: 'minimal_light_pill',
    name: 'Bright Creator Card',
    description: 'Crisp dark ink on clean frost card for bright social reels',
    ass: {
      fontName: 'Liberation Sans',
      fontSize: 56,
      primaryColour: '&H001E170F',
      secondaryColour: '&H001E170F',
      outlineColour: '&H18FFFFFF',
      backColour: '&H18FFFFFF',
      bold: -1,
      italic: 0,
      borderStyle: 3,
      outline: 14,
      shadow: 0,
      alignment: 2,
      marginV: 72,
      animation: 'none',
    },
    previewCss: {
      color: '#0F172A',
      fontFamily: "'Plus Jakarta Sans', 'Liberation Sans', sans-serif",
      fontWeight: 700,
      backgroundColor: 'rgba(255, 255, 255, 0.92)',
      padding: '6px 14px',
      borderRadius: '6px',
      textShadow: 'none',
    },
  },
  {
    id: 'kinetic_cyan_pop',
    name: 'Aqua Kinetic Bounce',
    description: 'High-energy sky-aqua word pop with dark outline contrast',
    isAnimated: true,
    ass: {
      fontName: 'Liberation Sans Narrow',
      fontSize: 76,
      primaryColour: '&H00FFF238',
      secondaryColour: '&H00FFFFFF',
      outlineColour: '&H00170B08',
      backColour: '&H80000000',
      bold: -1,
      italic: 0,
      borderStyle: 1,
      outline: 6,
      shadow: 3,
      alignment: 2,
      marginV: 90,
      uppercase: true,
      animation: 'karaoke-bounce',
    },
    previewCss: {
      color: '#38F2FF',
      fontFamily: "'Outfit', 'Liberation Sans Narrow', sans-serif",
      fontWeight: 800,
      textTransform: 'uppercase',
      textShadow: '-2px -2px 0 #080B17, 2px -2px 0 #080B17, -2px 2px 0 #080B17, 2px 2px 0 #080B17',
    },
  },
];

export const COLOR_GRADE_PRESETS: ColorGradePreset[] = [
  {
    id: 'ai_content_aware',
    name: 'Auto Color (Scene Aware)',
    description: 'Balances lighting, contrast, and skin tone automatically for your scene',
    cssFilter: 'contrast(1.12) saturate(1.18) brightness(1.03)',
    swatchColors: ['#F59E0B', '#7C3AED', '#10b981'],
  },
  {
    id: 'ai_auto_balance',
    name: 'Auto Balance',
    description: 'Lifts shadows and balances overall exposure cleanly',
    cssFilter: 'contrast(1.1) saturate(1.16) brightness(1.04)',
    swatchColors: ['#F59E0B', '#7C3AED', '#38bdf8'],
  },
  {
    id: 'teal_orange',
    name: 'Teal & Orange',
    description: 'Cool shadows paired with warm skin tones',
    cssFilter: 'contrast(1.14) saturate(1.22) sepia(0.14) hue-rotate(-8deg)',
    swatchColors: ['#0ea5e9', '#14b8a6', '#f97316'],
  },
  {
    id: 'moody_noir',
    name: 'Black & White',
    description: 'High-contrast monochrome look',
    cssFilter: 'grayscale(1) contrast(1.32) brightness(0.95)',
    swatchColors: ['#09090b', '#52525b', '#f4f4f5'],
  },
  {
    id: 'vintage_70s',
    name: 'Warm Vintage',
    description: 'Warm highlights and soft matte film tones',
    cssFilter: 'sepia(0.28) contrast(1.05) saturate(0.9) brightness(1.03)',
    swatchColors: ['#78350f', '#d97706', '#fde68a'],
  },
  {
    id: 'cyberpunk_neon',
    name: 'Vivid Night',
    description: 'Deep indigo shadows with vibrant highlights',
    cssFilter: 'contrast(1.2) saturate(1.42) hue-rotate(12deg)',
    swatchColors: ['#312e81', '#a855f7', '#06b6d4'],
  },
  {
    id: 'cold_nordic',
    name: 'Cool Slate',
    description: 'Crisp cool blue tones with muted greens',
    cssFilter: 'saturate(0.72) contrast(1.12) hue-rotate(170deg) saturate(0.85)',
    swatchColors: ['#0f172a', '#334155', '#67e8f9'],
  },
  {
    id: 'golden_sunset',
    name: 'Golden Sunset',
    description: 'Warm golden highlights and rich amber tones',
    cssFilter: 'sepia(0.22) saturate(1.24) brightness(1.04) hue-rotate(-10deg)',
    swatchColors: ['#9a3412', '#f59e0b', '#fef08a'],
  },
  {
    id: 'none',
    name: 'Original Color',
    description: 'Keep the original video colors unchanged',
    cssFilter: 'none',
    swatchColors: ['#64748b', '#94a3b8', '#cbd5e1'],
  },
];
