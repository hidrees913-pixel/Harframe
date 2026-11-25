import { AI_VOICE_CATALOG, type AiVoiceId } from './studioPresets.ts';

export interface CleanScriptResult {
  cleanScript: string;
  removedLinesCount: number;
  removedTags: string[];
}

export interface InhouseVoiceTranslation {
  /** Pure storytelling / visual prompt with voiceover-model directives stripped out */
  cleanStoryPrompt: string;
  /** True when the prompt contained voiceover-model / TTS / vocal delivery instructions */
  hadVoiceModelInstructions: boolean;
  /** Third-party / TTS model keywords or voice directives ignored */
  ignoredDirectives: string[];
  /** Best matching HarFrame in-house voice profile, if voice traits were specified */
  suggestedVoiceId: AiVoiceId | null;
  suggestedVoiceName: string | null;
  /** Clamped speaking rate inside [0.85, 1.25] when speed cues are present */
  suggestedRate: number | null;
  /** Delivery direction rewritten specifically for HarFrame's in-house Edge/Gemini TTS engine */
  inhouseDeliveryInstruction: string | null;
}

const PREAMBLE_LINE_RE =
  /^(?:(?:sure|certainly|of course|absolutely|great choice|got it|definitely|yes|okay|ok)[,!.]*\s*(?:here(?:'s| is)|below is|i(?:'ve| have)|let me|this is)?\b.*(?:script|voiceover|narration|video|clip|version|take|draft|option|caption|reframed|help).*|(?:sure|certainly|of course|absolutely|great choice|got it|happy to help)[,!.\s]*$|(?:here(?:'s| is)|below is|i(?:'ve| have) (?:created|written|crafted|prepared|put together))\b.*|note:|disclaimer:.*)$/i;

const OUTRO_LINE_RE =
  /^(?:let me know if\b.*|would you like me to\b.*|want me to\b.*|feel free to\b.*|if you(?:'d| would) like\b.*|hope (?:this|that) helps\b.*|i can also\b.*|you can adjust\b.*|total word count\b.*|estimated (?:reading|speaking|duration)\b.*|word count:\s*\d+.*)$/i;

const PURE_META_HEADING_RE =
  /^(?:#{1,6}\s+.*|(?:voiceover|narration|script|scene\s*\d*|hook|intro|body|outro|call to action|cta|visuals?|audio|sfx|music|camera|note|pacing|tone|delivery|voice\s*direction|voice\s*model|tts\s*prompt)(?:\s*\([^)]*\))?\s*:?\s*)$/i;

const PURE_TIME_OR_RULE_RE =
  /^(?:[-*_]{3,}|(?:\[|\()?\d{1,2}:\d{2}(?:\s*[-–—]\s*\d{1,2}:\d{2})?(?:\]|\))?)$/;

const INLINE_LABEL_PREFIX_RE =
  /^(?:[-*•]\s+|\d+[.)]\s+)?(?:\*{1,2})?(?:voiceover|narrator|narration|speaker|host|vo|delivery|voice\s*direction|voice\s*style|tone|line\s*\d*|part\s*\d*|scene\s*\d*|hook|intro|outro)(?:\s*\([^)]*\))?(?:\s*\[[^\]]*\])?(?:\*{1,2})?\s*:\s*(?:\*{1,2})?/i;

const SSML_TAG_RE = /<\/?(?:speak|prosody|break|emphasis|say-as|phoneme|sub|voice|audio|p|s|lang|mstts:[^>\s]+)(?=\s|\/|>)[^>]*>/gi;

const VOICE_DIRECTION_LINE_RE =
  /^(?:voice\s*(?:model|profile|style|tone|over\s*style|direction|setting)|delivery|speaking\s*(?:rate|pace|speed)|tts\s*(?:model|engine|settings?)|audio\s*cue)\s*:\s*.+$/i;

export function stripGeminiYapping(rawText: string): CleanScriptResult {
  const rawInput = String(rawText || '');
  SSML_TAG_RE.lastIndex = 0;
  const hadSsml = SSML_TAG_RE.test(rawInput);
  SSML_TAG_RE.lastIndex = 0;

  const input = rawInput
    .replace(/\r\n/g, '\n')
    .replace(SSML_TAG_RE, ' ')
    .trim();

  if (!input) {
    return { cleanScript: '', removedLinesCount: 0, removedTags: [] };
  }

  const lines = input.split('\n');
  const keptLines: string[] = [];
  const removedTags = new Set<string>();
  let removedLinesCount = 0;

  if (hadSsml) {
    removedTags.add('SSML / voice tags');
  }

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();

    if (/^```/.test(line)) {
      removedLinesCount++;
      removedTags.add('markdown code fence');
      continue;
    }

    if (!line) {
      continue;
    }

    if (PURE_TIME_OR_RULE_RE.test(line)) {
      removedLinesCount++;
      removedTags.add('timestamps / dividers');
      continue;
    }

    const strippedFormatting = line.replace(/[*_`]/g, '').trim();

    if (keptLines.length === 0 && PREAMBLE_LINE_RE.test(strippedFormatting)) {
      removedLinesCount++;
      removedTags.add('Gemini intro chatter');
      continue;
    }

    if (OUTRO_LINE_RE.test(strippedFormatting)) {
      removedLinesCount++;
      removedTags.add('Gemini closing banter');
      continue;
    }

    if (PURE_META_HEADING_RE.test(strippedFormatting)) {
      removedLinesCount++;
      removedTags.add('section labels');
      continue;
    }

    if (VOICE_DIRECTION_LINE_RE.test(strippedFormatting)) {
      removedLinesCount++;
      removedTags.add('voiceover-model directions');
      continue;
    }

    if (
      /^\[[^\]]+\]$/.test(strippedFormatting) ||
      /^\([^)]*(?:cut to|camera|visual|sfx|music|pause|beat|fade|zoom|b-roll|whisper|asmr|slow|fast|tone|voice|deep|warm|energetic)[^)]*\)$/i.test(
        strippedFormatting
      )
    ) {
      removedLinesCount++;
      removedTags.add('stage & voice directions');
      continue;
    }

    // Strip inline timestamp prefixes: [00:00 - 00:04], (0:02), 00:03 -
    line = line.replace(
      /^(?:\[|\()?\d{1,2}:\d{2}(?:\.\d+)?(?:\s*[-–—to]+\s*\d{1,2}:\d{2}(?:\.\d+)?)?(?:\]|\))?\s*[-:|]?\s*/i,
      ''
    );

    // Strip inline speaker/label prefixes like "**Narrator:** " or "- Voiceover: "
    line = line.replace(INLINE_LABEL_PREFIX_RE, '');

    // Remove visual & vocal stage tags embedded inside sentences
    const beforeBrackets = line;
    line = line
      .replace(/\[[^\]]{2,80}\]/g, ' ')
      .replace(
        /\((?:sfx|music|cut to|camera|visual|b-roll|pause|beat|fade|whisper|softly|slowly|quickly|warmly|deep voice|tone|voice)[^)]*\)/gi,
        ' '
      );
    if (line !== beforeBrackets) {
      removedTags.add('stage & voice directions');
    }

    line = line
      .replace(/^[-*•]\s+/, '')
      .replace(/^\*{1,3}(.+?)\*{1,3}$/, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\s+/g, ' ')
      .trim();

    if (
      (line.startsWith('"') && line.endsWith('"')) ||
      (line.startsWith('“') && line.endsWith('”'))
    ) {
      line = line.slice(1, -1).trim();
    }

    if (!line || PREAMBLE_LINE_RE.test(line) || OUTRO_LINE_RE.test(line)) {
      removedLinesCount++;
      continue;
    }

    keptLines.push(line);
  }

  return {
    cleanScript: keptLines.join('\n'),
    removedLinesCount,
    removedTags: Array.from(removedTags),
  };
}

/** Backwards-compatible export alias */
export const stripChatGptYapping = stripGeminiYapping;

const EXTERNAL_VOICE_MODEL_RE =
  /\b(?:eleven\s*labs|elevenlabs|openai\s*tts|gpt[-\s]?4o[-\s]?(?:mini[-\s]?)?tts|chatgpt\s*voice|amazon\s*polly|azure\s*(?:neural\s*)?tts|google\s*wavenet|play\.?ht|playht|murf\.?ai|wellsaid|coqui|xtts|bark\s*tts|cartesia|resemble\.?ai|speechify|ssml)\b/gi;

const VOICE_CLAUSE_PATTERNS: Array<{ re: RegExp; label: string }> = [
  {
    re: /\b(?:use|switch to|speak in|read in|narrate with|deliver with|with|via|voice(?:over)?\s*(?:model|style|tone|direction)?\s*:?)\s+(?:an?\s+)?(?:eleven\s*labs|elevenlabs|openai(?:\s*tts)?|polly|azure|murf|play\.?ht|playht|bark|coqui|cartesia|deep|bass|husky|whisper(?:y|ing)?|soft|asmr|warm|calm|soothing|british|uk|english|female|male|energetic|fast|slow|upbeat|cinematic|trailer|dramatic|robotic|breezy|expressive|conversational)[^.,;\n]*?(?:voiceover|voice|accent|model|preset|narrator|delivery|pauses?|tone|style|shimmer|onyx|alloy|adam|rachel|echo|fable|nova)\b/gi,
    label: 'external voiceover direction',
  },
  { re: EXTERNAL_VOICE_MODEL_RE, label: 'external voiceover model' },
  {
    re: /\b(?:speak|read|narrate|talk|deliver|whisper)\s+(?:very\s+)?(?:slow(?:ly)?|fast|quickly|rapidly|calmly|softly|gently|smoothly|in\s+an?\s+asmr\s+voice|with\s+dramatic\s+pauses?|at\s+\d+(?:\.\d+)?x(?:\s*(?:speed|pace|rate))?)\b(?:\s+with\s+(?:dramatic|short|long)\s+pauses?)?/gi,
    label: 'speaking pace directive',
  },
  {
    re: /\b(?:with\s+)?(?:dramatic|long|slow)\s+pauses?\b/gi,
    label: 'pause directive',
  },
  {
    re: /\b(?:add|include|insert)\s+(?:ssml|whisper|breath|pause|beat|sfx|<break[^>]*>)\s*(?:tags?|cues?|marks?)?/gi,
    label: 'TTS formatting tag request',
  },
  {
    re: SSML_TAG_RE,
    label: 'raw SSML tags',
  },
  {
    re: /\[(?:whisper|pause|beat|slow|fast|sigh|breath|voice\s*:[^\]]*)\]/gi,
    label: 'bracketed voice cues',
  },
];

export function translatePromptForInhouseStudio(rawPrompt: string): InhouseVoiceTranslation {
  const input = String(rawPrompt || '').trim();
  if (!input) {
    return {
      cleanStoryPrompt:
        'Write an engaging, crisp spoken voiceover narration describing what happens visually on screen.',
      hadVoiceModelInstructions: false,
      ignoredDirectives: [],
      suggestedVoiceId: null,
      suggestedVoiceName: null,
      suggestedRate: null,
      inhouseDeliveryInstruction: null,
    };
  }

  const ignoredSet = new Set<string>();
  let stripped = input;

  for (const { re, label } of VOICE_CLAUSE_PATTERNS) {
    re.lastIndex = 0;
    if (re.test(stripped)) {
      ignoredSet.add(label);
      re.lastIndex = 0;
      stripped = stripped.replace(re, ' ');
    }
  }

  // Also detect explicit speed numbers like "0.9x speed" or "1.15x"
  const explicitRateMatch = input.match(/\b(0\.[7-9]\d?|1\.[0-4]\d?)\s*x\b(?:\s*(?:speed|pace|rate))?/i);
  if (explicitRateMatch) {
    ignoredSet.add('speaking pace directive');
    stripped = stripped.replace(/\b(?:at\s+)?(0\.[7-9]\d?|1\.[0-4]\d?)\s*x\b(?:\s*(?:speed|pace|rate))?/gi, ' ');
  }

  // Clean dangling punctuation left after stripping voiceover clauses
  stripped = stripped
    .replace(/\b(?:and|then|please|with)\s*(?=[.,;!?]|$)/gi, ' ')
    .replace(/^[\s,;:.–—-]+|[\s,;:.–—-]+$/g, '')
    .replace(/\s*([,;:.!?])\s*/g, '$1 ')
    .replace(/([,;:])\s*\./g, '.')
    .replace(/^(?:,\s*)+/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  const lower = input.toLowerCase();
  const hasVoiceContext =
    ignoredSet.size > 0 ||
    /\b(?:voice|voiceover|narrator|accent|tts|ssml|speak|whisper|asmr|pace|pacing|speed|delivery|elevenlabs|openai|polly|onyx|shimmer|alloy)\b/.test(
      lower
    );

  // Infer best matching HarFrame in-house voice profile only when voice/delivery context exists
  let suggestedVoiceId: AiVoiceId | null = null;
  if (hasVoiceContext) {
    if (/\b(?:asmr|whisper|whispery|close[- ]mic|breath(?:y)?)\b/.test(lower)) {
      suggestedVoiceId = 'brian_asmr';
    } else if (/\b(?:british|uk\s*accent|uk\s*narrator|english\s*accent)\b/.test(lower)) {
      suggestedVoiceId = 'ryan_british';
    } else if (/\b(?:trailer|cinema|cinematic|epic|bass|dramatic|dark|onyx|movie)\b/.test(lower)) {
      suggestedVoiceId = 'gemini_fenrir';
    } else if (/\b(?:energetic|hype|upbeat|reels|tiktok|shorts|viral|excited|lively|shimmer)\b/.test(lower)) {
      suggestedVoiceId = 'emma_bright';
    } else if (/\b(?:explainer|tutorial|breakdown|friendly|puck|agile)\b/.test(lower)) {
      suggestedVoiceId = 'gemini_puck';
    } else if (/\b(?:deep\s*(?:male|voice)|baritone|conversational\s*male|storyteller\s*male|andrew)\b/.test(lower)) {
      suggestedVoiceId = 'andrew_story';
    } else if (/\b(?:broadcast|alto|expressive|resonance|kore)\b/.test(lower)) {
      suggestedVoiceId = 'gemini_kore';
    } else if (/\b(?:warm|documentary|calm\s*female|gentle|soothing|female\s*voice|aria)\b/.test(lower)) {
      suggestedVoiceId = 'aria_warm';
    }
  }

  let suggestedRate: number | null = null;
  if (explicitRateMatch) {
    const parsedRate = Number(explicitRateMatch[1]);
    if (Number.isFinite(parsedRate)) {
      suggestedRate = Number(Math.max(0.85, Math.min(1.25, parsedRate)).toFixed(2));
    }
  } else if (hasVoiceContext && /\b(?:slow|slowly|unhurried|deliberate|asmr|whisper|soothing|relaxed)\b/.test(lower)) {
    suggestedRate = 0.9;
  } else if (hasVoiceContext && /\b(?:fast|quickly|rapid|energetic|upbeat|punchy|hype)\b/.test(lower)) {
    suggestedRate = 1.1;
  }

  const hadVoiceModelInstructions =
    ignoredSet.size > 0 || suggestedVoiceId !== null || suggestedRate !== null;

  const matchedProfile = suggestedVoiceId
    ? AI_VOICE_CATALOG.find((v) => v.id === suggestedVoiceId) ?? null
    : null;

  let inhouseDeliveryInstruction: string | null = null;
  if (hadVoiceModelInstructions) {
    const targetVoice = matchedProfile ?? AI_VOICE_CATALOG[0];
    const tonePhrases: string[] = [];
    if (/\b(?:asmr|whisper|soft|gentle|soothing|calm)\b/.test(lower)) {
      tonePhrases.push('soft close-mic ASMR calm');
    } else if (/\b(?:trailer|deep|cinematic|epic|dramatic|bass)\b/.test(lower)) {
      tonePhrases.push('deep cinematic gravity');
    } else if (/\b(?:energetic|upbeat|hype|viral|reels|tiktok)\b/.test(lower)) {
      tonePhrases.push('lively short-form creator punch');
    } else if (/\b(?:british|uk)\b/.test(lower)) {
      tonePhrases.push('crisp UK editorial poise');
    } else if (/\b(?:warm|documentary)\b/.test(lower)) {
      tonePhrases.push('warm documentary articulation');
    } else {
      tonePhrases.push(targetVoice.geminiStyle);
    }

    const paceLabel = suggestedRate
      ? `${suggestedRate.toFixed(2)}x mastered pacing`
      : 'natural studio pacing';
    inhouseDeliveryInstruction = `In-house delivery: ${tonePhrases.join(', ')} with ${paceLabel}`;
  }

  const cleanStoryPrompt =
    stripped.length >= 10
      ? stripped
      : 'Write a crisp, vivid spoken narration describing what happens visually on screen with natural pacing.';

  return {
    cleanStoryPrompt,
    hadVoiceModelInstructions,
    ignoredDirectives: Array.from(ignoredSet),
    suggestedVoiceId,
    suggestedVoiceName: matchedProfile?.name ?? null,
    suggestedRate,
    inhouseDeliveryInstruction,
  };
}

export function buildInhouseVoiceStylePrompt(
  baseProfileStyle: string,
  tailoredInstruction?: string | null
): string {
  const extra = String(tailoredInstruction || '')
    .replace(EXTERNAL_VOICE_MODEL_RE, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!extra) return baseProfileStyle;
  return `${baseProfileStyle}. ${extra}`.slice(0, 260);
}

export function estimateSpeechDurationSec(
  scriptText: string,
  speakingRate = 1.0
): { wordCount: number; estimatedSec: number } {
  const words = String(scriptText || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const wordCount = words.length;
  if (wordCount === 0) {
    return { wordCount: 0, estimatedSec: 0 };
  }
  const safeRate = Math.max(0.65, Math.min(1.6, speakingRate || 1.0));
  const baselineWordsPerSec = 2.5 * safeRate;
  const estimatedSec = Number((wordCount / baselineWordsPerSec).toFixed(1));
  return { wordCount, estimatedSec };
}

export function buildGeminiPromptForClip(
  userPrompt: string,
  metadata: { filename: string; durationSec: number; width: number; height: number }
): string {
  const targetWords = Math.max(8, Math.round(metadata.durationSec * 2.4));
  const translated = translatePromptForInhouseStudio(userPrompt);

  return [
    `Clip duration: ${metadata.durationSec.toFixed(1)}s (${metadata.width}x${metadata.height}, file: ${metadata.filename}).`,
    `Target spoken length: ~${targetWords} words so it fits inside ${metadata.durationSec.toFixed(1)} seconds naturally.`,
    '',
    `Visual storytelling instruction: ${translated.cleanStoryPrompt}`,
    '',
    'Output ONLY the spoken voiceover narration sentences—no intro chatter, no voiceover-model cues, no SSML tags, no scene headings, no bracketed directions, and no closing remarks.',
  ].join('\n');
}

/** Backwards-compatible export alias */
export const buildChatGptPromptForClip = buildGeminiPromptForClip;

export function sanitizeForSpeech(rawText: string): string {
  return String(rawText || '')
    .replace(SSML_TAG_RE, ' ')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ' ')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s*[—–]\s*/g, ', ')
    .replace(/\s+&\s+/g, ' and ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function escapeXmlForSsml(text: string): string {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function splitScriptIntoTtsChunks(rawText: string, maxChars = 650): string[] {
  const clean = sanitizeForSpeech(rawText);
  if (!clean) return [];
  if (clean.length <= maxChars) return [clean];

  const sentences = clean
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let current = '';

  const pushOversizedSentence = (sentence: string) => {
    const words = sentence.split(/\s+/);
    let buf = '';
    for (const word of words) {
      const candidate = buf ? `${buf} ${word}` : word;
      if (candidate.length > maxChars && buf) {
        chunks.push(buf);
        buf = word;
      } else {
        buf = candidate;
      }
    }
    if (buf) chunks.push(buf);
  };

  for (const sentence of sentences) {
    if (sentence.length > maxChars) {
      if (current) {
        chunks.push(current);
        current = '';
      }
      pushOversizedSentence(sentence);
      continue;
    }

    const candidate = current ? `${current} ${sentence}` : sentence;
    if (candidate.length > maxChars && current) {
      chunks.push(current);
      current = sentence;
    } else {
      current = candidate;
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

export interface GeminiVideoPreviewSpec {
  needsTranscode: boolean;
  targetFps: number;
  maxFrames: number;
  keyframeCount: number;
}

export function computeGeminiVideoPreviewSpec(
  durationSec: number,
  fileSizeBytes: number
): GeminiVideoPreviewSpec {
  const safeDur = Number.isFinite(durationSec) && durationSec > 0 ? durationSec : 6;
  const safeSize = Number.isFinite(fileSizeBytes) && fileSizeBytes > 0 ? fileSizeBytes : 0;
  const targetFps = Number(Math.max(0.25, Math.min(2, 18 / safeDur)).toFixed(2));
  const needsTranscode = safeSize > 450 * 1024 || safeDur > 12;
  const keyframeCount = safeDur <= 10 ? 5 : 6;

  return {
    needsTranscode,
    targetFps,
    maxFrames: 20,
    keyframeCount,
  };
}

export function computeAdaptiveFrameTimestamps(
  durationSec: number,
  frameCount: number
): number[] {
  const safeDur = Number.isFinite(durationSec) && durationSec > 0 ? durationSec : 5;
  const count = Math.max(1, Math.min(12, Math.round(frameCount)));
  return Array.from({ length: count }, (_, idx) => {
    const raw = (safeDur * (idx + 0.5)) / count;
    const clamped = Math.max(0.08, Math.min(Math.max(0.1, safeDur - 0.08), raw));
    return Number(clamped.toFixed(2));
  });
}
