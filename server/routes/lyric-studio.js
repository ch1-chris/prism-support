import { Router } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { asyncHandler } from '../middleware/asyncHandler.js';

const router = Router();

const MODEL = 'claude-sonnet-4-6';
const ELEVEN_MODEL_ID = 'eleven_v3';

const PALETTE_KEYS = ['teal', 'magenta', 'purple', 'orange', 'blue', 'green', 'gold', 'mono'].join(', ');
const STYLE_KEYS = [
  'karaoke', 'spotlight', 'cascade', 'mono_callout', 'mono_callout_glow',
  'plain_center', 'bar_line', 'left_block', 'underline_pop',
].join(', ');

function elevenLabsTtsBody(text) {
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

function parseJSON(text) {
  let s = text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');
  s = s.replace(/```json|```/g, '').trim();
  return JSON.parse(s);
}

function buildPrompt(script) {
  return `You are designing a lyric / narration video that follows the Channel 1 design system (mono uppercase labels, accent-colored highlights, clean sans display type). Pick the best look for this script.

SCRIPT:
"""
${script}
"""

Choose one option from each list.
- palette: ${PALETTE_KEYS}
- style:   ${STYLE_KEYS}
- aspect:  16:9 | 9:16 | 1:1 | 4:5
- textScale: s | m | l | xl

Respond ONLY with valid JSON, no markdown fences, no preamble:
{
  "palette": "<key>",
  "style": "<key>",
  "aspect": "16:9|9:16|1:1|4:5",
  "textScale": "s|m|l|xl",
  "mood": "<one short sentence>",
  "reasoning": "<one sentence explaining the pick>"
}`;
}

router.get('/capabilities', (_req, res) => {
  res.json({
    elevenlabsConfigured: Boolean(String(process.env.ELEVENLABS_API_KEY ?? '').trim()),
  });
});

router.post('/synthesize-with-timestamps', asyncHandler(async (req, res) => {
  const text = req.body?.text;
  const voiceId = req.body?.voiceId;
  if (typeof text !== 'string' || !text.trim()) {
    res.status(400).json({ error: 'text is required' });
    return;
  }
  if (typeof voiceId !== 'string' || !voiceId.trim()) {
    res.status(400).json({ error: 'voiceId is required' });
    return;
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!String(apiKey ?? '').trim()) {
    res.status(503).json({ error: 'Server is not configured with ELEVENLABS_API_KEY.' });
    return;
  }

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId.trim())}/with-timestamps`;
  const upstream = await fetch(url, {
    method: 'POST',
    headers: {
      'xi-api-key': String(apiKey).trim(),
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(elevenLabsTtsBody(text.trim())),
  });

  const raw = await upstream.text();
  if (!upstream.ok) {
    let msg = raw.slice(0, 1200);
    try {
      const j = JSON.parse(raw);
      if (j?.detail?.message) msg = j.detail.message;
      else if (typeof j?.detail === 'string') msg = j.detail;
      else if (j?.message) msg = j.message;
    } catch (_e) {
      /* keep raw slice */
    }
    res.status(upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502).json({
      error: `ElevenLabs ${upstream.status}: ${msg}`,
    });
    return;
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (_e) {
    res.status(502).json({ error: 'ElevenLabs returned invalid JSON.' });
    return;
  }

  res.json(data);
}));

router.post('/style-suggestion', asyncHandler(async (req, res) => {
  const text = req.body?.text;
  if (typeof text !== 'string' || !text.trim()) {
    res.status(400).json({ error: 'text is required' });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    const err = new Error('Server is not configured with ANTHROPIC_API_KEY.');
    err.status = 503;
    throw err;
  }

  const anthropic = new Anthropic({ apiKey });
  const claudeResponse = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1000,
    messages: [{ role: 'user', content: buildPrompt(text.trim()) }],
  });

  const rawText = claudeResponse.content?.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  if (!rawText) {
    const err = new Error('Claude returned no text content');
    err.status = 502;
    throw err;
  }

  let parsed;
  try {
    parsed = parseJSON(rawText);
  } catch (_e) {
    const err = new Error(`Claude response was not valid JSON: ${rawText.slice(0, 200)}`);
    err.status = 502;
    throw err;
  }

  res.json(parsed);
}));

export default router;
