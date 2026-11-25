export type VideoUrlProvider =
  | 'youtube'
  | 'google_drive'
  | 'dropbox'
  | 'github'
  | 'hls'
  | 'direct'
  | 'platform';

export type NormalizedUrlResult =
  | {
      ok: true;
      url: string;
      originalUrl: string;
      provider: VideoUrlProvider;
      filenameHint?: string;
    }
  | {
      ok: false;
      error: string;
    };

const YOUTUBE_HOST_RE = /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/i;
const DIRECT_MEDIA_EXT_RE = /\.(mp4|mov|mkv|webm|m4v|avi|3gp|ogv|mpg|mpeg|flv|wmv)$/i;
const HLS_OR_DASH_EXT_RE = /\.(m3u8|mpd)$/i;

/**
 * Extracts a clean HTTP(S) URL from mobile share-sheet text (e.g. "Watch this! https://..."),
 * auto-prepends https:// for scheme-less domains, and normalizes cloud-drive share links
 * (Google Drive, Dropbox, GitHub blob) into direct downloadable URLs.
 */
export function extractAndNormalizeVideoUrl(rawInput: string): NormalizedUrlResult {
  const trimmed = String(rawInput || '').trim();
  if (!trimmed) {
    return { ok: false, error: 'Please enter a video URL to ingest.' };
  }

  let candidate = trimmed;

  // Extract explicit http(s) URL when surrounded by share-sheet text on mobile
  const explicitMatch = trimmed.match(/https?:\/\/[^\s<>"']+/i);
  if (explicitMatch) {
    candidate = explicitMatch[0].replace(/[),.!?;:'"]+$/, '');
  } else if (/^[a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s]*)?$/i.test(trimmed) && !/^[a-z]+:/i.test(trimmed)) {
    candidate = `https://${trimmed}`;
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return {
      ok: false,
      error: 'Enter a valid URL (e.g., https://example.com/clip.mp4 or a platform link).',
    };
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return { ok: false, error: 'Only HTTP and HTTPS URLs are supported.' };
  }

  const originalUrl = parsed.toString();
  const host = parsed.hostname.toLowerCase();

  // 1. YouTube
  if (YOUTUBE_HOST_RE.test(host)) {
    return {
      ok: true,
      url: originalUrl,
      originalUrl,
      provider: 'youtube',
    };
  }

  // 2. Google Drive share URL -> direct download URL
  if (host === 'drive.google.com' || host === 'drive.usercontent.google.com') {
    const filePathMatch = parsed.pathname.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
    const idParam = parsed.searchParams.get('id');
    const fileId = filePathMatch?.[1] || idParam;
    if (fileId) {
      return {
        ok: true,
        url: `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}`,
        originalUrl,
        provider: 'google_drive',
        filenameHint: `gdrive-${fileId.slice(0, 12)}.mp4`,
      };
    }
  }

  // 3. Dropbox share URL -> dl=1 direct stream
  if (host === 'dropbox.com' || host.endsWith('.dropbox.com')) {
    const nextUrl = new URL(originalUrl);
    if (nextUrl.hostname === 'dropbox.com' || nextUrl.hostname === 'www.dropbox.com') {
      nextUrl.searchParams.delete('dl');
      nextUrl.searchParams.set('dl', '1');
    }
    const baseName = decodeSafeFilename(nextUrl.pathname.split('/').pop());
    return {
      ok: true,
      url: nextUrl.toString(),
      originalUrl,
      provider: 'dropbox',
      filenameHint: baseName || undefined,
    };
  }

  // 4. GitHub blob URL -> raw.githubusercontent.com
  if (host === 'github.com') {
    const blobMatch = parsed.pathname.match(/^\/([^/]+)\/([^/]+)\/blob\/(.+)$/);
    if (blobMatch) {
      const rawUrl = `https://raw.githubusercontent.com/${blobMatch[1]}/${blobMatch[2]}/${blobMatch[3]}`;
      const baseName = decodeSafeFilename(blobMatch[3].split('/').pop());
      return {
        ok: true,
        url: rawUrl,
        originalUrl,
        provider: 'github',
        filenameHint: baseName || undefined,
      };
    }
  }

  // 5. HLS / DASH stream manifest
  if (HLS_OR_DASH_EXT_RE.test(parsed.pathname)) {
    return {
      ok: true,
      url: originalUrl,
      originalUrl,
      provider: 'hls',
      filenameHint: 'stream-clip.mp4',
    };
  }

  // 6. Direct video asset URL
  if (DIRECT_MEDIA_EXT_RE.test(parsed.pathname)) {
    const baseName = decodeSafeFilename(parsed.pathname.split('/').pop());
    return {
      ok: true,
      url: originalUrl,
      originalUrl,
      provider: 'direct',
      filenameHint: baseName || undefined,
    };
  }

  return {
    ok: true,
    url: originalUrl,
    originalUrl,
    provider: 'platform',
  };
}

function decodeSafeFilename(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const decoded = decodeURIComponent(raw).replace(/[/\\?%*:|"<>]/g, '_').trim();
    return decoded || null;
  } catch {
    return raw.replace(/[/\\?%*:|"<>]/g, '_').trim() || null;
  }
}

export function parseContentDispositionFilename(header: string | null | undefined): string | null {
  if (!header) return null;
  const starMatch = header.match(/filename\*\s*=\s*(?:UTF-8''|utf-8'')([^;\n]+)/i);
  if (starMatch?.[1]) {
    const clean = decodeSafeFilename(starMatch[1].replace(/^["']|["']$/g, ''));
    if (clean) return clean;
  }
  const plainMatch = header.match(/filename\s*=\s*"([^"]+)"|filename\s*=\s*([^;\n]+)/i);
  const candidate = plainMatch?.[1] || plainMatch?.[2];
  return decodeSafeFilename(candidate?.trim().replace(/^["']|["']$/g, ''));
}

/**
 * Extracts a direct downloadable Google Drive confirmation URL when Drive returns
 * a virus-scan interstitial HTML page instead of the raw media stream.
 */
export function extractGoogleDriveConfirmUrl(html: string): string | null {
  if (!html) return null;
  // Modern Drive interstitial uses a GET form with action="https://drive.usercontent.google.com/download"
  const formActionMatch = html.match(/action=["'](https:\/\/drive\.usercontent\.google\.com\/download[^"']*)["']/i);
  if (formActionMatch) {
    const actionUrl = new URL(formActionMatch[1]);
    const inputRegex = /<input[^>]+name=["']([^"']+)["'][^>]+value=["']([^"']*)["'][^>]*>/gi;
    let m: RegExpExecArray | null;
    while ((m = inputRegex.exec(html)) !== null) {
      actionUrl.searchParams.set(m[1], m[2]);
    }
    if (actionUrl.searchParams.get('id')) {
      return actionUrl.toString();
    }
  }

  const hrefMatch = html.match(/href=["'](\/uc\?export=download[^"']*confirm=[^"']+)["']/i);
  if (hrefMatch) {
    const decoded = hrefMatch[1].replace(/&amp;/g, '&');
    return `https://drive.google.com${decoded}`;
  }
  return null;
}

/**
 * Scans webpage HTML for OpenGraph/Twitter video meta tags or <video>/<source> media elements.
 */
export function extractHtmlVideoCandidate(html: string, baseUrl: string): string | null {
  if (!html) return null;

  const patterns = [
    /<meta[^>]+(?:property|name)=["']og:video:secure_url["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']og:video:secure_url["']/i,
    /<meta[^>]+(?:property|name)=["']og:video:url["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']og:video:url["']/i,
    /<meta[^>]+(?:property|name)=["']og:video["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']og:video["']/i,
    /<meta[^>]+(?:property|name)=["']twitter:player:stream["'][^>]+content=["']([^"']+)["']/i,
    /<source[^>]+src=["']([^"']+\.(?:mp4|webm|mov|m4v|m3u8)[^"']*)["']/i,
    /<video[^>]+src=["']([^"']+\.(?:mp4|webm|mov|m4v|m3u8)[^"']*)["']/i,
  ];

  for (const re of patterns) {
    const match = html.match(re);
    const rawCandidate = match?.[1]?.replace(/&amp;/g, '&').trim();
    if (!rawCandidate) continue;
    try {
      const resolved = new URL(rawCandidate, baseUrl);
      if (['http:', 'https:'].includes(resolved.protocol)) {
        return resolved.toString();
      }
    } catch {
      // Ignore malformed candidate
    }
  }

  return null;
}

/**
 * Extracts an 11-character YouTube video ID from watch, youtu.be, shorts, embed, live, or music URLs.
 */
export function extractYouTubeVideoId(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.toLowerCase();
    if (!YOUTUBE_HOST_RE.test(host)) return null;

    if (host.endsWith('youtu.be')) {
      const seg = parsed.pathname.split('/').filter(Boolean)[0];
      return seg && /^[a-zA-Z0-9_-]{11}$/.test(seg) ? seg : null;
    }

    const vParam = parsed.searchParams.get('v');
    if (vParam && /^[a-zA-Z0-9_-]{11}$/.test(vParam)) {
      return vParam;
    }

    const pathMatch = parsed.pathname.match(/^\/(?:shorts|embed|live|v)\/([a-zA-Z0-9_-]{11})(?:[/?#]|$)/);
    return pathMatch?.[1] ?? null;
  } catch {
    return null;
  }
}

