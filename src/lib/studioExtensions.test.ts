import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCustomCaptionPreset,
  deleteCustomCaptionPreset,
  filterPresetsByFolder,
  groupPresetsByFolder,
  parseCustomCaptionPresetsJson,
  upsertCustomCaptionPreset,
} from './captionPresetsStorage.ts';
import {
  ACCOUNT_HISTORY_LIMIT,
  addHistoryEntryWithLimit,
  createHistoryEntry,
  enforceHistoryLimit,
  GUEST_HISTORY_LIMIT,
  parseGuestHistoryJson,
} from './historyStore.ts';
import { DEFAULT_STUDIO_SETTINGS } from './batchQueue.ts';
import { CAPTION_PRESET_FOLDERS, presetToCustomCaptionStyle } from './studioPresets.ts';

test('categorized custom caption presets organize cleanly into Social Media, Documentary, and Cinematic folders', () => {
  assert.deepEqual([...CAPTION_PRESET_FOLDERS], ['Social Media', 'Documentary', 'Cinematic']);

  const socialPreset = createCustomCaptionPreset({
    name: 'Reel Pop Pink',
    folder: 'Social Media',
    baseStyleId: 'hormozi_yellow',
    customStyle: {
      ...presetToCustomCaptionStyle('hormozi_yellow'),
      primaryColor: '#FF3366',
      fontName: 'Noto Sans Display',
    },
  });

  const docPreset = createCustomCaptionPreset({
    name: 'Archive Serif',
    folder: 'Documentary',
    baseStyleId: 'documentary_lower_third',
    customStyle: {
      ...presetToCustomCaptionStyle('documentary_lower_third'),
      fontName: 'DejaVu Serif',
    },
  });

  const cinemaPreset = createCustomCaptionPreset({
    name: 'Noir Gold',
    folder: 'Cinematic',
    baseStyleId: 'editorial_serif_gold',
    customStyle: presetToCustomCaptionStyle('editorial_serif_gold'),
  });

  let list = upsertCustomCaptionPreset([], socialPreset);
  list = upsertCustomCaptionPreset(list, docPreset);
  list = upsertCustomCaptionPreset(list, cinemaPreset);

  assert.equal(list.length, 3);
  assert.equal(filterPresetsByFolder(list, 'All').length, 3);
  assert.equal(filterPresetsByFolder(list, 'Social Media').length, 1);
  assert.equal(filterPresetsByFolder(list, 'Documentary')[0]?.name, 'Archive Serif');

  const grouped = groupPresetsByFolder(list);
  assert.equal(grouped['Social Media'].length, 1);
  assert.equal(grouped.Documentary.length, 1);
  assert.equal(grouped.Cinematic.length, 1);

  // Upserting same folder + name replaces previous entry without duplicating
  const updatedSocial = createCustomCaptionPreset({
    name: 'reel pop pink',
    folder: 'Social Media',
    baseStyleId: 'hormozi_yellow',
    customStyle: {
      ...presetToCustomCaptionStyle('hormozi_yellow'),
      primaryColor: '#00E5FF',
    },
  });
  list = upsertCustomCaptionPreset(list, updatedSocial);
  assert.equal(filterPresetsByFolder(list, 'Social Media').length, 1);
  assert.equal(filterPresetsByFolder(list, 'Social Media')[0]?.customStyle.primaryColor, '#00E5FF');

  // Round-trip JSON parsing
  const reparsed = parseCustomCaptionPresetsJson(JSON.stringify(list));
  assert.equal(reparsed.length, 3);
  assert.equal(reparsed[0]?.folder, 'Social Media');

  // Delete preset
  const afterDelete = deleteCustomCaptionPreset(reparsed, docPreset.id);
  assert.equal(afterDelete.length, 2);
  assert.equal(filterPresetsByFolder(afterDelete, 'Documentary').length, 0);
});

test('history store caps guest renders at 2 and supports 5+ renders for signed-in accounts', () => {
  assert.equal(GUEST_HISTORY_LIMIT, 2);
  assert.ok(ACCOUNT_HISTORY_LIMIT >= 5);

  const makeRender = (idx: number) =>
    createHistoryEntry({
      id: `hist-${idx}`,
      timestamp: 1700000000000 + idx * 1000,
      metadata: {
        jobId: `job-${idx}`,
        filename: `clip-${idx}.mp4`,
        sourceUrl: `/api/media/job-${idx}/source`,
        sourceType: 'sample',
        durationSec: 8,
        width: 1280,
        height: 720,
        fps: 30,
        hasAudio: true,
        isStereoAudio: true,
        codec: 'h264',
        fileSizeBytes: 512000,
      },
      settings: {
        ...DEFAULT_STUDIO_SETTINGS,
        customCaptionStyle: presetToCustomCaptionStyle('hormozi_yellow'),
      },
      segments: [{ id: 's1', startSec: 0, endSec: 2, text: `Clip ${idx}` }],
      renderResult: {
        jobId: `job-${idx}`,
        outputUrl: `/api/media/job-${idx}/output`,
        downloadUrl: `/api/download/job-${idx}?name=clip-${idx}_harframe.mp4`,
        srtUrl: `/api/media/job-${idx}/srt`,
        assUrl: `/api/media/job-${idx}/ass`,
        width: 1280,
        height: 720,
        durationSec: 8,
        fileSizeBytes: 600000,
        voiceId: 'original',
        aiVoiceId: 'aria_warm',
        voiceoverEmbedded: true,
        audioMixMode: 'asmr_only',
        frameAspect: '16:9',
        resolutionTier: '720p',
        frameFit: 'fit',
        colorGradeId: 'none',
        captionsEnabled: true,
        captionStyleId: 'hormozi_yellow',
        customCaptionStyle: presetToCustomCaptionStyle('hormozi_yellow'),
      },
    });

  let guestList = addHistoryEntryWithLimit([], makeRender(1), GUEST_HISTORY_LIMIT);
  guestList = addHistoryEntryWithLimit(guestList, makeRender(2), GUEST_HISTORY_LIMIT);
  guestList = addHistoryEntryWithLimit(guestList, makeRender(3), GUEST_HISTORY_LIMIT);

  assert.equal(guestList.length, 2);
  assert.equal(guestList[0]?.filename, 'clip-3.mp4');
  assert.equal(guestList[1]?.filename, 'clip-2.mp4');

  const parsedGuest = parseGuestHistoryJson(JSON.stringify([makeRender(1), makeRender(2), makeRender(3)]));
  assert.equal(parsedGuest.length, 2);

  let accountList: ReturnType<typeof makeRender>[] = [];
  for (let i = 1; i <= 6; i++) {
    accountList = addHistoryEntryWithLimit(accountList, makeRender(i), ACCOUNT_HISTORY_LIMIT);
  }
  assert.equal(accountList.length, 6);
  assert.equal(enforceHistoryLimit(accountList, 5).length, 5);
});
