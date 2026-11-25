import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGeminiPromptForClip,
  buildInhouseVoiceStylePrompt,
  computeAdaptiveFrameTimestamps,
  computeGeminiVideoPreviewSpec,
  escapeXmlForSsml,
  estimateSpeechDurationSec,
  sanitizeForSpeech,
  splitScriptIntoTtsChunks,
  stripGeminiYapping,
  translatePromptForInhouseStudio,
} from './scriptCleaner.ts';

test('stripGeminiYapping extracts pure spoken narration and strips conversational banter and SSML', () => {
  const rawGemini = `Sure! Here is a gripping voiceover script tailored to your 6-second clip:

### Scene 1 [0:00 - 0:03]
Voice Direction: Deep whisper at 0.9x speed
<speak><break time="500ms"/>
**Voiceover:** "Every quiet drop of rain hides a story waiting to be told."

[Cut to slow motion macro shot]
- **Narrator (0:03 - 0:06):** Look closer (whisper) before the moment fades away.
</speak>

---
Word count: 20 words
Let me know if you want a calmer tone or alternate hook!`;

  const result = stripGeminiYapping(rawGemini);
  assert.equal(
    result.cleanScript,
    'Every quiet drop of rain hides a story waiting to be told.\nLook closer before the moment fades away.'
  );
  assert.ok(result.removedLinesCount >= 5);
  assert.ok(result.removedTags.includes('Gemini intro chatter'));
  assert.ok(result.removedTags.includes('Gemini closing banter'));
  assert.ok(result.removedTags.includes('SSML / voice tags'));
});

test('stripGeminiYapping removes inline stage and vocal cues while preserving clean dialogue lines', () => {
  const rawGemini = `Absolutely! I've crafted this concise voiceover for your video:

[00:00 - 00:02] **Hook:** [SFX: soft click] Sometimes stillness speaks **louder** than noise.
(0:02 - 0:05) Take a breath (slowly) and watch every detail unfold.

Hope this helps! Feel free to ask for revisions.`;

  const result = stripGeminiYapping(rawGemini);
  assert.equal(
    result.cleanScript,
    'Sometimes stillness speaks louder than noise.\nTake a breath and watch every detail unfold.'
  );
});

test('translatePromptForInhouseStudio strips voiceover-model directions and adapts them for HarFrame voice generator', () => {
  const translated = translatePromptForInhouseStudio(
    'Use ElevenLabs Onyx deep cinema trailer bass voice, speak slowly at 0.90x with <break time="1s"/> pauses, and describe this neon street rain scene.'
  );

  assert.equal(translated.hadVoiceModelInstructions, true);
  assert.ok(!/elevenlabs|onyx|<break/i.test(translated.cleanStoryPrompt));
  assert.match(translated.cleanStoryPrompt, /describe this neon street rain scene/i);
  assert.equal(translated.suggestedVoiceId, 'gemini_fenrir');
  assert.equal(translated.suggestedVoiceName, 'Fenrir');
  assert.equal(translated.suggestedRate, 0.9);
  assert.ok(translated.inhouseDeliveryInstruction?.includes('deep cinematic gravity'));
  assert.ok(!/elevenlabs/i.test(translated.inhouseDeliveryInstruction || ''));
});

test('translatePromptForInhouseStudio matches ASMR, British, and neutral visual prompts accurately', () => {
  const asmr = translatePromptForInhouseStudio(
    'Whisper softly in an ASMR voice while narrating the crisp espresso pour.'
  );
  assert.equal(asmr.suggestedVoiceId, 'brian_asmr');
  assert.equal(asmr.suggestedRate, 0.9);

  const uk = translatePromptForInhouseStudio(
    'Use a British UK narrator accent to explain the watch craftsmanship.'
  );
  assert.equal(uk.suggestedVoiceId, 'ryan_british');

  const visualOnly = translatePromptForInhouseStudio(
    'Highlight the warm golden shadows and city reflections across the harbor.'
  );
  assert.equal(visualOnly.hadVoiceModelInstructions, false);
  assert.equal(visualOnly.suggestedVoiceId, null);
  assert.equal(visualOnly.suggestedRate, null);
  assert.match(visualOnly.cleanStoryPrompt, /warm golden shadows/i);
});

test('buildInhouseVoiceStylePrompt merges tailored delivery safely without external TTS names', () => {
  const merged = buildInhouseVoiceStylePrompt(
    'Deep cinematic trailer narrator',
    'HarFrame in-house Fenrir delivery using ElevenLabs-free deep cinematic gravity at 0.90x'
  );
  assert.ok(!/elevenlabs/i.test(merged));
  assert.match(merged, /Deep cinematic trailer narrator/);
  assert.match(merged, /HarFrame in-house Fenrir delivery/);
});

test('estimateSpeechDurationSec scales word count by speaking rate accurately', () => {
  const normal = estimateSpeechDurationSec('one two three four five six seven eight nine ten', 1.0);
  const fast = estimateSpeechDurationSec('one two three four five six seven eight nine ten', 1.25);

  assert.equal(normal.wordCount, 10);
  assert.equal(normal.estimatedSec, 4);
  assert.ok(fast.estimatedSec < normal.estimatedSec);
});

test('buildGeminiPromptForClip calculates target word budget and strips voice-model clutter', () => {
  const prompt = buildGeminiPromptForClip(
    'Use OpenAI TTS shimmer, make it mysterious and poetic about rain reflections',
    {
      filename: 'rain.mp4',
      durationSec: 10,
      width: 1080,
      height: 1920,
    }
  );
  assert.match(prompt, /10\.0s/);
  assert.match(prompt, /~24 words/);
  assert.match(prompt, /mysterious and poetic about rain reflections/i);
  assert.ok(!/openai/i.test(prompt));
});

test('sanitizeForSpeech and escapeXmlForSsml neutralize SSML-breaking characters', () => {
  const clean = sanitizeForSpeech('Rain & neon — watching <street> glow.');
  assert.equal(clean, 'Rain and neon, watching <street> glow.');

  const escaped = escapeXmlForSsml('5<6 & "ok" > \'fine\'');
  assert.equal(escaped, '5&lt;6 &amp; &quot;ok&quot; &gt; &apos;fine&apos;');
});

test('splitScriptIntoTtsChunks breaks long narration cleanly under max character budget', () => {
  const longText = Array.from(
    { length: 12 },
    (_, i) => `Sentence number ${i + 1} explores the night market scene in detail.`
  ).join(' ');
  const chunks = splitScriptIntoTtsChunks(longText, 180);
  assert.ok(chunks.length >= 4);
  for (const chunk of chunks) {
    assert.ok(chunk.length <= 180, `Expected chunk length <= 180, got ${chunk.length}`);
  }
});

test('computeGeminiVideoPreviewSpec caps fps and frames across short and long clips', () => {
  const shortSmall = computeGeminiVideoPreviewSpec(6, 300 * 1024);
  assert.equal(shortSmall.needsTranscode, false);
  assert.equal(shortSmall.targetFps, 2);
  assert.equal(shortSmall.maxFrames, 20);

  const longCompact = computeGeminiVideoPreviewSpec(90, 900 * 1024);
  assert.equal(longCompact.needsTranscode, true);
  assert.equal(longCompact.targetFps, 0.25);
  assert.equal(longCompact.keyframeCount, 6);
});

test('computeAdaptiveFrameTimestamps distributes timestamps cleanly inside clip duration', () => {
  const stamps = computeAdaptiveFrameTimestamps(12, 6);
  assert.equal(stamps.length, 6);
  assert.ok(stamps[0] > 0 && stamps[0] < stamps[1]);
  assert.ok(stamps[5] < 12);
});
