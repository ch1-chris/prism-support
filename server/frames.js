import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';
import { mkdtempSync, readFileSync, rmSync, existsSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

ffmpeg.setFfmpegPath(ffmpegPath);

const FRAME_INTERVAL_SECONDS = 5;
const MAX_WIDTH = 720;

export function extractFrames(videoPath) {
  return new Promise((resolve, reject) => {
    const outDir = mkdtempSync(join(tmpdir(), 'prism-frames-'));

    ffmpeg(videoPath)
      .outputOptions([
        `-vf`, `fps=1/${FRAME_INTERVAL_SECONDS},scale='min(${MAX_WIDTH},iw)':-2`,
        `-q:v`, `4`,
      ])
      .output(join(outDir, 'frame-%04d.jpg'))
      .on('end', () => {
        const frames = [];
        for (let i = 1; ; i++) {
          const framePath = join(outDir, `frame-${String(i).padStart(4, '0')}.jpg`);
          if (!existsSync(framePath)) break;
          frames.push({
            timestamp: (i - 1) * FRAME_INTERVAL_SECONDS,
            path: framePath,
          });
        }
        resolve({ frames, outDir });
      })
      .on('error', (err) => {
        cleanupFrames(outDir);
        reject(new Error(`Frame extraction failed: ${err.message}`));
      })
      .run();
  });
}

export function readFrameAsBase64(framePath) {
  const buffer = readFileSync(framePath);
  return buffer.toString('base64');
}

export function getFramesForSegment(frames, startSeconds, endSeconds, maxFrames = 8) {
  const segmentFrames = frames.filter(
    (f) => f.timestamp >= startSeconds && f.timestamp <= endSeconds
  );

  if (segmentFrames.length <= maxFrames) return segmentFrames;

  const step = segmentFrames.length / maxFrames;
  const sampled = [];
  for (let i = 0; i < maxFrames; i++) {
    sampled.push(segmentFrames[Math.floor(i * step)]);
  }
  return sampled;
}

export function cleanupFrames(outDir) {
  try {
    if (outDir && existsSync(outDir)) {
      rmSync(outDir, { recursive: true, force: true });
    }
  } catch {
    // best-effort cleanup
  }
}

export function ensureTmpDir() {
  const dir = join(tmpdir(), 'prism-uploads');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}
