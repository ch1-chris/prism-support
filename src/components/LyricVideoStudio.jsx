import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Play, Pause, Download, Sparkles, Mic, Loader2, Check, AlertCircle,
  Eye, EyeOff, Film,
  Square, RectangleHorizontal,
  RectangleVertical,
} from 'lucide-react';

// ---------- Design tokens (from Channel 1 design system) ----------

const PALETTES = {
  teal:    { name: 'TEAL',    primary: '#2ED6E5', dark: '#033B40', light: '#D9FCFF' },
  magenta: { name: 'MAGENTA', primary: '#F266FF', dark: '#3D0A40', light: '#FBE4FF' },
  purple:  { name: 'PURPLE',  primary: '#7040FF', dark: '#150828', light: '#E5DCFF' },
  orange:  { name: 'ORANGE',  primary: '#FFAB1A', dark: '#3D2800', light: '#FFE8B8' },
  blue:    { name: 'BLUE',    primary: '#1ABEFF', dark: '#003040', light: '#CCEFFF' },
  green:   { name: 'GREEN',   primary: '#3AE556', dark: '#062D10', light: '#D5FBDC' },
  gold:    { name: 'GOLD',    primary: '#FFB700', dark: '#3D2A00', light: '#FFE899' },
  mono:    { name: 'MONO',    primary: '#17181A', dark: '#17181A', light: '#F0F2F7' },
};

const STYLES = {
  karaoke:           { name: 'KARAOKE',       blurb: 'All lyrics, active word glow' },
  spotlight:         { name: 'SPOTLIGHT',     blurb: 'One word at a time, centered' },
  cascade:           { name: 'CASCADE',       blurb: 'Words flow up and stack' },
  mono_callout:      { name: 'CALLOUT',       blurb: 'Mono chunk, left, multi-word' },
  mono_callout_glow: { name: 'CALLOUT 2',     blurb: 'Mono left + active glow' },
  plain_center:      { name: 'PLAIN',         blurb: 'Center chunk, no effects' },
  bar_line:          { name: 'BAR',           blurb: 'Active word on highlight bar' },
  left_block:        { name: 'LEFT BLOCK',    blurb: 'Left-aligned paragraph' },
  underline_pop:     { name: 'UNDERLINE',    blurb: 'Active word underlined' },
};

const ASPECTS = {
  '16:9': { label: '16:9',  sublabel: 'LANDSCAPE', w: 1920, h: 1080, Icon: RectangleHorizontal },
  '9:16': { label: '9:16',  sublabel: 'PORTRAIT',  w: 1080, h: 1920, Icon: RectangleVertical },
  '1:1':  { label: '1:1',   sublabel: 'SQUARE',    w: 1080, h: 1080, Icon: Square },
  '4:5':  { label: '4:5',   sublabel: 'VERTICAL',  w: 1080, h: 1350, Icon: RectangleVertical },
};

const TEXT_SCALES = {
  s:  { name: 'S',  factor: 0.75 },
  m:  { name: 'M',  factor: 1.0  },
  l:  { name: 'L',  factor: 1.4  },
  xl: { name: 'XL', factor: 1.85 },
};

const VOICES = [
  { id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel', vibe: 'Calm narrator' },
  { id: 'AZnzlk1XvdvUeBnXmlld', name: 'Domi',   vibe: 'Energetic' },
  { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Bella',  vibe: 'Soft & warm' },
  { id: 'ErXwobaYiN019PkySvjV', name: 'Antoni', vibe: 'Well-rounded' },
  { id: 'TxGEqnHWrfWFTfGW9XjX', name: 'Josh',   vibe: 'Deep' },
  { id: 'VR6AewLTigWG4xSOukaG', name: 'Arnold', vibe: 'Crisp' },
  { id: 'pNInz6obpgDQGcFmaJgB', name: 'Adam',   vibe: 'Deep narrator' },
  { id: 'yoZ06aMxZJJ28mfd3POQ', name: 'Sam',    vibe: 'Raspy' },
];

const ELEVEN_MODEL_ID = 'eleven_v3';

function buildElevenLabsTtsPayload(text) {
  return {
    text,
    model_id: ELEVEN_MODEL_ID,
    voice_settings: {
      stability: 0.45,
      similarity_boost: 0.75,
      style: 0.0,
      use_speaker_boost: true,
    },
  };
}

const SANS = '"Geist", "Helvetica Neue", system-ui, sans-serif';
const MONO = '"Geist Mono", ui-monospace, monospace';

// ---------- Helpers ----------

function buildWordsFromAlignment(alignment) {
  if (!alignment) return [];
  const chars = alignment.characters || [];
  const starts = alignment.character_start_times_seconds || [];
  const ends = alignment.character_end_times_seconds || [];
  const words = [];
  let curr = null;
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (/\s/.test(ch)) {
      if (curr) { words.push(curr); curr = null; }
    } else {
      if (!curr) curr = { text: ch, start: starts[i], end: ends[i] };
      else { curr.text += ch; curr.end = ends[i]; }
    }
  }
  if (curr) words.push(curr);
  return words;
}

function findActiveIndex(words, t) {
  if (!words.length) return -1;
  if (t < words[0].start) return -1;
  for (let i = 0; i < words.length; i++) {
    if (t >= words[i].start && t < words[i].end) return i;
    if (i < words.length - 1 && t >= words[i].end && t < words[i + 1].start) return i; // in gap, hold last
  }
  return words.length - 1;
}

function chunkIntoSentences(words) {
  // Group words into sentence-like chunks for paged styles.
  const chunks = [];
  let curr = [];
  for (const w of words) {
    curr.push(w);
    if (/[.!?…]$/.test(w.text) || curr.length >= 18) {
      chunks.push(curr); curr = [];
    }
  }
  if (curr.length) chunks.push(curr);
  return chunks;
}

function currentChunk(chunks, t) {
  if (!chunks.length) return { chunk: [], idx: 0 };
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    if (t < c[c.length - 1].end + 0.05) return { chunk: c, idx: i };
  }
  return { chunk: chunks[chunks.length - 1], idx: chunks.length - 1 };
}

function wrapLines(ctx, words, maxWidth, sizePx) {
  ctx.font = `500 ${sizePx}px ${SANS}`;
  const space = ctx.measureText(' ').width;
  const lines = [];
  let line = [];
  let w = 0;
  for (const word of words) {
    const ww = ctx.measureText(word.text).width;
    const add = (line.length ? space : 0) + ww;
    if (line.length && w + add > maxWidth) {
      lines.push(line);
      line = [word]; w = ww;
    } else {
      line.push(word); w += add;
    }
  }
  if (line.length) lines.push(line);
  return lines;
}

function wrapLinesMono(ctx, words, maxWidth, sizePx) {
  ctx.font = `500 ${sizePx}px ${MONO}`;
  const space = ctx.measureText(' ').width;
  const lines = [];
  let line = [];
  let w = 0;
  for (const word of words) {
    const ww = ctx.measureText(word.text).width;
    const add = (line.length ? space : 0) + ww;
    if (line.length && w + add > maxWidth) {
      lines.push(line);
      line = [word]; w = ww;
    } else {
      line.push(word); w += add;
    }
  }
  if (line.length) lines.push(line);
  return lines;
}

function rgba(hex, a) {
  const m = hex.replace('#','').match(/.{2}/g);
  const [r,g,b] = m.map(x => parseInt(x, 16));
  return `rgba(${r},${g},${b},${a})`;
}

// ---------- Frame renderers ----------

function drawCaptionBackground(ctx, opts) {
  const { width, height, palette } = opts;
  const bg = palette.dark;
  const fg = palette.light;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);
  const padding = Math.min(width, height) * 0.06;
  return { fg, bg, padding };
}

function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w/2, h/2);
  ctx.beginPath();
  ctx.moveTo(x+r, y);
  ctx.arcTo(x+w, y,   x+w, y+h, r);
  ctx.arcTo(x+w, y+h, x,   y+h, r);
  ctx.arcTo(x,   y+h, x,   y,   r);
  ctx.arcTo(x,   y,   x+w, y,   r);
  ctx.closePath();
}

function drawKaraoke(ctx, opts) {
  const { width, height, palette, words, time, textScale } = opts;
  const { padding } = drawCaptionBackground(ctx, opts);
  if (!words.length) return;

  const chunks = chunkIntoSentences(words);
  const { chunk } = currentChunk(chunks, time);
  const activeI = findActiveIndex(words, time);

  const maxW = width - padding * 2;
  const baseSize = Math.min(width, height) * 0.052 * textScale;
  const lines = wrapLines(ctx, chunk, maxW, baseSize);
  const lineH = baseSize * 1.25;
  const totalH = lines.length * lineH;
  let y = (height - totalH) / 2 + lineH * 0.7;

  ctx.font = `600 ${baseSize}px ${SANS}`;
  ctx.textBaseline = 'alphabetic';

  for (const line of lines) {
    let xOff = (width - lineWidth(ctx, line, baseSize)) / 2;
    for (let i = 0; i < line.length; i++) {
      const w = line[i];
      const isActive = words.indexOf(w) === activeI;
      const isPast = words.indexOf(w) < activeI;
      const wText = w.text;
      const ww = ctx.measureText(wText).width;
      if (isActive) {
        // glow / highlight box
        ctx.save();
        ctx.shadowColor = palette.primary;
        ctx.shadowBlur = baseSize * 0.6;
        ctx.fillStyle = palette.primary;
        ctx.fillText(wText, xOff, y);
        ctx.restore();
      } else if (isPast) {
        ctx.fillStyle = rgba(palette.light, 0.85);
        ctx.fillText(wText, xOff, y);
      } else {
        ctx.fillStyle = rgba(palette.light, 0.32);
        ctx.fillText(wText, xOff, y);
      }
      xOff += ww + ctx.measureText(' ').width;
    }
    y += lineH;
  }
}

function lineWidth(ctx, line, sizePx) {
  ctx.font = `600 ${sizePx}px ${SANS}`;
  const space = ctx.measureText(' ').width;
  let w = 0;
  line.forEach((word, i) => {
    w += ctx.measureText(word.text).width + (i < line.length-1 ? space : 0);
  });
  return w;
}

function drawSpotlight(ctx, opts) {
  const { width, height, palette, words, time, textScale } = opts;
  drawCaptionBackground(ctx, opts);
  if (!words.length) return;

  const idx = findActiveIndex(words, time);
  if (idx < 0) return;
  const w = words[idx];

  const wDur = Math.max(0.05, w.end - w.start);
  const wProgress = Math.min(1, Math.max(0, (time - w.start) / wDur));
  const popScale = 1 + (1 - wProgress) * 0.04;

  const baseSize = Math.min(width, height) * 0.16 * textScale;
  ctx.font = `700 ${baseSize}px ${SANS}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.save();
  ctx.translate(width/2, height/2);
  ctx.scale(popScale, popScale);
  ctx.shadowColor = palette.primary;
  ctx.shadowBlur = baseSize * 0.4;
  ctx.fillStyle = '#FFFFFF';
  ctx.fillText(w.text, 0, 0);
  ctx.restore();

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

function drawCascade(ctx, opts) {
  const { width, height, palette, words, time, textScale } = opts;
  const { padding } = drawCaptionBackground(ctx, opts);
  if (!words.length) return;

  const chunks = chunkIntoSentences(words);
  const { chunk } = currentChunk(chunks, time);

  const baseSize = Math.min(width, height) * 0.07 * textScale;
  ctx.font = `600 ${baseSize}px ${SANS}`;
  const lineH = baseSize * 1.3;

  // Find which words in this chunk are visible (started)
  const visible = chunk.filter(w => time >= w.start);

  // Stack from bottom
  let y = height - padding - lineH * 1.5;
  const renderList = visible.slice(-Math.floor(height / lineH) + 2); // limit

  for (let i = renderList.length - 1; i >= 0; i--) {
    const w = renderList[i];
    const stackPos = renderList.length - 1 - i; // 0 = newest at bottom
    const isCurrent = stackPos === 0 && time < w.end;

    // entry animation (slide up + fade)
    const since = time - w.start;
    const entry = Math.min(1, since / 0.22);
    const yOff = (1 - entry) * lineH * 0.6;
    const alpha = entry;

    ctx.save();
    ctx.globalAlpha = alpha * (isCurrent ? 1 : (1 - stackPos * 0.15));
    ctx.font = `${isCurrent ? 700 : 500} ${baseSize * (isCurrent ? 1.15 : 1)}px ${SANS}`;
    ctx.textAlign = 'center';
    ctx.fillStyle = isCurrent ? palette.primary : palette.light;
    if (isCurrent) {
      ctx.shadowColor = palette.primary;
      ctx.shadowBlur = baseSize * 0.5;
    }
    ctx.fillText(w.text, width/2, y + yOff);
    ctx.restore();
    y -= lineH;
  }
  ctx.textAlign = 'left';
}

/** Mono caption chunk — left-aligned wrap, karaoke-style timing (past / active / future). */
function paintMonoChunkCallout(ctx, opts, { activeGlow }) {
  const { width, height, palette, words, time, textScale } = opts;
  const { padding } = drawCaptionBackground(ctx, opts);
  if (!words.length) return;

  const chunks = chunkIntoSentences(words);
  const { chunk } = currentChunk(chunks, time);
  if (!chunk.length) return;

  const activeI = findActiveIndex(words, time);
  const maxW = width - padding * 2;
  const baseSize = Math.min(width, height) * 0.068 * textScale;
  const lines = wrapLinesMono(ctx, chunk, maxW, baseSize);
  const lineH = baseSize * 1.32;
  const totalH = lines.length * lineH;
  let y = (height - totalH) / 2 + lineH * 0.72;

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `500 ${baseSize}px ${MONO}`;
  const space = ctx.measureText(' ').width;

  for (const line of lines) {
    let xOff = padding;
    for (const w of line) {
      const wi = words.indexOf(w);
      const isActive = wi === activeI;
      const isPast = wi < activeI;
      const wText = w.text;
      ctx.font = `${isActive ? 700 : 500} ${baseSize}px ${MONO}`;
      const ww = ctx.measureText(wText).width;

      if (isActive && activeGlow) {
        ctx.save();
        ctx.shadowColor = palette.primary;
        ctx.shadowBlur = baseSize * 0.6;
        ctx.fillStyle = palette.primary;
        ctx.fillText(wText, xOff, y);
        ctx.restore();
      } else if (isActive) {
        ctx.fillStyle = palette.primary;
        ctx.fillText(wText, xOff, y);
      } else if (isPast) {
        ctx.fillStyle = rgba(palette.light, 0.92);
        ctx.fillText(wText, xOff, y);
      } else {
        ctx.fillStyle = rgba(palette.light, 0.38);
        ctx.fillText(wText, xOff, y);
      }
      xOff += ww + space;
    }
    y += lineH;
  }
}

function drawMonoCallout(ctx, opts) {
  paintMonoChunkCallout(ctx, opts, { activeGlow: false });
}

function drawMonoCalloutGlow(ctx, opts) {
  paintMonoChunkCallout(ctx, opts, { activeGlow: true });
}

function drawPlainCenter(ctx, opts) {
  const { width, height, palette, words, time, textScale } = opts;
  const { padding } = drawCaptionBackground(ctx, opts);
  if (!words.length) return;

  const chunks = chunkIntoSentences(words);
  const { chunk } = currentChunk(chunks, time);
  const activeI = findActiveIndex(words, time);

  const maxW = width - padding * 2;
  const baseSize = Math.min(width, height) * 0.052 * textScale;
  const lines = wrapLines(ctx, chunk, maxW, baseSize);
  const lineH = baseSize * 1.25;
  const totalH = lines.length * lineH;
  let y = (height - totalH) / 2 + lineH * 0.7;

  ctx.textBaseline = 'alphabetic';

  for (const line of lines) {
    let xOff = (width - lineWidth(ctx, line, baseSize)) / 2;
    for (let i = 0; i < line.length; i++) {
      const w = line[i];
      const wi = words.indexOf(w);
      const isActive = wi === activeI;
      const isPast = wi < activeI;
      const wText = w.text;
      ctx.font = `${isActive ? 700 : 600} ${baseSize}px ${SANS}`;
      const ww = ctx.measureText(wText).width;
      if (isActive) ctx.fillStyle = palette.primary;
      else if (isPast) ctx.fillStyle = rgba(palette.light, 0.92);
      else ctx.fillStyle = rgba(palette.light, 0.36);
      ctx.fillText(wText, xOff, y);
      xOff += ww + ctx.measureText(' ').width;
    }
    y += lineH;
  }
}

function drawUnderlinePop(ctx, opts) {
  const { width, height, palette, words, time, textScale } = opts;
  const { padding } = drawCaptionBackground(ctx, opts);
  if (!words.length) return;

  const chunks = chunkIntoSentences(words);
  const { chunk } = currentChunk(chunks, time);
  const activeI = findActiveIndex(words, time);

  const maxW = width - padding * 2;
  const baseSize = Math.min(width, height) * 0.052 * textScale;
  const lines = wrapLines(ctx, chunk, maxW, baseSize);
  const lineH = baseSize * 1.25;
  const totalH = lines.length * lineH;
  let y = (height - totalH) / 2 + lineH * 0.7;

  ctx.font = `600 ${baseSize}px ${SANS}`;
  ctx.textBaseline = 'alphabetic';

  for (const line of lines) {
    let xOff = (width - lineWidth(ctx, line, baseSize)) / 2;
    for (let i = 0; i < line.length; i++) {
      const w = line[i];
      const wi = words.indexOf(w);
      const isActive = wi === activeI;
      const isPast = wi < activeI;
      const wText = w.text;
      const ww = ctx.measureText(wText).width;
      if (isActive) {
        ctx.fillStyle = palette.primary;
        ctx.fillText(wText, xOff, y);
        ctx.strokeStyle = palette.primary;
        ctx.lineWidth = Math.max(3, baseSize * 0.11);
        ctx.lineCap = 'round';
        ctx.beginPath();
        const uy = y + baseSize * 0.14;
        ctx.moveTo(xOff, uy);
        ctx.lineTo(xOff + ww, uy);
        ctx.stroke();
      } else if (isPast) {
        ctx.fillStyle = rgba(palette.light, 0.85);
        ctx.fillText(wText, xOff, y);
      } else {
        ctx.fillStyle = rgba(palette.light, 0.32);
        ctx.fillText(wText, xOff, y);
      }
      xOff += ww + ctx.measureText(' ').width;
    }
    y += lineH;
  }
}

function drawBarLine(ctx, opts) {
  const { width, height, palette, words, time, textScale } = opts;
  const { padding } = drawCaptionBackground(ctx, opts);
  if (!words.length) return;

  const chunks = chunkIntoSentences(words);
  const { chunk } = currentChunk(chunks, time);
  const activeI = findActiveIndex(words, time);

  const maxW = width - padding * 2;
  const baseSize = Math.min(width, height) * 0.05 * textScale;
  const lines = wrapLines(ctx, chunk, maxW, baseSize);
  const lineH = baseSize * 1.28;
  const totalH = lines.length * lineH;
  let y = (height - totalH) / 2 + lineH * 0.72;

  ctx.font = `600 ${baseSize}px ${SANS}`;
  ctx.textBaseline = 'alphabetic';

  for (const line of lines) {
    let xOff = (width - lineWidth(ctx, line, baseSize)) / 2;
    for (let i = 0; i < line.length; i++) {
      const w = line[i];
      const wi = words.indexOf(w);
      const isActive = wi === activeI;
      const isPast = wi < activeI;
      const wText = w.text;
      const ww = ctx.measureText(wText).width;
      if (isActive) {
        const barH = baseSize * 0.62;
        const barY = y - baseSize * 0.76;
        ctx.fillStyle = rgba(palette.primary, 0.5);
        roundRect(ctx, xOff - baseSize * 0.12, barY, ww + baseSize * 0.24, barH, barH / 2);
        ctx.fill();
        ctx.fillStyle = palette.light;
        ctx.fillText(wText, xOff, y);
      } else if (isPast) {
        ctx.fillStyle = rgba(palette.light, 0.88);
        ctx.fillText(wText, xOff, y);
      } else {
        ctx.fillStyle = rgba(palette.light, 0.35);
        ctx.fillText(wText, xOff, y);
      }
      xOff += ww + ctx.measureText(' ').width;
    }
    y += lineH;
  }
}

function drawLeftBlock(ctx, opts) {
  const { width, height, palette, words, time, textScale } = opts;
  const { padding } = drawCaptionBackground(ctx, opts);
  if (!words.length) return;

  const chunks = chunkIntoSentences(words);
  const { chunk } = currentChunk(chunks, time);
  const activeI = findActiveIndex(words, time);

  const maxW = width - padding * 2;
  const baseSize = Math.min(width, height) * 0.048 * textScale;
  const lines = wrapLines(ctx, chunk, maxW, baseSize);
  const lineH = baseSize * 1.28;
  const totalH = lines.length * lineH;
  let y = (height - totalH) / 2 + lineH * 0.72;

  ctx.textBaseline = 'alphabetic';

  for (const line of lines) {
    let xOff = padding;
    for (let i = 0; i < line.length; i++) {
      const w = line[i];
      const wi = words.indexOf(w);
      const isActive = wi === activeI;
      const isPast = wi < activeI;
      const wText = w.text;
      ctx.font = `${isActive ? 700 : 600} ${baseSize}px ${SANS}`;
      const ww = ctx.measureText(wText).width;
      if (isActive) ctx.fillStyle = palette.primary;
      else if (isPast) ctx.fillStyle = rgba(palette.light, 0.9);
      else ctx.fillStyle = rgba(palette.light, 0.38);
      ctx.fillText(wText, xOff, y);
      xOff += ww + ctx.measureText(' ').width;
    }
    y += lineH;
  }
}

const RENDERERS = {
  karaoke: drawKaraoke,
  spotlight: drawSpotlight,
  cascade: drawCascade,
  mono_callout: drawMonoCallout,
  mono_callout_glow: drawMonoCalloutGlow,
  plain_center: drawPlainCenter,
  bar_line: drawBarLine,
  left_block: drawLeftBlock,
  underline_pop: drawUnderlinePop,
};

// ---------- App component ----------

export default function LyricVideoStudio({ embedded = false }) {
  // Inputs
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [serverElevenlabs, setServerElevenlabs] = useState(null);
  const [text, setText] = useState("This is your text. Generate a voice performance, customize the style, and export a synced video.");
  const [voiceId, setVoiceId] = useState(VOICES[0].id);

  // Generation state
  const [audioUrl, setAudioUrl] = useState(null);
  const [audioBlob, setAudioBlob] = useState(null);
  const [words, setWords] = useState([]);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);

  // Style controls
  const [paletteKey, setPaletteKey] = useState('teal');
  const [scaleKey, setScaleKey] = useState('m');

  // AI suggestion
  const [suggesting, setSuggesting] = useState(false);
  const [suggestion, setSuggestion] = useState(null);

  // Playback
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  // Export
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);

  // Refs
  const audioRef = useRef(null);
  const canvasRef = useRef(null);
  const previewWrapRef = useRef(null);
  const rafRef = useRef(null);
  const audioCtxRef = useRef(null);
  const audioSourceRef = useRef(null);
  const audioDestRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);

  // ---- Load fonts ----
  useEffect(() => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500;600&display=swap';
    document.head.appendChild(link);
    return () => { try { document.head.removeChild(link); } catch (e) {} };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/admin/lyric-studio/capabilities', { credentials: 'include' })
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((j) => {
        if (!cancelled) setServerElevenlabs(Boolean(j?.elevenlabsConfigured));
      })
      .catch(() => {
        if (!cancelled) setServerElevenlabs(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // ---- Set up audio context for capture (lazy, once) ----
  const ensureAudioRouting = useCallback(() => {
    if (!audioRef.current) return;
    if (audioSourceRef.current) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      const ctx = new AC();
      const source = ctx.createMediaElementSource(audioRef.current);
      const dest = ctx.createMediaStreamDestination();
      source.connect(dest);
      source.connect(ctx.destination);
      audioCtxRef.current = ctx;
      audioSourceRef.current = source;
      audioDestRef.current = dest;
    } catch (e) {
      console.warn('Audio routing setup failed:', e);
    }
  }, []);

  // ---- Render loop ----
  const renderFrame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const aspect = ASPECTS[aspectKey];
    if (canvas.width !== aspect.w || canvas.height !== aspect.h) {
      canvas.width = aspect.w;
      canvas.height = aspect.h;
    }
    const ctx = canvas.getContext('2d');
    const palette = PALETTES[paletteKey];
    const renderer = RENDERERS[styleKey] || drawKaraoke;
    renderer(ctx, {
      width: aspect.w,
      height: aspect.h,
      palette,
      words,
      time: currentTime,
      textScale: TEXT_SCALES[scaleKey].factor,
    });
  }, [aspectKey, paletteKey, styleKey, scaleKey, words, currentTime]);

  // Continuously render when playing OR when settings change (single shot on dep change)
  useEffect(() => {
    renderFrame();
  }, [renderFrame]);

  useEffect(() => {
    if (!playing && !exporting) return;
    const tick = () => {
      const a = audioRef.current;
      if (a) setCurrentTime(a.currentTime);
      renderFrame();
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [playing, exporting, renderFrame]);

  // ---- Generate voice (with timestamps) ----
  const generateVoice = async () => {
    if (!text.trim()) { setError('Add some text to vocalize.'); return; }
    const useServer = serverElevenlabs === true;
    if (!useServer && !apiKey.trim()) {
      setError('Paste your ElevenLabs API key, or set ELEVENLABS_API_KEY on the server (e.g. Railway).');
      return;
    }
    setError(null);
    setGenerating(true);
    setWords([]);
    setSuggestion(null);
    setCurrentTime(0);
    setPlaying(false);
    if (audioRef.current) { try { audioRef.current.pause(); } catch (e) {} }
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl(null);
    setAudioBlob(null);

    try {
      let data;
      if (useServer) {
        const res = await fetch('/api/admin/lyric-studio/synthesize-with-timestamps', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ text, voiceId }),
        });
        let body = {};
        try {
          body = await res.json();
        } catch (_e) {
          body = {};
        }
        if (!res.ok) {
          throw new Error(body?.error || `Request failed (${res.status})`);
        }
        data = body;
      } else {
        const res = await fetch(
          `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps`,
          {
            method: 'POST',
            headers: {
              'xi-api-key': apiKey.trim(),
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            body: JSON.stringify(buildElevenLabsTtsPayload(text)),
          }
        );
        if (!res.ok) {
          const err = await res.text();
          throw new Error(`ElevenLabs ${res.status}: ${err.slice(0, 200)}`);
        }
        data = await res.json();
      }

      const b64 = data.audio_base64;
      if (!b64 || typeof b64 !== 'string') {
        throw new Error('ElevenLabs response had no audio_base64.');
      }
      const bin = atob(b64);
      const buf = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      const blob = new Blob([buf], { type: 'audio/mpeg' });
      const url = URL.createObjectURL(blob);

      const alignment = data.normalized_alignment || data.alignment;
      const wordList = buildWordsFromAlignment(alignment);
      if (!wordList.length) {
        throw new Error('No word-level alignment returned; cannot preview captions.');
      }

      setAudioBlob(blob);
      setAudioUrl(url);
      setWords(wordList);
    } catch (e) {
      setError(e.message || 'Generation failed.');
    } finally {
      setGenerating(false);
    }
  };

  // ---- Claude suggestion ----
  const askClaude = async () => {
    if (!text.trim()) { setError('Add text first.'); return; }
    setError(null);
    setSuggesting(true);
    setSuggestion(null);
    try {
      const res = await fetch('/api/admin/lyric-studio/style-suggestion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ text }),
      });
      if (!res.ok) {
        let detail = `${res.status}`;
        try {
          const body = await res.json();
          if (body?.error) detail = `${res.status}: ${body.error}`;
        } catch (_e) {
          /* ignore */
        }
        throw new Error(detail);
      }
      const parsed = await res.json();

      if (PALETTES[parsed.palette])   setPaletteKey(parsed.palette);
      let stylePick = parsed.style;
      if (stylePick === 'subtitle' || stylePick === 'soft_window') stylePick = 'plain_center';
      if (STYLES[stylePick]) setStyleKey(stylePick);
      if (ASPECTS[parsed.aspect])     setAspectKey(parsed.aspect);
      if (TEXT_SCALES[parsed.textScale]) setScaleKey(parsed.textScale);
      setSuggestion(parsed);
    } catch (e) {
      setError(e.message || 'Suggestion failed.');
    } finally {
      setSuggesting(false);
    }
  };

  // ---- Playback controls ----
  const togglePlay = async () => {
    const a = audioRef.current;
    if (!a || !audioUrl) return;
    ensureAudioRouting();
    if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
      try { await audioCtxRef.current.resume(); } catch (e) {}
    }
    if (a.paused) { await a.play(); setPlaying(true); }
    else { a.pause(); setPlaying(false); }
  };

  const onAudioMeta = () => {
    if (audioRef.current) setDuration(audioRef.current.duration || 0);
  };
  const onAudioTime = () => {
    if (audioRef.current && !playing) setCurrentTime(audioRef.current.currentTime);
  };
  const onAudioEnd = () => { setPlaying(false); };

  const scrub = (e) => {
    if (!audioRef.current || !duration) return;
    const pct = parseFloat(e.target.value);
    audioRef.current.currentTime = pct * duration;
    setCurrentTime(pct * duration);
  };

  // ---- Export ----
  const pickMime = () => {
    const candidates = [
      'video/mp4;codecs=h264,aac',
      'video/mp4',
      'video/webm;codecs=h264,opus',
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm',
    ];
    for (const c of candidates) {
      if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(c)) return c;
    }
    return 'video/webm';
  };

  const exportVideo = async () => {
    const a = audioRef.current;
    const canvas = canvasRef.current;
    if (!a || !canvas || !audioUrl) { setError('Generate voice first.'); return; }
    setError(null);

    ensureAudioRouting();
    if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
      try { await audioCtxRef.current.resume(); } catch (e) {}
    }
    if (!audioDestRef.current) { setError('Audio routing unavailable in this browser.'); return; }

    const mime = pickMime();
    const ext = mime.includes('mp4') ? 'mp4' : 'webm';

    const videoStream = canvas.captureStream(30);
    const audioTracks = audioDestRef.current.stream.getAudioTracks();
    const combined = new MediaStream([
      ...videoStream.getVideoTracks(),
      ...audioTracks,
    ]);

    let recorder;
    try {
      recorder = new MediaRecorder(combined, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
    } catch (e) {
      setError(`MediaRecorder failed: ${e.message}. Your browser may not support video recording.`);
      return;
    }
    recorderRef.current = recorder;
    chunksRef.current = [];

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };

    const finalize = () => new Promise((resolve) => {
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mime });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `lyric-video-${Date.now()}.${ext}`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => URL.revokeObjectURL(url), 4000);
        resolve();
      };
    });

    setExporting(true);
    setExportProgress(0);

    // Reset and play
    a.currentTime = 0;
    setCurrentTime(0);

    const progressInterval = setInterval(() => {
      const d = a.duration || 1;
      setExportProgress(Math.min(1, a.currentTime / d));
    }, 100);

    const endHandler = async () => {
      a.removeEventListener('ended', endHandler);
      clearInterval(progressInterval);
      // small tail to capture last frame
      await new Promise(r => setTimeout(r, 200));
      recorder.stop();
      await finalize();
      setExporting(false);
      setExportProgress(0);
      setPlaying(false);
    };
    a.addEventListener('ended', endHandler);

    recorder.start(100);
    try {
      await a.play();
      setPlaying(true);
    } catch (e) {
      clearInterval(progressInterval);
      recorder.stop();
      setExporting(false);
      setError(`Playback failed: ${e.message}`);
    }
  };

  // Apply aspect change resets currentTime visualization
  useEffect(() => { renderFrame(); }, [aspectKey, renderFrame]);

  // ---- Computed ----
  const palette = PALETTES[paletteKey];
  const shellBg = palette.dark;
  const sectionAccent = palette.primary;

  // ---- Render ----
  return (
    <div
      style={{
        minHeight: embedded ? 'auto' : '100vh',
        background: shellBg,
        fontFamily: SANS,
        color: palette.light,
        transition: 'background 250ms ease',
      }}
      className={`p-2 sm:p-3${embedded ? ' lyric-studio-embedded' : ''}`}
    >
      {!embedded && (
        <div className="flex items-center justify-between mb-2 px-3 py-3">
          <div className="flex items-center gap-3">
            <div
              style={{ background: sectionAccent }}
              className="w-7 h-7 rounded-md flex items-center justify-center"
            >
              <Film className="w-4 h-4 text-black" strokeWidth={2.5}/>
            </div>
            <div className="leading-tight">
              <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: '0.08em' }} className="opacity-60">
                CHANNEL 1 / STUDIO
              </div>
              <div style={{ fontFamily: SANS, fontWeight: 600 }} className="text-base">
                Lyric Video Studio
              </div>
            </div>
          </div>
          <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: '0.08em' }} className="opacity-50 hidden sm:block">
            ELEVENLABS · CLAUDE · CANVAS
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-2">
        {/* Sidebar / controls */}
        <div
          style={{ background: '#FFFFFF', color: '#17181A', borderRadius: 16 }}
          className={
            embedded
              ? 'p-5 lg:max-h-[calc(100vh-12rem)] lg:overflow-y-auto'
              : 'p-5 lg:max-h-[calc(100vh-80px)] lg:overflow-y-auto'
          }
        >
          {/* Step 1: API + text */}
          <SectionLabel n="01" title="INPUT" accent={sectionAccent} />

          {serverElevenlabs === false && (
            <>
              <label style={{ fontFamily: MONO, fontSize: 11, letterSpacing: '0.08em' }} className="block mt-3 mb-1.5 text-gray-500">
                ELEVENLABS API KEY
              </label>
              <div className="relative">
                <input
                  type={showKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="xi-api-key..."
                  style={{ fontFamily: MONO }}
                  className="w-full bg-[#F0F2F7] border-0 rounded-lg px-3 py-2.5 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-black/10"
                />
                <button
                  onClick={() => setShowKey(!showKey)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-md hover:bg-black/5"
                  aria-label="Toggle key visibility"
                >
                  {showKey ? <EyeOff className="w-4 h-4 text-gray-500"/> : <Eye className="w-4 h-4 text-gray-500"/>}
                </button>
              </div>
              <p style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.06em' }} className="text-gray-400 mt-1.5">
                STORED IN MEMORY ONLY. NOT SAVED.
              </p>
            </>
          )}
          {serverElevenlabs === true && (
            <p style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.06em' }} className="text-gray-500 mt-3 leading-relaxed">
              Voice synthesis uses ElevenLabs <strong>{ELEVEN_MODEL_ID}</strong> via server <code className="text-[11px] bg-[#F0F2F7] px-1 rounded">ELEVENLABS_API_KEY</code>
              {' '}(Railway variables). Paste a local key below is not needed.
            </p>
          )}
          {serverElevenlabs === null && (
            <p style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.06em' }} className="text-gray-400 mt-3">
              Checking server voice configuration…
            </p>
          )}

          <label style={{ fontFamily: MONO, fontSize: 11, letterSpacing: '0.08em' }} className="block mt-4 mb-1.5 text-gray-500">
            TEXT
          </label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={5}
            placeholder="Paste your script here..."
            style={{ fontFamily: SANS }}
            className="w-full bg-[#F0F2F7] border-0 rounded-lg px-3 py-2.5 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-black/10 resize-y"
          />
          <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.06em' }} className="text-gray-400 mt-1 flex justify-between">
            <span>{text.length} CHARACTERS</span>
            <span>~{Math.ceil(text.split(/\s+/).filter(Boolean).length / 2.5)}S ESTIMATED</span>
          </div>

          <label style={{ fontFamily: MONO, fontSize: 11, letterSpacing: '0.08em' }} className="block mt-4 mb-1.5 text-gray-500">
            VOICE
          </label>
          <select
            value={voiceId}
            onChange={(e) => setVoiceId(e.target.value)}
            style={{ fontFamily: SANS }}
            className="w-full bg-[#F0F2F7] border-0 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-black/10"
          >
            {VOICES.map(v => (
              <option key={v.id} value={v.id}>{v.name} — {v.vibe}</option>
            ))}
          </select>

          <button
            onClick={generateVoice}
            disabled={generating}
            style={{ background: '#17181A', fontFamily: MONO, letterSpacing: '0.08em' }}
            className="mt-4 w-full text-white text-xs font-medium py-3 rounded-full flex items-center justify-center gap-2 hover:bg-black disabled:opacity-50 transition-all"
          >
            {generating ? <Loader2 className="w-4 h-4 animate-spin"/> : <Mic className="w-4 h-4"/>}
            {generating ? 'SYNTHESIZING…' : 'GENERATE VOICE + ALIGNMENT'}
          </button>

          {error && (
            <div className="mt-3 p-2.5 rounded-lg bg-red-50 border border-red-200 flex gap-2 items-start">
              <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5"/>
              <div className="text-xs text-red-700 break-words">{error}</div>
            </div>
          )}

          {words.length > 0 && (
            <div className="mt-3 p-2.5 rounded-lg bg-green-50 border border-green-200 flex gap-2 items-center">
              <Check className="w-4 h-4 text-green-600 flex-shrink-0"/>
              <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: '0.06em' }} className="text-green-800">
                {words.length} WORDS · {duration.toFixed(2)}S
              </div>
            </div>
          )}

          {/* Step 2: Style */}
          <div className="mt-7">
            <div className="flex items-center justify-between">
              <SectionLabel n="02" title="STYLE" accent={sectionAccent} />
              <button
                onClick={askClaude}
                disabled={suggesting || !text.trim()}
                style={{ background: '#FFB700', color: '#17181A', fontFamily: MONO, letterSpacing: '0.06em' }}
                className="text-[10px] font-medium px-2.5 py-1.5 rounded-full flex items-center gap-1 disabled:opacity-50 hover:brightness-95 transition-all"
              >
                {suggesting ? <Loader2 className="w-3 h-3 animate-spin"/> : <Sparkles className="w-3 h-3"/>}
                {suggesting ? 'THINKING' : 'AI SUGGEST'}
              </button>
            </div>

            {suggestion && (
              <div style={{ borderColor: sectionAccent }} className="mt-2 mb-1 p-2.5 rounded-lg border-l-2 bg-amber-50/40">
                <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.08em' }} className="text-gray-500 mb-0.5">
                  CLAUDE / MOOD
                </div>
                <div style={{ fontFamily: SANS }} className="text-xs leading-snug text-gray-700">
                  {suggestion.mood}
                </div>
              </div>
            )}

            <label style={{ fontFamily: MONO, fontSize: 11, letterSpacing: '0.08em' }} className="block mt-3 mb-1.5 text-gray-500">
              STYLE PRESET
            </label>
            <div className="grid grid-cols-2 gap-1">
              {Object.entries(STYLES).map(([k, v]) => (
                <button
                  key={k}
                  onClick={() => setStyleKey(k)}
                  className={`text-left px-3 py-2 rounded-lg border transition-all flex items-center justify-between ${
                    styleKey === k ? 'border-black bg-black text-white' : 'border-gray-200 hover:border-gray-400 bg-white'
                  }`}
                >
                  <div>
                    <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: '0.08em' }}>
                      {v.name}
                    </div>
                    <div style={{ fontFamily: SANS, fontSize: 11 }} className={styleKey === k ? 'opacity-70' : 'text-gray-500'}>
                      {v.blurb}
                    </div>
                  </div>
                  {styleKey === k && <Check className="w-3.5 h-3.5"/>}
                </button>
              ))}
            </div>

            <label style={{ fontFamily: MONO, fontSize: 11, letterSpacing: '0.08em' }} className="block mt-4 mb-1.5 text-gray-500">
              COLOR PALETTE
            </label>
            <div className="grid grid-cols-4 gap-1.5">
              {Object.entries(PALETTES).map(([k, v]) => (
                <button
                  key={k}
                  onClick={() => setPaletteKey(k)}
                  className={`relative aspect-square rounded-lg overflow-hidden border-2 transition-all ${
                    paletteKey === k ? 'border-black' : 'border-transparent hover:border-gray-300'
                  }`}
                  style={{ background: v.dark }}
                  title={v.name}
                >
                  <div style={{ background: v.primary }} className="absolute bottom-0 right-0 w-1/2 h-1/2"/>
                  <div style={{ background: v.light }} className="absolute top-0 right-0 w-1/4 h-1/4"/>
                  <div style={{ fontFamily: MONO, fontSize: 8, letterSpacing: '0.06em' }} className="absolute bottom-0 left-0 right-0 text-center pb-0.5 text-white mix-blend-difference">
                    {v.name}
                  </div>
                </button>
              ))}
            </div>

            <label style={{ fontFamily: MONO, fontSize: 11, letterSpacing: '0.08em' }} className="block mt-4 mb-1.5 text-gray-500">
              ASPECT RATIO
            </label>
            <div className="grid grid-cols-4 gap-1.5">
              {Object.entries(ASPECTS).map(([k, v]) => (
                <button
                  key={k}
                  onClick={() => setAspectKey(k)}
                  className={`px-2 py-2 rounded-lg border flex flex-col items-center justify-center gap-1 ${
                    aspectKey === k ? 'border-black bg-black text-white' : 'border-gray-200 hover:border-gray-400 bg-white'
                  }`}
                >
                  <v.Icon className="w-3.5 h-3.5"/>
                  <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.06em' }}>{v.label}</div>
                </button>
              ))}
            </div>

            <label style={{ fontFamily: MONO, fontSize: 11, letterSpacing: '0.08em' }} className="block mt-4 mb-1.5 text-gray-500">
              TEXT SIZE
            </label>
            <div className="grid grid-cols-4 gap-1.5">
              {Object.entries(TEXT_SCALES).map(([k, v]) => (
                <button
                  key={k}
                  onClick={() => setScaleKey(k)}
                  className={`px-2 py-2 rounded-lg border ${
                    scaleKey === k ? 'border-black bg-black text-white' : 'border-gray-200 hover:border-gray-400 bg-white'
                  }`}
                  style={{ fontFamily: MONO, fontSize: 11, letterSpacing: '0.08em' }}
                >
                  {v.name}
                </button>
              ))}
            </div>
          </div>

          {/* Step 3: Export */}
          <div className="mt-7">
            <SectionLabel n="03" title="EXPORT" accent={sectionAccent} />
            <button
              onClick={exportVideo}
              disabled={!audioUrl || exporting}
              style={{ background: sectionAccent, color: '#17181A', fontFamily: MONO, letterSpacing: '0.08em' }}
              className="mt-3 w-full text-xs font-medium py-3 rounded-full flex items-center justify-center gap-2 disabled:opacity-40 hover:brightness-95 transition-all"
            >
              {exporting ? <Loader2 className="w-4 h-4 animate-spin"/> : <Download className="w-4 h-4"/>}
              {exporting ? `RECORDING… ${Math.round(exportProgress*100)}%` : 'RECORD & DOWNLOAD VIDEO'}
            </button>
            {exporting && (
              <div className="mt-2 h-1 bg-gray-200 rounded-full overflow-hidden">
                <div style={{ width: `${exportProgress*100}%`, background: sectionAccent }} className="h-full transition-all"/>
              </div>
            )}
            <p style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.06em' }} className="text-gray-400 mt-2 leading-relaxed">
              RECORDS IN REAL TIME — A 30S CLIP TAKES 30S. OUTPUT IS MP4 WHERE SUPPORTED (CHROME/SAFARI), OTHERWISE WEBM.
            </p>
          </div>
        </div>

        {/* Preview */}
        <div
          ref={previewWrapRef}
          style={{ background: '#FFFFFF', borderRadius: 16 }}
          className="p-4 flex flex-col"
        >
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div style={{ background: sectionAccent }} className="w-1.5 h-1.5 rounded-full"/>
              <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: '0.08em' }} className="text-gray-500">
                LIVE PREVIEW · {ASPECTS[aspectKey].label}
              </div>
            </div>
            <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: '0.08em' }} className="text-gray-500">
              {STYLES[styleKey].name} / {PALETTES[paletteKey].name}
            </div>
          </div>

          <div className="flex-1 flex items-center justify-center bg-[#F0F2F7] rounded-xl p-4 min-h-[400px]">
            <canvas
              ref={canvasRef}
              style={{
                maxWidth: '100%',
                maxHeight: embedded ? 'calc(100vh - 22rem)' : 'calc(100vh - 280px)',
                width: 'auto',
                height: 'auto',
                aspectRatio: `${ASPECTS[aspectKey].w} / ${ASPECTS[aspectKey].h}`,
                background: '#000',
                borderRadius: 8,
                boxShadow: '0 10px 40px rgba(0,0,0,0.15)',
              }}
            />
          </div>

          {/* Transport */}
          <div className="mt-3 flex items-center gap-3">
            <button
              onClick={togglePlay}
              disabled={!audioUrl}
              style={{ background: '#17181A' }}
              className="w-11 h-11 rounded-full flex items-center justify-center text-white disabled:opacity-30 hover:bg-black transition-all"
            >
              {playing ? <Pause className="w-4 h-4"/> : <Play className="w-4 h-4 ml-0.5"/>}
            </button>
            <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: '0.06em' }} className="text-gray-600 tabular-nums w-16">
              {formatTime(currentTime)}
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.0001"
              value={duration ? currentTime / duration : 0}
              onChange={scrub}
              disabled={!audioUrl}
              className="flex-1 accent-black"
              style={{ accentColor: sectionAccent }}
            />
            <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: '0.06em' }} className="text-gray-600 tabular-nums w-16 text-right">
              {formatTime(duration)}
            </div>
          </div>

          <audio
            ref={audioRef}
            src={audioUrl || undefined}
            onLoadedMetadata={onAudioMeta}
            onTimeUpdate={onAudioTime}
            onEnded={onAudioEnd}
            crossOrigin="anonymous"
          />
        </div>
      </div>
    </div>
  );
}

function SectionLabel({ n, title, accent }) {
  return (
    <div className="flex items-center gap-2">
      <div
        style={{ background: accent, fontFamily: 'monospace', fontSize: 10 }}
        className="px-1.5 py-0.5 rounded text-black font-medium tabular-nums"
      >
        {n}
      </div>
      <div style={{ fontFamily: '"Geist Mono", ui-monospace, monospace', fontSize: 12, letterSpacing: '0.1em' }} className="font-medium text-gray-900">
        {title}
      </div>
    </div>
  );
}

function formatTime(s) {
  if (!s || !isFinite(s)) return '00:00.00';
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2,'0')}:${sec.toFixed(2).padStart(5, '0')}`;
}
