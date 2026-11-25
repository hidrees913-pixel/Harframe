import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import { createWriteStream, existsSync, mkdirSync, chmodSync, symlinkSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import ffmpegStatic from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';

import {
  buildFfmpegArgs,
  computeAutoBalanceFilter,
  type FrameLumaStats,
} from './src/lib/ffmpegPipeline.ts';
import { normalizeSegments, optimizeCaptionSegments, toAss, toSrt } from './src/lib/subtitles.ts';
import {
  extractAndNormalizeVideoUrl,
  extractGoogleDriveConfirmUrl,
  extractHtmlVideoCandidate,
  extractYouTubeVideoId,
  parseContentDispositionFilename,
} from './src/lib/urlUtils.ts';
import {
  buildInhouseVoiceStylePrompt,
  computeAdaptiveFrameTimestamps,
  computeGeminiVideoPreviewSpec,
  escapeXmlForSsml,
  estimateSpeechDurationSec,
  sanitizeForSpeech,
  splitScriptIntoTtsChunks,
  stripGeminiYapping,
  translatePromptForInhouseStudio,
} from './src/lib/scriptCleaner.ts';
import {
  AI_VOICE_CATALOG,
  AUDIO_MIX_OPTIONS,
  CAPTION_STYLE_PRESETS,
  COLOR_GRADE_PRESETS,
  FRAME_ASPECT_PRESETS,
  RESOLUTION_PRESETS,
  VOICE_PRESETS,
  type AiVoiceId,
  type AiVoiceProfile,
  type AudioMixMode,
  type CaptionStyleId,
  type ColorGradeId,
  type ContentAwareColorAnalysis,
  type CustomCaptionStyle,
  type FrameAspectId,
  type FrameFitMode,
  type RenderResult,
  type ResolutionTierId,
  type SubtitleSegment,
  type VideoMetadata,
  type VoiceId,
} from './src/lib/studioPresets.ts';
import type { HistoryEntry } from './src/lib/historyStore.ts';
import {
  parseFfmpegOutTimeSec,
  type LiveRenderProgress,
} from './src/lib/batchProgress.ts';

const execFileAsync = promisify(execFile);

const PORT = Number(process.env.PORT || 3000);
const WORKSPACE_DIR = '/tmp/harframe';
const BIN_DIR = path.join(WORKSPACE_DIR, 'bin');
const UPLOADS_DIR = path.join(WORKSPACE_DIR, 'uploads');
const OUTPUTS_DIR = path.join(WORKSPACE_DIR, 'outputs');
const VOICE_SAMPLES_DIR = path.join(WORKSPACE_DIR, 'voice-samples');
const DATA_DIR = path.join(WORKSPACE_DIR, 'data');
const STORE_FILE = path.join(DATA_DIR, 'store.json');

mkdirSync(BIN_DIR, { recursive: true });
mkdirSync(UPLOADS_DIR, { recursive: true });
mkdirSync(OUTPUTS_DIR, { recursive: true });
mkdirSync(VOICE_SAMPLES_DIR, { recursive: true });
mkdirSync(DATA_DIR, { recursive: true });

const SESSION_COOKIE_NAME = 'harframe_session';
const SESSION_TTL_SEC = 7 * 24 * 60 * 60;
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

interface StoredUser {
  id: string;
  username: string;
  usernameLower: string;
  passwordHash: string;
  createdAt: number;
}

interface PersistedStore {
  users: StoredUser[];
  histories: Record<string, HistoryEntry[]>;
}

let storeWriteChain = Promise.resolve();

async function loadPersistedStore(): Promise<PersistedStore> {
  try {
    if (!existsSync(STORE_FILE)) {
      return { users: [], histories: {} };
    }
    const raw = await fs.readFile(STORE_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<PersistedStore>;
    return {
      users: Array.isArray(parsed.users) ? parsed.users : [],
      histories: parsed.histories && typeof parsed.histories === 'object' ? parsed.histories : {},
    };
  } catch {
    return { users: [], histories: {} };
  }
}

async function savePersistedStore(store: PersistedStore): Promise<void> {
  storeWriteChain = storeWriteChain.then(async () => {
    const tmpFile = `${STORE_FILE}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(tmpFile, JSON.stringify(store, null, 2), 'utf-8');
    await fs.rename(tmpFile, STORE_FILE);
  });
  await storeWriteChain;
}

function hashUserPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

function verifyUserPassword(password: string, storedHash: string): boolean {
  const [salt, hexHash] = storedHash.split(':');
  if (!salt || !hexHash) return false;
  try {
    const expected = Buffer.from(hexHash, 'hex');
    const actual = crypto.scryptSync(password, salt, 64);
    if (expected.length !== actual.length) return false;
    return crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function signSessionToken(userId: string, username: string): string {
  const payload = Buffer.from(
    JSON.stringify({ userId, username, exp: Date.now() + SESSION_TTL_SEC * 1000 }),
    'utf-8'
  ).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verifySessionToken(token: string): { userId: string; username: string } | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  if (!payload || !sig) return null;
  try {
    const expectedSig = crypto
      .createHmac('sha256', SESSION_SECRET)
      .update(payload)
      .digest('base64url');
    const a = Buffer.from(sig);
    const b = Buffer.from(expectedSig);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8')) as {
      userId?: string;
      username?: string;
      exp?: number;
    };
    if (!decoded.userId || !decoded.username || !decoded.exp || decoded.exp < Date.now()) {
      return null;
    }
    return { userId: decoded.userId, username: decoded.username };
  } catch {
    return null;
  }
}

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) {
      try {
        out[key] = decodeURIComponent(val);
      } catch {
        out[key] = val;
      }
    }
  }
  return out;
}

function getAuthenticatedSession(req: express.Request): { userId: string; username: string } | null {
  const cookies = parseCookies(req.headers.cookie);
  const cookieToken = cookies[SESSION_COOKIE_NAME];
  if (cookieToken) {
    const verified = verifySessionToken(cookieToken);
    if (verified) return verified;
  }
  const authHeader = req.headers.authorization;
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    return verifySessionToken(authHeader.slice(7).trim());
  }
  return null;
}

function verifyMutationOriginOrHeader(req: express.Request): boolean {
  if (req.headers['x-requested-with'] === 'HarFrame') return true;
  const origin = req.headers.origin;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  if (typeof origin === 'string' && typeof host === 'string') {
    try {
      const originHost = new URL(origin).host;
      if (originHost === host) return true;
    } catch {
      return false;
    }
  }
  return false;
}

function appendSessionSetCookie(res: express.Response, token: string, maxAgeSec: number): void {
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAgeSec}; HttpOnly; Secure; SameSite=None; Partitioned`
  );
}

function resolveStaticBinary(candidate: string | null | undefined, fallbackCmd: string): string {
  if (candidate && existsSync(candidate)) {
    try {
      chmodSync(candidate, 0o755);
    } catch {
      // Ignore permission adjustment failures on read-only mounts
    }
    return candidate;
  }
  return fallbackCmd;
}

const FFMPEG_BIN = resolveStaticBinary(ffmpegStatic, 'ffmpeg');
const FFPROBE_BIN = resolveStaticBinary(ffprobeStatic?.path, 'ffprobe');

function ensureToolSymlink(name: string, target: string) {
  if (!path.isAbsolute(target) || !existsSync(target)) return;
  const linkPath = path.join(BIN_DIR, name);
  try {
    if (existsSync(linkPath)) {
      unlinkSync(linkPath);
    }
    symlinkSync(target, linkPath);
  } catch {
    // Non-fatal if symlink creation fails
  }
}

ensureToolSymlink('ffmpeg', FFMPEG_BIN);
ensureToolSymlink('ffprobe', FFPROBE_BIN);

interface JobRecord {
  jobId: string;
  inputPath: string;
  metadata: VideoMetadata;
  defaultTranscript?: SubtitleSegment[];
  cachedTranscript?: { engine: string; segments: SubtitleSegment[] };
  voiceoverPath?: string;
  voiceoverScript?: string;
  voiceoverAiVoiceId?: AiVoiceId;
  voiceoverRate?: number;
  voiceoverDurationSec?: number;
  voiceoverEngine?: string;
  visualSummary?: string;
  contentAwareAnalysis?: ContentAwareColorAnalysis;
}

const jobs = new Map<string, JobRecord>();
const renderProgressMap = new Map<string, LiveRenderProgress>();

const MAX_UPLOAD_BYTES = 500 * 1024 * 1024; // 500 MB
const ALLOWED_EXTENSIONS = new Set([
  '.mp4',
  '.mov',
  '.mkv',
  '.webm',
  '.m4v',
  '.avi',
  '.3gp',
  '.mpg',
  '.mpeg',
  '.ts',
  '.mts',
  '.m2ts',
  '.ogv',
  '.flv',
  '.wmv',
]);

function isSupportedVideoFile(filename: string, mimeType?: string): boolean {
  const ext = path.extname(filename || '').toLowerCase();
  if (ALLOWED_EXTENSIONS.has(ext)) return true;
  if (mimeType && mimeType.toLowerCase().startsWith('video/')) return true;
  if (!ext && (!mimeType || mimeType === 'application/octet-stream')) return true;
  return false;
}

function getSafeVideoExtension(filename: string, mimeType?: string): string {
  const ext = path.extname(filename || '').toLowerCase();
  if (ALLOWED_EXTENSIONS.has(ext)) return ext;
  if (mimeType?.includes('webm')) return '.webm';
  if (mimeType?.includes('quicktime')) return '.mov';
  if (mimeType?.includes('x-matroska')) return '.mkv';
  return '.mp4';
}

interface PendingUpload {
  uploadId: string;
  filename: string;
  mimeType: string;
  expectedSize: number;
  receivedBytes: number;
  tempPath: string;
}

const pendingUploads = new Map<string, PendingUpload>();

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const safeExt = getSafeVideoExtension(file.originalname, file.mimetype);
    cb(null, `${crypto.randomUUID()}${safeExt}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter: (_req, file, cb) => {
    if (!isSupportedVideoFile(file.originalname, file.mimetype)) {
      cb(
        new Error(
          'Unsupported file type. Upload a video file (MP4, MOV, MKV, WebM, AVI, M4V, or 3GP).'
        )
      );
      return;
    }
    cb(null, true);
  },
});

async function commandExists(bin: string): Promise<boolean> {
  try {
    await execFileAsync('which', [bin]);
    return true;
  } catch {
    return false;
  }
}

const LOCAL_YTDLP_BIN = path.join(WORKSPACE_DIR, 'bin', 'yt-dlp');
let ytDlpInstallPromise: Promise<string | null> | null = null;

async function resolveYtDlpBin(): Promise<string | null> {
  if (await commandExists('yt-dlp')) {
    return 'yt-dlp';
  }
  if (existsSync(LOCAL_YTDLP_BIN)) {
    try {
      const stat = await fs.stat(LOCAL_YTDLP_BIN);
      if (stat.size > 1024 * 1024) {
        return LOCAL_YTDLP_BIN;
      }
    } catch {
      // Re-download below
    }
  }
  if (!ytDlpInstallPromise) {
    ytDlpInstallPromise = (async () => {
      try {
        await fs.mkdir(path.dirname(LOCAL_YTDLP_BIN), { recursive: true });
        const response = await fetch(
          'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux',
          { headers: { 'User-Agent': 'HarFrame-MediaStudio/1.0' } }
        );
        if (!response.ok || !response.body) {
          return null;
        }
        const tempBin = `${LOCAL_YTDLP_BIN}.tmp`;
        await pipeline(
          Readable.fromWeb(response.body as import('node:stream/web').ReadableStream),
          createWriteStream(tempBin)
        );
        await fs.chmod(tempBin, 0o755);
        await fs.rename(tempBin, LOCAL_YTDLP_BIN);
        return LOCAL_YTDLP_BIN;
      } catch {
        return null;
      } finally {
        ytDlpInstallPromise = null;
      }
    })();
  }
  return ytDlpInstallPromise;
}

function runCommand(
  bin: string,
  args: string[],
  timeoutMs = 180000,
  onStdout?: (chunk: string) => void
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            child.kill('SIGKILL');
          }, timeoutMs)
        : null;

    child.stdout.on('data', (d: Buffer) => {
      const text = d.toString();
      stdout += text;
      if (onStdout) {
        onStdout(text);
      }
    });
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      if (timedOut) {
        reject(new Error(`${bin} timed out after ${Math.round(timeoutMs / 1000)}s.`));
        return;
      }
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`${bin} exited with code ${code}: ${stderr.slice(-600)}`));
      }
    });
  });
}

function createGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

async function probeVideo(filePath: string): Promise<{
  width: number;
  height: number;
  durationSec: number;
  fps: number;
  hasAudio: boolean;
  isStereoAudio: boolean;
  codec: string;
  fileSizeBytes: number;
}> {
  const { stdout } = await execFileAsync(FFPROBE_BIN, [
    '-v',
    'quiet',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    filePath,
  ]);
  const parsed = JSON.parse(stdout);
  const streams: Array<Record<string, unknown>> = parsed.streams || [];
  const videoStream = streams.find((s) => s.codec_type === 'video');
  const audioStream = streams.find((s) => s.codec_type === 'audio');
  if (!videoStream) {
    throw new Error('No video stream found in the provided media file.');
  }

  let width = Number(videoStream.width || 1280);
  let height = Number(videoStream.height || 720);

  const tags = (videoStream.tags as Record<string, unknown> | undefined) || {};
  const sideData = (videoStream.side_data_list as Array<Record<string, unknown>> | undefined) || [];
  let rotation = Number(tags.rotate || 0);
  if (!rotation) {
    const displayMatrix = sideData.find((item) => typeof item.rotation === 'number');
    if (displayMatrix) {
      rotation = Number(displayMatrix.rotation || 0);
    }
  }
  const absRot = Math.abs(Math.round(rotation)) % 360;
  if (absRot === 90 || absRot === 270) {
    [width, height] = [height, width];
  }

  let fps = 30;
  const rFrameRate = String(videoStream.r_frame_rate || '30/1');
  if (rFrameRate.includes('/')) {
    const [num, den] = rFrameRate.split('/').map(Number);
    if (den && num) fps = Number((num / den).toFixed(2));
  }

  const stat = await fs.stat(filePath);
  let durationSec = Number(
    Number(parsed.format?.duration || videoStream.duration || 0).toFixed(2)
  );
  if (!durationSec && videoStream.nb_frames && fps > 0) {
    durationSec = Number((Number(videoStream.nb_frames) / fps).toFixed(2));
  }

  const channels = Number(audioStream?.channels || 0);

  return {
    width,
    height,
    durationSec: durationSec || 5,
    fps,
    hasAudio: Boolean(audioStream),
    isStereoAudio: channels >= 2,
    codec: String(videoStream.codec_name || 'h264'),
    fileSizeBytes: stat.size,
  };
}

async function probeAudioDurationSec(filePath: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync(FFPROBE_BIN, [
      '-v',
      'quiet',
      '-print_format',
      'json',
      '-show_format',
      filePath,
    ]);
    const parsed = JSON.parse(stdout);
    const dur = Number(parsed.format?.duration || 0);
    return dur > 0 ? Number(dur.toFixed(2)) : 0;
  } catch {
    return 0;
  }
}

async function analyzeFrameLuma(inputPath: string): Promise<FrameLumaStats> {
  try {
    const { stdout } = await runCommand(FFMPEG_BIN, [
      '-v',
      'error',
      '-i',
      inputPath,
      '-vf',
      "select='not(mod(n\\,30))',signalstats,metadata=mode=print:file=-",
      '-frames:v',
      '6',
      '-f',
      'null',
      '-',
    ]);

    const yAvgMatches = [...stdout.matchAll(/lavfi\.signalstats\.YAVG=([\d.]+)/g)].map((m) =>
      Number(m[1])
    );
    const yMinMatches = [...stdout.matchAll(/lavfi\.signalstats\.YMIN=([\d.]+)/g)].map((m) =>
      Number(m[1])
    );
    const yMaxMatches = [...stdout.matchAll(/lavfi\.signalstats\.YMAX=([\d.]+)/g)].map((m) =>
      Number(m[1])
    );

    const avg = (arr: number[], fallback: number) =>
      arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : fallback;

    return {
      avgLuma: Number(avg(yAvgMatches, 112).toFixed(1)),
      minLuma: Number(avg(yMinMatches, 16).toFixed(1)),
      maxLuma: Number(avg(yMaxMatches, 234).toFixed(1)),
    };
  } catch {
    return { avgLuma: 112, minLuma: 16, maxLuma: 234 };
  }
}

function clampNum(val: unknown, min: number, max: number, fallback: number): number {
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  return Number(Math.max(min, Math.min(max, n)).toFixed(3));
}

function buildCssPreviewFilter(
  brightness: number,
  contrast: number,
  saturation: number,
  gamma: number
): string {
  const cssBrightness = Number(Math.max(0.75, Math.min(1.35, 1 + brightness * 1.35 + (gamma - 1) * 0.25)).toFixed(2));
  const cssContrast = Number(Math.max(0.8, Math.min(1.45, contrast)).toFixed(2));
  const cssSat = Number(Math.max(0.5, Math.min(1.5, saturation)).toFixed(2));
  return `brightness(${cssBrightness}) contrast(${cssContrast}) saturate(${cssSat})`;
}

async function computeContentAwareAnalysis(
  jobId: string,
  inputPath: string,
  durationSec: number
): Promise<ContentAwareColorAnalysis> {
  const frameStats = await analyzeFrameLuma(inputPath);
  const auto = computeAutoBalanceFilter(frameStats);

  const fallbackResult: ContentAwareColorAnalysis = {
    sceneType:
      frameStats.avgLuma < 85
        ? 'Low-Light Moody Scene'
        : frameStats.avgLuma > 165
          ? 'Bright Daylight Scene'
          : 'Balanced Mixed Scene',
    lightingCondition:
      frameStats.maxLuma - frameStats.minLuma < 140
        ? 'Flat / Low Contrast Log Profile'
        : 'Dynamic Natural Exposure',
    rationale: `Histogram balanced exposure from avg luma ${frameStats.avgLuma} to lift shadows and enrich midtone clarity.`,
    appliedBrightness: auto.appliedBrightness,
    appliedContrast: auto.appliedContrast,
    appliedSaturation: auto.appliedSaturation,
    appliedGamma: 1.03,
    colorBalance: {
      rs: -0.04,
      gs: 0.0,
      bs: 0.05,
      rm: 0.02,
      gm: 0.0,
      bm: -0.02,
      rh: 0.05,
      gh: 0.02,
      bh: -0.04,
    },
    avgLuma: frameStats.avgLuma,
    minLuma: frameStats.minLuma,
    maxLuma: frameStats.maxLuma,
    cssPreviewFilter: buildCssPreviewFilter(
      auto.appliedBrightness,
      auto.appliedContrast,
      auto.appliedSaturation,
      1.03
    ),
    engine: 'histogram-telemetry',
  };

  const ai = createGeminiClient();
  if (!ai) {
    return fallbackResult;
  }

  const tempFramePaths: string[] = [];
  try {
    const timestamps = computeAdaptiveFrameTimestamps(durationSec, 4);
    const parts: Array<{ inlineData: { mimeType: string; data: string } } | { text: string }> = [];

    for (let i = 0; i < timestamps.length; i++) {
      const ts = timestamps[i];
      const framePath = path.join(WORKSPACE_DIR, `${jobId}_grade_${i}.jpg`);
      tempFramePaths.push(framePath);
      try {
        await runCommand(FFMPEG_BIN, [
          '-y',
          '-ss',
          String(ts),
          '-i',
          inputPath,
          '-frames:v',
          '1',
          '-vf',
          "scale='min(480,iw):-2'",
          '-q:v',
          '4',
          framePath,
        ], 20000);
        if (existsSync(framePath)) {
          const buf = await fs.readFile(framePath);
          if (buf.length > 200) {
            parts.push({
              inlineData: { mimeType: 'image/jpeg', data: buf.toString('base64') },
            });
          }
        }
      } catch {
        // Skip failed thumbnail extraction
      }
    }

    if (parts.length === 0) {
      return fallbackResult;
    }

    parts.push({
      text: `You are a master film colorist grading this video clip (${parts.length} evenly sampled frames shown).
Measured luma telemetry: avgLuma=${frameStats.avgLuma}/255, minLuma=${frameStats.minLuma}, maxLuma=${frameStats.maxLuma}.
Recommend tailored FFmpeg color grading parameters suited specifically for this scene's lighting, subject, skin tones, and atmosphere:
- rationale: concise 1 to 2 complete sentences (under 180 characters) describing the grading decision
- appliedBrightness: -0.18 to 0.18 (0 is neutral)
- appliedContrast: 0.85 to 1.32 (1.0 is neutral)
- appliedSaturation: 0.72 to 1.40 (1.0 is neutral)
- appliedGamma: 0.88 to 1.22 (1.0 is neutral)
- colorBalance RGB shadow/midtone/highlight shifts (rs, gs, bs, rm, gm, bm, rh, gh, bh), each between -0.22 and 0.22 (subtle cinematic split toning).
Return structured JSON.`,
    });

    const colorSchema = {
      type: Type.OBJECT,
      properties: {
        sceneType: { type: Type.STRING },
        lightingCondition: { type: Type.STRING },
        rationale: { type: Type.STRING },
        appliedBrightness: { type: Type.NUMBER },
        appliedContrast: { type: Type.NUMBER },
        appliedSaturation: { type: Type.NUMBER },
        appliedGamma: { type: Type.NUMBER },
        colorBalance: {
          type: Type.OBJECT,
          properties: {
            rs: { type: Type.NUMBER },
            gs: { type: Type.NUMBER },
            bs: { type: Type.NUMBER },
            rm: { type: Type.NUMBER },
            gm: { type: Type.NUMBER },
            bm: { type: Type.NUMBER },
            rh: { type: Type.NUMBER },
            gh: { type: Type.NUMBER },
            bh: { type: Type.NUMBER },
          },
          required: ['rs', 'gs', 'bs', 'rm', 'gm', 'bm', 'rh', 'gh', 'bh'],
        },
      },
      required: [
        'sceneType',
        'lightingCondition',
        'rationale',
        'appliedBrightness',
        'appliedContrast',
        'appliedSaturation',
        'appliedGamma',
        'colorBalance',
      ],
    };

    const callColorModel = (
      model: 'gemini-4-hydrogen' | 'gemini-3.1-flash-lite',
      timeoutMs = 25000
    ) =>
      withTimeoutPromise(
        ai.models.generateContent({
          model,
          contents: { parts },
          config: {
            thinkingConfig: {
              thinkingLevel:
                model === 'gemini-4-hydrogen' ? ThinkingLevel.LOW : ThinkingLevel.MINIMAL,
            },
            responseMimeType: 'application/json',
            responseSchema: colorSchema,
          },
        }),
        timeoutMs,
        model
      );

    let response;
    let colorEngine = 'gemini-4-hydrogen-vision';
    try {
      response = await callColorModel('gemini-4-hydrogen', 12000);
    } catch (primaryErr) {
      const msg = primaryErr instanceof Error ? primaryErr.message : String(primaryErr);
      if (/503|UNAVAILABLE|RESOURCE_EXHAUSTED|429|timed out/i.test(msg)) {
        colorEngine = 'gemini-3.1-flash-lite-vision';
        response = await callColorModel('gemini-3.1-flash-lite', 25000);
      } else {
        throw primaryErr;
      }
    }

    const raw = (response.text ?? '')
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const cbRaw = (parsed.colorBalance as Record<string, unknown>) || {};

    const appliedBrightness = clampNum(parsed.appliedBrightness, -0.18, 0.18, auto.appliedBrightness);
    const appliedContrast = clampNum(parsed.appliedContrast, 0.85, 1.32, auto.appliedContrast);
    const appliedSaturation = clampNum(parsed.appliedSaturation, 0.72, 1.4, auto.appliedSaturation);
    const appliedGamma = clampNum(parsed.appliedGamma, 0.88, 1.22, 1.02);

    const rawRationale = String(parsed.rationale || fallbackResult.rationale).trim();
    const cleanRationale =
      rawRationale.length <= 320
        ? rawRationale
        : `${rawRationale.slice(0, 317).replace(/\s+\S*$/, '')}...`;

    return {
      sceneType: String(parsed.sceneType || fallbackResult.sceneType).slice(0, 64),
      lightingCondition: String(parsed.lightingCondition || fallbackResult.lightingCondition).slice(0, 64),
      rationale: cleanRationale,
      appliedBrightness,
      appliedContrast,
      appliedSaturation,
      appliedGamma,
      colorBalance: {
        rs: clampNum(cbRaw.rs, -0.22, 0.22, 0),
        gs: clampNum(cbRaw.gs, -0.22, 0.22, 0),
        bs: clampNum(cbRaw.bs, -0.22, 0.22, 0),
        rm: clampNum(cbRaw.rm, -0.22, 0.22, 0),
        gm: clampNum(cbRaw.gm, -0.22, 0.22, 0),
        bm: clampNum(cbRaw.bm, -0.22, 0.22, 0),
        rh: clampNum(cbRaw.rh, -0.22, 0.22, 0),
        gh: clampNum(cbRaw.gh, -0.22, 0.22, 0),
        bh: clampNum(cbRaw.bh, -0.22, 0.22, 0),
      },
      avgLuma: frameStats.avgLuma,
      minLuma: frameStats.minLuma,
      maxLuma: frameStats.maxLuma,
      cssPreviewFilter: buildCssPreviewFilter(
        appliedBrightness,
        appliedContrast,
        appliedSaturation,
        appliedGamma
      ),
      engine: colorEngine,
    };
  } catch (err) {
    console.error('[HarFrame Color] AI scene grading fallback triggered:', err);
    return fallbackResult;
  } finally {
    await Promise.all(tempFramePaths.map((p) => fs.unlink(p).catch(() => {})));
  }
}

function extractJsonArrayFromText(rawText: string): Array<{ startSec: number; endSec: number; text: string }> {
  const cleaned = rawText
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  const parsed = JSON.parse(cleaned || '[]');
  return Array.isArray(parsed) ? parsed : [];
}

async function detectSpeechWindows(
  inputPath: string,
  durationSec: number
): Promise<Array<{ start: number; end: number }>> {
  try {
    const { stderr } = await runCommand(FFMPEG_BIN, [
      '-i',
      inputPath,
      '-af',
      'silencedetect=noise=-34dB:d=0.28',
      '-f',
      'null',
      '-',
    ]);
    const silences: Array<{ start: number; end: number }> = [];
    let currentStart: number | null = null;

    for (const line of stderr.split('\n')) {
      const startMatch = line.match(/silence_start:\s*([\d.]+)/);
      if (startMatch) {
        currentStart = Number(startMatch[1]);
      }
      const endMatch = line.match(/silence_end:\s*([\d.]+)/);
      if (endMatch && currentStart !== null) {
        silences.push({ start: currentStart, end: Number(endMatch[1]) });
        currentStart = null;
      }
    }

    if (silences.length > 0) {
      const windows: Array<{ start: number; end: number }> = [];
      let cursor = 0;
      for (const s of silences) {
        if (s.start - cursor >= 0.3) {
          windows.push({
            start: Number(cursor.toFixed(2)),
            end: Number(s.start.toFixed(2)),
          });
        }
        cursor = s.end;
      }
      if (durationSec - cursor >= 0.3) {
        windows.push({
          start: Number(cursor.toFixed(2)),
          end: Number(durationSec.toFixed(2)),
        });
      }
      if (windows.length > 0) return windows;
    }
  } catch {
    // Fall back to full duration window
  }
  return [{ start: 0.08, end: Math.max(0.6, Number((durationSec - 0.08).toFixed(2))) }];
}

function alignTranscriptToWindows(
  transcriptText: string,
  windows: Array<{ start: number; end: number }>
): SubtitleSegment[] {
  const words = transcriptText.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (words.length === 0) return [];

  const totalWindowSec = windows.reduce((sum, w) => sum + Math.max(0.3, w.end - w.start), 0);
  if (totalWindowSec <= 0) return [];

  const aligned: SubtitleSegment[] = [];
  let wordOffset = 0;

  windows.forEach((win, idx) => {
    if (wordOffset >= words.length) return;
    const winDur = Math.max(0.3, win.end - win.start);
    const remainingWords = words.length - wordOffset;
    const wordShare =
      idx === windows.length - 1
        ? remainingWords
        : Math.max(1, Math.min(remainingWords, Math.round((winDur / totalWindowSec) * words.length)));
    const slice = words.slice(wordOffset, wordOffset + wordShare);
    wordOffset += wordShare;
    if (slice.length > 0) {
      aligned.push({
        id: `asr-align-${idx + 1}`,
        startSec: win.start,
        endSec: win.end,
        text: slice.join(' '),
      });
    }
  });

  return optimizeCaptionSegments(aligned, { maxWordsPerCue: 5 });
}

async function transcribeWithGemini(
  audioPath: string,
  mimeType: string,
  durationSec: number,
  inputPath: string
): Promise<{ engine: string; segments: SubtitleSegment[] }> {
  const ai = createGeminiClient();
  if (!ai) {
    throw new Error('GEMINI_API_KEY is not configured on the server.');
  }

  const stat = await fs.stat(audioPath);
  let uploadedFileName: string | null = null;
  let audioPart:
    | { inlineData: { mimeType: string; data: string } }
    | { fileData: { fileUri: string; mimeType: string } };

  try {
    if (stat.size > 12 * 1024 * 1024) {
      const uploaded = await ai.files.upload({
        file: audioPath,
        config: { mimeType },
      });
      uploadedFileName = uploaded.name || null;
      if (!uploaded.uri) {
        throw new Error('Failed to upload large audio stream to Gemini Files API.');
      }
      audioPart = {
        fileData: {
          fileUri: uploaded.uri,
          mimeType: uploaded.mimeType || mimeType,
        },
      };
    } else {
      const audioBuffer = await fs.readFile(audioPath);
      audioPart = {
        inlineData: {
          mimeType,
          data: audioBuffer.toString('base64'),
        },
      };
    }

    let primaryError: Error | null = null;

    for (const asrModel of ['gemini-4-hydrogen', 'gemini-3.1-flash-lite'] as const) {
      try {
        const response = await withTimeoutPromise(
          ai.models.generateContent({
            model: asrModel,
            contents: {
              parts: [
                audioPart,
                {
                  text: `Transcribe every spoken word, narration, dialogue, or vocal phrase in this ${durationSec.toFixed(1)}s audio track into tight subtitle cues (2 to 5 words per cue) with accurate startSec and endSec timestamps in seconds. Only return [] if the audio contains zero speech or lyrics.`,
                },
              ],
            },
            config: {
              thinkingConfig: {
                thinkingLevel:
                  asrModel === 'gemini-4-hydrogen' ? ThinkingLevel.LOW : ThinkingLevel.MINIMAL,
              },
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    startSec: { type: Type.NUMBER },
                    endSec: { type: Type.NUMBER },
                    text: { type: Type.STRING },
                  },
                  required: ['startSec', 'endSec', 'text'],
                },
              },
            },
          }),
          35000,
          asrModel
        );

        const parsed = extractJsonArrayFromText(response.text ?? '[]');
        const clamped = parsed
          .filter((item) => typeof item?.text === 'string' && item.text.trim().length > 0)
          .map((item, idx) => {
            const start = Math.max(0, Math.min(durationSec, Number(item.startSec) || 0));
            const end = Math.max(start + 0.25, Math.min(durationSec + 0.25, Number(item.endSec) || start + 1));
            return {
              id: `asr-${idx + 1}`,
              startSec: start,
              endSec: end,
              text: item.text,
            };
          });

        const optimized = optimizeCaptionSegments(clamped, { maxWordsPerCue: 5 });
        if (optimized.length > 0) {
          return { engine: `${asrModel}-asr`, segments: optimized };
        }
      } catch (err) {
        primaryError = err instanceof Error ? err : new Error(String(err));
        console.error(`[HarFrame ASR] ${asrModel} failed:`, primaryError.message);
      }
    }

    try {
      const transcribeResp = await ai.models.generateContent({
        model: 'gemini-3.5-transcribe',
        contents: {
          parts: [
            audioPart,
            { text: 'Transcribe all spoken words and dialogue in this audio verbatim.' },
          ],
        },
      });

      const plainText = (transcribeResp.text ?? '').trim();
      if (plainText.length > 0) {
        const windows = await detectSpeechWindows(inputPath, durationSec);
        const aligned = alignTranscriptToWindows(plainText, windows);
        if (aligned.length > 0) {
          return { engine: 'gemini-3.5-transcribe', segments: aligned };
        }
      }
    } catch (err) {
      const secondaryError = err instanceof Error ? err : new Error(String(err));
      console.error('[HarFrame ASR] gemini-3.5-transcribe failed:', secondaryError.message);
      if (primaryError) {
        throw new Error(`${primaryError.message}; ${secondaryError.message}`);
      }
      throw secondaryError;
    }

    if (primaryError) {
      throw primaryError;
    }

    return { engine: 'gemini-no-speech', segments: [] };
  } finally {
    if (uploadedFileName) {
      await ai.files.delete({ name: uploadedFileName }).catch(() => {});
    }
  }
}

async function detectAudioCadenceSegments(
  inputPath: string,
  durationSec: number
): Promise<SubtitleSegment[]> {
  const windows = await detectSpeechWindows(inputPath, durationSec);
  if (windows.length > 0 && !(windows.length === 1 && windows[0].start === 0.08)) {
    return windows.map((w, idx) => ({
      id: `cadence-${idx + 1}`,
      startSec: w.start,
      endSec: w.end,
      text: `Dialogue segment ${idx + 1}`,
    }));
  }

  const count = Math.max(1, Math.min(4, Math.round(durationSec / 2)));
  const step = durationSec / count;
  return Array.from({ length: count }, (_, idx) => ({
    id: `seg-${idx + 1}`,
    startSec: Number((idx * step + 0.1).toFixed(2)),
    endSec: Number(((idx + 1) * step - 0.1).toFixed(2)),
    text:
      idx === 0
        ? 'Bring every story to life'
        : idx === 1
          ? 'Studio voiceover & cinema color'
          : 'Exported in crisp 4K Ultra HD',
  }));
}

async function synthesizeEdgeChunkMp3(
  edgeVoiceName: string,
  chunkText: string,
  outMp3Path: string
): Promise<void> {
  const ssmlSafeText = escapeXmlForSsml(chunkText);
  let lastError: unknown;

  for (let attempt = 1; attempt <= 3; attempt++) {
    const tts = new MsEdgeTTS({ connectionTimeoutMs: 8000, synthesisTimeoutMs: 15000 });
    try {
      await tts.setMetadata(edgeVoiceName, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
      const { audioStream } = tts.toStream(ssmlSafeText);
      await pipeline(audioStream, createWriteStream(outMp3Path));

      const st = await fs.stat(outMp3Path).catch(() => null);
      if (!st || st.size < 400) {
        throw new Error('Edge TTS produced empty audio.');
      }
      return;
    } catch (err) {
      lastError = err;
      await fs.unlink(outMp3Path).catch(() => {});
      if (attempt < 3) {
        await new Promise((r) => setTimeout(r, attempt === 1 ? 350 : 900));
      }
    } finally {
      tts.close();
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function withTimeoutPromise<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)}s.`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function synthesizeWithEdgeTts(
  edgeVoiceName: string,
  text: string,
  speakingRate: number,
  outWavPath: string
): Promise<void> {
  const chunks = splitScriptIntoTtsChunks(text, 650);
  if (chunks.length === 0) {
    throw new Error('Script text has no speakable content.');
  }

  const chunkMp3Paths: string[] = [];
  const concatListPath = `${outWavPath}.edge.list.txt`;
  const combinedMp3 = `${outWavPath}.edge.mp3`;

  try {
    for (let i = 0; i < chunks.length; i++) {
      const partMp3 = `${outWavPath}.edge.part${i}.mp3`;
      chunkMp3Paths.push(partMp3);
      await synthesizeEdgeChunkMp3(edgeVoiceName, chunks[i], partMp3);
    }

    let sourceMp3 = chunkMp3Paths[0];
    if (chunkMp3Paths.length > 1) {
      const listContent = chunkMp3Paths
        .map((p) => `file '${p.replace(/'/g, "'\\''")}'`)
        .join('\n');
      await fs.writeFile(concatListPath, listContent, 'utf-8');
      await runCommand(FFMPEG_BIN, [
        '-y',
        '-f',
        'concat',
        '-safe',
        '0',
        '-i',
        concatListPath,
        '-c',
        'copy',
        combinedMp3,
      ]);
      sourceMp3 = combinedMp3;
    }

    const rateFilter =
      Math.abs(speakingRate - 1.0) > 0.02 ? `atempo=${speakingRate.toFixed(2)},` : '';
    await runCommand(FFMPEG_BIN, [
      '-y',
      '-i',
      sourceMp3,
      '-af',
      `aresample=48000,${rateFilter}highpass=f=70,deesser=i=0.25:m=0.4:f=0.55:s=o,alimiter=limit=0.92:attack=2:release=40:level=disabled,loudnorm=I=-14:TP=-1.0:LRA=7`,
      '-ac',
      '2',
      '-ar',
      '48000',
      '-c:a',
      'pcm_s16le',
      outWavPath,
    ]);
  } finally {
    for (const p of chunkMp3Paths) {
      await fs.unlink(p).catch(() => {});
    }
    await fs.unlink(concatListPath).catch(() => {});
    await fs.unlink(combinedMp3).catch(() => {});
  }
}

async function synthesizeWithGeminiTts(
  voiceName: 'Kore' | 'Charon' | 'Zephyr' | 'Puck' | 'Fenrir',
  stylePrompt: string,
  text: string,
  speakingRate: number,
  outWavPath: string
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured for Gemini TTS.');
  }

  const cleanText = sanitizeForSpeech(text);
  if (!cleanText) {
    throw new Error('Script text has no speakable content.');
  }

  const defaultAi = createGeminiClient()!;
  const alphaAi = new GoogleGenAI({
    apiKey,
    apiVersion: 'v1alpha',
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });

  const attempts: Array<{
    label: string;
    run: () => Promise<{ audioBase64?: string; mimeType?: string }>;
  }> = [
    {
      label: 'gemini-3.8-flash-lite-tts (v1alpha)',
      run: async () => {
        const resp = await alphaAi.models.generateContent({
          model: 'gemini-3.8-flash-lite-tts',
          contents: [
            {
              role: 'user',
              parts: [{ text: cleanText, speechMetadata: { style: stylePrompt } }],
            },
          ],
          config: {
            responseModalities: ['AUDIO'],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
          },
        });
        const inline = resp.candidates?.[0]?.content?.parts?.[0]?.inlineData;
        return { audioBase64: inline?.data, mimeType: inline?.mimeType };
      },
    },
    {
      label: 'gemini-3.8-flash-tts (v1alpha)',
      run: async () => {
        const resp = await alphaAi.models.generateContent({
          model: 'gemini-3.8-flash-tts',
          contents: [
            {
              role: 'user',
              parts: [{ text: cleanText, speechMetadata: { style: stylePrompt } }],
            },
          ],
          config: {
            responseModalities: ['AUDIO'],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
          },
        });
        const inline = resp.candidates?.[0]?.content?.parts?.[0]?.inlineData;
        return { audioBase64: inline?.data, mimeType: inline?.mimeType };
      },
    },
    {
      label: 'gemini-3.8-flash-tts',
      run: async () => {
        const resp = await defaultAi.models.generateContent({
          model: 'gemini-3.8-flash-tts',
          contents: [
            {
              role: 'user',
              parts: [{ text: `[Speak in a ${stylePrompt} voice]: ${cleanText}` }],
            },
          ],
          config: {
            responseModalities: ['AUDIO'],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
          },
        });
        const inline = resp.candidates?.[0]?.content?.parts?.[0]?.inlineData;
        return { audioBase64: inline?.data, mimeType: inline?.mimeType };
      },
    },
    {
      label: 'gemini-2.5-flash-preview-tts',
      run: async () => {
        const resp = await defaultAi.models.generateContent({
          model: 'gemini-2.5-flash-preview-tts',
          contents: [
            {
              role: 'user',
              parts: [{ text: `Say with a ${stylePrompt} tone: ${cleanText}` }],
            },
          ],
          config: {
            responseModalities: ['AUDIO'],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
          },
        });
        const inline = resp.candidates?.[0]?.content?.parts?.[0]?.inlineData;
        return { audioBase64: inline?.data, mimeType: inline?.mimeType };
      },
    },
  ];

  const rawAudioPath = `${outWavPath}.gemraw.bin`;
  try {
    let audioBase64: string | undefined;
    let mimeType: string | undefined;
    let usedModel = '';
    const attemptErrors: string[] = [];

    for (const attempt of attempts) {
      try {
        const res = await withTimeoutPromise(attempt.run(), 25000, attempt.label);
        if (res.audioBase64) {
          audioBase64 = res.audioBase64;
          mimeType = res.mimeType;
          usedModel = attempt.label;
          break;
        }
      } catch (err) {
        attemptErrors.push(err instanceof Error ? err.message : String(err));
      }
    }

    if (!audioBase64) {
      throw new Error(attemptErrors[0] || 'Gemini TTS returned no inline audio data.');
    }

    const rawBuf = Buffer.from(audioBase64, 'base64');
    await fs.writeFile(rawAudioPath, rawBuf);

    const isRiffWav =
      rawBuf.length >= 12 &&
      rawBuf.subarray(0, 4).toString('ascii') === 'RIFF' &&
      rawBuf.subarray(8, 12).toString('ascii') === 'WAVE';

    const inputArgs =
      isRiffWav || (mimeType && /wav|mp3|ogg|flac/i.test(mimeType) && !/l16|pcm/i.test(mimeType))
        ? ['-i', rawAudioPath]
        : ['-f', 's16le', '-ar', '24000', '-ac', '1', '-i', rawAudioPath];

    const rateFilter =
      Math.abs(speakingRate - 1.0) > 0.02 ? `atempo=${speakingRate.toFixed(2)},` : '';
    await runCommand(FFMPEG_BIN, [
      '-y',
      ...inputArgs,
      '-af',
      `aresample=48000,${rateFilter}highpass=f=70,deesser=i=0.25:m=0.4:f=0.55:s=o,alimiter=limit=0.92:attack=2:release=40:level=disabled,loudnorm=I=-14:TP=-1.0:LRA=7`,
      '-ac',
      '2',
      '-ar',
      '48000',
      '-c:a',
      'pcm_s16le',
      outWavPath,
    ]);
    return usedModel;
  } finally {
    await fs.unlink(rawAudioPath).catch(() => {});
  }
}

async function synthesizeVoiceWithFallback(
  profile: AiVoiceProfile,
  text: string,
  speakingRate: number,
  outWavPath: string,
  tailoredInstruction?: string | null
): Promise<{ engine: string }> {
  const errs: string[] = [];
  const effectiveGeminiStyle = buildInhouseVoiceStylePrompt(
    profile.geminiStyle,
    tailoredInstruction
  );

  if (profile.provider === 'edge') {
    try {
      await synthesizeWithEdgeTts(profile.edgeVoiceName, text, speakingRate, outWavPath);
      return { engine: `edge-neural (${profile.edgeVoiceName})` };
    } catch (err) {
      errs.push(`Edge: ${err instanceof Error ? err.message : String(err)}`);
    }

    try {
      const model = await synthesizeWithGeminiTts(
        profile.geminiVoiceName,
        effectiveGeminiStyle,
        text,
        speakingRate,
        outWavPath
      );
      return { engine: `${model} (fallback: ${profile.geminiVoiceName})` };
    } catch (err) {
      errs.push(`Gemini: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    try {
      const model = await synthesizeWithGeminiTts(
        profile.geminiVoiceName,
        effectiveGeminiStyle,
        text,
        speakingRate,
        outWavPath
      );
      return { engine: `${model} (${profile.geminiVoiceName})` };
    } catch (err) {
      errs.push(`Gemini: ${err instanceof Error ? err.message : String(err)}`);
    }

    try {
      await synthesizeWithEdgeTts(profile.edgeVoiceName, text, speakingRate, outWavPath);
      return { engine: `edge-neural (fallback: ${profile.edgeVoiceName})` };
    } catch (err) {
      errs.push(`Edge: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Final safety net: try reliable alternate Edge US neural voices if profile-specific endpoints failed
  for (const backupVoice of ['en-US-AriaNeural', 'en-US-AndrewMultilingualNeural']) {
    if (backupVoice === profile.edgeVoiceName) continue;
    try {
      await synthesizeWithEdgeTts(backupVoice, text, speakingRate, outWavPath);
      return { engine: `edge-neural (backup: ${backupVoice})` };
    } catch (err) {
      errs.push(`Backup(${backupVoice}): ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  throw new Error(`Free AI Voice synthesis failed (${errs.join(' | ')}).`);
}

async function startServer() {
  const app = express();
  app.use((req, res, next) => {
    const acceptEncoding = String(req.headers['accept-encoding'] || '');
    if (!acceptEncoding.includes('gzip') || req.path.startsWith('/api/media/') || req.path.startsWith('/api/download/')) {
      next();
      return;
    }
    const origJson = res.json.bind(res);
    res.json = (body: unknown) => {
      const serialized = JSON.stringify(body);
      if (serialized.length < 1024) {
        return origJson(body);
      }
      zlib.gzip(Buffer.from(serialized, 'utf-8'), (err, gz) => {
        if (err) {
          origJson(body);
          return;
        }
        res.setHeader('Content-Encoding', 'gzip');
        res.setHeader('Vary', 'Accept-Encoding');
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.send(gz);
      });
      return res;
    };
    next();
  });
  app.use(express.json({ limit: '10mb' }));

  app.get('/api/health', async (_req, res) => {
    const [hasPathFfmpeg, hasPathFfprobe, hasPathYtDlp, hasWhisper] = await Promise.all([
      commandExists('ffmpeg'),
      commandExists('ffprobe'),
      commandExists('yt-dlp'),
      commandExists('whisper'),
    ]);
    res.json({
      status: 'ok',
      ffmpeg: existsSync(FFMPEG_BIN) || hasPathFfmpeg,
      ffprobe: existsSync(FFPROBE_BIN) || hasPathFfprobe,
      ytDlp: hasPathYtDlp || existsSync(LOCAL_YTDLP_BIN),
      whisper: hasWhisper,
      geminiApi: Boolean(process.env.GEMINI_API_KEY),
    });
  });

  app.post('/api/upload', upload.single('video'), async (req, res) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: 'Please select a valid video file (MP4, MOV, MKV, WebM, AVI, or M4V).' });
        return;
      }

      const jobId = crypto.randomUUID();
      let probed;
      try {
        probed = await probeVideo(req.file.path);
      } catch (probeErr) {
        await fs.unlink(req.file.path).catch(() => {});
        throw probeErr;
      }
      const basename = path.basename(req.file.path);

      const metadata: VideoMetadata = {
        jobId,
        filename: req.file.originalname,
        sourceUrl: `/api/media/${basename}?kind=upload`,
        sourceType: 'upload',
        ...probed,
      };

      jobs.set(jobId, { jobId, inputPath: req.file.path, metadata });
      res.json({ metadata });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to ingest uploaded video.';
      res.status(400).json({ error: message });
    }
  });

  // Chunked binary upload routes
  app.post('/api/upload/init', async (req, res) => {
    try {
      const filename = String(req.body?.filename || 'video.mp4');
      const mimeType = String(req.body?.mimeType || '');
      const fileSize = Number(req.body?.fileSize || 0);

      if (!isSupportedVideoFile(filename, mimeType)) {
        res.status(400).json({
          error: 'Unsupported file type. Upload a video file (MP4, MOV, MKV, WebM, AVI, M4V, or 3GP).',
        });
        return;
      }
      if (!Number.isFinite(fileSize) || fileSize <= 0 || fileSize > MAX_UPLOAD_BYTES) {
        res.status(400).json({ error: 'Video file must be larger than 0 bytes and up to 500 MB.' });
        return;
      }

      const uploadId = crypto.randomUUID();
      const safeExt = getSafeVideoExtension(filename, mimeType);
      const tempPath = path.join(UPLOADS_DIR, `${uploadId}${safeExt}`);
      await fs.writeFile(tempPath, Buffer.alloc(0));

      pendingUploads.set(uploadId, {
        uploadId,
        filename,
        mimeType,
        expectedSize: fileSize,
        receivedBytes: 0,
        tempPath,
      });

      res.json({ uploadId, chunkSize: 4 * 1024 * 1024 });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to initialize video upload.';
      res.status(400).json({ error: message });
    }
  });

  app.post(
    '/api/upload/chunk/:uploadId',
    express.raw({ type: 'application/octet-stream', limit: '8mb' }),
    async (req, res) => {
      try {
        const uploadId = String(req.params.uploadId || '');
        const pending = pendingUploads.get(uploadId);
        if (!pending) {
          res.status(404).json({ error: 'Upload session expired or not found. Please try again.' });
          return;
        }
        const chunk = req.body as Buffer;
        if (!Buffer.isBuffer(chunk) || chunk.length === 0) {
          res.status(400).json({ error: 'Empty upload chunk received.' });
          return;
        }
        if (pending.receivedBytes + chunk.length > MAX_UPLOAD_BYTES) {
          pendingUploads.delete(uploadId);
          await fs.unlink(pending.tempPath).catch(() => {});
          res.status(400).json({ error: 'Uploaded video exceeds the 500 MB limit.' });
          return;
        }

        await fs.appendFile(pending.tempPath, chunk);
        pending.receivedBytes += chunk.length;
        res.json({ receivedBytes: pending.receivedBytes });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Chunk upload failed.';
        res.status(500).json({ error: message });
      }
    }
  );

  app.post('/api/upload/complete/:uploadId', async (req, res) => {
    const uploadId = String(req.params.uploadId || '');
    const pending = pendingUploads.get(uploadId);
    if (!pending) {
      res.status(404).json({ error: 'Upload session not found.' });
      return;
    }
    pendingUploads.delete(uploadId);

    try {
      const probed = await probeVideo(pending.tempPath);
      const jobId = crypto.randomUUID();
      const metadata: VideoMetadata = {
        jobId,
        filename: pending.filename,
        sourceUrl: `/api/media/${path.basename(pending.tempPath)}?kind=upload`,
        sourceType: 'upload',
        ...probed,
      };
      jobs.set(jobId, { jobId, inputPath: pending.tempPath, metadata });
      res.json({ metadata });
    } catch (error) {
      await fs.unlink(pending.tempPath).catch(() => {});
      const message =
        error instanceof Error ? error.message : 'Uploaded file does not contain a readable video stream.';
      res.status(400).json({ error: message });
    }
  });

  const BROWSER_FETCH_UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';

  async function downloadBinaryToFile(url: string, outPath: string): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 75000);
    try {
      const response = await fetch(url, {
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          'User-Agent': BROWSER_FETCH_UA,
          Accept: '*/*',
        },
      });
      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status}`);
      }
      await pipeline(
        Readable.fromWeb(response.body as import('node:stream/web').ReadableStream),
        createWriteStream(outPath)
      );
      const stat = await fs.stat(outPath).catch(() => null);
      if (!stat || stat.size < 1024) {
        await fs.unlink(outPath).catch(() => {});
        throw new Error('Empty downloaded file.');
      }
    } finally {
      clearTimeout(timer);
    }
  }

  async function runCookielessYtDlp(
    bin: string,
    targetUrl: string,
    templatePath: string
  ): Promise<void> {
    const parsed = new URL(targetUrl);
    const isYouTube = /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/i.test(parsed.hostname);

    const buildArgs = (extraArgs: string[]) => [
      '--no-playlist',
      '--no-warnings',
      '--ffmpeg-location',
      BIN_DIR,
      '--js-runtimes',
      'node',
      ...extraArgs,
      '-f',
      'bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b',
      '--merge-output-format',
      'mp4',
      '--max-filesize',
      '500M',
      '-o',
      templatePath,
      targetUrl,
    ];

    const attempts: string[][] = isYouTube
      ? [
          ['--extractor-args', 'youtube:player_client=android_vr,tv_embedded'],
          ['--extractor-args', 'youtube:player_client=ios,mweb'],
          ['--impersonate', 'Chrome-136', '--extractor-args', 'youtube:player_client=web,mweb'],
        ]
      : [['--impersonate', 'Chrome-136'], []];

    let lastErr: Error | null = null;
    for (const extra of attempts) {
      try {
        await runCommand(bin, buildArgs(extra), 120000);
        return;
      } catch (err) {
        lastErr = err instanceof Error ? err : new Error(String(err));
      }
    }
    throw lastErr || new Error('Stream extraction failed.');
  }

  const PIPED_INSTANCES = [
    'https://pipedapi.kavin.rocks',
    'https://pipedapi.adminforge.de',
    'https://api.piped.private.coffee',
    'https://pipedapi.drgns.space',
    'https://piped-api.garudalinux.org',
  ];

  const INVIDIOUS_INSTANCES = [
    'https://inv.nadeko.net',
    'https://invidious.nerdvpn.de',
    'https://yewtu.be',
    'https://invidious.fdn.fr',
  ];

  const COBALT_PUBLIC_INSTANCES = [
    'https://cobalt-api.kwiatekmiki.com',
    'https://cobalt.canine.tools',
  ];

  async function tryPipedYouTubeDownload(
    videoId: string,
    jobId: string,
    outputMp4Path: string
  ): Promise<string | null> {
    for (const base of PIPED_INSTANCES) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12000);
      try {
        const res = await fetch(`${base}/streams/${encodeURIComponent(videoId)}`, {
          signal: controller.signal,
          headers: { 'User-Agent': BROWSER_FETCH_UA, Accept: 'application/json' },
        });
        if (!res.ok) continue;
        const data = (await res.json()) as {
          title?: string;
          videoStreams?: Array<{
            url?: string;
            mimeType?: string;
            quality?: string;
            height?: number;
            videoOnly?: boolean;
          }>;
          audioStreams?: Array<{ url?: string; mimeType?: string; bitrate?: number }>;
        };
        const title = data.title ? `${data.title.replace(/[^\w\s-]/g, '').trim().slice(0, 48)}.mp4` : null;
        const streams = Array.isArray(data.videoStreams) ? data.videoStreams : [];
        const muxed = streams
          .filter((s) => s.url && !s.videoOnly && (s.mimeType || '').includes('mp4'))
          .sort((a, b) => (b.height || 0) - (a.height || 0))[0];

        if (muxed?.url) {
          await downloadBinaryToFile(muxed.url, outputMp4Path);
          return title || `youtube-${videoId}.mp4`;
        }

        const vidOnly = streams
          .filter((s) => s.url && s.videoOnly && (s.height || 0) <= 1080)
          .sort((a, b) => (b.height || 0) - (a.height || 0))[0];
        const audOnly = (Array.isArray(data.audioStreams) ? data.audioStreams : [])
          .filter((a) => a.url)
          .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];

        if (vidOnly?.url && audOnly?.url) {
          const tempV = path.join(UPLOADS_DIR, `${jobId}_pv.mp4`);
          const tempA = path.join(UPLOADS_DIR, `${jobId}_pa.m4a`);
          try {
            await Promise.all([
              downloadBinaryToFile(vidOnly.url, tempV),
              downloadBinaryToFile(audOnly.url, tempA),
            ]);
            await runCommand(FFMPEG_BIN, [
              '-y',
              '-i',
              tempV,
              '-i',
              tempA,
              '-c:v',
              'copy',
              '-c:a',
              'aac',
              '-b:a',
              '160k',
              '-shortest',
              '-movflags',
              '+faststart',
              outputMp4Path,
            ]);
            return title || `youtube-${videoId}.mp4`;
          } finally {
            await fs.unlink(tempV).catch(() => {});
            await fs.unlink(tempA).catch(() => {});
          }
        }
      } catch {
        // Try next public Piped node
      } finally {
        clearTimeout(timer);
      }
    }
    return null;
  }

  async function tryInvidiousYouTubeDownload(
    videoId: string,
    jobId: string,
    outputMp4Path: string
  ): Promise<string | null> {
    for (const base of INVIDIOUS_INSTANCES) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12000);
      try {
        const res = await fetch(`${base}/api/v1/videos/${encodeURIComponent(videoId)}`, {
          signal: controller.signal,
          headers: { 'User-Agent': BROWSER_FETCH_UA, Accept: 'application/json' },
        });
        if (!res.ok) continue;
        const data = (await res.json()) as {
          title?: string;
          formatStreams?: Array<{ url?: string; type?: string; qualityLabel?: string }>;
          adaptiveFormats?: Array<{ url?: string; type?: string; bitrate?: string }>;
        };
        const title = data.title ? `${data.title.replace(/[^\w\s-]/g, '').trim().slice(0, 48)}.mp4` : null;

        const prog = (data.formatStreams || [])
          .filter((s) => s.url && (s.type || '').includes('mp4'))
          .pop();

        if (prog?.url) {
          await downloadBinaryToFile(prog.url, outputMp4Path);
          return title || `youtube-${videoId}.mp4`;
        }

        const adaptive = data.adaptiveFormats || [];
        const vStream = adaptive.find((s) => s.url && (s.type || '').includes('video/mp4'));
        const aStream = adaptive.find((s) => s.url && (s.type || '').includes('audio/'));
        if (vStream?.url && aStream?.url) {
          const tempV = path.join(UPLOADS_DIR, `${jobId}_iv.mp4`);
          const tempA = path.join(UPLOADS_DIR, `${jobId}_ia.m4a`);
          try {
            await Promise.all([
              downloadBinaryToFile(vStream.url, tempV),
              downloadBinaryToFile(aStream.url, tempA),
            ]);
            await runCommand(FFMPEG_BIN, [
              '-y',
              '-i',
              tempV,
              '-i',
              tempA,
              '-c:v',
              'copy',
              '-c:a',
              'aac',
              '-shortest',
              '-movflags',
              '+faststart',
              outputMp4Path,
            ]);
            return title || `youtube-${videoId}.mp4`;
          } finally {
            await fs.unlink(tempV).catch(() => {});
            await fs.unlink(tempA).catch(() => {});
          }
        }
      } catch {
        // Try next Invidious node
      } finally {
        clearTimeout(timer);
      }
    }
    return null;
  }

  async function tryCobaltApiDownload(
    targetUrl: string,
    outputMp4Path: string
  ): Promise<string | null> {
    for (const endpoint of COBALT_PUBLIC_INSTANCES) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 14000);
      try {
        const res = await fetch(`${endpoint}/`, {
          method: 'POST',
          signal: controller.signal,
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'User-Agent': BROWSER_FETCH_UA,
          },
          body: JSON.stringify({ url: targetUrl, videoQuality: '1080' }),
        });
        if (!res.ok) continue;
        const data = (await res.json()) as {
          status?: string;
          url?: string;
          filename?: string;
        };
        if ((data.status === 'tunnel' || data.status === 'redirect') && data.url) {
          await downloadBinaryToFile(data.url, outputMp4Path);
          return data.filename || 'remote-video.mp4';
        }
      } catch {
        // Try next public resolver
      } finally {
        clearTimeout(timer);
      }
    }
    return null;
  }

  function inferExtensionFromContentType(contentType: string, fallbackUrl: string): string {
    const ct = contentType.toLowerCase();
    if (ct.includes('webm')) return '.webm';
    if (ct.includes('quicktime')) return '.mov';
    if (ct.includes('x-matroska') || ct.includes('mkv')) return '.mkv';
    if (ct.includes('x-msvideo') || ct.includes('avi')) return '.avi';
    try {
      const ext = path.extname(new URL(fallbackUrl).pathname).toLowerCase();
      if (ALLOWED_EXTENSIONS.has(ext)) return ext;
    } catch {
      // Ignore invalid fallbackUrl
    }
    return '.mp4';
  }

  async function findJobDownloadedFile(jobId: string): Promise<string | null> {
    const files = await fs.readdir(UPLOADS_DIR);
    const downloaded = files.find((f) => f.startsWith(`${jobId}.`) && !f.endsWith('.part'));
    return downloaded ? path.join(UPLOADS_DIR, downloaded) : null;
  }

  async function downloadHlsStreamWithFfmpeg(url: string, outputPath: string): Promise<void> {
    try {
      await runCommand(
        FFMPEG_BIN,
        [
          '-y',
          '-headers',
          `User-Agent: ${BROWSER_FETCH_UA}\r\n`,
          '-i',
          url,
          '-t',
          '600',
          '-c',
          'copy',
          '-bsf:a',
          'aac_adtstoasc',
          '-movflags',
          '+faststart',
          outputPath,
        ],
        90000
      );
    } catch {
      await runCommand(
        FFMPEG_BIN,
        [
          '-y',
          '-headers',
          `User-Agent: ${BROWSER_FETCH_UA}\r\n`,
          '-i',
          url,
          '-t',
          '600',
          '-c:v',
          'libx264',
          '-preset',
          'veryfast',
          '-crf',
          '22',
          '-pix_fmt',
          'yuv420p',
          '-c:a',
          'aac',
          '-b:a',
          '160k',
          '-movflags',
          '+faststart',
          outputPath,
        ],
        120000
      );
    }
  }

  async function tryDirectStreamOrHtmlInspect(
    url: string,
    jobId: string,
    depth = 0
  ): Promise<
    | { kind: 'downloaded'; filePath: string; displayName?: string }
    | { kind: 'hls'; streamUrl: string }
    | { kind: 'html'; html: string; finalUrl: string }
  > {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);

    try {
      const response = await fetch(url, {
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          'User-Agent': BROWSER_FETCH_UA,
          Accept: '*/*',
        },
      });

      if (!response.ok) {
        throw new Error(
          `Remote host returned HTTP ${response.status}. Verify the link is publicly accessible.`
        );
      }

      const finalUrl = response.url || url;
      const contentType = (response.headers.get('content-type') || '').toLowerCase();
      const dispName = parseContentDispositionFilename(response.headers.get('content-disposition'));

      if (
        contentType.includes('mpegurl') ||
        contentType.includes('x-mpegurl') ||
        /\.m3u8(\?|$)/i.test(finalUrl)
      ) {
        return { kind: 'hls', streamUrl: finalUrl };
      }

      if (contentType.includes('text/html') || contentType.includes('application/xhtml+xml')) {
        const html = await response.text();
        if (depth < 2) {
          const driveConfirmUrl = extractGoogleDriveConfirmUrl(html);
          if (driveConfirmUrl) {
            return await tryDirectStreamOrHtmlInspect(driveConfirmUrl, jobId, depth + 1);
          }
        }
        return { kind: 'html', html, finalUrl };
      }

      if (!response.body) {
        throw new Error('Empty response body from video URL.');
      }

      const ext = inferExtensionFromContentType(contentType, dispName || finalUrl);
      const outPath = path.join(UPLOADS_DIR, `${jobId}${ext}`);
      await pipeline(
        Readable.fromWeb(response.body as import('node:stream/web').ReadableStream),
        createWriteStream(outPath)
      );

      const stat = await fs.stat(outPath).catch(() => null);
      if (!stat || stat.size < 1024) {
        await fs.unlink(outPath).catch(() => {});
        throw new Error('Downloaded stream was empty or not a valid media file.');
      }

      return {
        kind: 'downloaded',
        filePath: outPath,
        displayName: dispName || undefined,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  app.post('/api/ingest-url', async (req, res) => {
    try {
      const normalized = extractAndNormalizeVideoUrl(String(req.body?.url || ''));
      if (normalized.ok === false) {
        res.status(400).json({ error: normalized.error });
        return;
      }

      const targetUrl = normalized.url;
      const parsedUrl = new URL(targetUrl);
      const jobId = crypto.randomUUID();
      let targetPath = path.join(UPLOADS_DIR, `${jobId}.mp4`);
      let resolvedDisplayName = normalized.filenameHint;

      if (
        normalized.provider === 'direct' ||
        normalized.provider === 'google_drive' ||
        normalized.provider === 'dropbox' ||
        normalized.provider === 'github'
      ) {
        const directAttempt = await tryDirectStreamOrHtmlInspect(targetUrl, jobId);
        if (directAttempt.kind === 'downloaded') {
          targetPath = directAttempt.filePath;
          resolvedDisplayName = directAttempt.displayName || resolvedDisplayName;
        } else if (directAttempt.kind === 'hls') {
          await downloadHlsStreamWithFfmpeg(directAttempt.streamUrl, targetPath);
        } else {
          const ytDlpBin = await resolveYtDlpBin();
          let downloadedViaYtDlp = false;
          if (ytDlpBin) {
            try {
              const templatePath = path.join(UPLOADS_DIR, `${jobId}.%(ext)s`);
              await runCookielessYtDlp(ytDlpBin, directAttempt.finalUrl, templatePath);
              const found = await findJobDownloadedFile(jobId);
              if (found) {
                targetPath = found;
                downloadedViaYtDlp = true;
              }
            } catch {
              // Fall through to HTML video extraction below
            }
          }

          if (!downloadedViaYtDlp) {
            const candidate = extractHtmlVideoCandidate(directAttempt.html, directAttempt.finalUrl);
            if (!candidate) {
              throw new Error(
                'Could not locate a direct video stream from this page. Ensure the share link is public or upload the video file directly.'
              );
            }
            if (/\.m3u8(\?|$)/i.test(candidate)) {
              await downloadHlsStreamWithFfmpeg(candidate, targetPath);
            } else {
              const embedded = await tryDirectStreamOrHtmlInspect(candidate, jobId, 1);
              if (embedded.kind === 'downloaded') {
                targetPath = embedded.filePath;
                resolvedDisplayName = embedded.displayName || resolvedDisplayName;
              } else if (embedded.kind === 'hls') {
                await downloadHlsStreamWithFfmpeg(embedded.streamUrl, targetPath);
              } else {
                throw new Error('Could not extract a direct video stream from this link.');
              }
            }
          }
        }
      } else if (normalized.provider === 'hls') {
        const ytDlpBin = await resolveYtDlpBin();
        let hlsDone = false;
        if (ytDlpBin) {
          try {
            const templatePath = path.join(UPLOADS_DIR, `${jobId}.%(ext)s`);
            await runCookielessYtDlp(ytDlpBin, targetUrl, templatePath);
            const found = await findJobDownloadedFile(jobId);
            if (found) {
              targetPath = found;
              hlsDone = true;
            }
          } catch {
            // Fall back to direct FFmpeg HLS muxing
          }
        }
        if (!hlsDone) {
          await downloadHlsStreamWithFfmpeg(targetUrl, targetPath);
        }
      } else {
        // Strictly cookie-free multi-resolver waterfall: yt-dlp -> Piped -> Invidious -> Cobalt -> HTML og:video
        let downloaded = false;
        const ytId = extractYouTubeVideoId(targetUrl);

        const ytDlpBin = await resolveYtDlpBin();
        if (ytDlpBin) {
          try {
            const templatePath = path.join(UPLOADS_DIR, `${jobId}.%(ext)s`);
            await runCookielessYtDlp(ytDlpBin, targetUrl, templatePath);
            const found = await findJobDownloadedFile(jobId);
            if (found) {
              targetPath = found;
              downloaded = true;
            }
          } catch {
            // Fall through cleanly to Piped/Invidious/Cobalt
          }
        }

        if (!downloaded && ytId) {
          const pipedName = await tryPipedYouTubeDownload(ytId, jobId, targetPath);
          if (pipedName) {
            resolvedDisplayName = pipedName;
            downloaded = true;
          }
        }

        if (!downloaded && ytId) {
          const invName = await tryInvidiousYouTubeDownload(ytId, jobId, targetPath);
          if (invName) {
            resolvedDisplayName = invName;
            downloaded = true;
          }
        }

        if (!downloaded) {
          const cobaltName = await tryCobaltApiDownload(targetUrl, targetPath);
          if (cobaltName) {
            resolvedDisplayName = cobaltName;
            downloaded = true;
          }
        }

        if (!downloaded) {
          try {
            const inspected = await tryDirectStreamOrHtmlInspect(targetUrl, jobId);
            if (inspected.kind === 'downloaded') {
              targetPath = inspected.filePath;
              resolvedDisplayName = inspected.displayName || resolvedDisplayName;
              downloaded = true;
            } else if (inspected.kind === 'hls') {
              await downloadHlsStreamWithFfmpeg(inspected.streamUrl, targetPath);
              downloaded = true;
            } else {
              const candidate = extractHtmlVideoCandidate(inspected.html, inspected.finalUrl);
              if (candidate) {
                if (/\.m3u8(\?|$)/i.test(candidate)) {
                  await downloadHlsStreamWithFfmpeg(candidate, targetPath);
                  downloaded = true;
                } else {
                  const embedded = await tryDirectStreamOrHtmlInspect(candidate, jobId, 1);
                  if (embedded.kind === 'downloaded') {
                    targetPath = embedded.filePath;
                    resolvedDisplayName = embedded.displayName || resolvedDisplayName;
                    downloaded = true;
                  } else if (embedded.kind === 'hls') {
                    await downloadHlsStreamWithFfmpeg(embedded.streamUrl, targetPath);
                    downloaded = true;
                  }
                }
              }
            }
          } catch {
            // Exhausted all resolvers
          }
        }

        if (!downloaded) {
          throw new Error(
            'Could not download a public stream from this URL via free resolvers right now. Try another public link (Direct MP4, Drive, Dropbox, Vimeo) or upload via Local Files.'
          );
        }
      }

      if (!existsSync(targetPath)) {
        res.status(422).json({ error: 'Video download produced no readable output file.' });
        return;
      }

      let probed;
      try {
        probed = await probeVideo(targetPath);
      } catch (probeErr) {
        await fs.unlink(targetPath).catch(() => {});
        throw probeErr;
      }

      const rawBase = path.basename(parsedUrl.pathname);
      const fallbackName =
        rawBase && rawBase !== '/' && rawBase !== 'watch' && rawBase !== 'uc'
          ? rawBase
          : 'remote-stream.mp4';

      const metadata: VideoMetadata = {
        jobId,
        filename: resolvedDisplayName || fallbackName,
        sourceUrl: `/api/media/${path.basename(targetPath)}?kind=upload`,
        sourceType: 'url',
        ...probed,
      };

      jobs.set(jobId, { jobId, inputPath: targetPath, metadata });
      res.json({ metadata });
    } catch (error) {
      const cleanMessage = (error instanceof Error ? error.message : 'Failed to download video URL.')
        .replace(/\/tmp\/harframe\/bin\/yt-dlp exited with code \d+:\s*/gi, '')
        .trim();
      res.status(422).json({ error: cleanMessage || 'Failed to download video stream.' });
    }
  });

  app.post('/api/sample', async (req, res) => {
    try {
      const orientation = req.body?.orientation === 'portrait' ? 'portrait' : 'landscape';
      const isPortrait = orientation === 'portrait';
      const sampleSize = isPortrait ? '720x1280' : '1280x720';
      const jobId = crypto.randomUUID();
      const samplePath = path.join(UPLOADS_DIR, `${jobId}.mp4`);

      // Synthesize a 6s stereo clip with ambient high-frequency foley + tonal melody so ASMR preservation works audibly
      await runCommand(FFMPEG_BIN, [
        '-y',
        '-threads',
        '0',
        '-f',
        'lavfi',
        '-i',
        `testsrc2=duration=6:size=${sampleSize}:rate=30`,
        '-f',
        'lavfi',
        '-i',
        "aevalsrc='0.28*sin(2*PI*220*t)+0.16*sin(2*PI*660*t)*(0.5+0.5*sin(2*PI*1.8*t))|0.28*sin(2*PI*220*t)+0.14*cos(2*PI*7200*t)*(0.4+0.6*sin(2*PI*5*t))':s=48000:d=6:c=stereo",
        '-vf',
        `eq=brightness=-0.06:contrast=0.92:saturation=0.9,drawbox=x=0:y=0:w=${isPortrait ? 720 : 1280}:h=${isPortrait ? 1280 : 720}:color=#19142b@0.22:t=fill`,
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-crf',
        '22',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-b:a',
        '160k',
        '-movflags',
        '+faststart',
        samplePath,
      ]);

      const probed = await probeVideo(samplePath);
      const defaultTranscript: SubtitleSegment[] = [
        {
          id: 's1',
          startSec: 0.0,
          endSec: 2.0,
          text: isPortrait
            ? 'HarFrame brings every vertical story to life'
            : 'HarFrame turns every frame into a vivid story',
        },
        { id: 's2', startSec: 2.1, endSec: 4.0, text: 'AI voiceover keeping crisp ASMR textures' },
        { id: 's3', startSec: 4.1, endSec: 5.9, text: 'Content-aware cinema color up to 4K' },
      ];

      const metadata: VideoMetadata = {
        jobId,
        filename: isPortrait
          ? 'harframe_vertical_9x16_720p.mp4'
          : 'harframe_studio_sample_720p.mp4',
        sourceUrl: `/api/media/${path.basename(samplePath)}?kind=upload`,
        sourceType: 'sample',
        ...probed,
      };

      jobs.set(jobId, { jobId, inputPath: samplePath, metadata, defaultTranscript });
      res.json({ metadata, segments: defaultTranscript });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to generate sample clip.';
      res.status(500).json({ error: message });
    }
  });

  // Step 2: Analyze clip with Gemini Vision + prompt (ignoring voice-model cues and translating them for in-house voice studio)
  app.post('/api/script/generate', async (req, res) => {
    const tempPreviewPath = path.join(WORKSPACE_DIR, `script_preview_${crypto.randomUUID()}.mp4`);
    const tempFramePaths: string[] = [];
    let uploadedFileName: string | null = null;
    try {
      const jobId = String(req.body?.jobId || '');
      const rawPrompt = String(req.body?.prompt || '').trim();
      const translation = translatePromptForInhouseStudio(rawPrompt);

      const job = jobs.get(jobId);
      if (!job || !existsSync(job.inputPath)) {
        res.status(404).json({ error: 'Video job not found. Load a video first.' });
        return;
      }

      const ai = createGeminiClient();
      if (!ai) {
        res.status(400).json({
          error:
            'GEMINI_API_KEY is not configured on the server. Use the Gemini Prompt Copier + Paste Cleaner below instead.',
        });
        return;
      }

      const origStat = await fs.stat(job.inputPath);
      const previewSpec = computeGeminiVideoPreviewSpec(
        job.metadata.durationSec,
        origStat.size
      );

      let videoToSendPath = job.inputPath;
      if (previewSpec.needsTranscode) {
        try {
          await runCommand(FFMPEG_BIN, [
            '-y',
            '-i',
            job.inputPath,
            '-vf',
            `scale='min(480,iw):-2',fps=${previewSpec.targetFps}`,
            '-frames:v',
            String(previewSpec.maxFrames),
            '-c:v',
            'libx264',
            '-preset',
            'ultrafast',
            '-crf',
            '30',
            '-pix_fmt',
            'yuv420p',
            '-an',
            '-movflags',
            '+faststart',
            tempPreviewPath,
          ], 45000);
          if (existsSync(tempPreviewPath)) {
            const pStat = await fs.stat(tempPreviewPath).catch(() => null);
            if (pStat && pStat.size > 1024) {
              videoToSendPath = tempPreviewPath;
            }
          }
        } catch {
          // If MP4 preview compression fails, keyframe storyboard fallback below still handles the clip cleanly
        }
      }

      const previewStat = await fs.stat(videoToSendPath);
      let videoPart:
        | { inlineData: { mimeType: string; data: string } }
        | { fileData: { fileUri: string; mimeType: string } };

      if (previewStat.size > 11 * 1024 * 1024) {
        const uploaded = await ai.files.upload({
          file: videoToSendPath,
          config: { mimeType: 'video/mp4' },
        });
        uploadedFileName = uploaded.name || null;
        if (!uploaded.uri) throw new Error('Failed to upload video preview for Gemini script generation.');
        videoPart = {
          fileData: { fileUri: uploaded.uri, mimeType: uploaded.mimeType || 'video/mp4' },
        };
      } else {
        const buf = await fs.readFile(videoToSendPath);
        videoPart = {
          inlineData: { mimeType: 'video/mp4', data: buf.toString('base64') },
        };
      }

      const targetRate = translation.suggestedRate ?? 1.0;
      const targetWords = Math.max(8, Math.round(job.metadata.durationSec * 2.4 * targetRate));
      const promptPayload = `Watch this ${job.metadata.durationSec.toFixed(1)}-second video clip carefully.
Visual storytelling instruction: "${translation.cleanStoryPrompt}"

Return JSON with:
1. "visualSummary": a concise 1-sentence description of what happens visually in the clip.
2. "script": ONLY the exact spoken words (~${targetWords} words so it fits naturally within ${job.metadata.durationSec.toFixed(1)}s). Ignore any external voice-model names, TTS engine directions, voice casting preferences, speaking speeds, SSML tags, or bracketed vocal cues—do NOT include greetings, headers, timestamps, speaker labels, SSML, or delivery cues inside "script".`;

      const scriptSchema = {
        type: Type.OBJECT,
        properties: {
          visualSummary: { type: Type.STRING },
          script: { type: Type.STRING },
        },
        required: ['visualSummary', 'script'],
      };

      const callGeminiScriptParts = async (
        model: 'gemini-4-hydrogen' | 'gemini-3.1-flash-lite',
        parts: Array<
          | { inlineData: { mimeType: string; data: string } }
          | { fileData: { fileUri: string; mimeType: string } }
          | { text: string }
        >,
        timeoutMs: number
      ) =>
        withTimeoutPromise(
          ai.models.generateContent({
            model,
            contents: { parts },
            config: {
              systemInstruction:
                'You are HarFrame Gemini Script Writer. Produce strictly speakable narration text grounded in the video frames. Never write SSML tags, voice actor notes, speed instructions, or TTS engine directives inside the script.',
              thinkingConfig: {
                thinkingLevel:
                  model === 'gemini-4-hydrogen' ? ThinkingLevel.LOW : ThinkingLevel.MINIMAL,
              },
              responseMimeType: 'application/json',
              responseSchema: scriptSchema,
            },
          }),
          timeoutMs,
          model
        );

      let response;
      let modelUsed = 'gemini-4-hydrogen';
      let lastVideoErr: Error | null = null;

      try {
        response = await callGeminiScriptParts(
          'gemini-4-hydrogen',
          [videoPart, { text: promptPayload }],
          12000
        );
      } catch (primaryErr) {
        const primaryMsg = primaryErr instanceof Error ? primaryErr.message : String(primaryErr);
        lastVideoErr = primaryErr instanceof Error ? primaryErr : new Error(primaryMsg);
        if (/503|UNAVAILABLE|RESOURCE_EXHAUSTED|429|timed out|INVALID_ARGUMENT/i.test(primaryMsg)) {
          try {
            modelUsed = 'gemini-3.1-flash-lite';
            response = await callGeminiScriptParts(
              'gemini-3.1-flash-lite',
              [videoPart, { text: promptPayload }],
              40000
            );
          } catch (secondaryErr) {
            const secMsg = secondaryErr instanceof Error ? secondaryErr.message : String(secondaryErr);
            lastVideoErr = secondaryErr instanceof Error ? secondaryErr : new Error(secMsg);
          }
        } else {
          throw primaryErr;
        }
      }

      // Fast Keyframe Storyboard Fallback when MP4 video decoding times out or stalls upstream
      if (!response) {
        const timestamps = computeAdaptiveFrameTimestamps(
          job.metadata.durationSec,
          previewSpec.keyframeCount
        );
        const keyframeParts: Array<{ inlineData: { mimeType: string; data: string } } | { text: string }> = [];

        for (let i = 0; i < timestamps.length; i++) {
          const ts = timestamps[i];
          const framePath = path.join(WORKSPACE_DIR, `${jobId}_script_kf_${i}.jpg`);
          tempFramePaths.push(framePath);
          try {
            await runCommand(FFMPEG_BIN, [
              '-y',
              '-ss',
              String(ts),
              '-i',
              job.inputPath,
              '-frames:v',
              '1',
              '-vf',
              "scale='min(480,iw):-2'",
              '-q:v',
              '5',
              framePath,
            ], 15000);
            if (existsSync(framePath)) {
              const buf = await fs.readFile(framePath);
              if (buf.length > 200) {
                keyframeParts.push({
                  inlineData: { mimeType: 'image/jpeg', data: buf.toString('base64') },
                });
              }
            }
          } catch {
            // Skip unreadable frame timestamp
          }
        }

        if (keyframeParts.length === 0) {
          throw lastVideoErr || new Error('Gemini script generation timed out on this video clip.');
        }

        const keyframePrompt = `These ${keyframeParts.length} evenly spaced keyframes represent a ${job.metadata.durationSec.toFixed(1)}-second video clip from start to finish.
Visual storytelling instruction: "${translation.cleanStoryPrompt}"

Return JSON with:
1. "visualSummary": a concise 1-sentence description of what happens visually across these frames.
2. "script": ONLY the exact spoken words (~${targetWords} words so it fits naturally within ${job.metadata.durationSec.toFixed(1)}s). Ignore any external voice-model names, TTS engine directions, voice casting preferences, speaking speeds, SSML tags, or bracketed vocal cues—do NOT include greetings, headers, timestamps, speaker labels, SSML, or delivery cues inside "script".`;

        keyframeParts.push({ text: keyframePrompt });

        try {
          modelUsed = 'gemini-3.1-flash-lite (keyframes)';
          response = await callGeminiScriptParts('gemini-3.1-flash-lite', keyframeParts, 30000);
        } catch (kfErr1) {
          try {
            modelUsed = 'gemini-4-hydrogen (keyframes)';
            response = await callGeminiScriptParts('gemini-4-hydrogen', keyframeParts, 30000);
          } catch (kfErr2) {
            throw kfErr2 instanceof Error ? kfErr2 : (kfErr1 instanceof Error ? kfErr1 : lastVideoErr!);
          }
        }
      }

      const raw = (response.text ?? '')
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/```\s*$/i, '')
        .trim();
      const parsed = JSON.parse(raw) as { visualSummary?: string; script?: string };
      const cleaned = stripGeminiYapping(parsed.script || '');
      const { wordCount, estimatedSec } = estimateSpeechDurationSec(cleaned.cleanScript, targetRate);
      const visualSummary = String(parsed.visualSummary || '').trim();

      job.visualSummary = visualSummary;
      res.json({
        cleanScript: cleaned.cleanScript,
        wordCount,
        estimatedDurationSec: estimatedSec,
        visualSummary,
        modelUsed,
        voiceTranslation: {
          hadVoiceModelInstructions: translation.hadVoiceModelInstructions,
          ignoredDirectives: translation.ignoredDirectives,
          suggestedVoiceId: translation.suggestedVoiceId,
          suggestedVoiceName: translation.suggestedVoiceName,
          suggestedRate: translation.suggestedRate,
          inhouseDeliveryInstruction: translation.inhouseDeliveryInstruction,
        },
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Gemini script generation failed.';
      res.status(500).json({ error: msg });
    } finally {
      if (uploadedFileName) {
        const ai = createGeminiClient();
        if (ai) await ai.files.delete({ name: uploadedFileName }).catch(() => {});
      }
      await fs.unlink(tempPreviewPath).catch(() => {});
      await Promise.all(tempFramePaths.map((p) => fs.unlink(p).catch(() => {})));
    }
  });

  app.post('/api/script/clean', (req, res) => {
    const rawText = String(req.body?.rawText || '');
    const speakingRate = Number(req.body?.speakingRate || 1.0);
    const cleaned = stripGeminiYapping(rawText);
    const { wordCount, estimatedSec } = estimateSpeechDurationSec(cleaned.cleanScript, speakingRate);
    res.json({
      cleanScript: cleaned.cleanScript,
      removedLinesCount: cleaned.removedLinesCount,
      removedTags: cleaned.removedTags,
      wordCount,
      estimatedDurationSec: estimatedSec,
    });
  });

  // Step 3: Free AI Voiceover Studio catalog, sample audition, and full voiceover generation
  app.get('/api/voices', (_req, res) => {
    res.json({ voices: AI_VOICE_CATALOG, audioMixOptions: AUDIO_MIX_OPTIONS });
  });

  app.get('/api/voices/:voiceId/sample', async (req, res) => {
    try {
      const voiceId = String(req.params.voiceId || '') as AiVoiceId;
      const profile = AI_VOICE_CATALOG.find((v) => v.id === voiceId);
      if (!profile) {
        res.status(404).json({ error: 'Voice profile not found.' });
        return;
      }

      const rate = clampNum(req.query?.rate, 0.75, 1.35, 1.0);
      const rateTag = Math.abs(rate - 1.0) <= 0.02 ? '' : `_r${rate.toFixed(2)}`;
      const cachedSamplePath = path.join(VOICE_SAMPLES_DIR, `${voiceId}_sample${rateTag}_v1.wav`);
      if (!existsSync(cachedSamplePath)) {
        await synthesizeVoiceWithFallback(profile, profile.samplePhrase, rate, cachedSamplePath);
      }

      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.sendFile(cachedSamplePath);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Could not synthesize voice sample.';
      res.status(500).json({ error: msg });
    }
  });

  app.post('/api/voiceover/generate', async (req, res) => {
    try {
      const jobId = String(req.body?.jobId || '');
      const aiVoiceId = String(req.body?.aiVoiceId || 'aria_warm') as AiVoiceId;
      const rawScript = String(req.body?.script || '');
      const speakingRate = clampNum(req.body?.speakingRate, 0.75, 1.35, 1.0);
      const tailoredInstruction =
        typeof req.body?.tailoredInstruction === 'string'
          ? req.body.tailoredInstruction.trim()
          : '';

      const job = jobs.get(jobId);
      if (!job || !existsSync(job.inputPath)) {
        res.status(404).json({ error: 'Video job not found. Load a video first.' });
        return;
      }

      const profile = AI_VOICE_CATALOG.find((v) => v.id === aiVoiceId);
      if (!profile) {
        res.status(400).json({ error: 'Invalid AI voice preset.' });
        return;
      }

      const cleaned = stripGeminiYapping(rawScript);
      const speakableScript = cleaned.cleanScript || rawScript.trim();
      if (!speakableScript) {
        res.status(400).json({ error: 'Please write or extract a narration script before generating voiceover audio.' });
        return;
      }

      const voFilename = `harframe_vo_${jobId}_${Date.now()}.wav`;
      const voPath = path.join(OUTPUTS_DIR, voFilename);

      const { engine } = await synthesizeVoiceWithFallback(
        profile,
        speakableScript,
        speakingRate,
        voPath,
        tailoredInstruction || null
      );

      const durationSec = await probeAudioDurationSec(voPath);

      job.voiceoverPath = voPath;
      job.voiceoverScript = speakableScript;
      job.voiceoverAiVoiceId = aiVoiceId;
      job.voiceoverRate = speakingRate;
      job.voiceoverDurationSec = durationSec;
      job.voiceoverEngine = engine;
      // Clear stale dialogue-only transcript cache so caption toggle/sync aligns to new voiceover
      job.cachedTranscript = undefined;

      res.json({
        voiceoverUrl: `/api/media/${voFilename}?kind=output`,
        durationSec,
        engine,
        voiceName: profile.name,
        cleanScript: speakableScript,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Voiceover synthesis failed.';
      res.status(500).json({ error: msg });
    }
  });

  // Step 4: AI Captions alignment (aligns generated voiceover + script OR transcribes original audio)
  app.post('/api/transcribe', async (req, res) => {
    try {
      const jobId = String(req.body?.jobId || '');
      const force = Boolean(req.body?.force);
      const preferredSource = String(req.body?.source || 'auto');
      const job = jobs.get(jobId);
      if (!job || !existsSync(job.inputPath)) {
        res.status(404).json({ error: 'Video job not found. Please load a video first.' });
        return;
      }

      // If AI voiceover has been generated and caller didn't explicitly demand source dialogue, sync to voiceover WAV
      if (
        preferredSource !== 'source' &&
        job.voiceoverPath &&
        existsSync(job.voiceoverPath)
      ) {
        const voDur = job.voiceoverDurationSec || (await probeAudioDurationSec(job.voiceoverPath)) || job.metadata.durationSec;
        if (job.voiceoverScript && job.voiceoverScript.trim().length > 0) {
          const windows = await detectSpeechWindows(job.voiceoverPath, voDur);
          const alignedSegments = alignTranscriptToWindows(job.voiceoverScript, windows);
          if (alignedSegments.length > 0) {
            job.cachedTranscript = {
              engine: 'voiceover-script-sync',
              segments: alignedSegments,
            };
            res.json(job.cachedTranscript);
            return;
          }
        }

        if (process.env.GEMINI_API_KEY) {
          const geminiVo = await transcribeWithGemini(
            job.voiceoverPath,
            'audio/wav',
            voDur,
            job.voiceoverPath
          );
          if (geminiVo.segments.length > 0) {
            job.cachedTranscript = geminiVo;
            res.json(job.cachedTranscript);
            return;
          }
        }
      }

      if (job.defaultTranscript && job.metadata.sourceType === 'sample') {
        res.json({
          engine: 'studio-sample-dialogue',
          segments: optimizeCaptionSegments(job.defaultTranscript, { maxWordsPerCue: 5 }),
        });
        return;
      }

      if (!job.metadata.hasAudio) {
        res.json({
          engine: 'silent-source',
          segments: [],
        });
        return;
      }

      if (job.cachedTranscript && !force) {
        res.json(job.cachedTranscript);
        return;
      }

      const speechPreFilter = 'highpass=f=85,lowpass=f=7600,afftdn=nr=8:nf=-48,speechnorm=e=4:c=2';
      const hasWhisper = await commandExists('whisper');
      let asrWarning: string | undefined;

      if (hasWhisper) {
        const wavPath = path.join(OUTPUTS_DIR, `${jobId}_asr.wav`);
        const jsonPath = path.join(OUTPUTS_DIR, `${jobId}_asr.json`);
        try {
          try {
            await runCommand(FFMPEG_BIN, [
              '-y',
              '-threads',
              '0',
              '-i',
              job.inputPath,
              '-vn',
              '-af',
              speechPreFilter,
              '-ac',
              '1',
              '-ar',
              '16000',
              '-c:a',
              'pcm_s16le',
              wavPath,
            ]);
          } catch {
            await runCommand(FFMPEG_BIN, [
              '-y',
              '-threads',
              '0',
              '-i',
              job.inputPath,
              '-vn',
              '-ac',
              '1',
              '-ar',
              '16000',
              '-c:a',
              'pcm_s16le',
              wavPath,
            ]);
          }
          await runCommand('whisper', [
            wavPath,
            '--model',
            'base',
            '--fp16',
            'False',
            '--beam_size',
            '1',
            '--best_of',
            '1',
            '--condition_on_previous_text',
            'False',
            '--output_format',
            'json',
            '--output_dir',
            OUTPUTS_DIR,
          ]);
          if (existsSync(jsonPath)) {
            const whisperData = JSON.parse(await fs.readFile(jsonPath, 'utf-8'));
            const segments = optimizeCaptionSegments(
              (whisperData.segments || []).map(
                (s: { start: number; end: number; text: string }, idx: number) => ({
                  id: `whisper-${idx + 1}`,
                  startSec: s.start,
                  endSec: s.end,
                  text: s.text,
                })
              ),
              { maxWordsPerCue: 5 }
            );
            if (segments.length > 0) {
              job.cachedTranscript = { engine: 'openai-whisper-optimized', segments };
              res.json(job.cachedTranscript);
              return;
            }
          }
        } catch (err) {
          console.error('[HarFrame ASR] Local Whisper failed:', err);
        } finally {
          await fs.unlink(wavPath).catch(() => {});
          await fs.unlink(jsonPath).catch(() => {});
        }
      }

      if (process.env.GEMINI_API_KEY) {
        const mp3Path = path.join(OUTPUTS_DIR, `${jobId}_asr.mp3`);
        try {
          let extracted = false;
          try {
            await runCommand(FFMPEG_BIN, [
              '-y',
              '-threads',
              '0',
              '-i',
              job.inputPath,
              '-vn',
              '-af',
              speechPreFilter,
              '-ac',
              '1',
              '-ar',
              '16000',
              '-c:a',
              'libmp3lame',
              '-b:a',
              '32k',
              mp3Path,
            ]);
            const st = await fs.stat(mp3Path).catch(() => null);
            extracted = Boolean(st && st.size >= 400);
          } catch {
            extracted = false;
          }

          if (!extracted) {
            await runCommand(FFMPEG_BIN, [
              '-y',
              '-threads',
              '0',
              '-i',
              job.inputPath,
              '-vn',
              '-ac',
              '1',
              '-ar',
              '16000',
              '-c:a',
              'libmp3lame',
              '-b:a',
              '32k',
              mp3Path,
            ]);
          }

          const geminiResult = await transcribeWithGemini(
            mp3Path,
            'audio/mp3',
            job.metadata.durationSec,
            job.inputPath
          );
          if (geminiResult.segments.length > 0) {
            job.cachedTranscript = geminiResult;
            res.json(job.cachedTranscript);
            return;
          }
          asrWarning = 'No spoken dialogue was detected in this audio track.';
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Gemini ASR request failed';
          console.error('[HarFrame ASR] Gemini transcription fallback triggered:', msg);
          asrWarning = `AI speech transcription unavailable (${msg.slice(0, 120)}). Loaded cadence timing placeholders.`;
        } finally {
          await fs.unlink(mp3Path).catch(() => {});
        }
      } else {
        asrWarning = 'GEMINI_API_KEY is not configured; using cadence timing placeholders.';
      }

      const fallbackSegments = optimizeCaptionSegments(
        await detectAudioCadenceSegments(job.inputPath, job.metadata.durationSec),
        { maxWordsPerCue: 5 }
      );
      res.json({
        engine: 'audio-cadence',
        segments: fallbackSegments,
        warning: asrWarning,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Transcription failed.';
      res.status(500).json({ error: message });
    }
  });

  // Step 5: AI Content-Aware Scene Color Analysis
  app.post('/api/color/analyze', async (req, res) => {
    try {
      const jobId = String(req.body?.jobId || '');
      const force = Boolean(req.body?.force);
      const job = jobs.get(jobId);
      if (!job || !existsSync(job.inputPath)) {
        res.status(404).json({ error: 'Video job not found. Load a video first.' });
        return;
      }

      if (job.contentAwareAnalysis && !force) {
        res.json({ analysis: job.contentAwareAnalysis });
        return;
      }

      const analysis = await computeContentAwareAnalysis(
        jobId,
        job.inputPath,
        job.metadata.durationSec
      );
      job.contentAwareAnalysis = analysis;
      res.json({ analysis });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Scene color analysis failed.';
      res.status(500).json({ error: message });
    }
  });

  // Final Render Pipeline (embeds AI voiceover with ASMR/SFX isolation, burned-in captions, AI content-aware color, 720p-4K framing)
  app.post('/api/render', async (req, res) => {
    try {
      const {
        jobId,
        voiceId = 'original',
        aiVoiceId = 'aria_warm',
        useAiVoiceover = true,
        script,
        speakingRate = 1.0,
        tailoredInstruction,
        audioMixMode = 'asmr_only',
        frameAspect = 'auto',
        resolutionTier = '1080p',
        frameFit = 'fit',
        colorGradeId = 'ai_content_aware',
        contentAwareAnalysis,
        captionsEnabled = true,
        captionStyleId = 'hormozi_yellow',
        customCaptionStyle,
        segments = [],
      } = req.body as {
        jobId: string;
        voiceId: VoiceId;
        aiVoiceId?: AiVoiceId;
        useAiVoiceover?: boolean;
        script?: string;
        speakingRate?: number;
        tailoredInstruction?: string;
        audioMixMode?: AudioMixMode;
        frameAspect?: FrameAspectId;
        resolutionTier?: ResolutionTierId;
        frameFit?: FrameFitMode;
        colorGradeId: ColorGradeId;
        contentAwareAnalysis?: ContentAwareColorAnalysis;
        captionsEnabled: boolean;
        captionStyleId: CaptionStyleId;
        customCaptionStyle?: Partial<CustomCaptionStyle>;
        segments: SubtitleSegment[];
      };

      const job = jobs.get(jobId);
      if (!job || !existsSync(job.inputPath)) {
        res.status(404).json({ error: 'Source video not found. Upload or load a sample video first.' });
        return;
      }

      if (!VOICE_PRESETS.some((v) => v.id === voiceId)) {
        res.status(400).json({ error: 'Invalid character voice preset.' });
        return;
      }
      if (!AUDIO_MIX_OPTIONS.some((m) => m.id === audioMixMode)) {
        res.status(400).json({ error: 'Invalid audio mix mode.' });
        return;
      }
      if (!FRAME_ASPECT_PRESETS.some((a) => a.id === frameAspect)) {
        res.status(400).json({ error: 'Invalid frame aspect ratio preset.' });
        return;
      }
      if (!RESOLUTION_PRESETS.some((r) => r.id === resolutionTier)) {
        res.status(400).json({ error: 'Invalid output resolution tier.' });
        return;
      }
      if (frameFit !== 'fit' && frameFit !== 'fill') {
        res.status(400).json({ error: 'Invalid frame fit mode.' });
        return;
      }
      if (!COLOR_GRADE_PRESETS.some((g) => g.id === colorGradeId)) {
        res.status(400).json({ error: 'Invalid color grading preset.' });
        return;
      }
      if (!CAPTION_STYLE_PRESETS.some((c) => c.id === captionStyleId)) {
        res.status(400).json({ error: 'Invalid caption style preset.' });
        return;
      }

      const renderStartedAt = Date.now();
      const totalSec = Math.max(0.5, job.metadata.durationSec || 6);
      renderProgressMap.set(jobId, {
        phase: 'preparing',
        percent: 5,
        encodedSec: 0,
        totalSec,
        startedAtMs: renderStartedAt,
        updatedAtMs: renderStartedAt,
      });

      const renderId = `${jobId}_${Date.now()}`;
      const outputFilename = `harframe_${renderId}_${resolutionTier}.mp4`;
      const outputPath = path.join(OUTPUTS_DIR, outputFilename);

      let frameStats: FrameLumaStats | undefined;
      let autoBalanceStats: RenderResult['autoBalanceStats'];
      let effectiveContentAware: ContentAwareColorAnalysis | undefined =
        contentAwareAnalysis || job.contentAwareAnalysis;

      if (colorGradeId === 'ai_auto_balance') {
        frameStats = await analyzeFrameLuma(job.inputPath);
        const computed = computeAutoBalanceFilter(frameStats);
        autoBalanceStats = {
          ...frameStats,
          appliedBrightness: computed.appliedBrightness,
          appliedContrast: computed.appliedContrast,
          appliedSaturation: computed.appliedSaturation,
        };
      } else if (colorGradeId === 'ai_content_aware' && !effectiveContentAware) {
        effectiveContentAware = await computeContentAwareAnalysis(
          jobId,
          job.inputPath,
          job.metadata.durationSec
        );
        job.contentAwareAnalysis = effectiveContentAware;
      }

      const normalizedSegments = normalizeSegments(segments);

      // Always embed the voiceover when active (irrespective of audioMixMode),
      // auto-synthesizing from script or captions if missing or if voice/script/rate changed.
      const shouldEmbedVoiceover = useAiVoiceover !== false;
      const safeAiVoiceId =
        AI_VOICE_CATALOG.find((v) => v.id === aiVoiceId)?.id ?? AI_VOICE_CATALOG[0].id;
      const safeRate = clampNum(speakingRate, 0.75, 1.35, 1.0);
      const rawScriptCandidate =
        typeof script === 'string' && script.trim().length > 0
          ? script
          : job.voiceoverScript || normalizedSegments.map((s) => s.text).join(' ');
      const cleanedCandidate = stripGeminiYapping(rawScriptCandidate);
      const speakableCandidate = cleanedCandidate.cleanScript || rawScriptCandidate.trim();

      const hasExistingVoiceover = Boolean(job.voiceoverPath && existsSync(job.voiceoverPath));
      const voiceConfigChanged =
        (typeof script === 'string' &&
          script.trim().length > 0 &&
          speakableCandidate !== (job.voiceoverScript || '')) ||
        (hasExistingVoiceover &&
          job.voiceoverAiVoiceId &&
          job.voiceoverAiVoiceId !== safeAiVoiceId) ||
        (hasExistingVoiceover &&
          typeof job.voiceoverRate === 'number' &&
          Math.abs(job.voiceoverRate - safeRate) > 0.02);

      if (shouldEmbedVoiceover && speakableCandidate && (!hasExistingVoiceover || voiceConfigChanged)) {
        const profile = AI_VOICE_CATALOG.find((v) => v.id === safeAiVoiceId) ?? AI_VOICE_CATALOG[0];
        const voFilename = `harframe_vo_${jobId}_${Date.now()}.wav`;
        const voPath = path.join(OUTPUTS_DIR, voFilename);
        const { engine } = await synthesizeVoiceWithFallback(
          profile,
          speakableCandidate,
          safeRate,
          voPath,
          typeof tailoredInstruction === 'string' && tailoredInstruction.trim()
            ? tailoredInstruction.trim()
            : null
        );
        const voDur = await probeAudioDurationSec(voPath);
        job.voiceoverPath = voPath;
        job.voiceoverScript = speakableCandidate;
        job.voiceoverAiVoiceId = safeAiVoiceId;
        job.voiceoverRate = safeRate;
        job.voiceoverDurationSec = voDur;
        job.voiceoverEngine = engine;
      }

      const effectiveVoiceoverPath =
        shouldEmbedVoiceover && job.voiceoverPath && existsSync(job.voiceoverPath)
          ? job.voiceoverPath
          : undefined;

      let assPath: string | undefined;
      let srtFilename: string | undefined;
      let assFilename: string | undefined;

      if (captionsEnabled && normalizedSegments.length > 0) {
        srtFilename = `harframe_${renderId}.srt`;
        assFilename = `harframe_${renderId}.ass`;
        const srtPath = path.join(OUTPUTS_DIR, srtFilename);
        assPath = path.join(OUTPUTS_DIR, assFilename);

        await fs.writeFile(srtPath, toSrt(normalizedSegments), 'utf-8');
        await fs.writeFile(
          assPath,
          toAss(
            normalizedSegments,
            captionStyleId,
            job.metadata.width,
            job.metadata.height,
            frameAspect,
            resolutionTier,
            frameFit,
            customCaptionStyle
          ),
          'utf-8'
        );
      }

      const ffmpegArgs = buildFfmpegArgs({
        inputPath: job.inputPath,
        outputPath,
        sourceWidth: job.metadata.width,
        sourceHeight: job.metadata.height,
        hasAudio: job.metadata.hasAudio,
        isStereoAudio: job.metadata.isStereoAudio ?? true,
        sourceDurationSec: job.metadata.durationSec,
        voiceId,
        voiceoverPath: effectiveVoiceoverPath,
        audioMixMode,
        frameAspect,
        resolutionTier,
        frameFit,
        colorGradeId,
        contentAwareAnalysis: effectiveContentAware,
        captionsEnabled: Boolean(captionsEnabled && assPath),
        captionStyleId,
        assFilePath: assPath,
        frameStats,
      });

      const encodingStartedAt = Date.now();
      renderProgressMap.set(jobId, {
        phase: 'encoding',
        percent: 5,
        encodedSec: 0,
        totalSec,
        startedAtMs: encodingStartedAt,
        updatedAtMs: encodingStartedAt,
      });

      const trackedArgs = ['-progress', 'pipe:1', ...ffmpegArgs];
      let stdoutRemainder = '';
      await runCommand(FFMPEG_BIN, trackedArgs, 180000, (chunk) => {
        stdoutRemainder = `${stdoutRemainder}${chunk}`.slice(-2048);
        const encodedSec = parseFfmpegOutTimeSec(stdoutRemainder);
        if (encodedSec !== null) {
          const pct = Math.max(5, Math.min(99, Math.round((encodedSec / totalSec) * 100)));
          renderProgressMap.set(jobId, {
            phase: 'encoding',
            percent: pct,
            encodedSec: Math.min(totalSec, encodedSec),
            totalSec,
            startedAtMs: encodingStartedAt,
            updatedAtMs: Date.now(),
          });
        }
      });

      const outputProbed = await probeVideo(outputPath);

      renderProgressMap.set(jobId, {
        phase: 'completed',
        percent: 100,
        encodedSec: totalSec,
        totalSec,
        startedAtMs: encodingStartedAt,
        updatedAtMs: Date.now(),
      });

      const result: RenderResult = {
        jobId,
        outputUrl: `/api/media/${outputFilename}?kind=output`,
        downloadUrl: `/api/download/${outputFilename}`,
        srtUrl: srtFilename ? `/api/download/${srtFilename}` : undefined,
        assUrl: assFilename ? `/api/download/${assFilename}` : undefined,
        width: outputProbed.width,
        height: outputProbed.height,
        durationSec: outputProbed.durationSec,
        fileSizeBytes: outputProbed.fileSizeBytes,
        voiceId,
        aiVoiceId: safeAiVoiceId,
        voiceoverEmbedded: Boolean(effectiveVoiceoverPath),
        audioMixMode: effectiveVoiceoverPath ? audioMixMode : undefined,
        frameAspect,
        resolutionTier,
        frameFit,
        colorGradeId,
        captionsEnabled,
        captionStyleId,
        customCaptionStyle: customCaptionStyle as CustomCaptionStyle | undefined,
        autoBalanceStats,
        contentAwareStats: colorGradeId === 'ai_content_aware' ? effectiveContentAware : undefined,
      };

      res.json({ result });
    } catch (error) {
      const reqJobId = typeof req.body?.jobId === 'string' ? req.body.jobId : '';
      if (reqJobId) {
        const existing = renderProgressMap.get(reqJobId);
        renderProgressMap.set(reqJobId, {
          phase: 'failed',
          percent: existing?.percent ?? 0,
          encodedSec: existing?.encodedSec ?? 0,
          totalSec: existing?.totalSec ?? 0,
          startedAtMs: existing?.startedAtMs ?? Date.now(),
          updatedAtMs: Date.now(),
        });
      }
      const message = error instanceof Error ? error.message : 'FFmpeg render failed.';
      res.status(500).json({ error: message });
    }
  });

  app.get('/api/render/progress/:jobId', (req, res) => {
    const { jobId } = req.params;
    const progress = renderProgressMap.get(jobId) ?? null;
    res.json({ progress });
  });

  // Restore a historical job into active memory when files still exist on disk
  app.post('/api/jobs/restore', (req, res) => {
    try {
      const { metadata, segments, visualSummary, contentAwareAnalysis, voiceoverUrl, voiceoverDurationSec, voiceoverEngine } =
        req.body as {
          metadata?: VideoMetadata;
          segments?: SubtitleSegment[];
          visualSummary?: string;
          contentAwareAnalysis?: ContentAwareColorAnalysis;
          voiceoverUrl?: string;
          voiceoverDurationSec?: number;
          voiceoverEngine?: string;
        };

      if (!metadata?.jobId || !metadata?.sourceUrl) {
        res.status(400).json({ error: 'Invalid historical metadata.' });
        return;
      }

      const rawSource = metadata.sourceUrl.split('?')[0] || '';
      const sourceFile = path.basename(rawSource);
      const sourcePath = path.resolve(UPLOADS_DIR, sourceFile);
      if (!sourcePath.startsWith(UPLOADS_DIR + path.sep) || !existsSync(sourcePath)) {
        res.json({ restored: false, sourceAvailable: false });
        return;
      }

      let voiceoverPath: string | undefined;
      if (voiceoverUrl) {
        const voFile = path.basename(voiceoverUrl.split('?')[0] || '');
        const resolvedVo = path.resolve(OUTPUTS_DIR, voFile);
        if (resolvedVo.startsWith(OUTPUTS_DIR + path.sep) && existsSync(resolvedVo)) {
          voiceoverPath = resolvedVo;
        }
      }

      if (!jobs.has(metadata.jobId)) {
        jobs.set(metadata.jobId, {
          jobId: metadata.jobId,
          inputPath: sourcePath,
          metadata,
          cachedTranscript:
            Array.isArray(segments) && segments.length > 0
              ? { engine: 'history-restored', segments }
              : undefined,
          voiceoverPath,
          voiceoverDurationSec,
          voiceoverEngine,
          visualSummary,
          contentAwareAnalysis,
        });
      }

      res.json({ restored: true, sourceAvailable: true });
    } catch {
      res.status(500).json({ error: 'Could not restore historical job.' });
    }
  });

  // Account Auth & Per-User History (last 5+ videos saved on server)
  app.get('/api/auth/me', async (req, res) => {
    const session = getAuthenticatedSession(req);
    if (!session) {
      res.json({ user: null });
      return;
    }
    const store = await loadPersistedStore();
    const user = store.users.find((u) => u.id === session.userId);
    if (!user) {
      res.json({ user: null });
      return;
    }
    res.json({ user: { id: user.id, username: user.username } });
  });

  app.post('/api/auth/register', async (req, res) => {
    try {
      const username = String(req.body?.username || '').trim();
      const password = String(req.body?.password || '');
      if (!/^[a-zA-Z0-9._-]{3,32}$/.test(username)) {
        res.status(400).json({
          error: 'Username must be 3–32 characters (letters, numbers, dot, underscore, or dash).',
        });
        return;
      }
      if (password.length < 6 || password.length > 128) {
        res.status(400).json({ error: 'Password must be between 6 and 128 characters.' });
        return;
      }

      const store = await loadPersistedStore();
      const lower = username.toLowerCase();
      if (store.users.some((u) => u.usernameLower === lower)) {
        res.status(409).json({ error: 'That username is already registered. Please sign in.' });
        return;
      }

      const newUser: StoredUser = {
        id: crypto.randomUUID(),
        username,
        usernameLower: lower,
        passwordHash: hashUserPassword(password),
        createdAt: Date.now(),
      };
      store.users.push(newUser);
      store.histories[newUser.id] = store.histories[newUser.id] || [];
      await savePersistedStore(store);

      const token = signSessionToken(newUser.id, newUser.username);
      appendSessionSetCookie(res, token, SESSION_TTL_SEC);
      res.json({ user: { id: newUser.id, username: newUser.username } });
    } catch {
      res.status(500).json({ error: 'Could not create account.' });
    }
  });

  app.post('/api/auth/login', async (req, res) => {
    try {
      const username = String(req.body?.username || '').trim();
      const password = String(req.body?.password || '');
      if (!username || !password) {
        res.status(400).json({ error: 'Enter your username and password.' });
        return;
      }

      const store = await loadPersistedStore();
      const user = store.users.find((u) => u.usernameLower === username.toLowerCase());
      if (!user || !verifyUserPassword(password, user.passwordHash)) {
        res.status(401).json({ error: 'Invalid username or password.' });
        return;
      }

      const token = signSessionToken(user.id, user.username);
      appendSessionSetCookie(res, token, SESSION_TTL_SEC);
      res.json({ user: { id: user.id, username: user.username } });
    } catch {
      res.status(500).json({ error: 'Sign in failed.' });
    }
  });

  app.post('/api/auth/logout', (req, res) => {
    if (!verifyMutationOriginOrHeader(req)) {
      res.status(403).json({ error: 'Forbidden request origin.' });
      return;
    }
    appendSessionSetCookie(res, '', 0);
    res.json({ loggedOut: true });
  });

  app.get('/api/history', async (req, res) => {
    const session = getAuthenticatedSession(req);
    if (!session) {
      res.status(401).json({ error: 'Sign in required for account history.' });
      return;
    }
    const store = await loadPersistedStore();
    const userExists = store.users.some((u) => u.id === session.userId);
    if (!userExists) {
      res.status(401).json({ error: 'Account session invalid.' });
      return;
    }
    const entries = store.histories[session.userId] || [];
    res.json({ entries });
  });

  app.post('/api/history', async (req, res) => {
    if (!verifyMutationOriginOrHeader(req)) {
      res.status(403).json({ error: 'Forbidden request origin.' });
      return;
    }
    const session = getAuthenticatedSession(req);
    if (!session) {
      res.status(401).json({ error: 'Sign in required to save account history.' });
      return;
    }
    const entry = req.body?.entry as HistoryEntry | undefined;
    if (!entry || !entry.id || !entry.metadata || !entry.settings || !entry.renderResult) {
      res.status(400).json({ error: 'Invalid history entry payload.' });
      return;
    }

    const store = await loadPersistedStore();
    if (!store.users.some((u) => u.id === session.userId)) {
      res.status(401).json({ error: 'Account not found.' });
      return;
    }
    const existing = store.histories[session.userId] || [];
    const deduped = existing.filter(
      (item) =>
        item.id !== entry.id && item.renderResult?.outputUrl !== entry.renderResult?.outputUrl
    );
    const updated = [entry, ...deduped].slice(0, 10);
    store.histories[session.userId] = updated;
    await savePersistedStore(store);
    res.json({ entries: updated });
  });

  app.delete('/api/history/:id', async (req, res) => {
    if (!verifyMutationOriginOrHeader(req)) {
      res.status(403).json({ error: 'Forbidden request origin.' });
      return;
    }
    const session = getAuthenticatedSession(req);
    if (!session) {
      res.status(401).json({ error: 'Sign in required.' });
      return;
    }
    const entryId = String(req.params.id || '');
    const store = await loadPersistedStore();
    const existing = store.histories[session.userId] || [];
    const updated = existing.filter((item) => item.id !== entryId);
    store.histories[session.userId] = updated;
    await savePersistedStore(store);
    res.json({ entries: updated });
  });

  app.get('/api/media/:filename', (req, res) => {
    const safeName = path.basename(req.params.filename);
    const kind = req.query.kind === 'upload' ? UPLOADS_DIR : OUTPUTS_DIR;
    const filePath = path.resolve(kind, safeName);
    if (!filePath.startsWith(kind + path.sep) || !existsSync(filePath)) {
      res.status(404).json({ error: 'Media file not found.' });
      return;
    }
    res.sendFile(filePath);
  });

  app.get('/api/download/:filename', (req, res) => {
    const safeName = path.basename(req.params.filename);
    const filePath = path.resolve(OUTPUTS_DIR, safeName);
    if (!filePath.startsWith(OUTPUTS_DIR + path.sep) || !existsSync(filePath)) {
      res.status(404).json({ error: 'Download file not found.' });
      return;
    }
    res.download(filePath, safeName);
  });

  app.delete('/api/jobs/:jobId', async (req, res) => {
    const jobId = String(req.params.jobId || '');
    const job = jobs.get(jobId);
    if (!job) {
      res.json({ deleted: false });
      return;
    }
    jobs.delete(jobId);
    await fs.unlink(job.inputPath).catch(() => {});
    if (job.voiceoverPath) {
      await fs.unlink(job.voiceoverPath).catch(() => {});
    }
    res.json({ deleted: true });
  });

  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(400).json({ error: err.message || 'Invalid request.' });
  });

  app.get('/healthz', (_req, res) => {
    res.status(200).send('ok');
  });

  const distDir = path.resolve(process.cwd(), 'dist');
  const isDevRunner =
    process.env.npm_lifecycle_event === 'dev' ||
    process.execArgv.some((arg) => arg.includes('tsx'));
  const useProductionStatic =
    process.env.NODE_ENV === 'production' ||
    (!isDevRunner && existsSync(path.join(distDir, 'index.html')));

  if (!useProductionStatic) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(
      '/assets',
      express.static(path.join(distDir, 'assets'), {
        maxAge: '7d',
        immutable: true,
      })
    );
    app.use(express.static(distDir, { maxAge: '1h' }));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`HarFrame Studio server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start HarFrame server:', err);
  process.exit(1);
});
