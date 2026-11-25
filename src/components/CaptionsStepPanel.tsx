import { useEffect, useState } from 'react';
import { BookmarkPlus, Captions, Folder, Loader2, RefreshCw, RotateCcw, Trash2 } from 'lucide-react';
import {
  CAPTION_FONT_OPTIONS,
  CAPTION_PRESET_FOLDERS,
  CAPTION_STYLE_PRESETS,
  getCaptionFontCssFamily,
  presetToCustomCaptionStyle,
  type CaptionAnimationKind,
  type CaptionFolderCategory,
  type CaptionPosition,
  type CaptionStyleId,
  type CustomCaptionPreset,
  type CustomCaptionStyle,
} from '../lib/studioPresets';
import {
  createCustomCaptionPreset,
  deleteCustomCaptionPreset,
  filterPresetsByFolder,
  loadCustomCaptionPresets,
  saveCustomCaptionPresets,
  upsertCustomCaptionPreset,
} from '../lib/captionPresetsStorage';

interface CaptionsStepPanelProps {
  captionsEnabled: boolean;
  onCaptionsEnabledChange: (enabled: boolean) => void;
  captionStyleId: CaptionStyleId;
  onCaptionStyleChange: (styleId: CaptionStyleId) => void;
  customCaptionStyle: CustomCaptionStyle;
  onCustomCaptionStyleChange: (style: CustomCaptionStyle) => void;
  hasSource: boolean;
  hasVoiceover: boolean;
  hasSegments: boolean;
  isTranscribing: boolean;
  transcribeEngine: string | null;
  transcribeWarning: string | null;
  onSyncCaptions: () => void;
}

const ANIMATION_OPTIONS: Array<{ id: CaptionAnimationKind; label: string }> = [
  { id: 'none', label: 'None (Static)' },
  { id: 'karaoke-bounce', label: 'Karaoke Bounce' },
  { id: 'elastic-pop', label: 'Elastic Pop' },
  { id: 'karaoke-sweep', label: 'Gold Sweep' },
  { id: 'glitch-pulse', label: 'Glitch Pulse' },
  { id: 'aura-wave', label: 'Aura Wave' },
  { id: 'comic-slam', label: 'Comic Slam' },
  { id: 'flash-alert', label: 'Flash Alert' },
];

function buildOutlineTextShadow(outlineWidth: number, outlineColor: string): string {
  if (outlineWidth <= 0) return 'none';
  const px = Math.max(1, Math.min(3, Math.round(outlineWidth / 2)));
  return `${-px}px ${-px}px 0 ${outlineColor}, ${px}px ${-px}px 0 ${outlineColor}, ${-px}px ${px}px 0 ${outlineColor}, ${px}px ${px}px 0 ${outlineColor}, 0 2px 6px rgba(0,0,0,0.65)`;
}

export function CaptionsStepPanel({
  captionsEnabled,
  onCaptionsEnabledChange,
  captionStyleId,
  onCaptionStyleChange,
  customCaptionStyle,
  onCustomCaptionStyleChange,
  hasSource,
  hasVoiceover,
  hasSegments,
  isTranscribing,
  transcribeWarning,
  onSyncCaptions,
}: CaptionsStepPanelProps) {
  const [savedPresets, setSavedPresets] = useState<CustomCaptionPreset[]>(() =>
    loadCustomCaptionPresets()
  );
  const [selectedFolder, setSelectedFolder] = useState<CaptionFolderCategory | 'All'>('All');
  const [newPresetName, setNewPresetName] = useState('');
  const [newPresetFolder, setNewPresetFolder] =
    useState<CaptionFolderCategory>('Social Media');
  const [presetFeedback, setPresetFeedback] = useState<string | null>(null);

  useEffect(() => {
    saveCustomCaptionPresets(savedPresets);
  }, [savedPresets]);

  const activeCaption =
    CAPTION_STYLE_PRESETS.find((c) => c.id === captionStyleId) ?? CAPTION_STYLE_PRESETS[0];

  const patchCustomStyle = (partial: Partial<CustomCaptionStyle>) => {
    onCustomCaptionStyleChange({ ...customCaptionStyle, ...partial });
  };

  const handleBuiltInPresetChange = (nextId: CaptionStyleId) => {
    onCaptionStyleChange(nextId);
    onCustomCaptionStyleChange(presetToCustomCaptionStyle(nextId));
  };

  const handleSaveCustomPreset = () => {
    const cleanName = newPresetName.trim();
    if (!cleanName) {
      setPresetFeedback('Enter a preset name first.');
      return;
    }
    const created = createCustomCaptionPreset({
      name: cleanName,
      folder: newPresetFolder,
      baseStyleId: captionStyleId,
      customStyle: customCaptionStyle,
    });
    const next = upsertCustomCaptionPreset(savedPresets, created);
    setSavedPresets(next);
    setNewPresetName('');
    setSelectedFolder(newPresetFolder);
    setPresetFeedback(`Saved "${created.name}" to ${created.folder}`);
    setTimeout(() => setPresetFeedback(null), 2400);
  };

  const handleApplySavedPreset = (preset: CustomCaptionPreset) => {
    onCaptionStyleChange(preset.baseStyleId);
    onCustomCaptionStyleChange({ ...preset.customStyle });
    setPresetFeedback(`Applied "${preset.name}"`);
    setTimeout(() => setPresetFeedback(null), 2000);
  };

  const handleDeleteSavedPreset = (id: string) => {
    setSavedPresets((prev) => deleteCustomCaptionPreset(prev, id));
  };

  const visibleSavedPresets = filterPresetsByFolder(savedPresets, selectedFolder);

  const previewCssStyle: React.CSSProperties = {
    color: customCaptionStyle.primaryColor,
    fontFamily: getCaptionFontCssFamily(customCaptionStyle.fontName),
    fontWeight: customCaptionStyle.bold ? 800 : 500,
    fontStyle: customCaptionStyle.italic ? 'italic' : 'normal',
    textTransform: customCaptionStyle.uppercase ? 'uppercase' : 'none',
    fontSize: `${Math.max(13, Math.min(24, Math.round(customCaptionStyle.fontSize * 0.27)))}px`,
    backgroundColor: customCaptionStyle.backgroundEnabled
      ? customCaptionStyle.backgroundColor
      : 'transparent',
    padding: customCaptionStyle.backgroundEnabled ? '5px 12px' : undefined,
    borderRadius: customCaptionStyle.backgroundEnabled ? '6px' : undefined,
    textShadow: customCaptionStyle.backgroundEnabled
      ? 'none'
      : buildOutlineTextShadow(
          customCaptionStyle.outlineWidth,
          customCaptionStyle.outlineColor
        ),
  };

  return (
    <section id="captions" aria-label="Captions" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-display text-base font-semibold text-slate-900">
            Captions
          </h2>
          <p className="text-xs text-slate-500">
            Customize colors, font, size, position, or save presets into folders.
          </p>
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={captionsEnabled}
          aria-label="Toggle captions"
          onClick={() => onCaptionsEnabledChange(!captionsEnabled)}
          className={`inline-flex items-center justify-center gap-2 min-h-[40px] px-4 py-2 rounded-lg text-xs font-semibold border whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
            captionsEnabled
              ? 'border-[#7C3AED] bg-[#7C3AED] text-white'
              : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400'
          }`}
        >
          <Captions className="w-4 h-4" aria-hidden="true" />
          Captions: {captionsEnabled ? 'On' : 'Off'}
        </button>
      </div>

      {!captionsEnabled ? (
        <p className="text-xs text-slate-500 bg-slate-50 rounded-lg px-3 py-2.5">
          Captions are turned off for this export.
        </p>
      ) : (
        <div className="space-y-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-slate-600">
              {hasVoiceover ? 'Sync captions to voiceover' : 'Generate captions from video audio'}
            </span>
            <button
              type="button"
              disabled={!hasSource || isTranscribing}
              onClick={onSyncCaptions}
              className="inline-flex items-center justify-center gap-1.5 min-h-[38px] px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-purple-50 border border-purple-200 text-[#6D28D9] hover:bg-purple-100 disabled:opacity-45 disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {isTranscribing ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
              )}
              {isTranscribing
                ? 'Syncing...'
                : hasSegments
                  ? 'Resync Captions'
                  : 'Sync Captions'}
            </button>
          </div>

          {transcribeWarning && (
            <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              {transcribeWarning}
            </p>
          )}

          {/* Built-in Preset Selector */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="caption-style-select" className="text-xs font-medium text-slate-700">
                Caption Style ({CAPTION_STYLE_PRESETS.length} styles)
              </label>
              <button
                type="button"
                onClick={() =>
                  onCustomCaptionStyleChange(presetToCustomCaptionStyle(captionStyleId))
                }
                title="Reset custom tweaks to selected preset defaults"
                className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 hover:text-[#7C3AED] cursor-pointer"
              >
                <RotateCcw className="w-3 h-3" aria-hidden="true" />
                Reset Style
              </button>
            </div>

            <select
              id="caption-style-select"
              value={captionStyleId}
              onChange={(e) => handleBuiltInPresetChange(e.target.value as CaptionStyleId)}
              className="w-full min-h-[40px] rounded-lg bg-white border border-slate-300 px-3 py-2 text-xs font-medium text-slate-900 focus:outline-none focus:border-[#7C3AED] cursor-pointer"
            >
              {CAPTION_STYLE_PRESETS.map((style) => (
                <option key={style.id} value={style.id}>
                  {style.name} {style.isAnimated ? '(Animated)' : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Caption Preview Stage */}
          <div className="rounded-lg bg-slate-900 px-3 py-4 text-center overflow-hidden min-h-[60px] flex items-center justify-center">
            <span
              className={`leading-tight tracking-wide caption-anim-${customCaptionStyle.animation}`}
              style={previewCssStyle}
            >
              HarFrame brings stories to life
            </span>
          </div>

          {/* Full Customizer Controls */}
          <div className="space-y-3 pt-2 border-t border-slate-200">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div>
                <label htmlFor="caption-font-select" className="block text-[11px] font-medium text-slate-700 mb-1">
                  Font
                </label>
                <select
                  id="caption-font-select"
                  value={customCaptionStyle.fontName}
                  onChange={(e) => patchCustomStyle({ fontName: e.target.value })}
                  className="w-full min-h-[38px] rounded-lg bg-white border border-slate-300 px-2.5 py-1.5 text-xs text-slate-900 focus:outline-none focus:border-[#7C3AED] cursor-pointer"
                >
                  {CAPTION_FONT_OPTIONS.map((font) => (
                    <option key={font.assFontName} value={font.assFontName}>
                      {font.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="caption-animation-select" className="block text-[11px] font-medium text-slate-700 mb-1">
                  Animation
                </label>
                <select
                  id="caption-animation-select"
                  value={customCaptionStyle.animation}
                  onChange={(e) =>
                    patchCustomStyle({ animation: e.target.value as CaptionAnimationKind })
                  }
                  className="w-full min-h-[38px] rounded-lg bg-white border border-slate-300 px-2.5 py-1.5 text-xs text-slate-900 focus:outline-none focus:border-[#7C3AED] cursor-pointer"
                >
                  {ANIMATION_OPTIONS.map((anim) => (
                    <option key={anim.id} value={anim.id}>
                      {anim.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Color Pickers Row */}
            <div className="grid grid-cols-3 gap-2">
              <label className="flex items-center justify-between gap-1.5 rounded-lg border border-slate-200 bg-slate-50/70 px-2.5 py-1.5 cursor-pointer">
                <span className="text-[11px] font-medium text-slate-700">Text</span>
                <input
                  type="color"
                  aria-label="Caption text color"
                  value={customCaptionStyle.primaryColor}
                  onChange={(e) =>
                    patchCustomStyle({ primaryColor: e.target.value.toUpperCase() })
                  }
                  className="w-6 h-6 rounded border-0 bg-transparent p-0 cursor-pointer"
                />
              </label>

              <label className="flex items-center justify-between gap-1.5 rounded-lg border border-slate-200 bg-slate-50/70 px-2.5 py-1.5 cursor-pointer">
                <span className="text-[11px] font-medium text-slate-700">Outline</span>
                <input
                  type="color"
                  aria-label="Caption outline color"
                  value={customCaptionStyle.outlineColor}
                  onChange={(e) =>
                    patchCustomStyle({ outlineColor: e.target.value.toUpperCase() })
                  }
                  className="w-6 h-6 rounded border-0 bg-transparent p-0 cursor-pointer"
                />
              </label>

              <div className="flex items-center justify-between gap-1 rounded-lg border border-slate-200 bg-slate-50/70 px-2 py-1.5">
                <label className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    aria-label="Enable caption background box"
                    checked={customCaptionStyle.backgroundEnabled}
                    onChange={(e) => patchCustomStyle({ backgroundEnabled: e.target.checked })}
                    className="accent-[#7C3AED] cursor-pointer"
                  />
                  Box
                </label>
                <input
                  type="color"
                  aria-label="Caption background box color"
                  disabled={!customCaptionStyle.backgroundEnabled}
                  value={customCaptionStyle.backgroundColor}
                  onChange={(e) =>
                    patchCustomStyle({ backgroundColor: e.target.value.toUpperCase() })
                  }
                  className="w-6 h-6 rounded border-0 bg-transparent p-0 cursor-pointer disabled:opacity-35"
                />
              </div>
            </div>

            {/* Size & Outline Sliders */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[11px]">
                  <label htmlFor="caption-size-slider" className="font-medium text-slate-700">
                    Font Size
                  </label>
                  <span className="font-mono-tabular font-semibold text-[#7C3AED]">
                    {customCaptionStyle.fontSize}px
                  </span>
                </div>
                <input
                  id="caption-size-slider"
                  type="range"
                  min="36"
                  max="96"
                  step="2"
                  value={customCaptionStyle.fontSize}
                  onChange={(e) => patchCustomStyle({ fontSize: Number(e.target.value) })}
                  className="w-full accent-[#7C3AED] cursor-pointer"
                />
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between text-[11px]">
                  <label htmlFor="caption-outline-slider" className="font-medium text-slate-700">
                    Outline
                  </label>
                  <span className="font-mono-tabular font-semibold text-[#7C3AED]">
                    {customCaptionStyle.outlineWidth}px
                  </span>
                </div>
                <input
                  id="caption-outline-slider"
                  type="range"
                  min="0"
                  max="10"
                  step="1"
                  value={customCaptionStyle.outlineWidth}
                  onChange={(e) => patchCustomStyle({ outlineWidth: Number(e.target.value) })}
                  className="w-full accent-[#7C3AED] cursor-pointer"
                />
              </div>
            </div>

            {/* Formatting & Position Row */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="inline-flex items-center gap-1" role="group" aria-label="Text formatting">
                <button
                  type="button"
                  aria-pressed={customCaptionStyle.bold}
                  onClick={() => patchCustomStyle({ bold: !customCaptionStyle.bold })}
                  className={`min-h-[32px] px-2.5 rounded-md text-xs font-bold border transition-colors cursor-pointer ${
                    customCaptionStyle.bold
                      ? 'border-[#7C3AED] bg-purple-50 text-[#6D28D9]'
                      : 'border-slate-200 bg-white text-slate-600'
                  }`}
                >
                  B
                </button>
                <button
                  type="button"
                  aria-pressed={customCaptionStyle.italic}
                  onClick={() => patchCustomStyle({ italic: !customCaptionStyle.italic })}
                  className={`min-h-[32px] px-2.5 rounded-md text-xs italic font-semibold border transition-colors cursor-pointer ${
                    customCaptionStyle.italic
                      ? 'border-[#7C3AED] bg-purple-50 text-[#6D28D9]'
                      : 'border-slate-200 bg-white text-slate-600'
                  }`}
                >
                  I
                </button>
                <button
                  type="button"
                  aria-pressed={customCaptionStyle.uppercase}
                  onClick={() => patchCustomStyle({ uppercase: !customCaptionStyle.uppercase })}
                  className={`min-h-[32px] px-2.5 rounded-md text-[11px] font-semibold border transition-colors cursor-pointer ${
                    customCaptionStyle.uppercase
                      ? 'border-[#7C3AED] bg-purple-50 text-[#6D28D9]'
                      : 'border-slate-200 bg-white text-slate-600'
                  }`}
                >
                  CAPS
                </button>
              </div>

              <div
                className="inline-flex items-center gap-1 p-0.5 rounded-lg bg-slate-100"
                role="group"
                aria-label="Caption position"
              >
                {(['bottom', 'middle', 'top'] as CaptionPosition[]).map((pos) => {
                  const active = customCaptionStyle.position === pos;
                  return (
                    <button
                      key={pos}
                      type="button"
                      aria-pressed={active}
                      onClick={() => patchCustomStyle({ position: pos })}
                      className={`min-h-[28px] px-2.5 rounded-md text-[11px] font-medium capitalize transition-colors cursor-pointer ${
                        active
                          ? 'bg-white text-slate-900 shadow-sm font-semibold'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {pos}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Save & Organize Custom Presets by Folder */}
          <div className="space-y-2.5 pt-3 border-t border-slate-200">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-900 inline-flex items-center gap-1.5">
                <Folder className="w-3.5 h-3.5 text-[#7C3AED]" aria-hidden="true" />
                Custom Presets
              </span>
              <span className="text-[11px] text-slate-400">
                {activeCaption.name}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <label htmlFor="custom-preset-name" className="sr-only">
                Custom preset name
              </label>
              <input
                id="custom-preset-name"
                type="text"
                placeholder="Preset name..."
                value={newPresetName}
                onChange={(e) => setNewPresetName(e.target.value)}
                className="flex-1 min-w-[120px] min-h-[36px] rounded-lg bg-white border border-slate-300 px-2.5 py-1 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-[#7C3AED]"
              />

              <label htmlFor="custom-preset-folder" className="sr-only">
                Preset folder
              </label>
              <select
                id="custom-preset-folder"
                value={newPresetFolder}
                onChange={(e) => setNewPresetFolder(e.target.value as CaptionFolderCategory)}
                className="min-h-[36px] rounded-lg bg-white border border-slate-300 px-2 py-1 text-xs text-slate-900 focus:outline-none focus:border-[#7C3AED] cursor-pointer"
              >
                {CAPTION_PRESET_FOLDERS.map((folder) => (
                  <option key={folder} value={folder}>
                    {folder}
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={handleSaveCustomPreset}
                className="inline-flex items-center gap-1 min-h-[36px] px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#7C3AED] hover:bg-[#6D28D9] text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <BookmarkPlus className="w-3.5 h-3.5" aria-hidden="true" />
                Save Preset
              </button>
            </div>

            {presetFeedback && (
              <p className="text-[11px] font-medium text-emerald-700">{presetFeedback}</p>
            )}

            {/* Folder Tabs */}
            <div className="flex flex-wrap items-center gap-1" role="tablist" aria-label="Custom preset folders">
              {(['All', ...CAPTION_PRESET_FOLDERS] as const).map((folder) => {
                const isSelected = selectedFolder === folder;
                const count =
                  folder === 'All'
                    ? savedPresets.length
                    : savedPresets.filter((p) => p.folder === folder).length;
                return (
                  <button
                    key={folder}
                    type="button"
                    role="tab"
                    aria-selected={isSelected}
                    onClick={() => setSelectedFolder(folder)}
                    className={`min-h-[28px] px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap ${
                      isSelected
                        ? 'bg-purple-100 text-[#6D28D9] font-semibold'
                        : 'bg-slate-100 text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {folder} ({count})
                  </button>
                );
              })}
            </div>

            {visibleSavedPresets.length === 0 ? (
              <p className="text-[11px] text-slate-400">
                No saved presets in {selectedFolder === 'All' ? 'any folder' : selectedFolder} yet.
              </p>
            ) : (
              <ul className="space-y-1 max-h-[140px] overflow-y-auto pr-1" aria-label="Saved custom caption presets">
                {visibleSavedPresets.map((preset) => (
                  <li
                    key={preset.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5"
                  >
                    <button
                      type="button"
                      onClick={() => handleApplySavedPreset(preset)}
                      className="flex-1 min-w-0 flex items-center gap-2 text-left cursor-pointer"
                    >
                      <span
                        className="w-3 h-3 rounded-sm border border-black/20 shrink-0"
                        style={{ backgroundColor: preset.customStyle.primaryColor }}
                        aria-hidden="true"
                      />
                      <span className="text-xs font-semibold text-slate-900 truncate">
                        {preset.name}
                      </span>
                      <span className="text-[10px] font-medium text-slate-500 shrink-0">
                        {preset.folder}
                      </span>
                    </button>

                    <button
                      type="button"
                      aria-label={`Delete preset ${preset.name}`}
                      onClick={() => handleDeleteSavedPreset(preset.id)}
                      className="inline-flex items-center justify-center w-6 h-6 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50 cursor-pointer"
                    >
                      <Trash2 className="w-3 h-3" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
