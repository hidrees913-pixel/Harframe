import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractAndNormalizeVideoUrl,
  extractGoogleDriveConfirmUrl,
  extractHtmlVideoCandidate,
  extractYouTubeVideoId,
  parseContentDispositionFilename,
} from './urlUtils.ts';

test('extractAndNormalizeVideoUrl extracts links from mobile share text and scheme-less input', () => {
  const fromShareText = extractAndNormalizeVideoUrl(
    'Check out this clip! https://cdn.example.com/videos/demo.mp4?token=123!'
  );
  assert.equal(fromShareText.ok, true);
  if (fromShareText.ok) {
    assert.equal(fromShareText.url, 'https://cdn.example.com/videos/demo.mp4?token=123');
    assert.equal(fromShareText.provider, 'direct');
    assert.equal(fromShareText.filenameHint, 'demo.mp4');
  }

  const noScheme = extractAndNormalizeVideoUrl('vimeo.com/12345678');
  assert.equal(noScheme.ok, true);
  if (noScheme.ok) {
    assert.equal(noScheme.url, 'https://vimeo.com/12345678');
    assert.equal(noScheme.provider, 'platform');
  }

  const invalid = extractAndNormalizeVideoUrl('ftp://files.example.com/clip.mp4');
  assert.equal(invalid.ok, false);
});

test('extractAndNormalizeVideoUrl normalizes Google Drive, Dropbox, GitHub, and HLS URLs', () => {
  const drive = extractAndNormalizeVideoUrl(
    'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQr/view?usp=sharing'
  );
  assert.equal(drive.ok, true);
  if (drive.ok) {
    assert.equal(drive.provider, 'google_drive');
    assert.equal(
      drive.url,
      'https://drive.google.com/uc?export=download&id=1AbCdEfGhIjKlMnOpQr'
    );
  }

  const dropbox = extractAndNormalizeVideoUrl(
    'https://www.dropbox.com/scl/fi/abc123/my_story.mp4?rlkey=xyz&dl=0'
  );
  assert.equal(dropbox.ok, true);
  if (dropbox.ok) {
    assert.equal(dropbox.provider, 'dropbox');
    assert.match(dropbox.url, /dl=1/);
    assert.equal(dropbox.filenameHint, 'my_story.mp4');
  }

  const github = extractAndNormalizeVideoUrl(
    'https://github.com/acme/clips/blob/main/assets/sample.mp4'
  );
  assert.equal(github.ok, true);
  if (github.ok) {
    assert.equal(github.provider, 'github');
    assert.equal(github.url, 'https://raw.githubusercontent.com/acme/clips/main/assets/sample.mp4');
  }

  const hls = extractAndNormalizeVideoUrl('https://stream.example.com/live/master.m3u8?hd=1');
  assert.equal(hls.ok, true);
  if (hls.ok) {
    assert.equal(hls.provider, 'hls');
  }
});

test('parseContentDispositionFilename decodes quoted and RFC5987 filenames', () => {
  assert.equal(
    parseContentDispositionFilename('attachment; filename="Summer Clip (Final).mp4"'),
    'Summer Clip (Final).mp4'
  );
  assert.equal(
    parseContentDispositionFilename("attachment; filename*=UTF-8''my%20reel%209x16.mov"),
    'my reel 9x16.mov'
  );
  assert.equal(parseContentDispositionFilename(null), null);
});

test('extractGoogleDriveConfirmUrl parses large-file virus scan confirm forms', () => {
  const html = `
    <form id="download-form" action="https://drive.usercontent.google.com/download" method="get">
      <input type="hidden" name="id" value="1XYZ_999">
      <input type="hidden" name="export" value="download">
      <input type="hidden" name="confirm" value="t">
      <input type="hidden" name="uuid" value="abcd-1234">
    </form>
  `;
  const confirmUrl = extractGoogleDriveConfirmUrl(html);
  assert.equal(
    confirmUrl,
    'https://drive.usercontent.google.com/download?id=1XYZ_999&export=download&confirm=t&uuid=abcd-1234'
  );
});

test('extractHtmlVideoCandidate extracts og:video and <video> relative source tags', () => {
  const ogHtml = `<html><head><meta property="og:video:secure_url" content="https://cdn.site.com/clip.mp4?a=1&amp;b=2"></head></html>`;
  assert.equal(
    extractHtmlVideoCandidate(ogHtml, 'https://site.com/watch'),
    'https://cdn.site.com/clip.mp4?a=1&b=2'
  );

  const tagHtml = `<html><body><video controls><source src="/media/reel.webm" type="video/webm"></video></body></html>`;
  assert.equal(
    extractHtmlVideoCandidate(tagHtml, 'https://site.com/posts/1'),
    'https://site.com/media/reel.webm'
  );
});

test('extractYouTubeVideoId resolves watch, shorts, youtu.be, embed, and live URLs', () => {
  assert.equal(extractYouTubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(extractYouTubeVideoId('https://www.youtube.com/shorts/F1-_Ot66Qms'), 'F1-_Ot66Qms');
  assert.equal(extractYouTubeVideoId('https://youtu.be/F1-_Ot66Qms?si=abc'), 'F1-_Ot66Qms');
  assert.equal(extractYouTubeVideoId('https://www.youtube.com/live/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(extractYouTubeVideoId('https://vimeo.com/12345678'), null);
});
