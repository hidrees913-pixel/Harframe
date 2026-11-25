import {
  CAPTION_PRESET_FOLDERS,
  presetToCustomCaptionStyle,
  type CaptionFolderCategory,
  type CaptionStyleId,
  type CustomCaptionPreset,
  type CustomCaptionStyle,
} from './studioPresets.ts';

export const CUSTOM_CAPTION_PRESETS_STORAGE_KEY = 'harframe_custom_caption_presets_v1';

export function createCustomCaptionPreset(params: {
  name: string;
  folder: CaptionFolderCategory;
  baseStyleId: CaptionStyleId;
  customStyle: CustomCaptionStyle;
  id?: string;
  createdAt?: number;
}): CustomCaptionPreset {
  const cleanName = params.name.trim() || 'Custom Caption';
  const validFolder = CAPTION_PRESET_FOLDERS.includes(params.folder)
    ? params.folder
    : 'Social Media';

  return {
    id: params.id || `custom_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name: cleanName.slice(0, 48),
    folder: validFolder,
    baseStyleId: params.baseStyleId,
    customStyle: { ...params.customStyle },
    createdAt: params.createdAt ?? Date.now(),
  };
}

export function upsertCustomCaptionPreset(
  existing: CustomCaptionPreset[],
  incoming: CustomCaptionPreset
): CustomCaptionPreset[] {
  const normalizedTarget = incoming.name.trim().toLowerCase();
  const withoutMatch = existing.filter(
    (p) =>
      p.id !== incoming.id &&
      !(p.folder === incoming.folder && p.name.trim().toLowerCase() === normalizedTarget)
  );
  return [incoming, ...withoutMatch].slice(0, 60);
}

export function deleteCustomCaptionPreset(
  existing: CustomCaptionPreset[],
  presetId: string
): CustomCaptionPreset[] {
  return existing.filter((p) => p.id !== presetId);
}

export function filterPresetsByFolder(
  presets: CustomCaptionPreset[],
  folder: CaptionFolderCategory | 'All'
): CustomCaptionPreset[] {
  if (folder === 'All') return presets;
  return presets.filter((p) => p.folder === folder);
}

export function groupPresetsByFolder(
  presets: CustomCaptionPreset[]
): Record<CaptionFolderCategory, CustomCaptionPreset[]> {
  const grouped: Record<CaptionFolderCategory, CustomCaptionPreset[]> = {
    'Social Media': [],
    Documentary: [],
    Cinematic: [],
  };
  for (const preset of presets) {
    const folder = CAPTION_PRESET_FOLDERS.includes(preset.folder)
      ? preset.folder
      : 'Social Media';
    grouped[folder].push(preset);
  }
  return grouped;
}

export function parseCustomCaptionPresetsJson(raw: string | null): CustomCaptionPreset[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const fallbackStyle = presetToCustomCaptionStyle('hormozi_yellow');
    return parsed
      .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
      .map((item) => ({
        id: String(item.id || `custom_${Math.random().toString(36).slice(2, 8)}`),
        name: String(item.name || 'Saved Preset').slice(0, 48),
        folder: CAPTION_PRESET_FOLDERS.includes(item.folder as CaptionFolderCategory)
          ? (item.folder as CaptionFolderCategory)
          : 'Social Media',
        baseStyleId: (item.baseStyleId as CaptionStyleId) || 'hormozi_yellow',
        customStyle: {
          ...fallbackStyle,
          ...((item.customStyle as Partial<CustomCaptionStyle>) || {}),
        },
        createdAt: typeof item.createdAt === 'number' ? item.createdAt : Date.now(),
      }));
  } catch {
    return [];
  }
}

export function loadCustomCaptionPresets(): CustomCaptionPreset[] {
  if (typeof window === 'undefined' || !window.localStorage) return [];
  return parseCustomCaptionPresetsJson(
    window.localStorage.getItem(CUSTOM_CAPTION_PRESETS_STORAGE_KEY)
  );
}

export function saveCustomCaptionPresets(presets: CustomCaptionPreset[]): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(CUSTOM_CAPTION_PRESETS_STORAGE_KEY, JSON.stringify(presets));
  } catch {
    // Ignore storage quota errors cleanly
  }
}
