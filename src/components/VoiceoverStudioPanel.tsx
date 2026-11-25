import { useEffect, useRef, useState } from 'react';
import { Loader2, Mic2, Play, Square, Volume2 } from 'lucide-react';
import {
  AI_VOICE_CATALOG,
  AUDIO_MIX_OPTIONS,
  VOICE_PRESETS,
  type AiVoiceId,
  type AudioMixMode,
  type VoiceId,
} from '../lib/studioPresets';

interface VoiceoverStudioPanelProps {
  hasSource: boolean;
  hasScript: boolean;
  hasSourceAudio: boolean;
  aiVoiceId: AiVoiceId;
  onAiVoiceChange: (voiceId: AiVoiceId) => void;
  speakingRate: number;
  onSpeakingRateChange: (rate: number) => void;
  tailoredVoiceInstruction?: string | null;
  useAiVoiceover: boolean;
  onUseAiVoiceoverChange: (enabled: boolean) => void;
  audioMixMode: AudioMixMode;
  onAudioMixModeChange: (mode: AudioMixMode) => void;
  fallbackCharacterVoiceId: VoiceId;
  onFallbackCharacterVoiceChange: (voiceId: VoiceId) => void;
  voiceoverUrl: string | null;
  voiceoverDurationSec: number | null;
  voiceoverEngine: string | null;
  isSynthesizing: boolean;
  voiceoverError: string | null;
  onGenerateVoiceover: () => void;
}

export function VoiceoverStudioPanel({
  hasSource,
  hasScript,
  hasSourceAudio,
  aiVoiceId,
  onAiVoiceChange,
  speakingRate,
  onSpeakingRateChange,
  useAiVoiceover,
  onUseAiVoiceoverChange,
  audioMixMode,
  onAudioMixModeChange,
  fallbackCharacterVoiceId,
  onFallbackCharacterVoiceChange,
  voiceoverUrl,
  voiceoverDurationSec,
  isSynthesizing,
  voiceoverError,
  onGenerateVoiceover,
}: VoiceoverStudioPanelProps) {
  const [auditioningId, setAuditioningId] = useState<AiVoiceId | null>(null);
  const [loadingSampleId, setLoadingSampleId] = useState<AiVoiceId | null>(null);
  const [sampleError, setSampleError] = useState<string | null>(null);
  const sampleAudioRef = useRef<HTMLAudioElement | null>(null);

  const selectedVoice =
    AI_VOICE_CATALOG.find((v) => v.id === aiVoiceId) ?? AI_VOICE_CATALOG[0];

  useEffect(() => {
    return () => {
      if (sampleAudioRef.current) {
        sampleAudioRef.current.pause();
        sampleAudioRef.current = null;
      }
    };
  }, []);

  const handleToggleSample = async (id: AiVoiceId) => {
    setSampleError(null);
    if (auditioningId === id && sampleAudioRef.current) {
      sampleAudioRef.current.pause();
      sampleAudioRef.current = null;
      setAuditioningId(null);
      return;
    }

    if (sampleAudioRef.current) {
      sampleAudioRef.current.pause();
      sampleAudioRef.current = null;
    }

    setLoadingSampleId(id);
    try {
      const rateQuery =
        Math.abs(speakingRate - 1.0) > 0.02
          ? `?rate=${encodeURIComponent(speakingRate.toFixed(2))}`
          : '';
      const audio = new Audio(`/api/voices/${encodeURIComponent(id)}/sample${rateQuery}`);
      sampleAudioRef.current = audio;

      audio.onended = () => {
        setAuditioningId(null);
        setLoadingSampleId(null);
      };
      audio.onerror = () => {
        setSampleError('Could not load voice sample.');
        setAuditioningId(null);
        setLoadingSampleId(null);
      };

      await audio.play();
      setAuditioningId(id);
    } catch {
      setSampleError('Audio playback blocked or unavailable.');
      setAuditioningId(null);
    } finally {
      setLoadingSampleId(null);
    }
  };

  const isPreviewingSelected = auditioningId === selectedVoice.id;
  const isLoadingSelectedPreview = loadingSampleId === selectedVoice.id;

  return (
    <section id="voiceover" aria-label="Voice and Sound" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-display text-base font-semibold text-slate-900">
            Voice
          </h2>
          <p className="text-xs text-slate-500">
            Voiceover is embedded into your exported video across every sound option.
          </p>
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={useAiVoiceover}
          onClick={() => onUseAiVoiceoverChange(!useAiVoiceover)}
          className={`min-h-[38px] px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors whitespace-nowrap cursor-pointer ${
            useAiVoiceover
              ? 'border-[#7C3AED] bg-purple-50 text-[#6D28D9]'
              : 'border-slate-300 bg-white text-slate-600 hover:text-slate-900'
          }`}
        >
          Voice: {useAiVoiceover ? 'On' : 'Off'}
        </button>
      </div>

      {useAiVoiceover ? (
        <>
          {/* Voice list */}
          <div className="grid grid-cols-1 gap-1.5 max-h-[240px] overflow-y-auto pr-1">
            {AI_VOICE_CATALOG.map((voice) => {
              const selected = voice.id === aiVoiceId;
              const isPlaying = auditioningId === voice.id;
              const isLoading = loadingSampleId === voice.id;

              return (
                <div
                  key={voice.id}
                  className={`rounded-lg border px-3 py-2 transition-colors flex items-center justify-between gap-2 ${
                    selected
                      ? 'border-[#7C3AED] bg-purple-50/70'
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      if (auditioningId && auditioningId !== voice.id && sampleAudioRef.current) {
                        sampleAudioRef.current.pause();
                        sampleAudioRef.current = null;
                        setAuditioningId(null);
                      }
                      onAiVoiceChange(voice.id);
                    }}
                    className="flex-1 min-w-0 text-left focus:outline-none cursor-pointer"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-slate-900 truncate">
                        {voice.name}
                      </span>
                      <span className="text-[11px] text-[#7C3AED] font-medium shrink-0">
                        {voice.toneTag}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 truncate">
                      {voice.role}
                    </p>
                  </button>

                  <button
                    type="button"
                    aria-label={isPlaying ? `Stop ${voice.name}` : `Play ${voice.name}`}
                    onClick={() => handleToggleSample(voice.id)}
                    className={`inline-flex items-center justify-center gap-1 min-h-[34px] px-2.5 py-1 rounded-md text-xs font-medium border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      isPlaying
                        ? 'border-[#7C3AED] bg-[#7C3AED] text-white'
                        : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    {isLoading ? (
                      <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
                    ) : isPlaying ? (
                      <Square className="w-3 h-3 fill-current" aria-hidden="true" />
                    ) : (
                      <Play className="w-3 h-3 fill-current" aria-hidden="true" />
                    )}
                    {isPlaying ? 'Stop' : 'Play'}
                  </button>
                </div>
              );
            })}
          </div>

          {/* Active voice Preview bar */}
          <div className="flex items-center justify-between gap-3 py-2.5 px-3 rounded-lg bg-amber-50/70 border border-amber-200">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-slate-900 truncate">
                {selectedVoice.name} &middot;{' '}
                <span className="font-normal text-slate-600">{selectedVoice.role}</span>
              </p>
              <p className="text-[11px] text-slate-600 italic truncate" title={selectedVoice.samplePhrase}>
                &ldquo;{selectedVoice.samplePhrase}&rdquo;
              </p>
            </div>
            <button
              type="button"
              aria-pressed={isPreviewingSelected}
              aria-label={
                isPreviewingSelected
                  ? `Stop preview for ${selectedVoice.name}`
                  : `Preview ${selectedVoice.name}`
              }
              disabled={isLoadingSelectedPreview}
              onClick={() => handleToggleSample(selectedVoice.id)}
              className={`inline-flex items-center justify-center gap-1.5 min-h-[40px] px-3.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer transition-colors disabled:opacity-60 ${
                isPreviewingSelected
                  ? 'bg-[#7C3AED] text-white'
                  : 'bg-white border border-slate-300 text-slate-900 hover:border-[#7C3AED]'
              }`}
            >
              {isLoadingSelectedPreview ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
              ) : isPreviewingSelected ? (
                <Square className="w-3.5 h-3.5 fill-current" aria-hidden="true" />
              ) : (
                <Play className="w-3.5 h-3.5 fill-current" aria-hidden="true" />
              )}
              {isLoadingSelectedPreview ? 'Loading...' : isPreviewingSelected ? 'Stop' : 'Preview'}
            </button>
          </div>

          {sampleError && (
            <p role="alert" className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              {sampleError}
            </p>
          )}

          {/* Speed slider */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <label htmlFor="voice-rate-slider" className="font-medium text-slate-700">
                Speed
              </label>
              <span className="font-mono-tabular font-semibold text-[#7C3AED]">
                {speakingRate.toFixed(2)}x
              </span>
            </div>
            <input
              id="voice-rate-slider"
              type="range"
              min="0.85"
              max="1.25"
              step="0.05"
              value={speakingRate}
              onChange={(e) => onSpeakingRateChange(Number(e.target.value))}
              className="w-full accent-[#7C3AED] cursor-pointer"
            />
          </div>

          {/* Create Voice button + player */}
          <div className="space-y-2.5">
            <button
              type="button"
              disabled={!hasSource || !hasScript || isSynthesizing}
              onClick={onGenerateVoiceover}
              className="w-full min-h-[44px] inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-xs font-semibold text-white bg-[#7C3AED] hover:bg-[#6D28D9] disabled:opacity-45 disabled:cursor-not-allowed transition-colors cursor-pointer whitespace-nowrap"
            >
              {isSynthesizing ? (
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
              ) : (
                <Mic2 className="w-4 h-4" aria-hidden="true" />
              )}
              {isSynthesizing
                ? 'Creating Voice...'
                : voiceoverUrl
                  ? 'Recreate Voice'
                  : 'Create Voice'}
            </button>

            {!hasScript && (
              <p className="text-[11px] text-slate-500">
                Write a script above, or export directly to voice over detected captions.
              </p>
            )}

            {voiceoverError && (
              <p role="alert" className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
                {voiceoverError}
              </p>
            )}

            {voiceoverUrl && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 p-3 space-y-2">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-800">
                    <Volume2 className="w-3.5 h-3.5" aria-hidden="true" />
                    Voice Ready &middot; Embedded on Export
                  </span>
                  {voiceoverDurationSec && (
                    <span className="font-mono-tabular text-emerald-700">
                      {voiceoverDurationSec.toFixed(1)}s
                    </span>
                  )}
                </div>
                <audio controls src={voiceoverUrl} className="w-full h-9" />
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="space-y-2">
          <label htmlFor="fallback-voice-select" className="block text-xs font-medium text-slate-700">
            Original Audio Filter
          </label>
          <select
            id="fallback-voice-select"
            value={fallbackCharacterVoiceId}
            onChange={(e) => onFallbackCharacterVoiceChange(e.target.value as VoiceId)}
            className="w-full min-h-[42px] rounded-lg bg-white border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-[#7C3AED] cursor-pointer"
          >
            {VOICE_PRESETS.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name} — {v.role}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Sound Mix Options (Always embeds voiceover when selected) */}
      <div className="space-y-2 pt-3 border-t border-slate-200">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-slate-700">
            Original Video Sound Mix
          </span>
          {!hasSourceAudio && (
            <span className="text-[11px] text-slate-400">No source audio</span>
          )}
        </div>

        <div role="radiogroup" aria-label="Original video sound mix" className="space-y-1.5">
          {AUDIO_MIX_OPTIONS.map((opt) => {
            const active = audioMixMode === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => {
                  if (!useAiVoiceover) {
                    onUseAiVoiceoverChange(true);
                  }
                  onAudioMixModeChange(opt.id);
                }}
                className={`w-full text-left rounded-lg border px-3 py-2 transition-colors cursor-pointer ${
                  active
                    ? 'border-[#7C3AED] bg-purple-50/60'
                    : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                <p className="text-xs font-semibold text-slate-900">{opt.label}</p>
                <p className="text-[11px] text-slate-500 mt-0.5">{opt.description}</p>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
